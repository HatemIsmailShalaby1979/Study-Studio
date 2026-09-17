// Podcast generation — always chunked.
//
// Extracted from `generation.ts` (plan item 5.1). Holds the chunked generator
// and the public `generatePodcastOnly` entry point. The lesson path and this
// one share only `transport.ts` and `prompts.ts`; they do not call each other.

import { AppError, ErrorCode } from "../error";
import {
  validateGenerateLesson,
  validatePodcastOutput,
  validatePodcastTitle,
  validatePodcastChunk,
  validateGlossaryQuiz,
} from "../validation";
import {
  GLOSSARY_QUIZ_JSON_SCHEMA,
  PODCAST_CHUNK_JSON_SCHEMA,
  PODCAST_TITLE_JSON_SCHEMA,
} from "../validation";
import { aiRuntime } from "../ai-runtime";
import { chatForJson, retrySameModel } from "./transport";
import { describeGenerationFailure } from "./errors";
import { skillInjector } from "../skills";
import { detectLanguage, trimSource, podcastTitleSystemPrompt, podcastChunkUserPrompt, podcastGlossaryQuizSystemPrompt } from "./prompts";
import type { LessonLanguage, GenerateRequest } from "./prompts";
import type { GeneratedLesson } from "./lesson";

const PODCAST_CHUNK_LINES = 6;

function targetPodcastExchanges(difficulty: string, length?: string): number {
  const base: Record<string, number> = { beginner: 16, intermediate: 24, expert: 32 };
  const mult: Record<string, number> = { short: 0.75, medium: 1.0, long: 1.5, comprehensive: 2.0 };
  const raw = Math.round((base[difficulty || "intermediate"] ?? 24) * (mult[length || "medium"] ?? 1.0));
  return Math.max(8, Math.min(60, raw));
}

/**
 * System prompt for one chunk of podcast dialogue.
 *
 * Exported for testing, matching the convention already used by
 * `getLessonSystemPrompt`. It is the LIVE podcast prompt — the one
 * `generatePodcastOnly` actually sends — and it resolves its skills by intent
 * rather than from the session binding, so a podcast started from the lesson
 * page still carries podcast methodology. Asserting it is the only way to prove
 * that routing works. See AUDIT.md plan item 4.13.
 */
export function podcastChunkSystemPrompt(
  difficulty: string,
  language: LessonLanguage,
  voiceGenderA: "male" | "female" = "male",
  voiceGenderB: "male" | "female" = "female"
): string {
  const diff = difficulty || "intermediate";

  const maleNames = language === "ar"
    ? ["أحمد", "محمد", "خالد", "عمر", "يوسف"]
    : ["James", "David", "Michael", "Robert", "Daniel"];
  const femaleNames = language === "ar"
    ? ["فاطمة", "خديجة", "نورة", "سارة", "ليلى"]
    : ["Sarah", "Emily", "Jessica", "Amanda", "Nicole"];

  const hostAName = voiceGenderA === "male" ? maleNames[0] : femaleNames[0];
  const hostBName = voiceGenderB === "male" ? maleNames[1] : femaleNames[1];

  // Podcast chunks always carry the podcast skill set, resolved by intent rather
  // than by whatever the user bound for lessons. A podcast generated from the
  // lesson page must still follow podcast methodology.
  return skillInjector.applyForIntent(
    `You are a podcast script writer. Continue an existing two-host educational podcast (Host A and Host B) at ${diff} level. ` +
    `Host A is ${hostAName} (${voiceGenderA}), Host B is ${hostBName} (${voiceGenderB}). ` +
    `Use their names naturally. Genders MUST match voices — do NOT use female names for a male voice or vice versa. ` +
    `Each exchange is 3-6 sentences of natural, substantive dialogue. Do NOT restart the conversation and do NOT repeat points ` +
    `already made — build on the script so far and move the discussion forward, covering the next aspect of the topic. ` +
    `The dialogue must have intellectual depth — not surface summaries. Include examples, analysis, and nuance. ` +
    `Respond ONLY with valid JSON: { "lines": [ { "speaker": "Host A", "text": "..." }, { "speaker": "Host B", "text": "..." } ] }.` +
    (language === "ar"
      ? `\n\nCRITICAL: Write all dialogue in Modern Standard Arabic (الفصحى). Keep the speaker labels "Host A"/"Host B" exactly as-is.`
      : ""),
    "podcast"
  );
}

/**
 * Layer 3 (podcast): podcasts are inherently long (15-40 exchanges), so they
 * are ALWAYS generated piecewise — title, then short chunks of dialogue, then
 * glossary + quiz. This keeps every individual structured-output call small
 * enough that even a 3B model cannot truncate it. Every chunk is retried on
 * the SAME model before giving up.
 */
