// Local text-to-speech via the Piper CLI.
//
// Piper is a small, fast, fully-offline TTS engine that runs on a single CPU
// (ONNX). Voice models live as `<voice>.onnx` + `<voice>.onnx.json` pairs in
// the app's `tts` data directory. Synthesis is done by shelling out to the
// `piper` binary; the resulting audio is a standard RIFF WAV written straight
// to disk (nothing is streamed through the webview).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Result of a successful synthesis, returned to the UI over Tauri IPC.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TtsInfo {
    pub path: String,
    pub size: u64,
}

// ---------------------------------------------------------------------------
// Voice catalog — must stay in sync with VOICES in tts.ts
// ---------------------------------------------------------------------------

const VOICE_IDS: &[&str] = &[
    "en_US-lessac-medium",
    "en_US-amy-medium",
    "en_GB-alba-medium",
    "ar_JO-kareem-medium",
];

/// The nested path under `rhasspy/piper-voices` where a voice's files live,
/// e.g. "ar_JO-kareem-medium" -> "ar/ar_JO/kareem/medium". The official repo
/// keeps files under `<lang>/<region>/<name>/<quality>/` — flat paths 404.
fn voice_repo_path(voice_id: &str) -> String {
    let parts: Vec<&str> = voice_id.split('-').collect();
    if parts.len() >= 3 {
        let region = parts[0];
        let lang = region.split('_').next().unwrap_or(region);
        format!("{lang}/{region}/{}/{quality}", parts[1], quality = parts[2])
    } else {
        voice_id.to_string()
    }
}

/// Pick a default voice: Arabic when the text contains Arabic script,
/// English otherwise. The app ships support for both.
pub fn default_voice_for(text: &str) -> String {
    if text.chars().any(|c| matches!(c, '\u{0600}'..='\u{06FF}')) {
        "ar_JO-kareem-medium".to_string()
    } else {
        "en_US-lessac-medium".to_string()
    }
}

/// Return the list of voice IDs whose `.onnx` + `.onnx.json` files both exist
/// in `model_dir`. Voices not yet downloaded are simply omitted.
pub fn available_voices(model_dir: &Path) -> Vec<String> {
    VOICE_IDS
        .iter()
        .filter(|id| {
            let onnx = model_dir.join(format!("{}.onnx", id));
            let json = model_dir.join(format!("{}.onnx.json", id));
            onnx.is_file() && json.is_file()
        })
        .map(|id| id.to_string())
        .collect()
}

// ---------------------------------------------------------------------------
// Dynamic voice & language discovery — NO hard-coded catalog.
//
// `available_voices` only checks the curated `VOICE_IDS`. These functions scan
// the model directory for ANY `*.onnx` + matching `*.onnx.json` pair, so every
// installed Piper voice — any language, any quality — is surfaced. The curated
// list remains a download shortcut; this is the source of truth for "what is
// actually installed".
// ---------------------------------------------------------------------------

/// Metadata for a voice discovered on disk (returned to the UI over IPC).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DiscoveredVoiceInfo {
    /// Voice id, e.g. "ar_JO-kareem-medium" (the Piper filename stem).
    pub id: String,
    /// ISO 639-1 language code parsed from the id, e.g. "ar", "en", "de".
    pub language: String,
    /// Region/dialect tag, e.g. "JO", "US", "GB" (may be empty).
    pub region: String,
    /// Voice name, e.g. "kareem", "amy".
    pub name: String,
    /// Quality, e.g. "low" | "medium" | "high".
    pub quality: String,
}

/// Parse a Piper voice id of the form `<lang>_<region>-<name>-<quality>`
/// (e.g. `ar_JO-kareem-medium`, `en_US-amy-medium`) into its parts.
/// Returns `(language, region, name, quality)` with empty strings for missing
/// parts, so a malformed id never breaks discovery.
pub fn parse_voice_id(voice_id: &str) -> (String, String, String, String) {
    let (region_part, rest) = voice_id
        .split_once('-')
        .map(|(a, b)| (a, Some(b)))
        .unwrap_or((voice_id, None));

    // region_part is "<lang>_<region>" (e.g. "ar_JO"). Lang is the part before
    // the first underscore; region is after it.
    let (language, region) = match region_part.split_once('_') {
        Some((lang, reg)) => (lang.to_string(), reg.to_string()),
        None => (region_part.to_string(), String::new()),
    };

    let (name, quality) = match rest {
        Some(r) => match r.rsplit_once('-') {
            // e.g. "kareem-medium" → name="kareem", quality="medium"
            Some((n, q)) => (n.to_string(), q.to_string()),
            None => (r.to_string(), String::new()),
        },
        None => (String::new(), String::new()),
    };

    (language, region, name, quality)
}

