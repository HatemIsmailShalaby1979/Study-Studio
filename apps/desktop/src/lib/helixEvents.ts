// Helix Education event stream (Study Studio client adapter).
//
// The desktop app persists an append-only evaluation event log in local
// storage. The record shape mirrors the Project Helix Education `state_core`
// event-sourced contract (EventStore / event_models.py): every event carries
// `event_id` (uuid4), `timestamp` (ISO8601 UTC) and a registered snake_case
// `__event_type__` so the same log can be replayed/imported by the Python
// learning engine. Study Studio emits three evaluation event kinds:
//
//   - `quiz_created`     (QuizGenerated)  — a diagnostic quiz was generated
//   - `answer_submitted` (AnswerSubmitted) — one answer recorded per item
//   - `quiz_result`      (MasteryScored)  — full-attempt telemetry roll-up
//
// Events are immutable once written; the log is never rewritten in place.

import { v4 as uuidv4 } from "uuid";
import type { HelixEvalEvent, QuizEvaluationMetrics, QuizRetentionSummary } from "@/types";

export const HELIX_EVENTS_KEY = "study-studio-helix-events";

export const EVENT_TYPES = {
  quizCreated: "quiz_created",
  answerSubmitted: "answer_submitted",
  quizResult: "quiz_result",
} as const;

function isoNow(): string {
  return new Date().toISOString();
}

/** Build a Helix Education event record with auto id + timestamp. */
export function createEvalEvent(
  eventType: string,
  fields: Record<string, unknown>
): HelixEvalEvent {
  return {
    event_id: uuidv4(),
    timestamp: isoNow(),
    __event_type__: eventType,
    source: "study-studio",
    ...fields,
  };
}

function readRaw(): HelixEvalEvent[] {
  try {
    const raw = localStorage.getItem(HELIX_EVENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(events: HelixEvalEvent[]): void {
  try {
    localStorage.setItem(HELIX_EVENTS_KEY, JSON.stringify(events));
  } catch {
    // Storage unavailable — telemetry is best-effort only.
  }
}

/** Append an event to the local Helix Education stream. */
export function appendEvalEvent(event: HelixEvalEvent): void {
  if (!event || typeof event !== "object") return;
  if (!event.event_id || !event.timestamp || !event.__event_type__) return;
  writeRaw([...readRaw(), event]);
}

/** Read the full event stream in append order. */
export function readEvalEvents(): HelixEvalEvent[] {
  return readRaw();
}

/** Clear the event stream (used by tests / "reset data"). */
export function clearEvalEvents(): void {
  try {
    localStorage.removeItem(HELIX_EVENTS_KEY);
  } catch {
    // best-effort
  }
}

/**
 * Summarise quiz mastery over the last N completed topics (MasteryScored /
 * `quiz_result` events). Fed to the Metacognitive Pulse so the 1-8 rating
 * dialog can reflect real retention performance instead of vibes.
 */
export function quizRetentionSummary(maxTopics = 5): QuizRetentionSummary {
  const results = readRaw()
    .filter((e) => e.__event_type__ === EVENT_TYPES.quizResult)
    .map((e) => ({
      topic: String(e["topic"] ?? "unknown"),
      accuracyScore: Number(e["accuracyScore"] ?? 0),
      retentionRatio: Number(e["retentionRatio"] ?? 0),
      completedAt: String(e["timestamp"] ?? ""),
    }))
    .sort((a, b) => (a.completedAt < b.completedAt ? -1 : 1));

  const lastN = results.slice(-maxTopics);
  const average = (fn: (r: { accuracyScore: number; retentionRatio: number }) => number): number | null => {
    if (lastN.length === 0) return null;
    const sum = lastN.reduce((acc, r) => acc + fn(r), 0);
    return sum / lastN.length;
  };

  return {
    topics: lastN,
    averageAccuracy: average((r) => r.accuracyScore),
    averageRetention: average((r) => r.retentionRatio),
    lastN: lastN.length,
  };
}

/**
 * Store the MasteryScored telemetry for a finished quiz attempt so the
 * pulse and journey stats can read it back.
 */
export function appendMasteryScored(opts: {
  quizId: string;
  topic: string;
  lessonTitle: string;
  metrics: QuizEvaluationMetrics;
}): void {
  appendEvalEvent(
    createEvalEvent(EVENT_TYPES.quizResult, {
      quiz_id: opts.quizId,
      topic: opts.topic,
      title: opts.lessonTitle,
      accuracyScore: opts.metrics.accuracyScore,
      confidenceIndex: opts.metrics.confidenceIndex,
      retentionRatio: opts.metrics.retentionRatio,
      totalQuestions: opts.metrics.totalQuestions,
      correctAnswers: opts.metrics.correctAnswers,
      avgResponseMs: opts.metrics.avgResponseMs,
    })
  );
}
