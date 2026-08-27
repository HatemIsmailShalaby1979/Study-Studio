// Metacognitive Pulse Dialog
// Fires every N=5 generated topics. Asks the learner to rate the experience
// 1-8 and give feedback. Offers system-level optimization advice.
//
// This is a controlled component: the parent owns the pulse state via
// useMetacognitiveObserver() and passes it in, so topic completion in the
// parent can trigger the pulse directly.

"use client";

import type { QuizRetentionSummary } from "@/types";

interface Props {
  showPulse: boolean;
  rating: number;
  setRating: (n: number) => void;
  feedback: string;
  setFeedback: (s: string) => void;
  optimizationAdvice: string;
  retentionSummary: QuizRetentionSummary;
  onSubmit: () => void;
  onDismiss: () => void;
}

export default function MetacognitivePulse({
  showPulse,
  rating,
  setRating,
  feedback,
  setFeedback,
  optimizationAdvice,
  retentionSummary,
  onSubmit,
  onDismiss,
}: Props) {
  if (!showPulse) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="card card-lg max-w-md w-full animate-scale-in">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-10 h-10 rounded-xl bg-primary-soft dark:bg-opacity-20 flex items-center justify-center text-xl">🧠</span>
          <div>
            <h3 className="font-bold text-lg leading-tight">Metacognitive Check-in</h3>
            <p className="text-xs text-muted">We've crafted 5 topics together!</p>
          </div>
        </div>

        <p className="text-sm text-foreground/80 mb-4 leading-relaxed">
          How was the rhythm and quality of your learning experience? Rate 1 to 8,
          and let our developers know what we can polish for you.
        </p>

        {/* Quiz retention roll-up across the last 5 completed topics. */}
        {retentionSummary.lastN > 0 && (
          <div className="mb-4 p-4 rounded-xl bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/30">
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-2">
              Quiz Retention — last {retentionSummary.lastN} topics
            </p>
            {retentionSummary.averageAccuracy !== null && (
              <div className="text-sm text-blue-800 dark:text-blue-300">
                Average Accuracy: {Math.round(retentionSummary.averageAccuracy)}%
                <span className="mx-2">·</span>
                Retention: {Math.round(retentionSummary.averageRetention ?? 0)}%
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {retentionSummary.topics.map((t, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-800/30 text-blue-700 dark:text-blue-300">
                  {t.topic}: {t.accuracyScore}%
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Rating buttons 1-8 */}
        <div className="flex justify-between gap-1 mb-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <button
              key={n}
              onClick={() => setRating(n)}
              className={`flex-1 py-2 rounded-lg border text-sm font-semibold transition-all ${
                rating === n
                  ? "border-primary bg-primary text-white"
                  : "border-card-border bg-card hover:border-primary/50"
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        {/* Feedback textarea */}
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="What could we polish? (optional)"
          className="input-field text-sm mb-3 resize-none"
          rows={3}
        />

        {/* System optimization advice */}
        {optimizationAdvice && (
          <div className="mb-4 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/30 text-xs text-blue-700 dark:text-blue-400">
            💡 {optimizationAdvice}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onDismiss} className="btn btn-ghost text-sm">
            Dismiss
          </button>
          <button onClick={onSubmit} className="btn btn-primary text-sm">
            Submit Feedback
          </button>
        </div>
      </div>
    </div>
  );
}