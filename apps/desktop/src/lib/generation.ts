// Lesson and podcast generation — public entry point.
//
// This file was 1,469 lines and is now split (plan item 5.1) into:
//
//   generation/prompts.ts    — pure prompt builders + language detection
//   generation/errors.ts     — error classification and failure descriptions
//   generation/transport.ts  — structured-output chat + same-model retry
//   generation/lesson.ts     — one-shot and chunked lesson strategies
//   generation/podcast.ts    — chunked podcast generation
//
// It deliberately keeps the SAME public export surface as before the split, so
// every existing `@/lib/generation` import keeps working unchanged. Do not move
// a consumer over to a submodule just because it seems tidier — the point of
// the barrel is that callers do not need to know the internal layout.
//
// This module is isomorphic: it runs inside the client bundle and in any server
// context. All model I/O goes through the AI Runtime (`src/lib/ai-runtime`),
// which dispatches to the active provider (Tauri IPC inside the desktop shell,
// direct HTTP in a plain browser). It is provider-agnostic — it never names a
// concrete backend.
//
// What remains here is the orchestration: request validation, model resolution,
// the one-shot→chunked fallback decision, and error wrapping.

import { AppError, ErrorCode } from "./error";
import { validateGenerateLesson } from "./validation";
import { aiRuntime } from "./ai-runtime";
import { classifyGenerationError, describeGenerationFailure } from "./generation/errors";
import { detectLanguage, getLessonSystemPrompt } from "./generation/prompts";
import type { LessonLanguage, GenerateRequest } from "./generation/prompts";
import { generateLessonChunked, tryGenerateLessonOnce } from "./generation/lesson";
import type { GeneratedLesson } from "./generation/lesson";
import { generateHTML } from "./htmlExport";

export type { GeneratedLesson, LessonLanguage, GenerateRequest };
export { generateHTML };
export { generatePodcastOnly } from "./generation/podcast";
export { detectLanguage, getLessonSystemPrompt, podcastChunkSystemPrompt } from "./generation/prompts";

/**
 * Generate a complete lesson.
 *
 * Strategy: one-shot structured JSON first (fast, covers most lessons). If that
 * fails *recoverably* — truncation, malformed JSON, schema slip — fall back to
 * the chunked two-phase path. Both use the SAME model: this app never switches
 * models mid-generation (session model policy).
 *
 * The one-shot attempt is made once, not retried. A retry is a real strategy
 * for a small request that can come back different; for a request whose whole
 * purpose is to exceed what the model will emit in one response, it is three
 * more minutes spent reaching the same truncation. `retrySameModel` still
 * guards every *chunk* of the fallback path, where the requests are small.
 */
