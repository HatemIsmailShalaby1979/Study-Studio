use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Manager, State};
use std::process::Command;

mod tts;

const OLLAMA_URL: &str = "http://localhost:11434";

pub struct AppState {
    pub ollama_running: Mutex<bool>,
    pub model_name: Mutex<Option<String>>,
    pub ollama_process: Mutex<Option<std::process::Child>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OllamaGenerateRequest {
    pub model: String,
    pub prompt: String,
    pub system: Option<String>,
    pub stream: bool,
    pub options: Option<OllamaOptions>,
    /// Ollama structured-output JSON Schema (top-level `format` field).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OllamaOptions {
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    /// Token cap. This is the Ollama-native option name; older versions of the
    /// app used `max_tokens`, which Ollama silently ignores. Both are emitted
    /// so the payload is valid regardless of how Ollama handles unknown keys.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub num_predict: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<i32>,
    /// Context window size (Ollama defaults to ~2048). Widened to 16384 so
    /// long lesson outputs aren't truncated mid-JSON.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub num_ctx: Option<u32>,
    /// GPU layer count hint. Only forwarded when explicitly set; Ollama's own
    /// auto-detection is usually best.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub num_gpu: Option<i32>,
    /// How long to keep the model resident between requests (e.g. "10m").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep_alive: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OllamaGenerateResponse {
    pub model: String,
    pub response: String,
    pub done: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OllamaChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OllamaChatRequest {
    pub model: String,
    pub messages: Vec<OllamaChatMessage>,
    pub stream: bool,
    pub options: Option<OllamaOptions>,
    /// Ollama structured-output JSON Schema (top-level `format` field).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OllamaChatResponse {
    pub model: String,
    pub message: OllamaChatMessage,
    pub done: bool,
}

#[derive(Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub model: String,
    pub ollama_available: bool,
}

#[derive(Serialize, Deserialize)]
pub struct ModelListResponse {
    pub models: Vec<ModelInfo>,
}

#[derive(Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub size: String,
    pub loaded: bool,
}

#[derive(Serialize, Deserialize, Default)]
pub struct PullProgress {
    pub status: String,
    pub digest: Option<String>,
    pub total: Option<u64>,
    pub completed: Option<u64>,
}

#[tauri::command]
async fn check_health(_state: State<'_, AppState>) -> Result<HealthResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    match client.get(format!("{}/api/tags", OLLAMA_URL)).send().await {
        Ok(resp) if resp.status().is_success() => {
            // Get the recommended model dynamically
            let models = list_models().await.unwrap_or_default();
            let recommended_model = get_recommended_model(&models);
            
            Ok(HealthResponse {
                status: "running".to_string(),
                model: recommended_model,
                ollama_available: true,
            })
        },
        _ => Ok(HealthResponse {
            status: "offline".to_string(),
            model: String::new(),
            ollama_available: false,
        }),
    }
}

fn get_recommended_model(models: &[ModelInfo]) -> String {
    if models.is_empty() {
        return String::new();
    }
    
    // Priority order based on quality and performance balance
    let priority_patterns = ["gemma3", "qwen3", "llama3", "qwen2.5", "mistral", "codellama", "phi3"];
    
    for pattern in &priority_patterns {
        if let Some(model) = models.iter().find(|m| m.name.to_lowercase().contains(pattern)) {
            return model.id.clone();
        }
    }
    
    // Return the first available model as fallback
    models[0].id.clone()
}

#[tauri::command]
async fn list_models() -> Result<Vec<ModelInfo>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(format!("{}/api/tags", OLLAMA_URL))
        .send()
        .await
        .map_err(|e| format!("Ollama connection failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Ollama returned status {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let models = body["models"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|m| ModelInfo {
                    id: m["model"].as_str().unwrap_or("unknown").to_string(),
                    name: m["name"].as_str().unwrap_or("unknown").to_string(),
                    size: format!("{} GB", m["size"].as_f64().unwrap_or(0.0) / 1_073_741_824.0),
                    loaded: false,
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(models)
}

/// Structured model profile returned by `/api/show` — used by the frontend
/// Pre-Flight Model Profiler to gate heavy generation tasks.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModelProfile {
    pub name: String,
    pub parameters: String,
    pub context_window: u64,
    pub supports_tools: bool,
}

