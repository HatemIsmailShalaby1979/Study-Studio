import { renderHook, act } from "@testing-library/react";
import { useMetacognitiveObserver } from "@/hooks/useMetacognitive";
import { appendMasteryScored, clearEvalEvents } from "@/lib/helixEvents";
import { readVersioned, resetStorageFailureListeners } from "@/lib/storage";

// Plan item 2.4: useMetacognitive was at 0% coverage. Its job is a small state
// machine over a persisted record, and the part most likely to break silently
// is the arithmetic that decides when to interrupt the learner with a pulse —
// it must fire every N completions, and it must NOT re-fire immediately after a
// submission. Both halves are pinned here.
//
// jest.setup.tsx replaces window.localStorage with bare jest.fn()s; a working
// map is installed so the versioned storage layer actually round-trips.

const STORAGE_KEY = "study-studio-metacognitive";
const PULSE_INTERVAL = 5;

let store: Record<string, string>;

beforeEach(() => {
  resetStorageFailureListeners();
  clearEvalEvents();

  store = {};
  Object.defineProperty(window, "localStorage", {
    writable: true,
    configurable: true,
    value: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = String(v);
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        store = {};
      },
    },
  });
});

function completeTopics(recordTopicCompletion: () => void, times: number): void {
  for (let i = 0; i < times; i++) {
    act(() => recordTopicCompletion());
  }
}