export async function generateLesson(payload: GenerateRequest): Promise<GeneratedLesson> {
  let validatedData: GenerateRequest;
  try {
    validatedData = validateGenerateLesson(payload);
  } catch (validationError) {
    if (validationError instanceof Error) {
      throw new AppError(
        `Invalid request: ${validationError.message}`,
        ErrorCode.VALIDATION_ERROR
      );
    }
    throw new AppError("Invalid request format", ErrorCode.VALIDATION_ERROR);
  }

  const { topic, content, model: preferredModel, difficulty, format, length, language } = validatedData;
  const requestDifficulty = difficulty || "intermediate";
  const requestFormat = format || "text";
  const requestLength = length || "medium";
  // Resolve output language: explicit choice wins, otherwise auto-detect from
  // the topic/content text so an Arabic topic yields an Arabic lesson.
  const requestLanguage: LessonLanguage =
    language ?? detectLanguage(`${topic ?? ""} ${content ?? ""}`);

  // Validate model availability and resolve the selected model. `ensureModel`
  // throws if the user-selected model isn't installed — generation never
  // auto-switches to a different model (session model policy).
  let selectedModel: string;
  try {
    selectedModel = await aiRuntime.ensureModel(preferredModel);
  } catch (e) {
    // If we can't resolve the selected model, there is nothing to fall back to.
    throw new AppError(
      `Failed to select a model: ${e instanceof Error ? e.message : String(e)}. ` +
        `Please ensure the AI runtime is running and has at least one model installed.`,
      ErrorCode.INTERNAL_ERROR
    );
  }

  // Skip the redundant standalone health check: `ensureModel`/`listModels`
  // already proved the runtime is reachable and has models. If it weren't, the
  // call above would have thrown. This removes one network round-trip before
  // the first token.

  const userPrompt = content
    ? `Here is the study material:\n\n${content}\n\nCreate a ${requestDifficulty}-level lesson from this material. Length: ${requestLength}. Cover ALL concepts in depth with substantive analysis, not surface summaries.`
    : `Create a ${requestDifficulty}-level educational lesson about: ${topic}. Length: ${requestLength}. Cover the topic thoroughly — foundations through advanced applications, with real examples and analysis.`;

  // Append journey context so topics in the same track build on each other.
  const userPromptWithJourney = validatedData.journeyContext
    ? `${userPrompt}\n\n${validatedData.journeyContext}`
    : userPrompt;

  const lessonSystemMessage = getLessonSystemPrompt(requestDifficulty, requestLanguage);

  // --- Session model policy: NO AUTO SWITCH ---
  // The user-selected model is the ONLY model used for this generation.
  // Recoverable errors (bad JSON, truncation) retry the SAME model up to
  // MAX_SAME_MODEL_RETRIES times — retrying the same model is not a switch.
  // Anything else (missing model, network, server 5xx) surfaces immediately.
  // Note: `validatedData` is schema-stripped, so the cancellation signal is
  // read from the raw payload (zod drops unknown keys).
  const signal = payload.signal;

  const tryWithModel = async (): Promise<GeneratedLesson> => {
    try {
      // Lesson: one shot, then fall back. Deliberately NOT wrapped in
      // `retrySameModel`.
      //
      // The one-shot request asks a local model for the entire lesson —
      // 8-12 sections of 300-500 words plus glossary and quiz, up to 24 576
      // tokens — in a single structured response. When that fails it fails
      // *deterministically*: the same prompt at the same length overruns the
      // same budget and gets truncated at the same place. Retrying it three
      // times therefore spent three more full generations (minutes each on a
      // 9B model) to reach the same error, and only then ran the fallback that
      // exists for exactly this failure. One attempt, then chunk.
      return await tryGenerateLessonOnce(selectedModel, lessonSystemMessage, userPromptWithJourney, requestLength, signal);
    } catch (e) {
      // One-shot lesson JSON failed recoverably (truncation, schema slip,
      // malformed JSON). Fall back to the chunked two-phase path with the SAME
      // model — never switch models. The chunked path keeps its own
      // same-model retry per chunk, which is where a retry can actually help:
      // each chunk is small enough that a second attempt is likely to differ.
      if (classifyGenerationError(e) === "recoverable") {
        console.warn("[generation] One-shot lesson JSON failed; falling back to chunked generation with the same model.");
        return generateLessonChunked(selectedModel, userPromptWithJourney, requestDifficulty, requestLanguage, requestLength, signal);
      }
      throw e;
    }
  };

  try {
    const lesson = await tryWithModel();
    const htmlContent = requestFormat === "html" ? generateHTML(lesson) : null;
    return {
      ...lesson,
      htmlContent,
      _model: selectedModel,
      _format: requestFormat,
      _length: requestLength,
    };
  } catch (error) {
    if (signal?.aborted) {
      throw new AppError("Lesson generation cancelled.", ErrorCode.EXTERNAL_API_ERROR);
    }
    const { reason, guidance } = describeGenerationFailure(error, requestLanguage);
    throw new AppError(
      `Lesson generation with model "${selectedModel}" failed: ${reason}.${guidance} The selected model is pinned for this session — pick a different model in the app to switch.`,
      ErrorCode.EXTERNAL_API_ERROR
    );
  }
}
