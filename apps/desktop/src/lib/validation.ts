import { z } from 'zod';

export const generateLessonSchema = z.object({
  topic: z.string().min(1, 'Topic is required').max(200, 'Topic too long').optional(),
  content: z.string().min(10, 'Content must be at least 10 characters').max(50000, 'Content too long').optional(),
  model: z.string().optional(),
  difficulty: z.enum(['beginner', 'intermediate', 'expert']).default('intermediate'),
  format: z.enum(['html', 'audio', 'podcast', 'text']).optional(),
  length: z.enum(['short', 'medium', 'long', 'comprehensive']).optional(),
  language: z.enum(['ar', 'en']).optional(),
  voiceGenderA: z.enum(['male', 'female']).optional(),
  voiceGenderB: z.enum(['male', 'female']).optional(),
  journeyContext: z.string().max(10000, 'Journey context too long').optional(),
}).refine(data => data.topic || data.content, {
  message: 'Either topic or content must be provided',
  path: ['topic']
});

export const evaluateQuizSchema = z.object({
  questions: z.array(z.object({
    question: z.string().min(1),
    options: z.array(z.string().min(1)).min(2, 'At least 2 options required'),
    correctIndex: z.number().int().min(0),
    explanation: z.string().min(1)
  })).min(1, 'At least one question required'),
  answers: z.record(z.number().int().min(0)),
  difficulty: z.enum(['beginner', 'intermediate', 'expert']).default('intermediate'),
  lessonTitle: z.string().min(1)
});

export const modelsSchema = z.object({
  source: z.enum(['local', 'ollama']).default('local'),
  freeOnly: z.boolean().default(true)
});

// ---------------------------------------------------------------------------
// Lightweight diagnostic quiz generation (Challenge Yourself engine)
// ---------------------------------------------------------------------------
export const diagnosticQuestionSchema = z
  .object({
    id: z.string().min(1).optional(),
    type: z.enum(["multiple_choice", "fill_blank", "translation"]),
    prompt: z.string().min(1, "Question prompt is required"),
    options: z.array(z.string().min(1)).min(2, "Multiple-choice needs at least 2 options").optional(),
    correctIndex: z.number().int().min(0).optional(),
    answer: z.string().min(1, "An answer is required").optional(),
    explanation: z.string().min(1, "Explanation is required"),
    languageTerm: z.string().optional(),
  })
  .superRefine((q, ctx) => {
    if (q.type === "multiple_choice") {
      if (!Array.isArray(q.options) || q.options.length < 2) {
        ctx.addIssue({ code: "custom", path: ["options"], message: "multiple_choice requires options" });
      }
      if (typeof q.correctIndex !== "number" || q.correctIndex < 0 || q.correctIndex >= (q.options?.length ?? 0)) {
        ctx.addIssue({ code: "custom", path: ["correctIndex"], message: "multiple_choice requires a valid correctIndex" });
      }
    } else if (!q.answer || q.answer.trim().length === 0) {
      ctx.addIssue({ code: "custom", path: ["answer"], message: "fill_blank/translation requires an answer" });
    }
  });

export const diagnosticQuizSchema = z.object({
  questions: z
    .array(diagnosticQuestionSchema)
    .min(3, "Diagnostic quiz needs 3-5 questions")
    .max(5, "Diagnostic quiz needs 3-5 questions"),
});

export function validateDiagnosticQuiz(data: unknown) {
  return diagnosticQuizSchema.parse(data);
}

export function validateGenerateLesson(data: unknown) {
  return generateLessonSchema.parse(data);
}

export function validateEvaluateQuiz(data: unknown) {
  return evaluateQuizSchema.parse(data);
}

export function validateModelsRequest(data: unknown) {
  return modelsSchema.parse(data);
}

// ---------------------------------------------------------------------------
// Shared sub-schemas (reused by lesson / podcast / chunk validators)
// ---------------------------------------------------------------------------
export const lessonSectionSchema = z.object({
  heading: z.string().min(1),
  content: z.string().min(500, "Section content must be at least 500 characters — provide substantial, detailed analysis with examples and depth"),
});

