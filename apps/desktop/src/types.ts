export interface Section {
  heading: string;
  content: string;
}

export interface GlossaryItem {
  term: string;
  definition: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface PodcastLine {
  speaker: "Host A" | "Host B";
  text: string;
}

export type Difficulty = "beginner" | "intermediate" | "expert";

export interface Lesson {
  id: string;
  title: string;
  sections: Section[];
  glossary: GlossaryItem[];
  quiz: QuizQuestion[];
  createdAt: string;
  type: "lesson" | "podcast";
  podcastScript?: PodcastLine[];
  difficulty?: Difficulty;
  inputText?: string;
  inputMode?: "topic" | "content";
  htmlContent?: string | null;
  audioUrl?: string | null;
  audioPath?: string | null;
  format?: "html" | "audio" | "podcast" | "text";
  length?: "short" | "medium" | "long" | "comprehensive";
  modelName?: string;
  ttsVoice?: string;
  ttsVoiceB?: string;
  audioFormat?: "mp3" | "wav";
  /** Optional journey container this lesson belongs to. */
  journeyId?: string;
}

export interface QuizResult {
  answers: Record<number, number>;
  score: number;
  completed: boolean;
}

export interface QuizEvaluation {
  overallScore: number;
  totalQuestions: number;
  correctAnswers: number;
  rating: "excellent" | "good" | "fair" | "needs_review";
  feedback: string;
  perQuestion: {
    questionIndex: number;
    userAnswer: number;
    correctAnswer: number;
    isCorrect: boolean;
    explanation: string;
  }[];
}

// ---------------------------------------------------------------------------
// Quiz & Evaluation Engine (Helix Prime Metacognitive learning engine)
// ---------------------------------------------------------------------------

/** Question kinds produced by the lightweight diagnostic quiz generator. */
export type QuizQuestionType = "multiple_choice" | "fill_blank" | "translation";

export interface DiagnosticQuizQuestion {
  /** Stable id used as the Helix Education `quiz_item_id`. */
  id: string;
  type: QuizQuestionType;
  prompt: string;
  /** Options for `multiple_choice`. */
  options?: string[];
  /** Index of the correct option for `multiple_choice`. */
  correctIndex?: number;
  /** Canonical answer for `fill_blank` / `translation`. */
  answer?: string;
  explanation: string;
  /** Target-language term when this is a micro-translation item. */
  languageTerm?: string;
}

export interface DiagnosticQuiz {
  quizId: string;
  topic: string;
  title: string;
  questions: DiagnosticQuizQuestion[];
  createdAt: string;
}

/** Telemetry captured for every diagnostic quiz attempt. */
export interface QuizEvaluationMetrics {
  /** Accuracy Score (%) — correct / total. */
  accuracyScore: number;
  /** Confidence Index (0-100) — derived from response latency; faster = higher. */
  confidenceIndex: number;
  /** Target-Language Retention Ratio (0-1). */
  retentionRatio: number;
  totalQuestions: number;
  correctAnswers: number;
  avgResponseMs: number;
}

/** Append-only Helix Education evaluation event (matches state_core contract). */
export interface HelixEvalEvent {
  event_id: string;
  timestamp: string; // ISO8601 UTC
  /** Registered event type string: quiz_created | answer_submitted | quiz_result. */
  __event_type__: string;
  source: "study-studio";
  [key: string]: unknown;
}

/** Quiz retention roll-up shown in the Metacognitive Pulse. */
export interface QuizRetentionSummary {
  topics: {
    topic: string;
    accuracyScore: number;
    retentionRatio: number;
    completedAt: string;
  }[];
  averageAccuracy: number | null;
  averageRetention: number | null;
  lastN: number;
}
