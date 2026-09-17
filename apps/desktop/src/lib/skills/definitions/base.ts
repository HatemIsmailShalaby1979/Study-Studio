// Base skill packs — the ones that shipped before the skill registry existed,
// preserved with their original instruction text so existing behaviour and tests
// are unchanged. They are now entries in the registry rather than the whole of it.

import type { SkillConfig } from "../types";

export const defaultSkill: SkillConfig = {
  id: "default",
  name: "Default Study Skill",
  summary: "General educator behaviour. The fallback when no other skill applies.",
  category: "pedagogy",
  systemInstructions:
    "You are an expert educator and study companion. Generate thorough, accurate, and genuinely useful learning content. Follow all structural and formatting instructions exactly.",
  appliesTo: [],
  priority: 10,
  defaultOn: true,
};

export const storytellingSkill: SkillConfig = {
  id: "storytelling",
  name: "Storytelling Audio",
  summary: "Warm single-voice narration tuned for text-to-speech.",
  category: "audio",
  systemInstructions: `### SYSTEM SKILL: STORYTELLING AUDIO
- Write audiobook narration that is warm, vivid, and easy to listen to.
- Use short sentences and natural rhythm optimized for text-to-speech.
- Include clear section transitions: "Now we move on to...".
- Keep paragraphs short (1-3 sentences) so TTS pauses feel natural.`,
  appliesTo: ["audio"],
  priority: 30,
  defaultOn: true,
};

export const podcastHostingSkill: SkillConfig = {
  id: "podcast",
  name: "Podcast Hosting",
  summary: "Two-host conversational structure with per-line TTS-safe output.",
  category: "audio",
  systemInstructions: `### SYSTEM SKILL: PODCAST HOSTING
- Write two-host conversational scripts (Host A and Host B).
- Host A explains; Host B asks naive-but-insightful questions.
- Every exchange advances the discussion - no filler.
- Lines must be self-contained for per-line TTS synthesis.`,
  appliesTo: ["podcast", "audio"],
  priority: 35,
  defaultOn: false,
};

/** Base language-scaffolding skill appended for non-native content. */
export function universalLanguageSkill(
  targetLevel: string,
  targetLanguage: string
): SkillConfig {
  return {
    id: `lang-${targetLanguage.toLowerCase()}-${targetLevel.toLowerCase()}`,
    name: `Universal Language Scaffolding (${targetLanguage} ${targetLevel})`,
    summary: `Progressive-immersion scaffolding for ${targetLanguage} at CEFR ${targetLevel}.`,
    category: "language",
    targetLanguage,
    targetLevel,
    systemInstructions: `### SYSTEM SKILL: UNIVERSAL LANGUAGE SCAFFOLDING
- Target Level: ${targetLevel}
- Strategy: Progressive Immersion
- Structure:
  1. Concept introduction in the learner's native language with ${targetLanguage} vocabulary inline.
  2. Dual-language sentence pairs (Target Phrase -> Translation + Pronunciation hint).
  3. Contextual micro-dialogues formatted for TTS output.`,
    appliesTo: ["lesson", "audio"],
    priority: 50,
    defaultOn: false,
  };
}