/// Try to read the language code from a voice's `.onnx.json` config. Piper
/// configs store it under `espeak.voice.id` as `<lang>-<dialect>...`. Falls
/// back to parsing the voice id when the file is unreadable or the field is
/// absent. Never panics.
fn language_from_config(json_path: &Path, fallback_voice_id: &str) -> String {
    if let Ok(raw) = std::fs::read_to_string(json_path) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) {
            // Piper stores the espeak voice id under `espeak.voice.id`, e.g.
            // "ar/ar_JO-kareem-medium" or "en-us". Take the leading language
            // token (before any "/" or "-").
            if let Some(vid) = val
                .get("espeak")
                .and_then(|e| e.get("voice"))
                .and_then(|v| v.get("id"))
                .and_then(|i| i.as_str())
            {
                let head = vid.split(['/', '-']).next().unwrap_or("").trim();
                if !head.is_empty() {
                    return head.to_lowercase();
                }
            }
            // Some configs put it at the top level under `language`.
            if let Some(lang) = val.get("language").and_then(|l| l.as_str()) {
                let head = lang.split(['/', '-']).next().unwrap_or("").trim();
                if !head.is_empty() {
                    return head.to_lowercase();
                }
            }
        }
    }
    // Fallback to id parsing.
    parse_voice_id(fallback_voice_id).0.to_lowercase()
}

/// Scan `model_dir` for every installed Piper voice. A voice counts as
/// installed when BOTH `<id>.onnx` and `<id>.onnx.json` exist. Returns every
/// match — no language/quality limit. Never panics; returns an empty vec when
/// the directory is missing or unreadable.
pub fn discover_installed_voices(model_dir: &Path) -> Vec<DiscoveredVoiceInfo> {
    let entries = match std::fs::read_dir(model_dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let mut found = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        // Only consider `.onnx` model files; each must have a sibling `.onnx.json`.
        let stem = match name.strip_suffix(".onnx") {
            Some(s) => s.to_string(),
            None => continue,
        };
        // Skip temp/partial downloads ("*.onnx.tmp") — they have no .onnx suffix.
        let json_path = model_dir.join(format!("{stem}.onnx.json"));
        if !json_path.is_file() {
            continue;
        }

        let (lang_id, region, voice_name, quality) = parse_voice_id(&stem);
        let language = language_from_config(&json_path, &stem);
        // Prefer the config-derived language; fall back to the id-derived one.
        let language = if language.is_empty() {
            lang_id.to_lowercase()
        } else {
            language
        };

        found.push(DiscoveredVoiceInfo {
            id: stem,
            language,
            region,
            name: voice_name,
            quality,
        });
    }

    // Stable order: language, then id.
    found.sort_by(|a, b| {
        a.language
            .cmp(&b.language)
            .then_with(|| a.id.cmp(&b.id))
    });
    found
}

/// Distinct, sorted language codes across all installed voices. Drives the
/// language dropdown in the UI. Never panics.
pub fn list_installed_languages(model_dir: &Path) -> Vec<String> {
    let mut langs: Vec<String> = discover_installed_voices(model_dir)
        .into_iter()
        .map(|v| v.language)
        .filter(|l| !l.is_empty())
        .collect();
    langs.sort();
    langs.dedup();
    langs
}

