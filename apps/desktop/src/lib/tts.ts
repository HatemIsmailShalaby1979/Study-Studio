// Local audio-file generation via Piper TTS (Rust backend).
//
// Unlike the live SpeechSynthesis players (which only play through the
// speakers), this pipeline produces a REAL WAV file on disk. The Rust command
// `tts_synthesize` writes it to <app-data>/audio/<lesson_id>.wav; the UI plays
// it back through Tauri's asset protocol and exports it via the save dialog.
import type { Lesson } from "@/types";
import { isTauri, invokeTauri } from "./tauri";

// ---------------------------------------------------------------------------
// Voice catalog — mirrors the Rust VOICES constant in tts.rs
// ---------------------------------------------------------------------------

export interface PiperVoice {
  id: string;
  language: string;
  accent: string;
  gender: "male" | "female";
  displayName: string;
}

export const VOICES: PiperVoice[] = [
  { id: "en_US-lessac-medium", language: "en", accent: "US", gender: "male", displayName: "English (US) — Lessac" },
  { id: "en_US-amy-medium", language: "en", accent: "US", gender: "female", displayName: "English (US) — Amy" },
  { id: "en_GB-alba-medium", language: "en", accent: "UK", gender: "female", displayName: "English (UK) — Alba" },
  { id: "ar_JO-kareem-medium", language: "ar", accent: "Jordanian", gender: "male", displayName: "العربية (الأردن) — كريم" },
];

/** Filter voices by language. */
export function voicesForLanguage(lang: string): PiperVoice[] {
  return VOICES.filter((v) => v.language === lang);
}

/**
 * The nested path under rhasspy/piper-voices where a voice's files actually
 * live, e.g. "ar_JO-kareem-medium" -> "ar/ar_JO/kareem/medium". The official
 * repo does NOT keep files at the top level; downloading from a flat path 404s.
 */
