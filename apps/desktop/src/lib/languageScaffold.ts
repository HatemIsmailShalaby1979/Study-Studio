// Universal Language Pedagogy Prompt Templates
//
// When generating non-English / target-language content, the skill layer
// injects scaffolded language instruction rules by default. This module
// provides the templates and a builder for composing them with the base
// generation prompts.

export interface LanguageScaffoldOptions {
  targetLanguage: string;
  targetLevel: string; // A1, A2, B1, B2, C1
  learnerNativeLanguage?: string; // e.g. "English", "Arabic"
  dualLanguagePairs?: boolean; // include Target -> Translation + pronunciation
  microDialogues?: boolean; // contextual dialogues formatted for TTS
}

export interface LanguageScaffold {
  systemInstruction: string;
  /** Prompts appended to the user turn to reinforce the pedagogy. */
  userHints: string[];
}

const CEFR_LEVEL_DESCRIPTIONS: Record<string, string> = {
  A1: "absolute beginner — high-frequency vocabulary, slow pace, heavy repetition",
  A2: "elementary — familiar topics, basic grammar, short exchanges",
  B1: "intermediate — personal/interest topics, connected text, opinions",
  B2: "upper-intermediate — abstract topics, fluency, detailed argument",
  C1: "advanced — complex subjects, nuanced expression, near-native flow",
  C2: "mastery — sophisticated register, subtle idiom, full nuance",
};

export function buildLanguageScaffold(opts: LanguageScaffoldOptions): LanguageScaffold {
  const {
    targetLanguage,
    targetLevel,
    learnerNativeLanguage = "the learner's native language",
    dualLanguagePairs = true,
    microDialogues = true,
  } = opts;

  const levelDesc =
    CEFR_LEVEL_DESCRIPTIONS[targetLevel.toUpperCase()] ?? CEFR_LEVEL_DESCRIPTIONS["A1"];

  const systemInstruction = `### SYSTEM SKILL: UNIVERSAL LANGUAGE SCAFFOLDING
- Target Language: ${targetLanguage}
- Target Level: ${targetLevel.toUpperCase()} (${levelDesc})
- Learner's Native Language: ${learnerNativeLanguage}
- Strategy: Progressive Immersion
- Structure:
  1. Concept introduction in ${learnerNativeLanguage} with ${targetLanguage} vocabulary inline.
  2. Dual-language sentence pairs (Target Phrase -> Translation + Pronunciation hint).
  3. Contextual micro-dialogues formatted for TTS output.
- Every piece of content must be genuinely useful to a ${targetLevel.toUpperCase()} learner — it must TEACH the language, not just present information.
- When a term is first used, always give its pronunciation hint in brackets, e.g. "der Apfel [der AH-pfel]".
- Sentences must be short and rhythmic so text-to-speech output sounds natural.
- Scaffold difficulty progressively: introduce, repeat with variation, then apply in a mini-dialogue.`;

  const userHints: string[] = [];
  if (dualLanguagePairs) {
    userHints.push(
      `For every new ${targetLanguage} expression, include a dual-language pair: the ${targetLanguage} phrase, its ${learnerNativeLanguage} translation, and a pronunciation hint.`
    );
  }
  if (microDialogues) {
    userHints.push(
      `Include at least one short ${targetLanguage} micro-dialogue (4-8 lines) that reuses the vocabulary and grammar just taught, written so it can be read aloud by a text-to-speech voice.`
    );
  }

  return { systemInstruction, userHints };
}

/**
 * Compose a full system prompt for a target-language lesson: base educational
 * instructions + language scaffolding.
 */
export function composeLanguageLessonPrompt(opts: LanguageScaffoldOptions): string {
  const scaffold = buildLanguageScaffold(opts);
  return [
    scaffold.systemInstruction,
    "Base instructions:",
    "Generate the lesson entirely in the target language with scaffolding as specified above.",
    "Include glossary, quiz, and section structure as requested.",
  ].join("\n\n");
}