/// Download a voice model (`.onnx` + `.onnx.json`) from HuggingFace into
/// `model_dir`. The two files are fetched in parallel.
pub async fn download_voice(voice_id: &str, model_dir: &Path) -> Result<(), String> {
    let base_url = format!(
        "https://huggingface.co/rhasspy/piper-voices/resolve/main/{}",
        voice_repo_path(voice_id)
    );

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    // Download .onnx and .onnx.json in parallel
    let onnx_url = format!("{base_url}.onnx");
    let json_url = format!("{base_url}.onnx.json");

    let onnx_fut = client.get(&onnx_url).send();
    let json_fut = client.get(&json_url).send();

    let (onnx_resp, json_resp) = tokio::join!(onnx_fut, json_fut);

    let onnx_bytes = onnx_resp
        .map_err(|e| format!("Failed to download {voice_id}.onnx: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Failed to read {voice_id}.onnx bytes: {e}"))?;

    let json_bytes = json_resp
        .map_err(|e| format!("Failed to download {voice_id}.onnx.json: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Failed to read {voice_id}.onnx.json bytes: {e}"))?;

    // Write both files atomically (write to temp then rename)
    let onnx_path = model_dir.join(format!("{voice_id}.onnx"));
    let json_path = model_dir.join(format!("{voice_id}.onnx.json"));

    let onnx_tmp = model_dir.join(format!("{voice_id}.onnx.tmp"));
    let json_tmp = model_dir.join(format!("{voice_id}.onnx.json.tmp"));

    std::fs::write(&onnx_tmp, &onnx_bytes)
        .map_err(|e| format!("Failed to write {voice_id}.onnx: {e}"))?;
    std::fs::write(&json_tmp, &json_bytes)
        .map_err(|e| format!("Failed to write {voice_id}.onnx.json: {e}"))?;

    std::fs::rename(&onnx_tmp, &onnx_path)
        .map_err(|e| format!("Failed to rename {voice_id}.onnx: {e}"))?;
    std::fs::rename(&json_tmp, &json_path)
        .map_err(|e| format!("Failed to rename {voice_id}.onnx.json: {e}"))?;

    Ok(())
}

/// Check whether `ffmpeg` is available on the system PATH.
pub fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Convert a WAV file to MP3 using ffmpeg. Returns the output path on success.
pub fn convert_wav_to_mp3(wav_path: &Path, mp3_path: &Path) -> Result<TtsInfo, String> {
    if !ffmpeg_available() {
        return Err(
            "ffmpeg is not installed. Install it from https://ffmpeg.org to enable MP3 output."
                .to_string(),
        );
    }

    let output = Command::new("ffmpeg")
        .args([
            "-i",
            wav_path.to_str().unwrap_or(""),
            "-codec:a",
            "libmp3lame",
            "-qscale:a",
            "2",
            "-y",
            mp3_path.to_str().unwrap_or(""),
        ])
        .output()
        .map_err(|e| format!("Failed to launch ffmpeg: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg conversion failed: {stderr}"));
    }

    let size = std::fs::metadata(mp3_path)
        .map_err(|e| format!("MP3 file missing after conversion: {e}"))?
        .len();

    if size == 0 {
        return Err("ffmpeg produced an empty MP3 file.".to_string());
    }

    Ok(TtsInfo {
        path: mp3_path.to_string_lossy().into_owned(),
        size,
    })
}

/// The absolute path of the model file for `voice` inside `model_dir`.
pub fn model_paths(model_dir: &Path, voice: &str) -> (PathBuf, PathBuf) {
    (
        model_dir.join(format!("{voice}.onnx")),
        model_dir.join(format!("{voice}.onnx.json")),
    )
}

/// Synthesize `text` to a WAV file at `out_path` using the `piper` binary and
/// the given voice model. Returns the output path and byte size.
///
/// This is a pure, blocking function so it can be unit-tested directly; the
/// Tauri command wraps it in `spawn_blocking`.
pub fn synthesize_to_file(
    piper_bin: &str,
    model_dir: &Path,
    voice: &str,
    text: &str,
    out_path: &Path,
) -> Result<TtsInfo, String> {
    let (model_file, config_file) = model_paths(model_dir, voice);
    let mut selected_model = model_file.clone();
    let mut selected_config = config_file.clone();

    // Piper only ships ONE Arabic voice (ar_JO-kareem-medium). If it is not
    // installed, fall back to the English voice so a requested Arabic render
    // can still produce audio instead of hard-failing.
    if !selected_model.is_file() || !selected_config.is_file() {
        if voice == "ar_JO-kareem-medium" {
            let (en_model, en_config) = model_paths(model_dir, "en_US-lessac-medium");
            if en_model.is_file() && en_config.is_file() {
                selected_model = en_model;
                selected_config = en_config;
            } else {
                return Err(format!(
                    "The English fallback voice 'en_US-lessac-medium' is not downloaded. \
                     Go to the Audiobook or Podcast tab and click 'Download Voice' to install it. \
                     Expected files: {} and {}",
                    en_model.display(),
                    en_config.display()
                ));
            }
        } else {
            return Err(format!(
                "Voice model '{}' is not downloaded. \
                 Go to the Audiobook or Podcast tab and click 'Download Voice' to install it. \
                 Expected files: {} and {}",
                voice,
                model_file.display(),
                config_file.display()
            ));
        }
    }

    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create audio directory: {e}"))?;
    }

    // Piper reads input from a file (`-i`) or stdin. A temp file avoids
    // Windows stdin encoding pitfalls entirely.
    let input_path = std::env::temp_dir().join(format!("study-studio-tts-{}.txt", uuid::Uuid::new_v4()));
    std::fs::write(&input_path, text)
        .map_err(|e| format!("Failed to write TTS input: {e}"))?;

    let result = run_piper(piper_bin, &selected_model, &selected_config, &input_path, out_path);

    let _ = std::fs::remove_file(&input_path);
    result
}