export function voiceRepoBase(voiceId: string): string {
  const [region, name, quality] = voiceId.split("-");
  const lang = (region ?? "").split("_")[0] ?? "";
  return `${lang}/${region}/${name}/${quality}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TtsInfo {
  path: string;
  size: number;
}

// ---------------------------------------------------------------------------
// TTS helpers
// ---------------------------------------------------------------------------

/** Build the text that is read aloud from a lesson or podcast script. */
export function buildTtsText(lesson: Lesson): string {
  if (lesson.podcastScript && lesson.podcastScript.length > 0) {
    return lesson.podcastScript.map((line) => `${line.speaker}: ${line.text}`).join("\n");
  }
  return lesson.sections.map((section) => `${section.heading}.\n${section.content}`).join("\n\n");
}

/** Detect whether a lesson's content is primarily Arabic. */
function detectLessonLanguage(lesson: Lesson): "en" | "ar" {
  const text = `${lesson.title ?? ""} ${lesson.sections.map((s) => s.heading).join(" ")}`;
  return /[\u0600-\u06FF]/.test(text) ? "ar" : "en";
}

/**
 * Generate a real audio file for the lesson. Only available inside the Tauri
 * desktop shell; a plain browser has no way to run the local TTS engine.
 */
export async function generateAudio(
  lesson: Lesson,
  voice?: string,
  format: "wav" | "mp3" = "wav"
): Promise<TtsInfo> {
  if (!isTauri()) {
    throw new Error("Audio files can only be generated inside the Study Studio desktop app.");
  }
  return invokeTauri<TtsInfo>("tts_synthesize", {
    text: buildTtsText(lesson),
    voice: voice ?? null,
    lessonId: lesson.id,
    format,
  });
}

/**
 * Generate a real audio file for a podcast, reading each script line with its
 * host's voice (voice_a = Host A, voice_b = Host B) and concatenating the
 * segments into a single file. Falls back to the single-voice lesson path when
 * the lesson has no podcast script.
 */
export async function generatePodcastAudio(
  lesson: Lesson,
  voiceA: string,
  voiceB: string,
  format: "wav" | "mp3" = "wav"
): Promise<TtsInfo> {
  if (!isTauri()) {
    throw new Error("Audio files can only be generated inside the Study Studio desktop app.");
  }
  if (!lesson.podcastScript || lesson.podcastScript.length === 0) {
    return generateAudio(lesson, voiceA, format);
  }
  return invokeTauri<TtsInfo>("tts_synthesize_podcast", {
    script: lesson.podcastScript,
    voiceA,
    voiceB,
    lessonId: lesson.id,
    format,
  });
}

/** Ask the user where to save (native save dialog), returns the chosen path or null. */
export async function pickAudioDestination(defaultName: string): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({
    defaultPath: defaultName,
    filters: [{ name: "Audio", extensions: ["mp3", "wav"] }],
  });
}

/** Copy an already-generated audio file to a user-chosen destination. */
export async function exportAudio(sourcePath: string, destPath: string): Promise<number> {
  return invokeTauri<number>("tts_export_audio", { sourcePath, destPath });
}

/** Convert a filesystem path to a URL the webview can play via <audio>. */
export async function audioFileUrl(path: string): Promise<string> {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return convertFileSrc(path);
}

/** Check if ffmpeg is available on the system. */
export async function checkFfmpeg(): Promise<boolean> {
  if (!isTauri()) return false;
  return invokeTauri<boolean>("check_ffmpeg");
}

/** List which voice IDs are already downloaded on the backend. */
export async function listAvailableVoices(): Promise<string[]> {
  if (!isTauri()) return [];
  return invokeTauri<string[]>("list_tts_voices");
}

/** Download a Piper voice model on-demand from HuggingFace. */
export async function downloadVoice(voiceId: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("Voice download is only available in the desktop app.");
  }
  await invokeTauri<void>("download_tts_voice", { voiceId });
}

// ---------------------------------------------------------------------------
// Dynamic voice & language discovery (bridges to Rust scan + Web Speech)
// ---------------------------------------------------------------------------

/** Metadata for a voice discovered on disk by the Rust backend. */
export interface DiscoveredVoiceInfo {
  id: string;
  language: string;
  region: string;
  name: string;
  quality: string;
}

/**
 * Discover ALL installed Piper voices on disk (not just the curated 4).
 * Returns empty array outside Tauri or on any error. Never throws.
 */
export async function discoverInstalledVoices(): Promise<DiscoveredVoiceInfo[]> {
  if (!isTauri()) return [];
  try {
    return await invokeTauri<DiscoveredVoiceInfo[]>("discover_tts_voices");
  } catch {
    return [];
  }
}

/**
 * List distinct language codes across all installed Piper voices.
 * Returns empty array outside Tauri or on any error. Never throws.
 */
export async function listInstalledLanguages(): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    return await invokeTauri<string[]>("list_tts_languages");
  } catch {
    return [];
  }
}

/**
 * Check whether a local TTS engine appears to be available (at least one
 * voice installed on disk, or Web Speech API in the browser). Never throws.
 */
export async function isTtsAvailable(): Promise<boolean> {
  if (!isTauri()) {
    // Browser: Web Speech API is always "available" (OS-native).
    return typeof window !== "undefined" && !!window.speechSynthesis;
  }
  const voices = await discoverInstalledVoices();
  return voices.length > 0;
}

/**
 * A unified voice catalog merging every source:
 *   1. Curated seed voices (VOICES) — marked "piper-seed" when on disk.
 *   2. Disk-discovered voices (any .onnx on disk) — "piper" source.
 *   3. Web Speech API voices — "web-speech" source.
 *
 * Deduplicated by id (Piper seeds win over Web Speech for the same id).
 * Sorted by language → gender → displayName.
 *
 * This is the single source of truth for voice dropdowns going forward.
 */
export async function unifiedVoiceCatalog(): Promise<UnifiedVoice[]> {
  const [diskVoices, curatedAvailable, webSpeechVoices] = await Promise.all([
    discoverInstalledVoices(),
    isTauri() ? listAvailableVoices().catch(() => []) : Promise.resolve([]),
    discoverWebSpeechVoices(),
  ]);

  const catalog = new Map<string, UnifiedVoice>();

  // 1. Disk-discovered Piper voices (includes curated ones when installed).
  for (const v of diskVoices) {
    const isSeed = VOICES.some((s) => s.id === v.id);
    catalog.set(v.id, {
      id: v.id,
      displayName: isSeed
        ? VOICES.find((s) => s.id === v.id)!.displayName
        : `${v.language.toUpperCase()} — ${v.name} (${v.quality})`,
      language: v.language,
      gender: isSeed ? VOICES.find((s) => s.id === v.id)!.gender : "unknown",
      source: isSeed ? "piper-seed" : "piper",
      available: true,
    });
  }

  // 2. Curated seeds NOT yet on disk (show as download targets).
  for (const v of VOICES) {
    if (!catalog.has(v.id)) {
      catalog.set(v.id, {
        id: v.id,
        displayName: `${v.displayName} (download)`,
        language: v.language,
        gender: v.gender,
        source: "piper-seed",
        available: false,
      });
    }
  }

  // 3. Web Speech voices (only if not already covered by a Piper voice).
  for (const wv of webSpeechVoices) {
    // Use the raw Web Speech voice id as the catalog key (prefixed "ws:").
    if (!catalog.has(wv.id)) {
      catalog.set(wv.id, {
        id: wv.id,
        displayName: `${wv.displayName} (Web Speech)`,
        language: wv.lang,
        gender: wv.gender,
        source: "web-speech",
        available: true,
      });
    }
  }

  return sortUnifiedVoices([...catalog.values()]);
}

/** One entry in the unified voice catalog. */
export interface UnifiedVoice {
  id: string;
  displayName: string;
  language: string;
  gender: "male" | "female" | "unknown";
  /** Where this voice comes from. */
  source: "piper-seed" | "piper" | "web-speech";
  /** Whether the voice is ready to use (on disk or natively available). */
  available: boolean;
}

/** Discover voices from the Web Speech API (browser + OS-native engines). */
function discoverWebSpeechVoices(): { id: string; displayName: string; lang: string; gender: "male" | "female" | "unknown" }[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  try {
    return window.speechSynthesis.getVoices().map((v) => ({
      id: `ws:${v.name}`,
      displayName: `${v.name} (${v.lang})`,
      lang: v.lang.split("-")[0] ?? "en",
      gender: inferGender(v.name),
    }));
  } catch {
    return [];
  }
}

function inferGender(name: string): "male" | "female" | "unknown" {
  const n = name.toLowerCase();
  if (/(female|woman|girl|zira|susan|amy|jenny|aria|samantha|alba)/.test(n)) return "female";
  if (/(male|man|boy|david|mark|guy|daniel|lessac|kareem)/.test(n)) return "male";
  return "unknown";
}

function sortUnifiedVoices(voices: UnifiedVoice[]): UnifiedVoice[] {
  const genderOrder: Record<string, number> = { female: 0, male: 1, unknown: 2 };
  return voices.sort((a, b) => {
    if (a.language !== b.language) return a.language.localeCompare(b.language);
    const ag = genderOrder[a.gender] ?? 3;
    const bg = genderOrder[b.gender] ?? 3;
    if (ag !== bg) return ag - bg;
    return a.displayName.localeCompare(b.displayName);
  });
}

/** Filter the unified catalog for voices matching a language prefix. */
export function unifiedVoicesForLanguage(voices: UnifiedVoice[], lang: string): UnifiedVoice[] {
  if (!lang) return voices;
  const prefix = lang.toLowerCase();
  return voices.filter((v) => v.language.toLowerCase().startsWith(prefix));
}
