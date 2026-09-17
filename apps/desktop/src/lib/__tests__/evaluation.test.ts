import { evaluateQuiz } from "@/lib/evaluation";
import { aiRuntime, extractJsonFromResponse, repairJson } from "@/lib/ai-runtime";

// Characterisation tests for quiz evaluation — the code that decides a
// student's score, so a bug here misgrades the user directly.
//
// `validateEvaluateQuiz` is deliberately NOT mocked: it is a cheap zod parse and
// mocking it would mean the suite never proves that the real request shape is
// accepted. The AI runtime is mocked, because it is an I/O seam.
//
// The interesting surface here is the four distinct ways a result can be
// produced: runtime offline, model unavailable, AI evaluation, and local
// scoring fallback. All four must agree on the score.

jest.mock("@/lib/ai-runtime", () => ({
  aiRuntime: {
    health: jest.fn(),
    ensureModel: jest.fn(),
    chat: jest.fn(),
  },
  extractJsonFromResponse: jest.fn(),
  repairJson: jest.fn(),
}));

const mockRuntime = aiRuntime as unknown as {
  health: jest.Mock;
  ensureModel: jest.Mock;
  chat: jest.Mock;
};
const mockExtract = extractJsonFromResponse as jest.MockedFunction<typeof extractJsonFromResponse>;
const mockRepair = repairJson as jest.MockedFunction<typeof repairJson>;

interface Question {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

function q(over: Partial<Question> = {}): Question {
  return {
    question: "What drives evaporation?",
    options: ["Heat", "Cold", "Pressure"],
    correctIndex: 0,
    explanation: "Heat supplies the energy.",
    ...over,
  };
}

function submission(over: Record<string, unknown> = {}) {
  return {
    questions: [q()],
    answers: { 0: 0 },
    difficulty: "intermediate",
    lessonTitle: "The Water Cycle",
    ...over,
  };
}

/** The AI's reply, as the code expects to parse it out of the raw response. */
const AI_REPLY = JSON.stringify({
  overallScore: 100,
  totalQuestions: 1,
  correctAnswers: 1,
  rating: "excellent",
  feedback: "Excellent work on the water cycle.",
  perQuestion: [
    {
      questionIndex: 0,
      userAnswer: 0,
      correctAnswer: 0,
      isCorrect: true,
      explanation: "You correctly identified heat as the driver.",
    },
  ],
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});

  mockRuntime.health.mockResolvedValue({ available: true, recommendedModel: "llama3" });
  // Echo the requested model: the code uses ensureModel's RETURN value as the
  // model it then passes to chat, so a fixed return would make it impossible to
  // assert which model was actually requested.
  mockRuntime.ensureModel.mockImplementation(async (m: string) => m);
  mockRuntime.chat.mockResolvedValue(AI_REPLY);
  mockExtract.mockReturnValue(AI_REPLY);
  mockRepair.mockImplementation((s: string) => s);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("evaluateQuiz — runtime offline", () => {
  beforeEach(() => {
    mockRuntime.health.mockResolvedValue({ available: false });
  });

  it("reports an offline rating rather than a zero score", async () => {
    const result = await evaluateQuiz(submission());

    expect(result.rating).toBe("offline");
    expect(result.overallScore).toBe(0);
    expect(result.correctAnswers).toBe(0);
    expect(result.totalQuestions).toBe(1);
    expect(result.feedback).toMatch(/runtime is not running/i);
  });

  it("still marks the answers it can judge locally", async () => {
    const result = await evaluateQuiz(submission({ answers: { 0: 1 } }));

    expect(result.perQuestion[0]).toEqual({
      questionIndex: 0,
      userAnswer: 1,
      correctAnswer: 0,
      isCorrect: false,
      explanation: "Heat supplies the energy.",
    });
  });

  it("never calls the model when the runtime is down", async () => {
    await evaluateQuiz(submission());

    expect(mockRuntime.chat).not.toHaveBeenCalled();
    expect(mockRuntime.ensureModel).not.toHaveBeenCalled();
  });

  it("treats an unanswered question as -1 and incorrect", async () => {
    const result = await evaluateQuiz(submission({ answers: {} }));

    expect(result.perQuestion[0]!.userAnswer).toBe(-1);
    expect(result.perQuestion[0]!.isCorrect).toBe(false);
  });
});

describe("evaluateQuiz — model resolution", () => {
  it("resolves the model the caller passed", async () => {
    await evaluateQuiz(submission(), "mistral");

    expect(mockRuntime.ensureModel).toHaveBeenCalledWith("mistral");
    expect(mockRuntime.chat).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "mistral"
    );
  });

  it("falls back to the runtime's recommended model", async () => {
    mockRuntime.health.mockResolvedValue({ available: true, recommendedModel: "llama3" });
    await evaluateQuiz(submission());

    expect(mockRuntime.ensureModel).not.toHaveBeenCalled();
    expect(mockRuntime.chat).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "llama3"
    );
  });

