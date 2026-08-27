import {
  htmlToPlainText,
  normalizeAnswer,
  isDiagnosticAnswerCorrect,
  buildDiagnosticQuizPrompt,
  buildFallbackQuiz,
  parseDiagnosticQuiz,
  scoreDiagnosticQuiz,
  accuracyGuidance,
} from "@/lib/quizEngine";
import type { DiagnosticQuiz, DiagnosticQuizQuestion, DiagnosticAnswer } from "@/types";

// ---------------------------------------------------------------------------
// htmlToPlainText
// ---------------------------------------------------------------------------
describe("htmlToPlainText", () => {
  it("strips HTML tags and collapses whitespace", () => {
    expect(htmlToPlainText("<p>Hello <b>World</b>!</p>")).toBe("Hello World !");
  });

  it("drops script and style blocks", () => {
    expect(htmlToPlainText("<script>alert('x')</script><p>Hi</p><style>.a{}</style>")).toBe("Hi");
  });

  it("decodes common HTML entities", () => {
    expect(htmlToPlainText("a &amp; b &lt; c &gt; d &quot;e&quot; f&#39;g")).toBe("a & b < c > d \"e\" f'g");
  });

  it("returns empty string for falsy input", () => {
    expect(htmlToPlainText("")).toBe("");
    expect(htmlToPlainText(null as unknown as string)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// normalizeAnswer
// ---------------------------------------------------------------------------
describe("normalizeAnswer", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeAnswer("Hello, World!")).toBe("hello world");
  });

  it("collapses whitespace", () => {
    expect(normalizeAnswer("  a   b  ")).toBe("a b");
  });

  it("handles empty input", () => {
    expect(normalizeAnswer("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// isDiagnosticAnswerCorrect
// ---------------------------------------------------------------------------
describe("isDiagnosticAnswerCorrect", () => {
  const mc: DiagnosticQuizQuestion = {
    id: "q1",
    type: "multiple_choice",
    prompt: "What is 2+2?",
    options: ["3", "4", "5", "6"],
    correctIndex: 1,
    explanation: "Basic math",
  };

  const fill: DiagnosticQuizQuestion = {
    id: "q2",
    type: "fill_blank",
    prompt: "The capital of France is ___",
    answer: "Paris",
    explanation: "Geography",
  };

  const translation: DiagnosticQuizQuestion = {
    id: "q3",
    type: "translation",
    prompt: "Translate 'hello'",
    answer: "مرحبا",
    explanation: "Translation",
    languageTerm: "hello",
  };

  it("MC: correct when optionIndex matches correctIndex", () => {
    expect(isDiagnosticAnswerCorrect(mc, { questionId: "q1", value: "4", optionIndex: 1, elapsedMs: 1000 })).toBe(true);
  });

  it("MC: incorrect when optionIndex doesn't match", () => {
    expect(isDiagnosticAnswerCorrect(mc, { questionId: "q1", value: "3", optionIndex: 0, elapsedMs: 1000 })).toBe(false);
  });

  it("MC: incorrect when no answer provided", () => {
    expect(isDiagnosticAnswerCorrect(mc, undefined)).toBe(false);
  });

  it("fill_blank: correct with matching value (case/punct insensitive)", () => {
    expect(isDiagnosticAnswerCorrect(fill, { questionId: "q2", value: "paris.", elapsedMs: 2000 })).toBe(true);
  });

  it("fill_blank: incorrect with wrong value", () => {
    expect(isDiagnosticAnswerCorrect(fill, { questionId: "q2", value: "london", elapsedMs: 2000 })).toBe(false);
  });

  it("translation: correct with matching value", () => {
    expect(isDiagnosticAnswerCorrect(translation, { questionId: "q3", value: "مرحبا", elapsedMs: 3000 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildDiagnosticQuizPrompt
// ---------------------------------------------------------------------------
describe("buildDiagnosticQuizPrompt", () => {
  it("returns a prompt with lesson title and content", () => {
    const prompt = buildDiagnosticQuizPrompt({
      lessonTitle: "Quantum Computing",
      plainText: "Quantum computing uses qubits which can exist in superposition.",
    });
    expect(prompt).toContain("Quantum Computing");
    expect(prompt).toContain("Quantum computing uses qubits");
  });

  it("includes translation instruction for non-English", () => {
    const prompt = buildDiagnosticQuizPrompt({
      lessonTitle: "Arabic Basics",
      plainText: "مرحبا بالعالم",
      language: "ar",
    });
    expect(prompt).toContain("ar");
  });

  it("includes fill-in-the-blank instruction for English", () => {
    const prompt = buildDiagnosticQuizPrompt({
      lessonTitle: "English Topic",
      plainText: "Some content about a topic.",
    });
    expect(prompt).toContain("fill-in-the-blank");
  });
});

// ---------------------------------------------------------------------------
// buildFallbackQuiz (deterministic, no LLM needed)
// ---------------------------------------------------------------------------
describe("buildFallbackQuiz", () => {
  const glossary = [
    { term: "Photosynthesis", definition: "Process by which plants convert sunlight into energy." },
    { term: "Chlorophyll", definition: "Green pigment in plants that absorbs light energy." },
  ];

  it("produces at least 3 questions from glossary", () => {
    const quiz = buildFallbackQuiz({
      lessonTitle: "Plant Biology",
      htmlContent: "<p>Photosynthesis is essential.</p>",
      glossary,
      language: "en",
    });
    expect(quiz.questions.length).toBeGreaterThanOrEqual(3);
    expect(quiz.questions.length).toBeLessThanOrEqual(5);
    expect(quiz.topic).toBe("Plant Biology");
  });

  it("includes a translation question when language is non-English", () => {
    const quiz = buildFallbackQuiz({
      lessonTitle: "Arabic Basics",
      htmlContent: "<p>Content here</p>",
      glossary,
      language: "ar",
    });
    expect(quiz.questions.some((q) => q.type === "translation")).toBe(true);
  });

  it("fills to 3 questions from plain text when glossary is empty", () => {
    const quiz = buildFallbackQuiz({
      lessonTitle: "Empty Topic",
      htmlContent: "Sentence one is more than twenty characters long for testing. Sentence two is also long enough to trigger the filter.",
    });
    expect(quiz.questions.length).toBeGreaterThanOrEqual(3);
  });

  it("caps at MAX_QUESTIONS (5)", () => {
    const bigGlossary = Array.from({ length: 10 }, (_, i) => ({
      term: `Term${i}`,
      definition: `Definition number ${i} is long enough to pass the filter.`,
    }));
    const quiz = buildFallbackQuiz({
      lessonTitle: "Big Lesson",
      htmlContent: "",
      glossary: bigGlossary,
    });
    expect(quiz.questions.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// parseDiagnosticQuiz
// ---------------------------------------------------------------------------
describe("parseDiagnosticQuiz", () => {
  it("parses a valid JSON quiz response", () => {
    const json = JSON.stringify({
      questions: [
        { type: "multiple_choice", prompt: "Q1?", options: ["A", "B", "C", "D"], correctIndex: 0, explanation: "Because A" },
        { type: "fill_blank", prompt: "Q2: ___ is key", answer: "keyword", explanation: "Keyword is the answer" },
        { type: "translation", prompt: "Q3", answer: "مرحبا", explanation: "Arabic greeting", languageTerm: "hello" },
      ],
    });
    const quiz = parseDiagnosticQuiz(json, "test-topic", "Test Lesson");
    expect(quiz.quizId).toContain("diag_");
    expect(quiz.questions.length).toBe(3);
    expect(quiz.questions[0].type).toBe("multiple_choice");
    expect(quiz.questions[0].id).toBeTruthy();
  });

  it("throws on invalid JSON", () => {
    expect(() => parseDiagnosticQuiz("not json at all", "t", "T")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// scoreDiagnosticQuiz
// ---------------------------------------------------------------------------
describe("scoreDiagnosticQuiz", () => {
  const quiz: DiagnosticQuiz = {
    quizId: "test",
    topic: "topic",
    title: "title",
    createdAt: new Date().toISOString(),
    questions: [
      { id: "q1", type: "multiple_choice", prompt: "Q1?", options: ["A", "B"], correctIndex: 0, explanation: "e" },
      { id: "q2", type: "fill_blank", prompt: "Q2: ___", answer: "correct", explanation: "e" },
      { id: "q3", type: "translation", prompt: "Q3", answer: "translated", explanation: "e", languageTerm: "term" },
    ],
  };

  it("computes accuracy, confidence, and retention correctly", () => {
    const answers: Record<string, DiagnosticAnswer> = {
      q1: { questionId: "q1", value: "A", optionIndex: 0, elapsedMs: 5000 },
      q2: { questionId: "q2", value: "correct", elapsedMs: 3000 },
      q3: { questionId: "q3", value: "translated", elapsedMs: 4000 },
    };
    const metrics = scoreDiagnosticQuiz(quiz, answers, Date.now());
    expect(metrics.accuracyScore).toBe(100);
    expect(metrics.totalQuestions).toBe(3);
    expect(metrics.correctAnswers).toBe(3);
    expect(metrics.retentionRatio).toBe(1); // translation item correct
    expect(metrics.confidenceIndex).toBeGreaterThan(90); // fast responses
  });

  it("reports 0% when all answers are wrong", () => {
    const answers: Record<string, DiagnosticAnswer> = {
      q1: { questionId: "q1", value: "B", optionIndex: 1, elapsedMs: 10000 },
      q2: { questionId: "q2", value: "wrong", elapsedMs: 10000 },
      q3: { questionId: "q3", value: "wrong", elapsedMs: 10000 },
    };
    const metrics = scoreDiagnosticQuiz(quiz, answers, Date.now());
    expect(metrics.accuracyScore).toBe(0);
    expect(metrics.correctAnswers).toBe(0);
  });

  it("handles empty answers", () => {
    const metrics = scoreDiagnosticQuiz(quiz, {}, Date.now());
    expect(metrics.accuracyScore).toBe(0);
    expect(metrics.confidenceIndex).toBe(100); // 0 avg ms → 1 - 0/60000 = 1 → 100
  });
});

// ---------------------------------------------------------------------------
// accuracyGuidance
// ---------------------------------------------------------------------------
describe("accuracyGuidance", () => {
  it("returns the 80%+ guidance string", () => {
    const result = accuracyGuidance({ accuracyScore: 85, confidenceIndex: 80, retentionRatio: 0.9, totalQuestions: 5, correctAnswers: 4, avgResponseMs: 4000 });
    expect(result).toContain("brainpower");
  });

  it("returns the 60%+ guidance string", () => {
    const result = accuracyGuidance({ accuracyScore: 65, confidenceIndex: 70, retentionRatio: 0.7, totalQuestions: 5, correctAnswers: 3, avgResponseMs: 8000 });
    expect(result).toContain("one listen");
  });

  it("returns the low-score guidance string", () => {
    const result = accuracyGuidance({ accuracyScore: 30, confidenceIndex: 50, retentionRatio: 0.3, totalQuestions: 5, correctAnswers: 1, avgResponseMs: 15000 });
    expect(result).toContain("Audiobook");
  });
});
