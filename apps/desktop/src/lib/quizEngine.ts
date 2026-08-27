// Lightweight Diagnostic Quiz Generator & Evaluator
//
// The "Challenge Yourself" engine. It parses a lesson's generated HTML and
// produces 3-5 targeted diagnostic questions (concept recall multiple-choice,
// key-vocabulary fill-in-the-blank, and micro-translations for language
// learning). It is deliberately lightweight:
//   - one small structured-output call to the local LLM (no streaming), or
//   - a deterministic offline fallback built from the lesson glossary/text,
//     so evaluation NEVER blocks audio generation or freezes the UI.
//
// Telemetry (Accuracy Score, Confidence Index, Target-Language Retention
// Ratio) is logged to the Helix Education event stream for the Metacognitive
// Pulse and journey analytics.

import { aiRuntime, extractJsonFromResponse, repairJson } from "./ai-runtime";
import { validateDiagnosticQuiz, QUIZ_GENERATION_JSON_SCHEMA } from "./validation";
import {
  appendEvalEvent,
  appendMasteryScored,
  createEvalEvent,
  EVENT_TYPES,
} from "./helixEvents";
import type {
  DiagnosticQuiz,
  DiagnosticQuizQuestion,
  QuizEvaluationMetrics,
} from "@/types";

export interface DiagnosticAnswer {
  questionId: string;
  /** For multiple_choice: the selected option text. For fill/translation: typed text. */
  value: string;
  optionIndex?: number;
  /** Response latency for this item in milliseconds. */
  elapsedMs: number;
}

export interface GenerateDiagnosticQuizOptions {
  lessonTitle: string;
  /** Raw generated HTML (parsed for content). */
  htmlContent: string;
  /** Plain-text fallback when no HTML is available (e.g. buildTtsText(lesson)). */
  lessonText?: string;
  glossary?: { term: string; definition: string }[];
  /** Lesson language tag ("en" | "ar" | "de" | ...). Enables micro-translations. */
  language?: string;
  /** Pinned session model, passed straight to the runtime (never auto-switched). */
  model?: string;
}

const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 5;
const MAX_CONTENT_CHARS = 6000;
const CONFIDENCE_WINDOW_MS = 60_000; // avg response at/above 60s → confidence 0

// ─── HTML / text helpers ──────────────────────────────────────────────────