describe("useMetacognitiveObserver", () => {
  it("starts hidden with an empty retention summary", () => {
    const { result } = renderHook(() => useMetacognitiveObserver());

    expect(result.current.showPulse).toBe(false);
    expect(result.current.rating).toBe(0);
    expect(result.current.feedback).toBe("");
    expect(result.current.retentionSummary).toEqual({
      topics: [],
      averageAccuracy: null,
      averageRetention: null,
      lastN: 0,
    });
  });

  it("does not show the pulse before the interval is reached", () => {
    const { result } = renderHook(() => useMetacognitiveObserver());

    completeTopics(result.current.recordTopicCompletion, PULSE_INTERVAL - 1);

    expect(result.current.showPulse).toBe(false);
  });

  it("shows the pulse on the Nth completed topic", () => {
    const { result } = renderHook(() => useMetacognitiveObserver());

    completeTopics(result.current.recordTopicCompletion, PULSE_INTERVAL);

    expect(result.current.showPulse).toBe(true);
  });

  it("persists the topic count as it grows", () => {
    const { result } = renderHook(() => useMetacognitiveObserver());

    completeTopics(result.current.recordTopicCompletion, 2);

    const persisted = readVersioned<{ topicCount: number }>(
      STORAGE_KEY,
      (raw) => (raw as { topicCount: number }) ?? null,
      { topicCount: -1 }
    );
    expect(persisted.topicCount).toBe(2);
  });

  it("survives a remount by restoring the persisted count", () => {
    const view = renderHook(() => useMetacognitiveObserver());
    completeTopics(view.result.current.recordTopicCompletion, 3);
    view.unmount();

    const { result } = renderHook(() => useMetacognitiveObserver());
    // Four more completions push the restored count (3) to 7, past the interval.
    completeTopics(result.current.recordTopicCompletion, 4);

    expect(result.current.showPulse).toBe(true);
  });

  it("submits a pulse, stores it, and hides the dialog", () => {
    const { result } = renderHook(() => useMetacognitiveObserver());
    completeTopics(result.current.recordTopicCompletion, PULSE_INTERVAL);
    expect(result.current.showPulse).toBe(true);

    act(() => result.current.setRating(7));
    act(() => result.current.setFeedback("  Audio felt slow.  "));
    act(() => result.current.submitPulse());

    expect(result.current.showPulse).toBe(false);
    expect(result.current.rating).toBe(0);
    expect(result.current.feedback).toBe("");

    const persisted = readVersioned<{
      lastRating: number | null;
      lastFeedback: string;
      lastSubmittedTopicCount: number;
    }>(STORAGE_KEY, (raw) => (raw as never) ?? null, {
      lastRating: null,
      lastFeedback: "",
      lastSubmittedTopicCount: -1,
    });

    expect(persisted.lastRating).toBe(7);
    expect(persisted.lastFeedback).toBe("Audio felt slow.");
    expect(persisted.lastSubmittedTopicCount).toBe(PULSE_INTERVAL);
    expect(store[STORAGE_KEY]).toContain("\"v\":1");
  });

  it("falls back to a neutral rating when the learner submits nothing", () => {
    const { result } = renderHook(() => useMetacognitiveObserver());
    completeTopics(result.current.recordTopicCompletion, PULSE_INTERVAL);

    act(() => result.current.submitPulse());

    const persisted = readVersioned<{ lastRating: number | null }>(
      STORAGE_KEY,
      (raw) => (raw as { lastRating: number | null }) ?? null,
      { lastRating: null }
    );
    expect(persisted.lastRating).toBe(5);
  });

  it("does not re-fire the pulse immediately after a submission", () => {
    const { result } = renderHook(() => useMetacognitiveObserver());
    completeTopics(result.current.recordTopicCompletion, PULSE_INTERVAL);
    act(() => result.current.submitPulse());

    // The count is now reset for the interval, so a single more completion
    // must not interrupt again.
    completeTopics(result.current.recordTopicCompletion, 1);
    expect(result.current.showPulse).toBe(false);

    // ...and it fires exactly once the full interval has elapsed since submit.
    completeTopics(result.current.recordTopicCompletion, PULSE_INTERVAL - 1);
    expect(result.current.showPulse).toBe(true);
  });

  it("dismisses the pulse without writing a rating", () => {
    const { result } = renderHook(() => useMetacognitiveObserver());
    completeTopics(result.current.recordTopicCompletion, PULSE_INTERVAL);

    act(() => result.current.setRating(3));
    act(() => result.current.dismissPulse());

    expect(result.current.showPulse).toBe(false);
    expect(result.current.rating).toBe(0);
    expect(result.current.feedback).toBe("");

    const persisted = readVersioned<{ lastRating: number | null }>(
      STORAGE_KEY,
      (raw) => (raw as { lastRating: number | null }) ?? null,
      { lastRating: null }
    );
    expect(persisted.lastRating).toBeNull();
  });

  it("reveals the optimization suggestion when the pulse opens", () => {
    const { result } = renderHook(() => useMetacognitiveObserver());
    expect(result.current.optimizationAdvice).toBe("");

    completeTopics(result.current.recordTopicCompletion, PULSE_INTERVAL);
    expect(result.current.optimizationAdvice).toMatch(/sluggish/i);
  });

  it("leaves the suggestion text in place after the pulse closes", () => {
    // Pinning existing behaviour, not endorsing it. The advice effect returns
    // early while `showPulse` is false, so the last string it wrote is never
    // cleared — consumers must gate on `showPulse` themselves. If this hook is
    // ever fixed to reset the advice, this test should be updated to assert
    // the empty string.
    const { result } = renderHook(() => useMetacognitiveObserver());
    completeTopics(result.current.recordTopicCompletion, PULSE_INTERVAL);
    expect(result.current.optimizationAdvice).not.toBe("");

    act(() => result.current.dismissPulse());

    expect(result.current.showPulse).toBe(false);
    expect(result.current.optimizationAdvice).toMatch(/sluggish/i);
  });

  it("rolls up quiz retention for the pulse, and only then", () => {
    const { result } = renderHook(() => useMetacognitiveObserver());
    expect(result.current.retentionSummary.lastN).toBe(0);

    appendMasteryScored({
      quizId: "q1",
      topic: "Water",
      lessonTitle: "Water Cycle",
      metrics: {
        accuracyScore: 80,
        confidenceIndex: 0.5,
        retentionRatio: 0.7,
        totalQuestions: 4,
        correctAnswers: 3,
        avgResponseMs: 1200,
      },
    });

    completeTopics(result.current.recordTopicCompletion, PULSE_INTERVAL);

    expect(result.current.retentionSummary.lastN).toBe(1);
    expect(result.current.retentionSummary.averageAccuracy).toBe(80);
    expect(result.current.retentionSummary.averageRetention).toBe(0.7);
    expect(result.current.retentionSummary.topics[0].topic).toBe("Water");
  });
});