/// Query Ollama `/api/show` for a single model's metadata (parameters,
/// context window, tool-calling support). Returns null when Ollama is down or
/// the model is unknown — the frontend treats that as "assume suitable".
#[tauri::command]
async fn model_profile(model_name: String) -> Result<Option<ModelProfile>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(format!("{}/api/show", OLLAMA_URL))
        .json(&serde_json::json!({ "name": model_name, "verbose": true }))
        .send()
        .await
        .map_err(|e| format!("Ollama show request failed: {e}"))?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let details = body.get("details").cloned().unwrap_or_default();
    let parameters = details
        .get("parameters")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let model_info = body.get("model_info").cloned().unwrap_or_default();
    let context_window = model_info
        .get("llama.context_length")
        .and_then(|v| v.as_u64())
        .unwrap_or(8192);

    let lower = model_name.to_lowercase();
    let supports_tools = [
        "qwen2.5",
        "qwen3",
        "llama3.1",
        "llama3.2",
        "mistral",
        "gemma3",
        "phi4",
    ]
    .iter()
    .any(|base| lower.starts_with(base));

    Ok(Some(ModelProfile {
        name: model_name,
        parameters,
        context_window,
        supports_tools,
    }))
}

/// Spawn `ollama serve` as a child process and wait for the server to become
/// reachable.  Returns a human-readable status string.
///
/// If Ollama is already running (flag or HTTP check succeeds), returns
/// immediately without spawning a second instance.
#[tauri::command]
async fn start_ollama_if_needed(state: State<'_, AppState>) -> Result<String, String> {
    // 1. Quick flag check — avoids re-spawning within the same session.
    {
        let running = state.ollama_running.lock().map_err(|e| e.to_string())?;
        if *running {
            return Ok("Ollama is already running".to_string());
        }
    }

    // 2. If Ollama is already listening (user started it externally), just
    //    record that it's running and return.
    {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(3))
            .build()
            .map_err(|e| e.to_string())?;

        if client
            .get(format!("{}/api/tags", OLLAMA_URL))
            .send()
            .await
            .is_ok_and(|r| r.status().is_success())
        {
            let mut running = state.ollama_running.lock().map_err(|e| e.to_string())?;
            *running = true;
            return Ok("Ollama is already running".to_string());
        }
    }

    // 3. Try to spawn `ollama serve`.
    //
    //    Set OLLAMA_ORIGINS=* so the server accepts CORS requests from the
    //    Tauri webview origin (https://tauri.localhost). Without this, Ollama
    //    defaults to allowing only http://localhost:* origins and returns
    //    403 Forbidden for the webview's direct fetch() calls. (The Rust IPC
    //    path is unaffected by CORS, but the frontend may still issue direct
    //    HTTP requests as a fallback.)
    #[cfg(target_os = "windows")]
    let ollama_cmd = Command::new("ollama")
        .arg("serve")
        .env("OLLAMA_ORIGINS", "*")
        .spawn();

    #[cfg(not(target_os = "windows"))]
    let ollama_cmd = Command::new("ollama")
        .arg("serve")
        .env("OLLAMA_ORIGINS", "*")
        .spawn();

    let child = match ollama_cmd {
        Ok(c) => c,
        Err(e) => {
            return Err(format!(
                "Failed to start Ollama. Please install it from https://ollama.ai. Error: {}",
                e
            ))
        }
    };

    {
        let mut running = state.ollama_running.lock().map_err(|e| e.to_string())?;
        let mut process = state.ollama_process.lock().map_err(|e| e.to_string())?;
        *running = true;
        *process = Some(child);
    }

    // 4. Poll until the server accepts connections (up to ~15 s).
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;

    for _ in 0..15 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        if client
            .get(format!("{}/api/tags", OLLAMA_URL))
            .send()
            .await
            .is_ok_and(|r| r.status().is_success())
        {
            return Ok("Ollama started successfully".to_string());
        }
    }

    // Process was spawned but not yet accepting traffic — tell the caller
    // it may still need a moment.
    Ok("Ollama process started; server may need a few more seconds".to_string())
}