export const glossaryItemSchema = z.object({
  term: z.string().min(1),
  definition: z.string().min(80, "Definition must be at least 80 characters — provide a clear, precise definition with context and practical significance"),
});

export const quizItemSchema = z.object({
  question: z.string().min(15, "Question must be at least 15 characters — test real understanding, not trivial recall"),
  options: z.array(z.string().min(1)).min(4, "Quiz questions must have exactly 4 options (A, B, C, D)"),
  correctIndex: z.number().int().min(0).max(3, "correctIndex must be 0-3 (4 options)"),
  explanation: z.string().min(100, "Explanation must be at least 100 characters — explain WHY this answer is correct and WHY the other options are wrong"),
});

export const podcastLineSchema = z.object({
  speaker: z.enum(["Host A", "Host B"]),
  text: z.string().min(30, "Podcast line must be at least 30 characters — each line must have substantive content"),
});

// ---------------------------------------------------------------------------
// Full-output validators (one-shot or assembled from chunks)
// ---------------------------------------------------------------------------
export const lessonOutputSchema = z.object({
  title: z.string().min(1),
  sections: z.array(lessonSectionSchema).min(6, "Lesson must have at least 6 sections for meaningful depth"),
  glossary: z.array(glossaryItemSchema).min(8, "Lesson must have at least 8 glossary terms"),
  quiz: z.array(quizItemSchema).min(6, "Lesson must have at least 6 quiz questions"),
  podcastScript: z.array(podcastLineSchema).optional(),
});

/** Podcast output — no `sections`; the script IS the body. */
export const podcastOutputSchema = z.object({
  title: z.string().min(1),
  podcastScript: z.array(podcastLineSchema).min(8, "Podcast must have at least 8 dialogue lines for substantive conversation"),
  glossary: z.array(glossaryItemSchema).min(6, "Podcast must have at least 6 glossary terms"),
  quiz: z.array(quizItemSchema).min(6, "Podcast must have at least 6 quiz questions"),
});

// ---------------------------------------------------------------------------
// Chunk-phase output schemas (Layer 3 — piecewise generation)
// ---------------------------------------------------------------------------
export const lessonOutlineOutputSchema = z.object({
  title: z.string().min(1),
  headings: z.array(z.string().min(1)).min(5, "Outline must have at least 5 headings"),
});

export const lessonSectionBatchOutputSchema = z.object({
  sections: z.array(lessonSectionSchema).min(1),
});

export const glossaryQuizOutputSchema = z.object({
  glossary: z.array(glossaryItemSchema).min(8, "Glossary must have at least 8 terms"),
  quiz: z.array(quizItemSchema).min(6, "Quiz must have at least 6 questions"),
});

export const podcastTitleOutputSchema = z.object({
  title: z.string().min(1),
});

export const podcastChunkOutputSchema = z.object({
  lines: z.array(podcastLineSchema).min(2, "Podcast chunk must have at least 2 dialogue lines"),
});

// ---------------------------------------------------------------------------
// Repair helpers — fix common model mistakes before strict validation
// ---------------------------------------------------------------------------
function repairQuizItem(item: unknown): unknown {
  if (!item || typeof item !== "object") return item;
  const obj = item as Record<string, unknown>;
  const idx = obj['correctIndex'];
  // If correctIndex is missing, not a number, or out of range, default to 0
  if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx > 3) {
    obj['correctIndex'] = 0;
  }
  return obj;
}