async function generatePodcastChunked(
  modelId: string,
  userPrompt: string,
  difficulty: string,
  language: LessonLanguage,
  length?: string,
  voiceGenderA: "male" | "female" = "male",
  voiceGenderB: "male" | "female" = "female"
): Promise<GeneratedLesson> {
  const target = targetPodcastExchanges(difficulty, length);
  const source = trimSource(userPrompt);

  const titleData = validatePodcastTitle(
    await retrySameModel(modelId, () =>
      chatForJson(
        modelId,
        [
          { role: "system", content: podcastTitleSystemPrompt(language, voiceGenderA, voiceGenderB) },
          { role: "user", content: userPrompt },
        ],
        PODCAST_TITLE_JSON_SCHEMA,
        512
      )
    )
  );

  const script: { speaker: "Host A" | "Host B"; text: string }[] = [];
  const maxChunks = Math.ceil(target / 2) + 1;
  let chunks = 0;
  while (script.length < target && chunks < maxChunks) {
    const count = Math.min(PODCAST_CHUNK_LINES, target - script.length);
    const chunk = validatePodcastChunk(
      await retrySameModel(modelId, () =>
        chatForJson(
          modelId,
          [
            { role: "system", content: podcastChunkSystemPrompt(difficulty, language, voiceGenderA, voiceGenderB) },
            { role: "user", content: podcastChunkUserPrompt(titleData.title, source, script, count) },
          ],
          PODCAST_CHUNK_JSON_SCHEMA,
          6144
        )
      )
    );
    script.push(...chunk.lines);
    chunks += 1;
  }

  const glossaryQuiz = validateGlossaryQuiz(
    await retrySameModel(modelId, () =>
      chatForJson(
        modelId,
        [
          { role: "system", content: podcastGlossaryQuizSystemPrompt(difficulty, language, titleData.title) },
          { role: "user", content: userPrompt },
        ],
        GLOSSARY_QUIZ_JSON_SCHEMA,
        12288
      )
    )
  );

  const podcast = validatePodcastOutput({
    title: titleData.title,
    podcastScript: script,
    glossary: glossaryQuiz.glossary,
    quiz: glossaryQuiz.quiz,
  });

  // `sections` stays populated for downstream consumers that always read it
  // (library cards, HTML export, plain-audio mode); the real body is the script.
  // Podcasts are validated via validatePodcastOutput above — skip
  // validateLessonOutput because podcasts only have a single transcript section
  // and would fail the 6-section minimum that lessons require.
  return {
    title: podcast.title,
    sections: [
      {
        heading: podcast.title,
        content: podcast.podcastScript.map((l) => l.text).join("\n\n"),
      },
    ],
    glossary: podcast.glossary,
    quiz: podcast.quiz,
    podcastScript: podcast.podcastScript,
  } as GeneratedLesson;
}

export async function generatePodcastOnly(payload: {
  topic?: string;
  content?: string;
  model?: string;
  difficulty?: string;
  language?: LessonLanguage;
  length?: string;
  voiceGenderA?: "male" | "female";
  voiceGenderB?: "male" | "female";
}): Promise<{ podcastScript: GeneratedLesson["podcastScript"] }> {
  let validatedData: GenerateRequest;
  try {
    validatedData = validateGenerateLesson(payload);
  } catch (validationError) {
    if (validationError instanceof Error) {
      throw new AppError(`Invalid request: ${validationError.message}`, ErrorCode.VALIDATION_ERROR);
    }
    throw new AppError("Invalid request format", ErrorCode.VALIDATION_ERROR);
  }

  const { topic, content, model: preferredModel, difficulty, length, language, voiceGenderA, voiceGenderB, journeyContext } = validatedData;
  const requestDifficulty = difficulty || "intermediate";
  const requestLength = length || "medium";
  const requestLanguage: LessonLanguage =
    language ?? detectLanguage(`${topic ?? ""} ${content ?? ""}`);

  let selectedModel: string;
  try {
    selectedModel = await aiRuntime.ensureModel(preferredModel);
  } catch (e) {
    throw new AppError(
      `Failed to select a model: ${e instanceof Error ? e.message : String(e)}.`,
      ErrorCode.INTERNAL_ERROR
    );
  }

  const userPrompt = content
    ? `Here is the study material:\n\n${content}\n\nCreate a ${requestDifficulty}-level podcast from this material. Length: ${requestLength}.`
    : `Create a ${requestDifficulty}-level educational podcast about: ${topic}. Length: ${requestLength}.`;

  const userPromptWithJourney = journeyContext
    ? `${userPrompt}\n\n${journeyContext}`
    : userPrompt;

  try {
    const podcastLesson = await generatePodcastChunked(
      selectedModel,
      userPromptWithJourney,
      requestDifficulty,
      requestLanguage,
      requestLength,
      voiceGenderA || "male",
      voiceGenderB || "female"
    );
    return { podcastScript: podcastLesson.podcastScript };
  } catch (error) {
    const { reason, guidance } = describeGenerationFailure(error, requestLanguage);
    throw new AppError(
      `Podcast generation with model "${selectedModel}" failed: ${reason}.${guidance}`,
      ErrorCode.EXTERNAL_API_ERROR
    );
  }
}