  it("degrades to local scoring when the model cannot be resolved", async () => {
    // Session model policy: never auto-switch. A missing model must degrade to
    // local scoring, not silently pick a different one.
    mockRuntime.ensureModel.mockRejectedValue(new Error("model not installed"));

    const result = await evaluateQuiz(submission(), "missing-model");

    expect(result.rating).toBe("excellent");
    expect(result.overallScore).toBe(100);
    expect(mockRuntime.chat).not.toHaveBeenCalled();
  });

  it("handles a non-Error rejection from model resolution", async () => {
    mockRuntime.ensureModel.mockRejectedValue("plain string failure");
    const result = await evaluateQuiz(submission(), "missing-model");

    expect(result.overallScore).toBe(100);
  });
});

describe("evaluateQuiz — AI evaluation", () => {
  it("returns the model's score, rating and feedback", async () => {
    mockRuntime.chat.mockResolvedValue(AI_REPLY);
    const result = await evaluateQuiz(submission());

    expect(result.overallScore).toBe(100);
    expect(result.rating).toBe("excellent");
    expect(result.feedback).toBe("Excellent work on the water cycle.");
  });

  it("sends the lesson title and the computed score in the prompt", async () => {
    await evaluateQuiz(submission({ answers: { 0: 1 } }));

    const prompt = mockRuntime.chat.mock.calls[0]![0][1].content as string;
    expect(prompt).toContain("The Water Cycle");
    expect(prompt).toContain("intermediate");
    expect(prompt).toContain("0/1 correct, 0%");
  });

  it("asks for structured output with the evaluation JSON schema", async () => {
    await evaluateQuiz(submission());

    const options = mockRuntime.chat.mock.calls[0]![1];
    expect(options).toEqual(
      expect.objectContaining({ format: expect.objectContaining({ type: "object" }) })
    );
  });

  it("re-derives correctness from the real answers, ignoring the model's claim", async () => {
    // The model is asked for its own perQuestion, but the code overwrites
    // isCorrect/userAnswer with values computed from the submitted answers —
    // so a hallucinated "isCorrect: true" cannot inflate the result.
    const lying = JSON.stringify({
      overallScore: 100,
      totalQuestions: 1,
      correctAnswers: 1,
      rating: "excellent",
      feedback: "Perfect!",
      perQuestion: [
        { questionIndex: 0, userAnswer: 0, correctAnswer: 0, isCorrect: true, explanation: "right" },
      ],
    });
    mockRuntime.chat.mockResolvedValue(lying);
    mockExtract.mockReturnValue(lying);

    const result = await evaluateQuiz(submission({ answers: { 0: 1 } }));

    expect(result.perQuestion[0]!.isCorrect).toBe(false);
    expect(result.perQuestion[0]!.userAnswer).toBe(1);
    expect(result.perQuestion[0]!.correctAnswer).toBe(0);
  });

  it("NOTE — drops the model's per-question explanations", async () => {
    // Characterises a real gap. The prompt explicitly asks the model for a
    // detailed `explanation` per question, and `EvaluationResult.perQuestion`
    // types `explanation` as a required string — but the mapping that builds
    // the returned array never copies it, so it is `undefined` at runtime and
    // the model's per-question feedback is discarded. The UI reads it, so the
    // per-question breakdown renders an empty explanation after an AI
    // evaluation (the local-scoring paths DO supply one).
    // Rewrite this test if the mapping is fixed to carry `explanation` through.
    const result = await evaluateQuiz(submission());

    expect(result.perQuestion[0]).toEqual({
      questionIndex: 0,
      userAnswer: 0,
      correctAnswer: 0,
      isCorrect: true,
    });
    expect(result.perQuestion[0]!.explanation).toBeUndefined();
  });

  it("NOTE — truncates to the model's perQuestion length", async () => {
    // The returned array is built by mapping over the MODEL's perQuestion, not
    // over the submitted questions. If the model returns fewer entries than
    // there are questions, the missing ones vanish from the result entirely
    // instead of falling back to the locally computed values.
    const short = JSON.stringify({
      overallScore: 50,
      totalQuestions: 2,
      correctAnswers: 1,
      rating: "fair",
      feedback: "Mixed.",
      perQuestion: [
        { questionIndex: 0, userAnswer: 0, correctAnswer: 0, isCorrect: true, explanation: "a" },
      ],
    });
    mockRuntime.chat.mockResolvedValue(short);
    mockExtract.mockReturnValue(short);

    const result = await evaluateQuiz(
      submission({
        questions: [q(), q({ question: "What forms clouds?", correctIndex: 1 })],
        answers: { 0: 0, 1: 1 },
      })
    );

    expect(result.perQuestion).toHaveLength(1);
    expect(result.totalQuestions).toBe(2);
  });

  it("repairs malformed JSON before giving up", async () => {
    const broken = '{"overallScore": 100, "feedback": "ok",,}';
    mockRuntime.chat.mockResolvedValue(broken);
    mockExtract.mockReturnValue(broken);
    mockRepair.mockReturnValue(AI_REPLY);

    const result = await evaluateQuiz(submission());

    expect(mockRepair).toHaveBeenCalledWith(broken);
    expect(result.feedback).toBe("Excellent work on the water cycle.");
  });

  it("falls back to local scoring when the reply cannot be parsed at all", async () => {
    mockRuntime.chat.mockResolvedValue("not json");
    mockExtract.mockReturnValue("not json");
    mockRepair.mockImplementation(() => {
      throw new Error("unrepairable");
    });

    const result = await evaluateQuiz(submission());

    expect(result.rating).toBe("excellent");
    expect(result.feedback).toMatch(/You scored 1 out of 1/);
  });

  it("falls back to local scoring when the chat call rejects", async () => {
    mockRuntime.chat.mockRejectedValue(new Error("connection reset"));

    const result = await evaluateQuiz(submission());

    expect(result.overallScore).toBe(100);
    expect(result.feedback).toMatch(/You scored 1 out of 1/);
  });
});

