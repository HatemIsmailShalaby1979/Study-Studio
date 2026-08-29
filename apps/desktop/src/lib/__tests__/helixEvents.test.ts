import {
  createEvalEvent,
  appendEvalEvent,
  readEvalEvents,
  clearEvalEvents,
  quizRetentionSummary,
  appendMasteryScored,
  EVENT_TYPES,
  HELIX_EVENTS_KEY,
} from "@/lib/helixEvents";

// ---------------------------------------------------------------------------
// In-memory localStorage mock (jest.setup defines jest.fn() stubs)
// ---------------------------------------------------------------------------
const store: Record<string, string> = {};

beforeEach(() => {
  // Reset store
  Object.keys(store).forEach((k) => delete store[k]);

  // Wire jest.fn() stubs to our in-memory store
  (globalThis.localStorage.getItem as jest.Mock).mockImplementation((key: string) => store[key] ?? null);
  (globalThis.localStorage.setItem as jest.Mock).mockImplementation((key: string, value: string) => {
    store[key] = value;
  });
  (globalThis.localStorage.removeItem as jest.Mock).mockImplementation((key: string) => {
    delete store[key];
  });
});

// ---------------------------------------------------------------------------
// createEvalEvent
// ---------------------------------------------------------------------------
describe("createEvalEvent", () => {
  it("generates an event with event_id, timestamp, __event_type__ and source", () => {
    const event = createEvalEvent("quiz_created", { quiz_id: "q1" });
    expect(event.event_id).toBeTruthy();
    expect(typeof event.event_id).toBe("string");
    expect(event.timestamp).toBeTruthy();
    expect(event.__event_type__).toBe("quiz_created");
    expect(event.source).toBe("study-studio");
    expect(event.quiz_id).toBe("q1");
  });
});

// ---------------------------------------------------------------------------
// appendEvalEvent + readEvalEvents
// ---------------------------------------------------------------------------
describe("appendEvalEvent / readEvalEvents", () => {
  it("appends events and reads them back in order", () => {
    clearEvalEvents();
    const e1 = createEvalEvent("quiz_created", { quiz_id: "q1" });
    const e2 = createEvalEvent("answer_submitted", { quiz_id: "q1", raw_answer: "42" });

    appendEvalEvent(e1);
    appendEvalEvent(e2);

    const events = readEvalEvents();
    expect(events.length).toBe(2);
    expect(events[0].quiz_id).toBe("q1");
    expect(events[1].raw_answer).toBe("42");
  });

  it("rejects events missing required fields", () => {
    clearEvalEvents();
    appendEvalEvent({ event_id: "", timestamp: "", __event_type__: "", source: "study-studio" } as any);
    expect(readEvalEvents().length).toBe(0);
  });

  it("clearEvalEvents empties the store", () => {
    appendEvalEvent(createEvalEvent("quiz_created", { quiz_id: "x" }));
    expect(readEvalEvents().length).toBe(1);
    clearEvalEvents();
    expect(readEvalEvents().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// appendMasteryScored + quizRetentionSummary
// ---------------------------------------------------------------------------
describe("quizRetentionSummary", () => {
  beforeEach(() => {
    clearEvalEvents();
  });

  it("returns empty summary when no quiz results exist", () => {
    const summary = quizRetentionSummary(5);
    expect(summary.lastN).toBe(0);
    expect(summary.averageAccuracy).toBeNull();
    expect(summary.averageRetention).toBeNull();
    expect(summary.topics.length).toBe(0);
  });

  it("summarises the last N topics correctly", () => {
    // Emit 3 MasteryScored events
    appendMasteryScored({
      quizId: "q1",
      topic: "Photosynthesis",
      lessonTitle: "Photosynthesis",
      metrics: { accuracyScore: 80, confidenceIndex: 90, retentionRatio: 0.8, totalQuestions: 5, correctAnswers: 4, avgResponseMs: 3000 },
    });
    appendMasteryScored({
      quizId: "q2",
      topic: "Mitosis",
      lessonTitle: "Mitosis",
      metrics: { accuracyScore: 60, confidenceIndex: 70, retentionRatio: 0.6, totalQuestions: 5, correctAnswers: 3, avgResponseMs: 5000 },
    });
    appendMasteryScored({
      quizId: "q3",
      topic: "Meiosis",
      lessonTitle: "Meiosis",
      metrics: { accuracyScore: 100, confidenceIndex: 95, retentionRatio: 1.0, totalQuestions: 5, correctAnswers: 5, avgResponseMs: 2000 },
    });

    const summary = quizRetentionSummary(5);
    expect(summary.lastN).toBe(3);
    expect(summary.averageAccuracy).toBeCloseTo(80, 0); // (80+60+100)/3
    expect(summary.averageRetention).toBeCloseTo(0.8, 1); // (0.8+0.6+1.0)/3
    expect(summary.topics.length).toBe(3);
    expect(summary.topics[0].topic).toBe("Photosynthesis");
    expect(summary.topics[2].topic).toBe("Meiosis");
  });

  it("caps at maxTopics", () => {
    for (let i = 0; i < 10; i++) {
      appendMasteryScored({
        quizId: `q${i}`,
        topic: `Topic${i}`,
        lessonTitle: `Topic${i}`,
        metrics: { accuracyScore: 50 + i * 5, confidenceIndex: 50, retentionRatio: 0.5, totalQuestions: 3, correctAnswers: 1, avgResponseMs: 5000 },
      });
    }
    const summary = quizRetentionSummary(3);
    expect(summary.lastN).toBe(3);
    expect(summary.topics[0].topic).toBe("Topic7");
    expect(summary.topics[2].topic).toBe("Topic9");
  });
});

// ---------------------------------------------------------------------------
// EVENT_TYPES constant
// ---------------------------------------------------------------------------
describe("EVENT_TYPES", () => {
  it("has the expected snake_case event type strings", () => {
    expect(EVENT_TYPES.quizCreated).toBe("quiz_created");
    expect(EVENT_TYPES.answerSubmitted).toBe("answer_submitted");
    expect(EVENT_TYPES.quizResult).toBe("quiz_result");
  });
});