function repairQuizArray(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj['quiz'])) {
    obj['quiz'] = (obj['quiz'] as unknown[]).map(repairQuizItem);
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------
export function validateLessonOutput(data: unknown) {
  return lessonOutputSchema.parse(repairQuizArray(data));
}

export function validatePodcastOutput(data: unknown) {
  return podcastOutputSchema.parse(repairQuizArray(data));
}

export function validateLessonOutline(data: unknown) {
  return lessonOutlineOutputSchema.parse(data);
}

export function validateLessonSectionBatch(data: unknown) {
  return lessonSectionBatchOutputSchema.parse(data);
}

export function validateGlossaryQuiz(data: unknown) {
  return glossaryQuizOutputSchema.parse(repairQuizArray(data));
}

export function validatePodcastTitle(data: unknown) {
  return podcastTitleOutputSchema.parse(data);
}

export function validatePodcastChunk(data: unknown) {
  return podcastChunkOutputSchema.parse(data);
}

// ---------------------------------------------------------------------------
// Ollama `format` JSON Schemas (Layer 1 — structured output)
// ---------------------------------------------------------------------------
// These mirror the zod schemas above for Ollama's structured-output mode
// (`format` field in /api/chat and /api/generate request bodies).
const S = { type: "string" } as const;

const jsonSection = {
  type: "object",
  properties: { heading: S, content: S },
  required: ["heading", "content"],
};

const jsonGlossaryItem = {
  type: "object",
  properties: { term: S, definition: S },
  required: ["term", "definition"],
};

const jsonQuizItem = {
  type: "object",
  properties: {
    question: S,
    options: { type: "array", items: S },
    correctIndex: { type: "integer" },
    explanation: S,
  },
  required: ["question", "options", "correctIndex", "explanation"],
};

const jsonPodcastLine = {
  type: "object",
  properties: {
    speaker: { type: "string", enum: ["Host A", "Host B"] },
    text: S,
  },
  required: ["speaker", "text"],
};

export const LESSON_OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: S,
    sections: { type: "array", items: jsonSection },
    glossary: { type: "array", items: jsonGlossaryItem },
    quiz: { type: "array", items: jsonQuizItem },
    podcastScript: { type: "array", items: jsonPodcastLine },
  },
  required: ["title", "sections"],
};

export const PODCAST_TITLE_JSON_SCHEMA = {
  type: "object",
  properties: { title: S },
  required: ["title"],
};

export const PODCAST_CHUNK_JSON_SCHEMA = {
  type: "object",
  properties: { lines: { type: "array", items: jsonPodcastLine } },
  required: ["lines"],
};

export const LESSON_OUTLINE_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: S,
    headings: { type: "array", items: S },
  },
  required: ["title", "headings"],
};

export const LESSON_SECTIONS_BATCH_JSON_SCHEMA = {
  type: "object",
  properties: { sections: { type: "array", items: jsonSection } },
  required: ["sections"],
};

export const GLOSSARY_QUIZ_JSON_SCHEMA = {
  type: "object",
  properties: {
    glossary: { type: "array", items: jsonGlossaryItem },
    quiz: { type: "array", items: jsonQuizItem },
  },
  required: ["glossary", "quiz"],
};

export const EVALUATION_OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    overallScore: { type: "integer" },
    totalQuestions: { type: "integer" },
    correctAnswers: { type: "integer" },
    rating: { type: "string", enum: ["excellent", "good", "fair", "needs_review"] },
    feedback: S,
    perQuestion: {
      type: "array",
      items: {
        type: "object",
        properties: {
          questionIndex: { type: "integer" },
          userAnswer: { type: "integer" },
          correctAnswer: { type: "integer" },
          isCorrect: { type: "boolean" },
          explanation: S,
        },
        required: ["questionIndex", "userAnswer", "correctAnswer", "isCorrect", "explanation"],
      },
    },
  },
  required: ["overallScore", "totalQuestions", "correctAnswers", "rating", "feedback", "perQuestion"],
};

const jsonDiagnosticQuestion = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["multiple_choice", "fill_blank", "translation"] },
    prompt: S,
    options: { type: "array", items: S },
    correctIndex: { type: "integer" },
    answer: S,
    explanation: S,
    languageTerm: S,
  },
  required: ["type", "prompt", "explanation"],
};

/** Structured-output schema for the lightweight diagnostic quiz generator. */
export const QUIZ_GENERATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: jsonDiagnosticQuestion,
      minItems: 3,
      maxItems: 5,
    },
  },
  required: ["questions"],
};