/** Strip HTML to readable plain text (no DOM dependency; jest/node-safe). */
export function htmlToPlainText(html: string): string {
  if (!html) return "";
  let text = html
    // drop script/style blocks first so their text never leaks in
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    // decode the most common entities
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  // collapse whitespace and trim
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

/** Deterministic djb2 string hash → stable short ids. */
function stableId(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

// ─── Prompt building ──────────────────────────────────────────────────────

/**
 * Build the compact LLM prompt for the diagnostic quiz. Requests exactly
 * 3-5 questions mixing multiple_choice, fill_blank and translation, all
 * grounded in the supplied lesson content.
 */
export function buildDiagnosticQuizPrompt(input: {
  lessonTitle: string;
  plainText: string;
  language?: string;
}): string {
  const lang = input.language && input.language !== "en" ? input.language : null;
  const content = input.plainText.slice(0, MAX_CONTENT_CHARS);
  const langInstr = lang
    ? `\nInclude 1 micro-translation question: pick an important term and ask the learner to translate it to/from ${lang} (this tests Target-Language Retention).`
    : `\nInclude 1 fill-in-the-blank key-vocabulary question drawn from an important term in the lesson.`;

  return `You are an expert diagnostic tutor. Create a short diagnostic quiz for the lesson titled "${input.lessonTitle}".

Lesson content:
"""${content}"""

Requirements:
- Exactly 3 to 5 questions.
- Question TYPES: at least one "multiple_choice" (concept recall), at least one "fill_blank" (key vocabulary).${langInstr}
- Multiple choice: 4 plausible options, set correctIndex to the right one.
- Fill-in-the-blank: replace the tested term with ___ and put the exact answer in "answer".
- Translation: put the target-language term in "answer" and the term text in "languageTerm".
- Keep questions fast and precise. Do NOT ask anything outside the lesson content.

Respond ONLY with valid JSON:
{ "questions": [ { "type": "multiple_choice|fill_blank|translation", "prompt": "...", "options": ["A","B","C","D"], "correctIndex": 0, "answer": "...", "explanation": "Why the answer is right.", "languageTerm": "..." } ] }`;
}

// ─── Parsing / validation ─────────────────────────────────────────────────

/** Parse raw model output into a validated DiagnosticQuiz. */
export function parseDiagnosticQuiz(jsonStr: string, topic: string, lessonTitle: string): DiagnosticQuiz {
  let data: unknown;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    data = JSON.parse(repairJson(jsonStr));
  }
  const validated = validateDiagnosticQuiz(data);
  const questions: DiagnosticQuizQuestion[] = (validated.questions as DiagnosticQuizQuestion[]).map((q) => ({
    ...q,
    id: q.id || stableId(`${q.type}:${q.prompt}`),
  }));
  return {
    quizId: `diag_${stableId(`${topic}:${lessonTitle}:${Date.now()}`)}`,
    topic,
    title: lessonTitle,
    questions,
    createdAt: new Date().toISOString(),
  };
}

// ─── Deterministic offline fallback ───────────────────────────────────────

function fallbackMultipleChoice(
  term: string,
  definition: string,
  distractors: string[]
): DiagnosticQuizQuestion {
  const options = [definition, ...distractors].slice(0, 4);
  // guarantee 4 options
  while (options.length < 4) options.push(`Something unrelated to "${term}".`);
  const correctIndex = 0;
  return {
    id: stableId(`mc:${term}`),
    type: "multiple_choice",
    prompt: `Which of these correctly describes the key term "${term}"?`,
    options,
    correctIndex,
    explanation: `"${term}" is defined as: ${definition}.`,
  };
}

function fallbackFillBlank(term: string, definition: string): DiagnosticQuizQuestion {
  return {
    id: stableId(`fb:${term}`),
    type: "fill_blank",
    prompt: `Complete the key term: "${definition}". The term is: ___`,
    answer: term,
    explanation: `The key term is "${term}".`,
  };
}

function fallbackTranslation(term: string): DiagnosticQuizQuestion {
  return {
    id: stableId(`tr:${term}`),
    type: "translation",
    prompt: `Translate the term "${term}" into English.`,
    answer: term,
    explanation: `The English form of the term is "${term}".`,
    languageTerm: term,
  };
}

/**
 * Deterministic quiz builder used when the LLM is unavailable or fails.
 * Grounded in the lesson glossary (fallback chain keeps 3-5 questions).
 */
export function buildFallbackQuiz(opts: GenerateDiagnosticQuizOptions): DiagnosticQuiz {
  const glossary = opts.glossary?.filter((g) => g.term && g.definition) ?? [];
  const questions: DiagnosticQuizQuestion[] = [];

  const terms = glossary.slice(0, 4);
  for (let i = 0; i < terms.length && questions.length < 2; i++) {
    const term = terms[i];
    if (!term) continue;
    const distractors = glossary.filter((g) => g.term !== term.term).map((g) => g.definition);
    questions.push(fallbackMultipleChoice(term.term, term.definition, distractors));
  }

  for (let i = 0; i < terms.length && questions.length < 4; i++) {
    const term = terms[i];
    if (!term) continue;
    if (!questions.some((q) => q.id === stableId(`fb:${term.term}`))) {
      questions.push(fallbackFillBlank(term.term, term.definition));
    }
  }

  const lang = opts.language && opts.language !== "en" ? opts.language : null;
  const firstTerm = terms[0];
  if (lang && firstTerm && questions.length < MAX_QUESTIONS) {
    questions.push(fallbackTranslation(firstTerm.term));
  }

  // If the lesson has no glossary, derive questions from the plain text.
  if (questions.length < MIN_QUESTIONS) {
    const plain = htmlToPlainText(opts.htmlContent) || (opts.lessonText ?? "");
    const sentences = plain.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 20);
    const topic = opts.lessonTitle.trim() || "this lesson";
    if (sentences.length > 0) {
      questions.push({
        id: stableId(`mc:main:${topic}`),
        type: "multiple_choice",
        prompt: `What is "${topic}" mainly about?`,
        options: [
          (sentences[0] ?? "").slice(0, 140),
          "A brief history of unrelated engineering topics.",
          "A recipe for a seasonal dish.",
          "An overview of cloud pricing models.",
        ],
        correctIndex: 0,
        explanation: `The lesson opens: "${(sentences[0] ?? "").slice(0, 120)}…"`,
      });
    }
    const sentences2 = sentences[1];
    if (sentences2 && questions.length < MAX_QUESTIONS) {
      questions.push({
        id: stableId(`fb:detail:${topic}`),
        type: "fill_blank",
        prompt: `Fill in the missing key idea from the lesson: "${sentences2.slice(0, 100)}…" The missing idea is the topic of this sentence.`,
        answer: sentences2.slice(0, 60),
        explanation: "This sentence introduces a key idea covered in the lesson.",
      });
    }
    if (questions.length < MIN_QUESTIONS) {
      questions.push({
        id: stableId(`mc:vocab:${topic}`),
        type: "multiple_choice",
        prompt: `Which option is a key term introduced by "${topic}"?`,
        options: [topic, "Quicksort", "Resistor", "Bézier"],
        correctIndex: 0,
        explanation: `"${topic}" is the central concept of the lesson.`,
      });
    }
  }

  // Hard cap at MAX_QUESTIONS, fill to MIN_QUESTIONS as a safety net.
  const finalQuestions = questions.slice(0, MAX_QUESTIONS);
  while (finalQuestions.length < MIN_QUESTIONS) {
    const n = finalQuestions.length + 1;
    finalQuestions.push({
      id: stableId(`mc:generic:${n}`),
      type: "multiple_choice",
      prompt: `Which statement best reflects a core idea of "${opts.lessonTitle || "this lesson"}"?`,
      options: [
        `Core idea ${n} from "${opts.lessonTitle || "the lesson"}".`,
        "A statement that is clearly false.",
        "A statement about economics.",
        "A statement about sports.",
      ],
      correctIndex: 0,
      explanation: `Re-read the lesson to confirm core idea ${n}.`,
    });
  }

  return {
    quizId: `diag_${stableId(`${opts.lessonTitle}:${Date.now()}`)}`,
    topic: opts.lessonTitle,
    title: opts.lessonTitle,
    questions: finalQuestions,
    createdAt: new Date().toISOString(),
  };
}