describe("evaluateQuiz — local scoring", () => {
  /**
   * Force the local path so the rating thresholds can be exercised directly.
   *
   * A model MUST be passed: without one the code skips `ensureModel` entirely
   * and uses `health.recommendedModel`, so the rejection below would never be
   * reached and the AI path would run instead.
   */
  async function localScore(correct: number, total: number) {
    mockRuntime.ensureModel.mockRejectedValue(new Error("offline"));
    const questions = Array.from({ length: total }, (_, i) =>
      q({ question: `Question number ${i + 1}`, correctIndex: 0 })
    );
    const answers: Record<number, number> = {};
    for (let i = 0; i < correct; i++) answers[i] = 0;
    for (let i = correct; i < total; i++) answers[i] = 1;
    return evaluateQuiz(submission({ questions, answers }), "pinned-model");
  }

  it("computes the percentage", async () => {
    expect((await localScore(1, 4)).overallScore).toBe(25);
    expect((await localScore(3, 4)).overallScore).toBe(75);
  });

  it("rounds to the nearest whole percent", async () => {
    // 1/3 = 33.33… must not be truncated to 33 by accident.
    expect((await localScore(1, 3)).overallScore).toBe(33);
    expect((await localScore(2, 3)).overallScore).toBe(67);
  });

  it("rates 80 and above as excellent", async () => {
    expect((await localScore(4, 5)).rating).toBe("excellent");
  });

  it("rates 60 to 79 as good", async () => {
    expect((await localScore(3, 5)).rating).toBe("good");
    expect((await localScore(4, 5)).rating).toBe("excellent");
  });

  it("rates 40 to 59 as fair", async () => {
    expect((await localScore(2, 5)).rating).toBe("fair");
  });

  it("rates below 40 as needs_review", async () => {
    expect((await localScore(1, 5)).rating).toBe("needs_review");
    expect((await localScore(0, 5)).rating).toBe("needs_review");
  });

  it("summarises the score in the feedback", async () => {
    const result = await localScore(2, 5);
    expect(result.feedback).toBe(
      "You scored 2 out of 5 (40%). Review the explanations below for each question to improve your understanding."
    );
  });

  it("explains a correct answer", async () => {
    const result = await localScore(1, 1);
    expect(result.perQuestion[0]!.explanation).toBe("Correct! Heat supplies the energy.");
  });

  it("explains an incorrect answer with the right option text", async () => {
    const result = await localScore(0, 1);
    expect(result.perQuestion[0]!.explanation).toBe(
      'Incorrect. The correct answer was "Heat". Heat supplies the energy.'
    );
  });

  it("reports the total even when nothing is right", async () => {
    const result = await localScore(0, 3);
    expect(result.totalQuestions).toBe(3);
    expect(result.correctAnswers).toBe(0);
    expect(result.overallScore).toBe(0);
  });
});

describe("evaluateQuiz — request validation", () => {
  it("rejects a submission with no questions", async () => {
    await expect(evaluateQuiz(submission({ questions: [] }))).rejects.toThrow();
  });

  it("rejects a question with fewer than two options", async () => {
    await expect(
      evaluateQuiz(submission({ questions: [q({ options: ["only"] })] }))
    ).rejects.toThrow();
  });

  it("rejects a missing lesson title", async () => {
    await expect(evaluateQuiz(submission({ lessonTitle: "" }))).rejects.toThrow();
  });

  it("rejects a non-integer answer index", async () => {
    await expect(evaluateQuiz(submission({ answers: { 0: 1.5 } }))).rejects.toThrow();
  });

  it("defaults the difficulty when it is omitted", async () => {
    const body = submission();
    delete (body as Record<string, unknown>).difficulty;
    await evaluateQuiz(body);

    const prompt = mockRuntime.chat.mock.calls[0]![0][1].content as string;
    expect(prompt).toContain("intermediate");
  });
});
