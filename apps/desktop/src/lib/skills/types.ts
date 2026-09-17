// Skill system contracts.
//
// A "skill" is a named block of system instructions bound to a generation task.
// Skills are injected into the system prompt for every request in the session,
// so the model's output follows a methodology rather than improvising one.
//
// Skills are provider-agnostic and model-agnostic: they are prompt content, not
// code. A skill cannot execute anything, which is why the upstream agent skills
// (which ship shell scripts) are distilled to their methodology here — see
// AUDIT.md phase 4.

/**
 * The kind of generation a skill can be applied to. Callers declare intent;
 * the registry resolves the skill set. Adding an intent means adding a routing
 * row in registry.ts, never touching a call site.
 */
export type SkillIntent =
  | "lesson"
  | "podcast"
  | "audio"
  | "quiz"
  | "research"
  | "rewrite";

/** Grouping used by the UI to organise the skill list. */
export type SkillCategory = "pedagogy" | "audio" | "writing" | "research" | "language";

export interface VoicePresets {
  audiobook?: string;
  podcast1?: string;
  podcast2?: string;
}

export interface SkillConfig {
  /** Stable id. Used for persistence, dedup, and the UI key. */
  id: string;
  /** Human-facing name. */
  name: string;
  /** One-line description shown under the name in the UI. */
  summary?: string;
  category: SkillCategory;
  /**
   * System-instruction block. Written in the second person, addressed to the
   * model, and self-contained: it must make sense without the other skills.
   */
  systemInstructions: string;
  /**
   * Intents this skill applies to. An empty array means "every intent" — use
   * sparingly, it makes routing harder to reason about.
   */
  appliesTo: SkillIntent[];
  /**
   * Composition order. Lower runs first, so foundational constraints sit above
   * task-specific ones and a later skill can refine an earlier one.
   */
  priority: number;
  /** Provenance: where these instructions came from. Shown in the UI tooltip. */
  source?: string;
  /** Upstream skill version, when derived from one. */
  version?: string;
  /** Whether auto-binding enables this skill by default. */
  defaultOn?: boolean;
  /** Which language this skill scaffolds (e.g. "de-DE", "ar", "en"). */
  targetLanguage?: string;
  /** CEFR target level, e.g. "A1", "B2". */
  targetLevel?: string;
  /** Voice presets the skill recommends. */
  voicePresets?: VoicePresets;
}

/** A skill bound into the session, with its resolution metadata. */
export interface InjectedSkillContext {
  modelName: string;
  /** Provider that was active when the skills were bound. */
  providerId: string;
  /** Every skill in the composed set, in injection order. */
  skills: SkillConfig[];
  /** When the set was bound (epoch ms). */
  injectedAt: number;
}

/** Lightweight view of a bound skill, safe to pass to React state. */
export interface ActiveSkillSummary {
  id: string;
  name: string;
  category: SkillCategory;
  summary?: string;
}