// ─── Generation orchestration ─────────────────────────────────────────────

/**
 * Generate a diagnostic quiz for a lesson. Fast, non-blocking, never
 * touches the audio pipeline. Falls back to the deterministic builder when
 * the local model is unavailable or the structured output can't be parsed.
 */
export async function generateDiagnosticQuiz(
  opts: GenerateDiagnosticQuizOptions
): Promise<DiagnosticQuiz> {
  const plainText = htmlToPlainText(opts.htmlContent) || (opts.lessonText ?? "");

  try {
    const health = await aiRuntime.health();
    if (!health.available) {
      return buildFallbackQuiz(opts);
    }
    const modelToUse = opts.model ? await aiRuntime.ensureModel(opts.model) : health.recommendedModel;

    const prompt = buildDiagnosticQuizPrompt({
      lessonTitle: opts.lessonTitle,
      plainText,
      language: opts.language,
    });

    const raw = await aiRuntime.chat(
      [
        {
          role: "system",
          content: "You are a precise diagnostic tutor. Always answer with only valid JSON.",
        },
        { role: "user", content: prompt },
      ],
      { temperature: 0.3, maxTokens: 1500, format: QUIZ_GENERATION_JSON_SCHEMA },
      modelToUse
    );
    const quiz = parseDiagnosticQuiz(extractJsonFromResponse(raw), opts.lessonTitle, opts.lessonTitle);
    return quiz;
  } catch (err) {
    console.warn(
      `[quizEngine] LLM quiz generation failed; using offline builder: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return buildFallbackQuiz(opts);
  }
}

// ─── Answer scoring ───────────────────────────────────────────────────────

/** Normalise free-text answers for comparison (case/punctuation/whitespace). */
export function normalizeAnswer(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether a learner answer is correct for a given question. */
export function isDiagnosticAnswerCorrect(
  question: DiagnosticQuizQuestion,
  answer?: DiagnosticAnswer
): boolean {
  if (!answer) return false;
  if (question.type === "multiple_choice") {
    return typeof answer.optionIndex === "number" && answer.optionIndex === question.correctIndex;
  }
  if (!question.answer) return false;
  return normalizeAnswer(answer.value) === normalizeAnswer(question.answer);
}

/** Score a completed diagnostic quiz into the three Helix telemetry metrics. */
export function scoreDiagnosticQuiz(
  quiz: DiagnosticQuiz,
  answers: Record<string, DiagnosticAnswer>,
  startedAt: number
): QuizEvaluationMetrics {
  const total = quiz.questions.length;
  let correct = 0;
  let latencySum = 0;
  let latencyCount = 0;

  const byType: Record<DiagnosticQuizQuestion["type"], { correct: number; total: number }> = {
    multiple_choice: { correct: 0, total: 0 },
    fill_blank: { correct: 0, total: 0 },
    translation: { correct: 0, total: 0 },
  };

  for (const q of quiz.questions) {
    const a = answers[q.id];
    const ok = isDiagnosticAnswerCorrect(q, a);
    byType[q.type].total += 1;
    if (ok) {
      correct += 1;
      byType[q.type].correct += 1;
    }
    if (a && typeof a.elapsedMs === "number") {
      latencySum += a.elapsedMs;
      latencyCount += 1;
    }
  }

  const accuracyScore = total > 0 ? Math.round((correct / total) * 100) : 0;
  const avgResponseMs = latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0;

  // Confidence Index: faster, more deliberate answering → higher confidence.
  const confidenceIndex = Math.round(
    Math.max(0, Math.min(1, 1 - avgResponseMs / CONFIDENCE_WINDOW_MS)) * 100
  );

  // Target-Language Retention Ratio: translation items dominate, then
  // vocabulary (fill_blank); otherwise accuracy as the base retention signal.
  let retentionRatio: number;
  if (byType.translation.total > 0) {
    retentionRatio = byType.translation.correct / byType.translation.total;
  } else if (byType.fill_blank.total > 0) {
    retentionRatio = byType.fill_blank.correct / byType.fill_blank.total;
  } else {
    retentionRatio = accuracyScore / 100;
  }
  retentionRatio = Math.round(retentionRatio * 100) / 100;

  void startedAt;
  return {
    accuracyScore,
    confidenceIndex,
    retentionRatio,
    totalQuestions: total,
    correctAnswers: correct,
    avgResponseMs,
  };
}

/** Humorous guidance delivered after a diagnostic quiz attempt. */
export function accuracyGuidance(metrics: QuizEvaluationMetrics): string {
  if (metrics.accuracyScore >= 80) {
    return "Whoa, save some brainpower for the rest of us! You crushed that.";
  }
  if (metrics.accuracyScore >= 60) {
    return "Solid work! You are one listen away from absolute mastery.";
  }
  return "No worries at all! That's why we built the Audiobook. Give the story another listen or hit regenerate with an \"Explain like I'm 10\" tweak.";
}

// ─── Event logging (orchestration) ────────────────────────────────────────

/** Log QuizGenerated (quiz_created) when a diagnostic quiz is produced. */
export function logQuizGenerated(quiz: DiagnosticQuiz): void {
  appendEvalEvent(
    createEvalEvent(EVENT_TYPES.quizCreated, {
      quiz_id: quiz.quizId,
      topic: quiz.topic,
      title: quiz.title,
      question_count: quiz.questions.length,
      categories: quiz.questions.map((q) => q.type),
    })
  );
}

/** Log AnswerSubmitted (answer_submitted) for a single item. */
export function logAnswerSubmitted(quiz: DiagnosticQuiz, answer: DiagnosticAnswer, attempt: number): void {
  appendEvalEvent(
    createEvalEvent(EVENT_TYPES.answerSubmitted, {
      quiz_id: quiz.quizId,
      quiz_item_id: answer.questionId,
      question: quiz.questions.find((q) => q.id === answer.questionId)?.prompt ?? "",
      raw_answer: answer.value,
      attempt_number: attempt,
      response_ms: answer.elapsedMs,
    })
  );
}

/** Log MasteryScored (quiz_result) telemetry and return it for callers. */
export function logMasteryScored(
  quiz: DiagnosticQuiz,
  metrics: QuizEvaluationMetrics
): QuizEvaluationMetrics {
  appendMasteryScored({
    quizId: quiz.quizId,
    topic: quiz.topic,
    lessonTitle: quiz.title,
    metrics,
  });
  return metrics;
}

/** One-stop attempt recorder used by the DiagnosticQuiz component. */
export function recordQuizAttempt(opts: {
  quiz: DiagnosticQuiz;
  answers: Record<string, DiagnosticAnswer>;
  startedAt: number;
}): QuizEvaluationMetrics {
  const metrics = scoreDiagnosticQuiz(opts.quiz, opts.answers, opts.startedAt);
  return logMasteryScored(opts.quiz, metrics);
}
