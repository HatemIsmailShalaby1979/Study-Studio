// Dynamic Skill Injection System
//
// When the user selects an Ollama model, a target-domain skill configuration
// is loaded and pinned for the session. Every generation request (creating
// topics, customizing audio commands) prepends the injected skill's system
// instructions. Re-injection only happens when the user changes the model.

export interface SkillConfig {
  id: string;
  name: string;
  /** System-instruction block prepended to every request in this session. */
  systemInstructions: string;
  /** Which languages/pedagogy this skill scaffolds (e.g. "de-DE", "ar", "en"). */
  targetLanguage?: string;
  /** CEFR target level, e.g. "A1", "B2". */
  targetLevel?: string;
  /** Voice presets the skill recommends. */
  voicePresets?: {
    audiobook?: string;
    podcast1?: string;
    podcast2?: string;
  };
}

export interface InjectedSkillContext {
  modelName: string;
  skill: SkillConfig;
  injectedAt: number;
}

/** Base language-scaffolding skill appended for non-native content. */
function universalLanguageSkill(targetLevel: string, targetLanguage: string): SkillConfig {
  return {
    id: `lang-${targetLanguage}-${targetLevel}`,
    name: `Universal Language Scaffolding (${targetLanguage} ${targetLevel})`,
    targetLanguage,
    targetLevel,
    systemInstructions: `### SYSTEM SKILL: UNIVERSAL LANGUAGE SCAFFOLDING
- Target Level: ${targetLevel}
- Strategy: Progressive Immersion
- Structure:
  1. Concept introduction in the learner's native language with ${targetLanguage} vocabulary inline.
  2. Dual-language sentence pairs (Target Phrase -> Translation + Pronunciation hint).
  3. Contextual micro-dialogues formatted for TTS output.`,
  };
}

const SKILLS: Record<string, SkillConfig> = {
  default: {
    id: "default",
    name: "Default Study Skill",
    systemInstructions:
      "You are an expert educator and study companion. Generate thorough, accurate, and genuinely useful learning content. Follow all structural and formatting instructions exactly.",
  },
  storytelling: {
    id: "storytelling",
    name: "Storytelling Audio",
    systemInstructions: `### SYSTEM SKILL: STORYTELLING AUDIO
- Write audiobook narration that is warm, vivid, and easy to listen to.
- Use short sentences and natural rhythm optimized for text-to-speech.
- Include clear section transitions: "Now we move on to...".
- Keep paragraphs short (1-3 sentences) so TTS pauses feel natural.`,
  },
  podcast: {
    id: "podcast",
    name: "Podcast Hosting",
    systemInstructions: `### SYSTEM SKILL: PODCAST HOSTING
- Write two-host conversational scripts (Host A and Host B).
- Host A explains; Host B asks naive-but-insightful questions.
- Every exchange advances the discussion - no filler.
- Lines must be self-contained for per-line TTS synthesis.`,
  },
  deutsch: universalLanguageSkill("A1", "Deutsch"),
  arabic: universalLanguageSkill("A1", "Arabic"),
  spanish: universalLanguageSkill("A1", "Spanish"),
  french: universalLanguageSkill("A1", "French"),
};

/**
 * Resolve a skill config by name or language. Falls back to the default skill
 * when nothing matches.
 */
export function getSkill(idOrLang?: string): SkillConfig {
  if (!idOrLang) return SKILLS["default"]!;
  const lower = idOrLang.toLowerCase();
  if (SKILLS[lower]) return SKILLS[lower] as SkillConfig;
  // Language shorthands
  if (["de", "deutsch", "german"].includes(lower)) return SKILLS["deutsch"]!;
  if (["ar", "arabic"].includes(lower)) return SKILLS["arabic"]!;
  if (["es", "spanish"].includes(lower)) return SKILLS["spanish"]!;
  if (["fr", "french"].includes(lower)) return SKILLS["french"]!;
  return SKILLS["default"]!;
}

/** List all available skill ids for UI selection. */
export function listSkills(): { id: string; name: string }[] {
  return Object.values(SKILLS).map((s) => ({ id: s.id, name: s.name }));
}

/**
 * Session-level skill context manager. Holds the active injected skill and
 * re-injects only when the model (or skill) changes.
 */
export class SkillInjector {
  private context: InjectedSkillContext | null = null;

  /**
   * Bind a skill to a model selection. Returns the new context, or the
   * existing one when the model hasn't changed (no re-injection).
   */
  bind(modelName: string, skillId?: string): InjectedSkillContext {
    if (
      this.context &&
      this.context.modelName === modelName &&
      this.context.skill.id === (skillId ?? this.context.skill.id)
    ) {
      return this.context;
    }
    const skill = getSkill(skillId);
    this.context = {
      modelName,
      skill,
      injectedAt: Date.now(),
    };
    return this.context;
  }

  /** The active injected skill, if any. */
  current(): InjectedSkillContext | null {
    return this.context;
  }

  /** Prepend the injected skill instructions to a system prompt. */
  apply(systemPrompt: string): string {
    if (!this.context) return systemPrompt;
    return `${this.context.skill.systemInstructions}\n\n${systemPrompt}`;
  }

  reset(): void {
    this.context = null;
  }
}

/** Singleton for the whole app session. */
export const skillInjector = new SkillInjector();