#[tauri::command]
fn get_ollama_status(state: State<'_, AppState>) -> Result<String, String> {
    let running = state.ollama_running.lock().map_err(|e| e.to_string())?;
    if *running {
        Ok("running".to_string())
    } else {
        Ok("stopped".to_string())
    }
}

#[tauri::command]
async fn pull_model(model_name: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(format!("{}/api/pull", OLLAMA_URL))
        .json(&serde_json::json!({ "name": model_name }))
        .send()
        .await
        .map_err(|e| format!("Failed to start pull: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Pull failed with status {}", resp.status()));
    }

    Ok(format!("Pulling model '{}' started in background", model_name))
}

#[tauri::command]
async fn generate(
    state: State<'_, AppState>,
    prompt: String,
    system_prompt: Option<String>,
    temperature: Option<f32>,
    max_tokens: Option<i32>,
    top_p: Option<f32>,
    num_ctx: Option<u32>,
    num_gpu: Option<i32>,
    keep_alive: Option<String>,
    format: Option<serde_json::Value>,
) -> Result<String, String> {
    // Get model string and immediately drop the guard
    let model = {
        let model_guard = state.model_name.lock().map_err(|e| e.to_string())?;
        model_guard.clone().unwrap_or_else(|| "llama3.2:3b".to_string())
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1800))
        .build()
        .map_err(|e| e.to_string())?;

    let request = OllamaGenerateRequest {
        model: model.clone(),
        prompt,
        system: system_prompt,
        stream: false,
        format,
        options: Some(OllamaOptions {
            temperature,
            top_p: top_p.or(Some(0.9)),
            num_predict: max_tokens,
            max_tokens,
            num_ctx: num_ctx.or(Some(16384)),
            num_gpu,
            keep_alive: keep_alive.or_else(|| Some("10m".to_string())),
        }),
    };

    let resp = client
        .post(format!("{}/api/generate", OLLAMA_URL))
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama error ({}): {}", status, text));
    }

    let result: OllamaGenerateResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(result.response)
}

#[tauri::command]
async fn chat(
    state: State<'_, AppState>,
    messages: Vec<OllamaChatMessage>,
    temperature: Option<f32>,
    max_tokens: Option<i32>,
    top_p: Option<f32>,
    num_ctx: Option<u32>,
    num_gpu: Option<i32>,
    keep_alive: Option<String>,
    format: Option<serde_json::Value>,
) -> Result<String, String> {
    // Get model string and immediately drop the guard
    let model = {
        let model_guard = state.model_name.lock().map_err(|e| e.to_string())?;
        model_guard.clone().unwrap_or_else(|| "llama3.2:3b".to_string())
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1800))
        .build()
        .map_err(|e| e.to_string())?;

    let request = OllamaChatRequest {
        model: model.clone(),
        messages,
        stream: false,
        format,
        options: Some(OllamaOptions {
            temperature,
            top_p: top_p.or(Some(0.9)),
            num_predict: max_tokens,
            max_tokens,
            num_ctx: num_ctx.or(Some(16384)),
            num_gpu,
            keep_alive: keep_alive.or_else(|| Some("10m".to_string())),
        }),
    };

    let resp = client
        .post(format!("{}/api/chat", OLLAMA_URL))
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Ollama chat failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama error ({}): {}", status, text));
    }

    let result: OllamaChatResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(result.message.content)
}

#[tauri::command]
async fn set_model(state: State<'_, AppState>, model_name: String) -> Result<(), String> {
    let mut model = state.model_name.lock().map_err(|e| e.to_string())?;
    *model = Some(model_name);
    Ok(())
}

