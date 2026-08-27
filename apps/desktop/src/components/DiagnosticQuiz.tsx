// DiagnosticQuiz — the "Challenge Yourself" sidecar.
//
// Rendered only while the topic pipeline is in a quiz stage (QUIZ_IN_PROGRESS /
// QUIZ_COMPLETED). It generates a lightweight 3-5 question diagnostic quiz for
// the current lesson, records each answer as Helix Education telemetry
// (answer_submitted), and rolls the attempt up into MasteryScored
// (quiz_result) with Accuracy Score, Confidence Index and Target-Language
// Retention Ratio.
//
// The component is deliberately human-initiated: it only mounts when the
// learner presses "Challenge Yourself" on the Topic View. It never fires after
// audio generation finishes, and it never touches the audio pipeline state
// beyond the stage transitions owned by the parent.

"use client";

import { useEffect, useRef, useState } from "react";
import type { DiagnosticQuiz as DiagnosticQuizModel, QuizEvaluationMetrics } from "@/types";
import { generateDiagnosticQuiz, type DiagnosticAnswer } from "@/lib/quizEngine";
import {
  accuracyGuidance,
  logAnswerSubmitted,
  logQuizGenerated,
  recordQuizAttempt,
} from "@/lib/quizEngine";

interface Props {
  lessonTitle: string;
  /** Lesson body as HTML or plain text (parsed/stripped inside the engine). */
  topicText: string;
  glossary?: { term: string; definition: string }[];
  language?: string;
  model?: string;
  /** Called when every question is answered (parent dispatches COMPLETE_QUIZ). */
  onFinish: () => void;
  /** Called when the learner leaves the quiz (parent dispatches EXIT_QUIZ). */
  onExit: () => void;
}

type Phase = "loading" | "answering" | "results";

