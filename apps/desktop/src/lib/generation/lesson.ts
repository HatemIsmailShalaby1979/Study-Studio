// Lesson generation — the one-shot path and the chunked fallback.
//
// Extracted from `generation.ts` (plan item 5.1). The public entry point is
// still `generateLesson` in `../generation`; this module holds the two
// strategies it picks between and their prompt/schema plumbing.

import {
  validateLessonOutput,
  validateLessonOutline,
  validateLessonSectionBatch,
  validateGlossaryQuiz,
} from "../validation";
import {
  GLOSSARY_QUIZ_JSON_SCHEMA,
  LESSON_OUTLINE_JSON_SCHEMA,
  LESSON_OUTPUT_JSON_SCHEMA,
  LESSON_SECTIONS_BATCH_JSON_SCHEMA,
} from "../validation";
import { chatForJson, retrySameModel } from "./transport";
import type { AIMessage } from "../ai-runtime";
import {
  lessonOutlineSystemPrompt,
  lessonSectionSystemPrompt,
  lessonSectionBatchUserPrompt,
  lessonGlossaryQuizSystemPrompt,
  trimSource,
} from "./prompts";
import type { LessonLanguage } from "./prompts";

export interface GeneratedLesson {
  title: string;
  sections: { heading: string; content: string }[];
  glossary: { term: string; definition: string }[];
  quiz: { question: string; options: string[]; correctIndex: number; explanation: string }[];
  podcastScript?: { speaker: "Host A" | "Host B"; text: string }[];
  htmlContent?: string | null;
  _model: string;
  _format?: "html" | "audio" | "podcast" | "text";
  _length?: "short" | "medium" | "long" | "comprehensive";
}

function lessonMaxTokens(inputLen: number, length?: string): number {
  const lengthMap: Record<string, number> = {
    short: 12288,
    medium: 24576,
    long: 32768,
    comprehensive: 49152,
  };
  return lengthMap[length || "medium"] || 24576;
}

/**
 * Direct one-shot lesson generation: the whole `{title, sections, glossary,
 * quiz}` in a single structured-output call. Fast when it works; the chunked
 * path is the fallback for long/comprehensive lessons that exceed the
 * one-shot budget.
 */
export async function tryGenerateLessonOnce(
  modelId: string,
  systemMessage: string,
  userPrompt: string,
  length?: string,
  signal?: AbortSignal
): Promise<GeneratedLesson> {
  const inputLen = userPrompt.length + systemMessage.length;
  const messages: AIMessage[] = [
    { role: "system", content: systemMessage },
    { role: "user", content: userPrompt },
  ];
  const parsed = await chatForJson(modelId, messages, LESSON_OUTPUT_JSON_SCHEMA, lessonMaxTokens(inputLen, length), signal);
  return validateLessonOutput(parsed) as GeneratedLesson;
}

// ---------------------------------------------------------------------------
// Lesson — chunked fallback path (Layer 3)
// ---------------------------------------------------------------------------

/** How many outline headings each section-content request covers. */
const LESSON_SECTION_BATCH_SIZE = 1;

/**
 * Map a requested heading batch onto the sections a model produced. Headings
 * are authoritative (from the outline step); content is matched by position.
 * Missing/empty content fails the batch so it can be retried.
 */
function assignBatchSections(
  headings: string[],
  produced: { heading: string; content: string }[]
): { heading: string; content: string }[] {
  if (produced.length === 0) {
    throw new Error("Chunk validation failed: the model produced no sections");
  }
  // Match produced sections to the authoritative headings by heading text when
  // possible; fall back to position order. This tolerates models that emit the
  // sections in a different order than requested.
  const byHeading = new Map<string, string>();
  const positional: string[] = [];
  for (const s of produced) {
    const content = (s?.content ?? "").trim();
    if (!content) continue;
    positional.push(content);
    const key = (s?.heading ?? "").trim().toLowerCase();
    if (key) byHeading.set(key, content);
  }
  return headings.map((heading) => {
    const key = heading.trim().toLowerCase();
    const content = byHeading.get(key) ?? positional.shift() ?? "";
    if (!content) {
      throw new Error("Chunk validation failed: empty section content");
    }
    return { heading, content };
  });
}

/**
 * Layer 3 (lesson): chunked, two-phase generation used when the one-shot JSON
 * fails. Phase 1 plans title + headings; phase 2 writes section content in
 * small batches; phase 3 produces glossary + quiz. Every chunk is retried on
 * the SAME model before giving up.
 */
export async function generateLessonChunked(
  modelId: string,
  userPrompt: string,
  difficulty: string,
  language: LessonLanguage,
  length?: string,
  signal?: AbortSignal
): Promise<GeneratedLesson> {
  const source = trimSource(userPrompt);

  const outline = validateLessonOutline(
    await retrySameModel(
      modelId,
      () =>
        chatForJson(
          modelId,
          [
            { role: "system", content: lessonOutlineSystemPrompt(difficulty, language) },
            { role: "user", content: userPrompt },
          ],
          LESSON_OUTLINE_JSON_SCHEMA,
          4096,
          signal
        ),
      signal
    )
  );

  const sections: GeneratedLesson["sections"] = [];
  for (let i = 0; i < outline.headings.length; i += LESSON_SECTION_BATCH_SIZE) {
    const batchHeadings = outline.headings.slice(i, i + LESSON_SECTION_BATCH_SIZE);
    const batchSections = await retrySameModel(
      modelId,
      async () => {
        const batch = validateLessonSectionBatch(
          await chatForJson(
            modelId,
            [
              { role: "system", content: lessonSectionSystemPrompt(difficulty, language) },
              { role: "user", content: lessonSectionBatchUserPrompt(source, batchHeadings) },
            ],
            LESSON_SECTIONS_BATCH_JSON_SCHEMA,
            12288,
            signal
          )
        );
        return assignBatchSections(batchHeadings, batch.sections);
      },
      signal
    );
    sections.push(...batchSections);
  }

  const glossaryQuiz = validateGlossaryQuiz(
    await retrySameModel(
      modelId,
      () =>
        chatForJson(
          modelId,
          [
            { role: "system", content: lessonGlossaryQuizSystemPrompt(difficulty, language, outline.title) },
            { role: "user", content: userPrompt },
          ],
          GLOSSARY_QUIZ_JSON_SCHEMA,
          24576,
          signal
        ),
      signal
    )
  );

  return validateLessonOutput({
    title: outline.title,
    sections,
    glossary: glossaryQuiz.glossary,
    quiz: glossaryQuiz.quiz,
  }) as GeneratedLesson;
}
