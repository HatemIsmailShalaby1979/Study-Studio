// Unrestricted Voice Selector
//
// Zero artificial limits on TTS voices. The dropdown dynamically discovers
// voices from every available source:
//   - Web Speech API (browser/OS native voices)
//   - Piper TTS models (downloaded on-demand via the Rust backend)
//   - (future) local audio synthesizers
// Voices are merged, de-duplicated by id, sorted by locale/gender/style, and
// exposed to the UI as a single unified catalog.

import { isTauri } from "./tauri";
import { VOICES, listAvailableVoices, PiperVoice } from "./tts";

export interface DiscoveredVoice {
  id: string;
  displayName: string;
  lang: string;
  gender: "male" | "female" | "unknown";
  style: string;
  source: "web-speech" | "piper" | "os";
  available: boolean;
}

/** Discover voices from the Web Speech API (browser + OS-native engines). */
export function discoverWebSpeechVoices(): DiscoveredVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  try {
    const voices = window.speechSynthesis.getVoices();
    return voices.map((v) => ({
      id: `ws:${v.name}`,
      displayName: `${v.name} (${v.lang})`,
      lang: v.lang,
      gender: detectWebSpeechGender(v),
      style: "Natural",
      source: "web-speech" as const,
      available: true,
    }));
  } catch {
    return [];
  }
}

/** Infer gender from common voice-name heuristics across OS engines. */
function detectWebSpeechGender(v: SpeechSynthesisVoice): "male" | "female" | "unknown" {
  const name = v.name.toLowerCase();
  if (/(female|woman|girl|zira|susan|amy|jenny|aria|samantha)/.test(name)) return "female";
  if (/(male|man|boy|david|mark|guy|daniel)/.test(name)) return "male";
  return "unknown";
}

/** Map the app's Piper voice catalog to the unified DiscoveredVoice shape. */
function piperVoicesToDiscovered(available: string[]): DiscoveredVoice[] {
  return VOICES.map((v: PiperVoice) => ({
    id: `piper:${v.id}`,
    displayName: `${v.displayName} (Piper HD)`,
    lang: v.language === "ar" ? "ar" : "en",
    gender: v.gender,
    style: "Piper HD",
    source: "piper" as const,
    available: available.includes(v.id),
  }));
}

/**
 * Build the full voice catalog across all sources. In the Tauri shell the
 * Piper models that are already downloaded are marked available; in a plain
 * browser only Web Speech voices exist.
 */
export async function buildVoiceCatalog(): Promise<DiscoveredVoice[]> {
  const [webSpeech, piperAvailable] = await Promise.all([
    Promise.resolve(discoverWebSpeechVoices()),
    isTauri()
      ? listAvailableVoices().catch(() => [])
      : Promise.resolve([]),
  ]);

  const piper = piperVoicesToDiscovered(piperAvailable);

  // Deduplicate by id (prefer Piper over Web Speech for the same base voice).
  const map = new Map<string, DiscoveredVoice>();
  for (const v of piper) map.set(v.id, v);
  for (const v of webSpeech) {
    if (!map.has(v.id)) map.set(v.id, v);
  }

  const all = [...map.values()];
  return sortVoices(all);
}

/** Sort by language, then gender, then style for a clean dropdown. */
export function sortVoices(voices: DiscoveredVoice[]): DiscoveredVoice[] {
  return [...voices].sort((a, b) => {
    if (a.lang !== b.lang) return a.lang.localeCompare(b.lang);
    const genderOrder = { female: 0, male: 1, unknown: 2 } as const;
    const ag = genderOrder[a.gender] ?? 3;
    const bg = genderOrder[b.gender] ?? 3;
    if (ag !== bg) return ag - bg;
    return a.displayName.localeCompare(b.displayName);
  });
}

/** Filter the catalog for voices matching a language prefix (e.g. "de", "ar"). */
export function voicesForLang(voices: DiscoveredVoice[], lang: string): DiscoveredVoice[] {
  return voices.filter((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase()));
}