#[tauri::command]
async fn get_model(state: State<'_, AppState>) -> Result<String, String> {
    // Check if model is already cached
    let cached_model = {
        let model_guard = state.model_name.lock().map_err(|e| e.to_string())?;
        model_guard.clone()
    };
    
    // If no model is set, auto-select the best available
    if let Some(m) = cached_model {
        return Ok(m);
    }
    
    // Auto-detect and select the best model
    let models = list_models().await?;
    let recommended = get_recommended_model(&models);
    
    if recommended.is_empty() {
        return Err("No models available in Ollama. Please pull a model first.".to_string());
    }
    
    // Cache the selected model
    {
        let mut model_guard = state.model_name.lock().map_err(|e| e.to_string())?;
        *model_guard = Some(recommended.clone());
    }
    
    Ok(recommended)
}

#[tauri::command]
async fn auto_select_model(state: State<'_, AppState>) -> Result<String, String> {
    let models = list_models().await?;
    
    if models.is_empty() {
        return Err("No models found in Ollama. Please install a model using 'ollama pull <model-name>'".to_string());
    }
    
    let recommended = get_recommended_model(&models);
    
    // Update the cached model
    let mut model = state.model_name.lock().map_err(|e| e.to_string())?;
    *model = Some(recommended.clone());
    
    Ok(recommended)
}

/// Synthesize lesson/podcast text into a real audio file via the local Piper
/// TTS engine. Files are written to <app-data>/audio/<lesson_id>.wav or .mp3
/// and persisted on disk (survive app restarts).
#[tauri::command]
async fn tts_synthesize(
    app: tauri::AppHandle,
    text: String,
    voice: Option<String>,
    lesson_id: String,
    format: Option<String>,
) -> Result<tts::TtsInfo, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let audio_dir = data_dir.join("audio");
    let default_model_dir = data_dir.join("tts");
    let model_dir = std::env::var("STUDY_STUDIO_PIPER_MODEL_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or(default_model_dir);
    let piper_bin =
        std::env::var("STUDY_STUDIO_PIPER_BIN").unwrap_or_else(|_| "piper".to_string());
    let selected_voice = voice.unwrap_or_else(|| tts::default_voice_for(&text));

    std::fs::create_dir_all(&audio_dir)
        .map_err(|e| format!("Failed to create audio directory: {e}"))?;

    // Always generate WAV first
    let wav_path = audio_dir.join(format!("{lesson_id}.wav"));
    let wav_path_clone = wav_path.clone();

    let info = tauri::async_runtime::spawn_blocking(move || {
        tts::synthesize_to_file(&piper_bin, &model_dir, &selected_voice, &text, &wav_path_clone)
    })
    .await
    .map_err(|e| format!("TTS task failed: {e}"))??;

    // If MP3 requested and ffmpeg available, convert
    if format.as_deref() == Some("mp3") && tts::ffmpeg_available() {
        let mp3_path = audio_dir.join(format!("{lesson_id}.mp3"));
        match tts::convert_wav_to_mp3(&wav_path, &mp3_path) {
            Ok(mp3_info) => return Ok(mp3_info),
            Err(e) => {
                eprintln!("[tts] MP3 conversion failed, returning WAV: {e}");
            }
        }
    }

    Ok(info)
}

/// One line of a podcast script, as produced by the generation pipeline.
#[derive(serde::Deserialize)]
struct PodcastLineArg {
    speaker: String,
    text: String,
}