export default function DiagnosticQuiz({
  lessonTitle,
  topicText,
  glossary,
  language,
  model,
  onFinish,
  onExit,
}: Props) {
  const [quiz, setQuiz] = useState<DiagnosticQuizModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [answers, setAnswers] = useState<Record<string, DiagnosticAnswer>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [metrics, setMetrics] = useState<QuizEvaluationMetrics | null>(null);
  const attemptRef = useRef(1);
  const lastItemAtRef = useRef(Date.now());
  const finishedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setPhase("loading");
      setError(null);
      setQuiz(null);
      setAnswers({});
      setTyped({});
      setMetrics(null);
      finishedRef.current = false;
      try {
        const generated = await generateDiagnosticQuiz({
          lessonTitle,
          htmlContent: topicText,
          lessonText: topicText,
          glossary,
          language,
          model,
        });
        if (cancelled) return;
        logQuizGenerated(generated);
        lastItemAtRef.current = Date.now();
        setQuiz(generated);
        setPhase("answering");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to build your diagnostic quiz.");
        setPhase("answering");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [lessonTitle, topicText, glossary, language, model, attemptRef]);

  const handleOption = (questionId: string, optionIndex: number, optionText: string) => {
    if (!quiz || answers[questionId]) return;
    const now = Date.now();
    const answer: DiagnosticAnswer = {
      questionId,
      value: optionText,
      optionIndex,
      elapsedMs: now - lastItemAtRef.current,
    };
    lastItemAtRef.current = now;
    logAnswerSubmitted(quiz, answer, attemptRef.current);
    const next = { ...answers, [questionId]: answer };
    setAnswers(next);
    if (!finishedRef.current && Object.keys(next).length === quiz.questions.length) {
      finish(next);
    }
  };

  const handleTyped = (questionId: string, value: string) => {
    if (!quiz || answers[questionId]) return;
    const now = Date.now();
    const answer: DiagnosticAnswer = {
      questionId,
      value,
      elapsedMs: now - lastItemAtRef.current,
    };
    lastItemAtRef.current = now;
    logAnswerSubmitted(quiz, answer, attemptRef.current);
    const next = { ...answers, [questionId]: answer };
    setAnswers(next);
    if (!finishedRef.current && Object.keys(next).length === quiz.questions.length) {
      finish(next);
    }
  };

  const finish = (allAnswers: Record<string, DiagnosticAnswer>) => {
    if (!quiz || finishedRef.current) return;
    finishedRef.current = true;
    const result = recordQuizAttempt({ quiz, answers: allAnswers, startedAt: lastItemAtRef.current });
    setMetrics(result);
    setPhase("results");
    onFinish();
  };

  const handleRetry = () => {
    attemptRef.current += 1;
    setQuiz(null);
    setAnswers({});
    setTyped({});
    setMetrics(null);
    finishedRef.current = false;
    setPhase("loading");
    generateDiagnosticQuiz({
      lessonTitle,
      htmlContent: topicText,
      lessonText: topicText,
      glossary,
      language,
      model,
    })
      .then((generated) => {
        logQuizGenerated(generated);
        lastItemAtRef.current = Date.now();
        setQuiz(generated);
        setPhase("answering");
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to rebuild your diagnostic quiz.");
        setPhase("answering");
      });
  };

  return (
    <div className="card mb-6 animate-scale-in" id="challenge-yourself">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚡</span>
          <h2 className="text-xl font-semibold">Challenge Yourself</h2>
          {quiz && <span className="badge badge-primary text-xs">{quiz.questions.length} quick questions</span>}
        </div>
        <button onClick={onExit} className="btn btn-ghost text-xs !py-1 !px-2.5">
          Exit quiz
        </button>
      </div>

      {phase === "loading" && (
        <div className="flex flex-col items-center gap-3 py-10">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          <span className="text-sm text-muted">Crafting a quick diagnostic quiz...</span>
        </div>
      )}

      {phase === "results" && metrics && (
        <div className="p-5 rounded-xl mb-5 text-center border animate-scale-in" style={{ borderColor: "var(--primary)" }}>
          <div className="text-3xl font-bold bg-gradient-to-r from-primary to-accent-blue bg-clip-text text-transparent">
            {metrics.accuracyScore}%
          </div>
          <div className="text-sm text-muted mt-1 mb-2">
            {metrics.correctAnswers}/{metrics.totalQuestions} correct
            <span className="mx-2">·</span>
            Confidence {metrics.confidenceIndex}
            <span className="mx-2">·</span>
            Retention {Math.round(metrics.retentionRatio * 100)}%
          </div>
          <p className="text-sm text-foreground/80 leading-relaxed p-3 rounded-lg bg-sidebar mb-3">
            {accuracyGuidance(metrics)}
          </p>
          <div className="flex items-center justify-center gap-2">
            <button onClick={handleRetry} className="btn btn-ghost text-sm">
              🔄 Try again
            </button>
            <button onClick={onExit} className="btn btn-primary text-sm">
              Back to lesson
            </button>
          </div>
        </div>
      )}

      {error && phase !== "loading" && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/15 border border-red-200 dark:border-red-800/30 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {phase === "answering" && quiz && (
        <div className="space-y-5">
          {quiz.questions.map((q, i) => {
            const answered = Boolean(answers[q.id]);
            return (
              <div key={q.id} className="border border-card-border rounded-xl p-4">
                <p className="font-medium mb-3 flex items-start gap-2">
                  <span className="flex-shrink-0 w-6 h-6 rounded-md bg-primary-soft dark:bg-opacity-20 flex items-center justify-center text-primary text-xs font-bold mt-0.5">
                    {i + 1}
                  </span>
                  <span>{q.prompt}</span>
                </p>

                {q.type === "multiple_choice" && (
                  <div className="space-y-2 ml-8">
                    {(q.options ?? []).map((opt, oIndex) => {
                      const isCorrect = answered && oIndex === q.correctIndex;
                      const isWrong = answered && answers[q.id]?.optionIndex === oIndex && oIndex !== q.correctIndex;
                      const isSelected = answered && answers[q.id]?.optionIndex === oIndex;
                      return (
                        <button
                          key={oIndex}
                          onClick={() => handleOption(q.id, oIndex, opt)}
                          disabled={answered}
                          className={`w-full text-left p-3 rounded-xl border transition-all duration-200 text-sm flex items-center gap-3 ${
                            isCorrect
                              ? "border-accent-green bg-green-50 dark:bg-green-900/20 text-accent-green font-medium"
                              : isWrong
                                ? "border-accent-red bg-red-50 dark:bg-red-900/20 text-accent-red"
                                : isSelected
                                  ? "border-card-border opacity-50"
                                  : answered
                                    ? "border-card-border opacity-50"
                                    : "border-card-border hover:border-primary hover:bg-primary-soft/50 cursor-pointer"
                          }`}
                        >
                          <span
                            className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
                              isCorrect
                                ? "bg-green-500 text-white"
                                : isWrong
                                  ? "bg-red-500 text-white"
                                  : "bg-sidebar text-muted"
                            }`}
                          >
                            {isCorrect ? "✓" : isWrong ? "✗" : String.fromCharCode(65 + oIndex)}
                          </span>
                          <span className="flex-1">{opt}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {(q.type === "fill_blank" || q.type === "translation") && (
                  <div className="ml-8">
                    <input
                      type="text"
                      value={typed[q.id] ?? ""}
                      disabled={answered}
                      onChange={(e) => setTyped({ ...typed, [q.id]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !answered && (typed[q.id] ?? "").trim()) {
                          handleTyped(q.id, typed[q.id] ?? "");
                        }
                      }}
                      placeholder={
                        q.type === "translation"
                          ? "Type the translation…"
                          : "Type the missing term…"
                      }
                      className="input-field text-sm"
                    />
                    {!answered && (typed[q.id] ?? "").trim() && (
                      <button
                        onClick={() => handleTyped(q.id, typed[q.id] ?? "")}
                        className="btn btn-secondary !py-1 !px-3 text-xs mt-2"
                      >
                        Submit
                      </button>
                    )}
                  </div>
                )}

                {answered && (
                  <div
                    className={`mt-2 ml-8 text-xs p-2.5 rounded-lg animate-fade-in ${
                      q.type === "multiple_choice" && answers[q.id]?.optionIndex === q.correctIndex
                        ? "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/20"
                        : q.type === "multiple_choice"
                          ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/20"
                          : answers[q.id] && q.answer
                            ? "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/20"
                            : "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30"
                    }`}
                  >
                    {q.explanation}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