/// Synthesize a two-host podcast script into a single WAV. Each line is read
/// with the voice matching its speaker (Host A / Host B); the segments are
/// then concatenated with ffmpeg. Requires ffmpeg on the system PATH.
pub fn synthesize_podcast_to_file(
    piper_bin: &str,
    model_dir: &Path,
    voice_a: &str,
    voice_b: &str,
    lines: &[(String, String)],
    out_path: &Path,
) -> Result<TtsInfo, String> {
    if lines.is_empty() {
        return Err("Podcast script is empty — nothing to synthesize.".to_string());
    }
    if !ffmpeg_available() {
        return Err(
            "ffmpeg is not installed. Install it from https://ffmpeg.org to enable podcast file generation."
                .to_string(),
        );
    }

    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create audio directory: {e}"))?;
    }

    // Work in a per-call temp dir so partial failures leave no debris.
    let work_dir =
        std::env::temp_dir().join(format!("study-studio-podcast-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&work_dir)
        .map_err(|e| format!("Failed to create temp dir: {e}"))?;

    let build = (|| -> Result<(), String> {
        let mut segments: Vec<std::path::PathBuf> = Vec::new();
        for (i, (speaker, text)) in lines.iter().enumerate() {
            let voice = if speaker == "Host A" { voice_a } else { voice_b };
            let seg = work_dir.join(format!("seg-{i:03}.wav"));
            synthesize_to_file(piper_bin, model_dir, voice, text, &seg)?;
            segments.push(seg);
        }

        let mut list = String::new();
        for seg in &segments {
            let p = seg.to_string_lossy().replace('\'', "'\\''");
            list.push_str(&format!("file '{p}'\n"));
        }
        let list_path = work_dir.join("list.txt");
        std::fs::write(&list_path, &list)
            .map_err(|e| format!("Failed to write concat list: {e}"))?;

        let output = Command::new("ffmpeg")
            .args([
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                list_path.to_str().unwrap_or(""),
                "-c:a",
                "pcm_s16le",
                out_path.to_str().unwrap_or(""),
            ])
            .output()
            .map_err(|e| format!("Failed to launch ffmpeg: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("ffmpeg podcast concat failed: {stderr}"));
        }
        Ok(())
    })();

    let _ = std::fs::remove_dir_all(&work_dir);

    build?;

    let size = std::fs::metadata(out_path)
        .map_err(|e| format!("Podcast audio file missing after concat: {e}"))?
        .len();

    if size == 0 {
        return Err("Podcast audio file is empty.".to_string());
    }

    Ok(TtsInfo {
        path: out_path.to_string_lossy().into_owned(),
        size,
    })
}

fn run_piper(
    piper_bin: &str,
    model_file: &Path,
    config_file: &Path,
    input_path: &Path,
    out_path: &Path,
) -> Result<TtsInfo, String> {
    let mut cmd = Command::new(piper_bin);
    cmd.arg("-m")
        .arg(model_file)
        .arg("-c")
        .arg(config_file)
        .arg("-i")
        .arg(input_path)
        .arg("-f")
        .arg(out_path)
        .arg("--sentence-silence")
        .arg("0.35");

    // Keep the console window hidden when spawned from the GUI app.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to launch piper ({piper_bin}): {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Piper synthesis failed ({status}): {stderr}",
            status = output.status
        ));
    }

    let size = std::fs::metadata(out_path)
        .map_err(|e| format!("Piper finished but output is missing: {e}"))?
        .len();

    if size == 0 {
        return Err("Piper produced an empty audio file.".to_string());
    }

    Ok(TtsInfo {
        path: out_path.to_string_lossy().into_owned(),
        size,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_env() -> Option<(String, PathBuf)> {
        let bin = std::env::var("STUDY_STUDIO_PIPER_BIN").unwrap_or_else(|_| "piper".to_string());
        let model_dir = std::env::var("STUDY_STUDIO_PIPER_MODEL_DIR")
            .map(PathBuf::from)
            .ok()?;
        let (model, config) = model_paths(&model_dir, "en_US-lessac-medium");
        if model.is_file() && config.is_file() {
            Some((bin, model_dir))
        } else {
            None
        }
    }

    #[test]
    fn defaults_to_english() {
        assert_eq!(default_voice_for("Hello there"), "en_US-lessac-medium");
        assert_eq!(
            default_voice_for("Quantum computing explained"),
            "en_US-lessac-medium"
        );
    }

    #[test]
    fn repo_paths_are_nested() {
        assert_eq!(
            voice_repo_path("ar_JO-kareem-medium"),
            "ar/ar_JO/kareem/medium"
        );
        assert_eq!(
            voice_repo_path("en_US-lessac-medium"),
            "en/en_US/lessac/medium"
        );
        assert_eq!(
            voice_repo_path("en_GB-alba-medium"),
            "en/en_GB/alba/medium"
        );
    }

    #[test]
    fn empty_podcast_script_is_an_error() {
        let out = std::env::temp_dir().join("tts-empty-podcast.wav");
        let res = synthesize_podcast_to_file(
            "piper",
            Path::new("C:/definitely-missing"),
            "en_US-lessac-medium",
            "en_US-amy-medium",
            &[],
            &out,
        );
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("empty"));
    }

    #[test]
    fn detects_arabic_script() {
        assert_eq!(default_voice_for("مرحبا بكم في بودكاست"), "ar_JO-kareem-medium");
        assert_eq!(
            default_voice_for("Study \u{0627}\u{0644}\u{0633}\u{0644}\u{0627}\u{0645} test"),
            "ar_JO-kareem-medium"
        );
    }

    #[test]
    fn missing_model_is_an_error() {
        let out = std::env::temp_dir().join("tts-missing-model-test.wav");
        let res = synthesize_to_file("piper", Path::new("C:/definitely-missing"), "en_US-lessac-medium", "hi", &out);
        assert!(res.is_err());
        let msg = res.unwrap_err().to_lowercase();
        assert!(msg.contains("model") || msg.contains("config"));
    }

    /// When the Arabic voice is missing the synthesizer must target the
    /// English fallback instead of erroring on the Arabic path. Using a
    /// definitely-missing dir forces the fallback to recurse and then report
    /// the English model path — proving the fallback branch ran.
    #[test]
    fn arabic_fallback_targets_english_when_missing() {
        let out = std::env::temp_dir().join("tts-arabic-fallback-missing.wav");
        let res = synthesize_to_file(
            "piper",
            Path::new("C:/definitely-missing"),
            "ar_JO-kareem-medium",
            "مرحبا",
            &out,
        );
        assert!(res.is_err());
        let msg = res.unwrap_err();
        assert!(
            msg.contains("en_US-lessac-medium"),
            "error should reference the English fallback model, got: {msg}"
        );
        assert!(
            !msg.contains("ar_JO-kareem-medium"),
            "error should describe the fallback, not the original Arabic voice, got: {msg}"
        );
    }

    /// Real end-to-end fallback: with ONLY the English voice present, an
    /// Arabic request must still succeed by falling back to English. Skips
    /// (passes) when piper or the English voice are not installed.
    #[test]
    fn arabic_synthesis_falls_back_to_english() {
        let Some((bin, model_dir)) = test_env() else {
            eprintln!("SKIP: piper or voice models not available");
            return;
        };
        let (en_model, en_config) = model_paths(&model_dir, "en_US-lessac-medium");

        let tmp = std::env::temp_dir().join(format!("tts-fallback-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).expect("create temp model dir");
        std::fs::copy(&en_model, tmp.join("en_US-lessac-medium.onnx"))
            .expect("copy english model into temp dir");
        std::fs::copy(&en_config, tmp.join("en_US-lessac-medium.onnx.json"))
            .expect("copy english config into temp dir");

        let out = std::env::temp_dir().join("tts-arabic-fallback-real.wav");
        let _ = std::fs::remove_file(&out);

        let info = synthesize_to_file(&bin, &tmp, "ar_JO-kareem-medium", "مرحبا", &out)
            .expect("arabic request should succeed by falling back to the english model");

        assert!(info.size > 1_000, "expected a meaningful wav size");
        let head = std::fs::read(&out).expect("read wav");
        assert_eq!(&head[0..4], b"RIFF", "output must be a RIFF wav");

        let _ = std::fs::remove_file(&out);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Real synthesis end-to-end. Skips (passes) when piper or the voice
    /// models are not installed, so it is safe on CI and fresh machines.
    #[test]
    fn synthesizes_a_real_wav() {
        let Some((bin, model_dir)) = test_env() else {
            eprintln!("SKIP: piper or voice models not available");
            return;
        };

        let out = std::env::temp_dir().join("tts-real-test.wav");
        let _ = std::fs::remove_file(&out);

        let info = synthesize_to_file(
            &bin,
            &model_dir,
            "en_US-lessac-medium",
            "Hello and welcome to Study Studio. This audio was generated locally by Piper.",
            &out,
        )
        .expect("synthesis should succeed");

        assert!(info.size > 1_000, "expected a meaningful wav size");
        let head = std::fs::read(&out).expect("read wav");
        assert_eq!(&head[0..4], b"RIFF", "output must be a RIFF wav");

        let _ = std::fs::remove_file(&out);
    }

    /// Arabic voice model produces a wav when Arabic text is detected.
    #[test]
    fn synthesizes_arabic_wav() {
        let Some((bin, model_dir)) = test_env() else {
            eprintln!("SKIP: piper or voice models not available");
            return;
        };
        let (ar_model, ar_config) = model_paths(&model_dir, "ar_JO-kareem-medium");
        if !ar_model.is_file() || !ar_config.is_file() {
            eprintln!("SKIP: arabic voice model not installed");
            return;
        }

        let out = std::env::temp_dir().join("tts-arabic-test.wav");
        let _ = std::fs::remove_file(&out);

        let info = synthesize_to_file(
            &bin,
            &model_dir,
            "ar_JO-kareem-medium",
            "مرحبا بكم في بودكاست ستوديو الدراسة.",
            &out,
        )
        .expect("arabic synthesis should succeed");

        assert!(info.size > 1_000);
        let head = std::fs::read(&out).expect("read wav");
        assert_eq!(&head[0..4], b"RIFF");

        let _ = std::fs::remove_file(&out);
    }

    /// Real two-host podcast synthesis end-to-end: two voices, per-line
    /// segments concatenated by ffmpeg into one WAV. Skips when piper, the
    /// voices or ffmpeg are not installed.
    #[test]
    fn synthesizes_a_podcast_wav() {
        if !ffmpeg_available() {
            eprintln!("SKIP: ffmpeg not available");
            return;
        }
        let Some((bin, model_dir)) = test_env() else {
            eprintln!("SKIP: piper or voice models not available");
            return;
        };
        let (en_model, en_config) = model_paths(&model_dir, "en_US-lessac-medium");
        if !en_model.is_file() || !en_config.is_file() {
            eprintln!("SKIP: english voice model not installed");
            return;
        }

        let out = std::env::temp_dir().join("tts-podcast-test.wav");
        let _ = std::fs::remove_file(&out);

        let lines = vec![
            ("Host A".to_string(), "Welcome to our show.".to_string()),
            ("Host B".to_string(), "Great to be here.".to_string()),
        ];
        let info = synthesize_podcast_to_file(
            &bin,
            &model_dir,
            "en_US-lessac-medium",
            "en_US-lessac-medium",
            &lines,
            &out,
        )
        .expect("podcast synthesis should succeed");

        assert!(info.size > 2_000, "expected a meaningful podcast wav size");
        let head = std::fs::read(&out).expect("read wav");
        assert_eq!(&head[0..4], b"RIFF");

        let _ = std::fs::remove_file(&out);
    }
}