/// Synthesize a two-host podcast into a real audio file using the host voices
/// selected in the UI (voice_a for Host A, voice_b for Host B). Each line is
/// read with its host's voice and the segments are concatenated via ffmpeg.
#[tauri::command]
async fn tts_synthesize_podcast(
    app: tauri::AppHandle,
    script: Vec<PodcastLineArg>,
    voice_a: String,
    voice_b: String,
    lesson_id: String,
    format: Option<String>,
) -> Result<tts::TtsInfo, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let audio_dir = data_dir.join("audio");
    let default_model_dir = data_dir.join("tts");
    let model_dir = std::env::var("STUDY_STUDIO_PIPER_MODEL_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or(default_model_dir);
    let piper_bin =
        std::env::var("STUDY_STUDIO_PIPER_BIN").unwrap_or_else(|_| "piper".to_string());

    std::fs::create_dir_all(&audio_dir)
        .map_err(|e| format!("Failed to create audio directory: {e}"))?;

    let lines: Vec<(String, String)> = script.into_iter().map(|l| (l.speaker, l.text)).collect();

    // Always build the full WAV first.
    let wav_path = audio_dir.join(format!("{lesson_id}-podcast.wav"));
    let wav_clone = wav_path.clone();
    let info = tauri::async_runtime::spawn_blocking(move || {
        tts::synthesize_podcast_to_file(
            &piper_bin,
            &model_dir,
            &voice_a,
            &voice_b,
            &lines,
            &wav_clone,
        )
    })
    .await
    .map_err(|e| format!("Podcast TTS task failed: {e}"))??;

    // If MP3 requested and ffmpeg available, convert.
    if format.as_deref() == Some("mp3") && tts::ffmpeg_available() {
        let mp3_path = audio_dir.join(format!("{lesson_id}-podcast.mp3"));
        match tts::convert_wav_to_mp3(&wav_path, &mp3_path) {
            Ok(mp3_info) => return Ok(mp3_info),
            Err(e) => {
                eprintln!("[tts] Podcast MP3 conversion failed, returning WAV: {e}");
            }
        }
    }

    Ok(info)
}

/// Copy an already-generated audio file to a user-chosen destination
/// (picked via the save dialog on the frontend). This is the "Download".
#[tauri::command]
async fn tts_export_audio(source_path: String, dest_path: String) -> Result<u64, String> {
    let src = std::path::PathBuf::from(source_path);
    let dest = std::path::PathBuf::from(dest_path);

    if !src.is_file() {
        return Err(format!("Audio file not found: {}", src.display()));
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create destination directory: {e}"))?;
    }

    std::fs::copy(&src, &dest).map_err(|e| format!("Failed to copy audio: {e}"))
}

/// List which TTS voice models are already downloaded on disk.
#[tauri::command]
async fn list_tts_voices(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    let model_dir = data_dir.join("tts");
    Ok(tts::available_voices(&model_dir))
}

/// Download a Piper voice model on-demand from HuggingFace.
#[tauri::command]
async fn download_tts_voice(app: tauri::AppHandle, voice_id: String) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    let model_dir = data_dir.join("tts");
    std::fs::create_dir_all(&model_dir)
        .map_err(|e| format!("Failed to create TTS model directory: {e}"))?;
    tts::download_voice(&voice_id, &model_dir).await
}

/// Check whether ffmpeg is available on the system.
#[tauri::command]
async fn check_ffmpeg() -> Result<bool, String> {
    Ok(tts::ffmpeg_available())
}

/// Discover ALL installed Piper voices on disk (not just the curated 4).
/// Scans `<app-data>/tts` for every `*.onnx` + `*.onnx.json` pair and
/// returns metadata (id, language, region, name, quality). Never throws.
#[tauri::command]
async fn discover_tts_voices(app: tauri::AppHandle) -> Result<Vec<tts::DiscoveredVoiceInfo>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    let model_dir = data_dir.join("tts");
    Ok(tts::discover_installed_voices(&model_dir))
}

/// List distinct language codes across all installed Piper voices.
/// Drives the language dropdown in the UI. Never throws.
#[tauri::command]
async fn list_tts_languages(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    let model_dir = data_dir.join("tts");
    Ok(tts::list_installed_languages(&model_dir))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .manage(AppState {
            ollama_running: Mutex::new(false),
            model_name: Mutex::new(None),
            ollama_process: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            check_health,
            list_models,
            model_profile,
            pull_model,
            generate,
            chat,
            set_model,
            get_model,
            start_ollama_if_needed,
            get_ollama_status,
            auto_select_model,
            tts_synthesize,
            tts_synthesize_podcast,
            tts_export_audio,
            list_tts_voices,
            download_tts_voice,
            check_ffmpeg,
            discover_tts_voices,
            list_tts_languages,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}