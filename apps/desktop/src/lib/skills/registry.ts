// Skill registry — the single source of truth for which skills exist and which
// ones apply to a given generation intent.
//
// Adding a skill means adding one entry to ALL_SKILLS. Adding an intent means
// adding one row to INTENT_ROUTING. Nothing else changes: call sites ask for
// "the skills for a lesson", never for a named skill.

import { defaultSkill, podcastHostingSkill, storytellingSkill, universalLanguageSkill } from "./definitions/base";

// Re-exported so callers (and the injector) can reach the base packs through
// the registry rather than importing a definition file directly.
export { defaultSkill, podcastHostingSkill, storytellingSkill, universalLanguageSkill };
import { educationSkill } from "./definitions/education";
import { humanizerSkill } from "./definitions/humanizer";
import { notebooklmStudioSkill } from "./definitions/notebooklmStudio";
import { openLessonSkill } from "./definitions/openLesson";
import { podcastOpsSkill } from "./definitions/podcastOps";
import type { SkillConfig, SkillIntent } from "./types";

/**
 * Every registered skill. Order here is not injection order — that comes from
 * each skill's `priority`. See composeSkills().
 */
export const ALL_SKILLS: SkillConfig[] = [
  // Foundational
  defaultSkill,
  // Pedagogy
  educationSkill,
  openLessonSkill,
  // Audio
  storytellingSkill,
  podcastHostingSkill,
  podcastOpsSkill,
  // Research
  notebooklmStudioSkill,
  // Language scaffolding
  universalLanguageSkill("A1", "Deutsch"),
  universalLanguageSkill("A1", "Arabic"),
  universalLanguageSkill("A1", "Spanish"),
  universalLanguageSkill("A1", "French"),
  // Writing quality — applies to everything, so it runs last
  humanizerSkill,
];

/**
 * Which skill ids apply to each intent, in addition to any skill whose
 * `appliesTo` already lists the intent. Kept explicit so routing is readable in
 * one place rather than inferred from scattered metadata.
 */
const INTENT_ROUTING: Record<SkillIntent, string[]> = {
  // A lesson is taught (education) and should push the learner to reason
  // (open-lesson), then be written cleanly (humanizer, via appliesTo: []).
  lesson: ["education", "open-lesson"],
  // A podcast is a script (podcast-ops) with per-line TTS constraints
  // (podcast hosting) and clean prose.
  podcast: ["podcast-ops", "podcast"],
  // Audio narration is single-voice storytelling.
  audio: ["storytelling"],
  quiz: ["education", "open-lesson"],
  // Source-grounded artifact generation.
  research: ["notebooklm-studio"],
  // Rewriting existing text is the humanizer's own job, nothing else.
  rewrite: ["humanizer"],
};

/**
 * Aliases so short, human, and language-code names resolve. This preserves the
 * pre-registry API (`getSkill("deutsch")`, `getSkill("de")`) without keeping a
 * second lookup table.
 */
const ALIASES: Record<string, string> = {
  // languages
  de: "lang-deutsch-a1",
  german: "lang-deutsch-a1",
  deutsch: "lang-deutsch-a1",
  ar: "lang-arabic-a1",
  arabic: "lang-arabic-a1",
  es: "lang-spanish-a1",
  spanish: "lang-spanish-a1",
  fr: "lang-french-a1",
  french: "lang-french-a1",
  // legacy ids
  "lang-deutsch-a1": "lang-deutsch-a1",
  // conversational aliases
  storytelling: "storytelling",
  audiobook: "storytelling",
  podcast: "podcast",
  hosting: "podcast",
  humanize: "humanizer",
  humanizer: "humanizer",
  education: "education",
  pedagogy: "education",
  socratic: "open-lesson",
  openlesson: "open-lesson",
  "open-lesson": "open-lesson",
  "podcast-ops": "podcast-ops",
  podcastops: "podcast-ops",
  notebooklm: "notebooklm-studio",
  "notebooklm-studio": "notebooklm-studio",
  sources: "notebooklm-studio",
};

const BY_ID = new Map<string, SkillConfig>(ALL_SKILLS.map((s) => [s.id, s]));

/**
 * Resolve a skill by id, alias, or language shorthand. Falls back to the
 * default skill when nothing matches, so a stale persisted id never breaks
 * generation.
 */
export function getSkill(idOrAlias?: string): SkillConfig {
  if (!idOrAlias) return defaultSkill;
  const key = idOrAlias.trim().toLowerCase();
  const direct = BY_ID.get(key);
  if (direct) return direct;
  const aliased = ALIASES[key];
  if (aliased) {
    const resolved = BY_ID.get(aliased);
    if (resolved) return resolved;
  }
  return defaultSkill;
}

/** Whether a skill id resolves to a real skill (not the default fallback). */
export function hasSkill(idOrAlias: string): boolean {
  const key = idOrAlias.trim().toLowerCase();
  return BY_ID.has(key) || ALIASES[key] !== undefined;
}

/** Every skill, for the UI selector. */
export function listSkills(): { id: string; name: string; summary?: string; category: string }[] {
  return ALL_SKILLS.map((s) => ({
    id: s.id,
    name: s.name,
    summary: s.summary,
    category: s.category,
  }));
}

/**
 * Every skill applicable to an intent, in injection order.
 *
 * Order is by ascending `priority`, so foundational constraints precede
 * task-specific ones and a later skill can refine an earlier one. The humanizer
 * carries priority 90 and `appliesTo: []`, so it always lands last and governs
 * the finished prose.
 *
 * `exclude` lets a caller drop a skill the user turned off, and `include` lets
 * a caller force one in (an explicit user selection).
 */
export function skillsForIntent(
  intent: SkillIntent,
  options: { include?: string[]; exclude?: string[] } = {}
): SkillConfig[] {
  const exclude = new Set((options.exclude ?? []).map((s) => s.trim().toLowerCase()));

  // Skills that name this intent directly, plus the explicit routing table.
  const routedIds = new Set<string>(INTENT_ROUTING[intent] ?? []);
  const byMetadata = ALL_SKILLS.filter((s) => s.appliesTo.includes(intent)).map((s) => s.id);
  for (const id of byMetadata) routedIds.add(id);

  // Always include the catch-all writing skill and the default educator.
  routedIds.add(defaultSkill.id);
  routedIds.add(humanizerSkill.id);

  // Caller-forced inclusions.
  for (const raw of options.include ?? []) {
    const skill = getSkill(raw);
    if (skill) routedIds.add(skill.id);
  }

  return ALL_SKILLS.filter((s) => routedIds.has(s.id) && !exclude.has(s.id)).sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id)
  );
}

/**
 * The skills bound automatically at app launch. Everything that is `defaultOn`
 * and applies to the core lesson intent, which is what a user generates first.
 */
export function defaultSkillSet(): SkillConfig[] {
  return skillsForIntent("lesson");
}
