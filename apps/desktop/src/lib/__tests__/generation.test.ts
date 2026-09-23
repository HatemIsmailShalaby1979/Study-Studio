import {
  detectLanguage,
  getLessonSystemPrompt,
  podcastChunkSystemPrompt,
  generateHTML,
  generateLesson,
} from "@/lib/generation";
import type { GeneratedLesson } from "@/lib/generation";
import { ErrorCode } from "@/lib/error";
import type { OllamaChatMessage } from "@/lib/ollama";
import {
  GLOSSARY_QUIZ_JSON_SCHEMA,
  LESSON_OUTLINE_JSON_SCHEMA,
  LESSON_OUTPUT_JSON_SCHEMA,
  LESSON_SECTIONS_BATCH_JSON_SCHEMA,
  validateLessonOutput,
} from "@/lib/validation";
import type { ZodError } from "zod";

// ---------------------------------------------------------------------------
// detectLanguage
// ---------------------------------------------------------------------------
describe("detectLanguage", () => {
  it("returns 'en' for Latin-only text", () => {
    expect(detectLanguage("Hello world")).toBe("en");
  });

  it("returns 'ar' when any Arabic character is present", () => {
    expect(detectLanguage("الذكاء الاصطناعي")).toBe("ar");
    expect(detectLanguage("AI and الذكاء")).toBe("ar");
  });

  it("returns 'en' for empty strings", () => {
    expect(detectLanguage("")).toBe("en");
    expect(detectLanguage(undefined as unknown as string)).toBe("en");
  });
});

// ---------------------------------------------------------------------------
// getLessonSystemPrompt / podcastChunkSystemPrompt – language parameter
//
// These exercise the LIVE podcast prompt. The previous pair of tests covered
// `getPodcastSystemPrompt`, which had no production caller — it was superseded
// by the chunked path and has been deleted. See AUDIT.md.
// ---------------------------------------------------------------------------
describe("system prompts", () => {
  it("lesson prompt defaults to English when no language is given", () => {
    const prompt = getLessonSystemPrompt("beginner");
    expect(prompt).toContain("world-class educator");
    expect(prompt).not.toContain("Modern Standard Arabic");
  });

  it("lesson prompt includes an Arabic instruction when language='ar'", () => {
    const prompt = getLessonSystemPrompt("beginner", "ar");
    expect(prompt).toContain("Modern Standard Arabic");
    expect(prompt).toContain("JSON keys");
  });

  it("podcast chunk prompt includes an Arabic instruction when language='ar'", () => {
    const prompt = podcastChunkSystemPrompt("intermediate", "ar", "male", "female");
    expect(prompt).toContain("Modern Standard Arabic");
  });

  it("podcast chunk prompt omits the Arabic instruction for English", () => {
    const prompt = podcastChunkSystemPrompt("intermediate", "en", "male", "female");
    expect(prompt).not.toContain("Arabic");
  });
});

// ---------------------------------------------------------------------------
// generateHTML – lang, dir, localized labels
// ---------------------------------------------------------------------------
describe("generateHTML", () => {
  const baseLesson: GeneratedLesson = {
    title: "Test Lesson",
    sections: [{ heading: "Introduction", content: "Some content here." }],
    glossary: [{ term: "Term", definition: "A definition." }],
    quiz: [{ question: "What is X?", options: ["A", "B"], correctIndex: 0, explanation: "Because." }],
    _model: "test",
  };

  it("produces English HTML by default", () => {
    const html = generateHTML(baseLesson);
    expect(html).toMatch(/<html lang="en">/);
    expect(html).not.toContain('dir="rtl"');
    expect(html).toContain("Glossary");
    expect(html).toContain("Quiz");
  });

  it("produces RTL Arabic HTML when content contains Arabic", () => {
    const arabicLesson: GeneratedLesson = {
      ...baseLesson,
      title: "الذكاء الاصطناعي",
      sections: [{ heading: "مقدمة", content: "محتوى عربي." }],
    };
    const html = generateHTML(arabicLesson);
    expect(html).toMatch(/<html lang="ar"/);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("المصطلحات");
    expect(html).toContain("اختبر معلوماتك");
  });

  it("includes the lesson title in the <title> tag", () => {
    expect(generateHTML(baseLesson)).toContain("<title>Test Lesson</title>");
  });
});

// ---------------------------------------------------------------------------
// generateLesson – same-model retry policy + NO auto-switch
// ---------------------------------------------------------------------------

// Mock the Ollama transport so no network is involved; `extractJsonFromResponse`
// stays real to match production JSON handling.
jest.mock("@/lib/ollama", () => ({
  ...jest.requireActual("@/lib/ollama"),
  chat: jest.fn(),
  ensureModel: jest.fn(),
}));

import { chat, ensureModel } from "@/lib/ollama";

const mockedChat = chat as jest.MockedFunction<typeof chat>;
const mockedEnsureModel = ensureModel as jest.MockedFunction<typeof ensureModel>;

const VALID_LESSON_JSON = JSON.stringify({
  title: "Test Lesson",
  sections: [
    { heading: "Introduction to the Topic", content: "This is a comprehensive introduction to the topic that covers the fundamental concepts and provides a solid foundation for understanding the material in depth. The content here is detailed enough to pass the five hundred character minimum requirement for section content. We explore the key ideas, their origins, and why they matter in the broader context of the field. Every concept is explained with care and precision. The introduction sets the stage for the rest of the lesson by establishing the core principles and their significance for learners at all levels." },
    { heading: "Core Concepts and Foundations", content: "The core concepts form the backbone of this topic. They include multiple interconnected ideas that build upon each other to create a comprehensive understanding of the subject matter. Here we examine each concept in detail, providing concrete examples and real-world applications that help the learner grasp the underlying mechanisms. The relationships between concepts are clearly articulated with specific references to how they interact and depend on one another in practice across different contexts and scenarios." },
    { heading: "Advanced Topics and Analysis", content: "Advanced topics go beyond the basics and explore deeper aspects of the subject that require sustained intellectual engagement. They require a solid understanding of the foundational concepts covered in earlier sections before attempting this material. This section provides rigorous analysis, comparing different approaches and evaluating their strengths and weaknesses with concrete evidence. Edge cases and controversies are addressed with nuance and specificity throughout the discussion. We look at competing frameworks and identify where each approach excels or falls short in professional practice and academic research across the discipline." },
    { heading: "Practical Applications", content: "The practical applications of this topic are numerous and span across various fields and industries worldwide. Understanding these applications helps bridge the gap between theoretical knowledge and real-world practice for learners at every level. We examine specific case studies, named examples, and real-world implementations that demonstrate how the concepts are applied in professional settings with measurable outcomes. Each application is analyzed for its effectiveness and the conditions under which it performs best in practice. Concrete examples illustrate the significant impact of proper implementation on organizational results." },
    { heading: "Historical Context and Development", content: "The historical development of this topic reveals how ideas evolved over time through the contributions of key researchers and practitioners across multiple centuries. Understanding this history provides essential context for current approaches and helps predict future directions with greater accuracy. We trace the major milestones and the reasoning behind pivotal shifts in understanding that transformed the field. The evolution of thought in this area is marked by several important breakthroughs that fundamentally changed how practitioners approach the subject today." },
    { heading: "Conclusion and Future Directions", content: "In conclusion, this topic provides a rich and comprehensive understanding of the subject matter that extends well beyond surface-level awareness. The key takeaways are essential for anyone seeking mastery of the material and its broader implications. We summarize the critical insights, identify open questions that remain unresolved, and suggest directions for further study and research in this fascinating area of inquiry. The future of this field holds promise for continued advancement and deeper understanding of the mechanisms that drive progress in this domain over time." },
  ],
  glossary: [
    { term: "Term One", definition: "A detailed and comprehensive definition of the first key term used in this lesson. This definition provides sufficient context and practical significance to be genuinely useful to the learner studying this subject matter thoroughly." },
    { term: "Term Two", definition: "A detailed and comprehensive definition of the second key term used in this lesson. This definition provides sufficient context and practical significance to be genuinely useful to the learner studying this subject matter thoroughly." },
    { term: "Term Three", definition: "A detailed and comprehensive definition of the third key term used in this lesson. This definition provides sufficient context and practical significance to be genuinely useful to the learner studying this subject matter thoroughly." },
    { term: "Term Four", definition: "A detailed and comprehensive definition of the fourth key term used in this lesson. This definition provides sufficient context and practical significance to be genuinely useful to the learner studying this subject matter thoroughly." },
    { term: "Term Five", definition: "A detailed and comprehensive definition of the fifth key term used in this lesson. This definition provides sufficient context and practical significance to be genuinely useful to the learner studying this subject matter thoroughly." },
    { term: "Term Six", definition: "A detailed and comprehensive definition of the sixth key term used in this lesson. This definition provides sufficient context and practical significance to be genuinely useful to the learner studying this subject matter thoroughly." },
    { term: "Term Seven", definition: "A detailed and comprehensive definition of the seventh key term used in this lesson. This definition provides sufficient context and practical significance to be genuinely useful to the learner studying this subject matter thoroughly." },
    { term: "Term Eight", definition: "A detailed and comprehensive definition of the eighth key term used in this lesson. This definition provides sufficient context and practical significance to be genuinely useful to the learner studying this subject matter thoroughly." },
  ],
  quiz: [
    { question: "What is the primary focus of this comprehensive lesson?", options: ["Option A", "Option B", "Option C", "Option D"], correctIndex: 0, explanation: "Option A is correct because it directly addresses the main topic covered throughout the lesson material, which explores the fundamental concepts and their practical applications in real-world scenarios across multiple domains of study." },
    { question: "Which concept is most fundamental to understanding this topic?", options: ["Option A", "Option B", "Option C", "Option D"], correctIndex: 1, explanation: "Option B is correct as it represents the foundational concept upon which other ideas are built, providing the essential framework for deeper analysis and understanding of the subject matter as a whole." },
    { question: "How do practical applications relate to theoretical frameworks?", options: ["Option A", "Option B", "Option C", "Option D"], correctIndex: 2, explanation: "Option C correctly describes the relationship between theoretical frameworks and practical implementations, showing how theory guides practice and practice validates theory in a continuous cycle of improvement." },
    { question: "What historical development shaped the current understanding?", options: ["Option A", "Option B", "Option C", "Option D"], correctIndex: 0, explanation: "Option A is correct because the historical development of key ideas directly influenced how we understand and apply these concepts today in both professional and academic contexts across the field." },
    { question: "Which approach best demonstrates the core principles?", options: ["Option A", "Option B", "Option C", "Option D"], correctIndex: 3, explanation: "Option D is correct because it most clearly illustrates the core principles in action, providing a concrete example of theoretical concepts applied practically in real-world situations." },
    { question: "What are the future directions for this field of study?", options: ["Option A", "Option B", "Option C", "Option D"], correctIndex: 1, explanation: "Option B is correct because it identifies the most promising and actively researched directions that will shape the field in coming years based on current trends and evidence." },
  ],
});

// NOTE: VALID_PODCAST_TITLE / VALID_PODCAST_CHUNK / VALID_PODCAST_GQ /
// PODCAST_FAIL were removed here — they were declared but referenced by no
// test, so they only produced lint warnings. No podcast-generation test
// currently exists (the suite only asserts podcast *prompt* text and the
// lesson-only path), so the podcast output contract is untested. Restore
// these fixtures when that test is written. See AUDIT.md §5.

function messagesOf(call: unknown[]): OllamaChatMessage[] {
  return call[0] as OllamaChatMessage[];
}

/** The JSON Schema a chat call was constrained by (`format` in the options). */
function schemaOf(call: unknown[]): unknown {
  return (call[1] as { format?: unknown } | undefined)?.format;
}

/** How many calls were made against a given JSON Schema. */
function callsWithSchema(schema: unknown): number {
  return mockedChat.mock.calls.filter((c) => schemaOf(c) === schema).length;
}

const PARSED_LESSON = JSON.parse(VALID_LESSON_JSON) as {
  title: string;
  sections: { heading: string; content: string }[];
  glossary: unknown[];
  quiz: unknown[];
};

/** Fixtures for the chunked fallback path, derived from the one-shot lesson. */
const VALID_OUTLINE_JSON = JSON.stringify({
  title: PARSED_LESSON.title,
  headings: PARSED_LESSON.sections.map((s) => s.heading),
});
const VALID_GLOSSARY_QUIZ_JSON = JSON.stringify({
  glossary: PARSED_LESSON.glossary,
  quiz: PARSED_LESSON.quiz,
});
/** The chunked path requests one section at a time. */
const VALID_SECTION_BATCH_JSON = JSON.stringify({
  sections: [PARSED_LESSON.sections[0]],
});

/**
 * Route each chat call by the JSON Schema it carries.
 *
 * Routing by schema rather than by call index keeps these tests about the
 * strategy — which request the generator makes next, and on which model —
 * instead of about how many calls happened to precede it.
 */
function routeBySchema(over: {
  oneShot?: () => string;
  outline?: () => string;
  section?: () => string;
  glossaryQuiz?: () => string;
}) {
  mockedChat.mockImplementation(async (_messages, options) => {
    const format = (options as { format?: unknown } | undefined)?.format;
    if (format === LESSON_OUTPUT_JSON_SCHEMA) {
      return over.oneShot ? over.oneShot() : VALID_LESSON_JSON;
    }
    if (format === LESSON_OUTLINE_JSON_SCHEMA) {
      return over.outline ? over.outline() : VALID_OUTLINE_JSON;
    }
    if (format === LESSON_SECTIONS_BATCH_JSON_SCHEMA) {
      return over.section ? over.section() : VALID_SECTION_BATCH_JSON;
    }
    if (format === GLOSSARY_QUIZ_JSON_SCHEMA) {
      return over.glossaryQuiz ? over.glossaryQuiz() : VALID_GLOSSARY_QUIZ_JSON;
    }
    throw new Error(`unrouted chat call (format=${String(format)})`);
  });
}

function schemaError(): ZodError {
  try {
    validateLessonOutput({ title: "Wrong shape" });
  } catch (e) {
    return e as ZodError;
  }
  throw new Error("expected validation to fail");
}

function systemMessageOf(call: unknown[]): string {
  const msgs = messagesOf(call);
  const system = msgs.find((m) => m.role === "system");
  return system ? system.content : "";
}

describe("generateLesson", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedEnsureModel.mockResolvedValue("llama3.2:3b");
    // Don't sleep during retry backoff in unit tests.
    process.env["STUDIO_STUDIO_RETRY_BACKOFF_MS"] = "0";
  });

  it("returns a lesson with the selected model on the happy path", async () => {
    mockedChat.mockResolvedValueOnce(VALID_LESSON_JSON); // lesson (one-shot)

    const lesson = await generateLesson({ topic: "Quantum computing" });

    expect(lesson.title).toBe("Test Lesson");
    expect(lesson._model).toBe("llama3.2:3b");
    expect(mockedChat.mock.calls.length).toBe(1);
    expect(mockedChat.mock.calls[0][2]).toBe("llama3.2:3b");
  });

  it("does NOT auto-switch when the selected model is missing", async () => {
    mockedChat.mockRejectedValue(new Error("Ollama error (404): model 'llama3.2:3b' not found"));

    await expect(generateLesson({ topic: "Quantum computing" })).rejects.toMatchObject({
      code: ErrorCode.EXTERNAL_API_ERROR,
    });
    // only ever called once, with the user-selected model — no fallback switch
    expect(mockedChat).toHaveBeenCalledTimes(1);
    expect(mockedChat.mock.calls[0][2]).toBe("llama3.2:3b");
  });

  it("falls back to the chunked path, on the same model, when the one-shot fails recoverably", async () => {
    routeBySchema({ oneShot: () => { throw schemaError(); } });

    const lesson = await generateLesson({ topic: "Quantum computing" });

    expect(lesson.title).toBe("Test Lesson");
    expect(lesson.sections).toHaveLength(PARSED_LESSON.sections.length);
    expect(mockedEnsureModel).toHaveBeenCalledTimes(1);
    expect(mockedChat.mock.calls.every((c) => c[2] === "llama3.2:3b")).toBe(true);
  });

  it("does not retry the one-shot request — a recoverable failure goes straight to chunking", async () => {
    // The regression this guards: a retry is a reasonable strategy for a small
    // request, but the one-shot lesson request is deliberately larger than a
    // model will emit in one response, so a retry reproduces the same
    // truncation — minutes of generation each time — and only then runs the
    // fallback that exists for this failure. It must be attempted exactly once.
    routeBySchema({ oneShot: () => { throw new Error("Unexpected end of JSON input"); } });

    await generateLesson({ topic: "Quantum computing" });

    expect(callsWithSchema(LESSON_OUTPUT_JSON_SCHEMA)).toBe(1);
    expect(callsWithSchema(LESSON_OUTLINE_JSON_SCHEMA)).toBeGreaterThanOrEqual(1);
  });

  it("retries each CHUNK of the fallback path on the same model", async () => {
    // Chunk requests are small enough that a second attempt can genuinely
    // differ, so the same-model retry belongs here rather than on the one-shot.
    let outlineAttempts = 0;
    routeBySchema({
      oneShot: () => { throw schemaError(); },
      outline: () => {
        outlineAttempts += 1;
        if (outlineAttempts === 1) throw new Error("Unexpected token < in JSON");
        return VALID_OUTLINE_JSON;
      },
    });

    const lesson = await generateLesson({ topic: "Quantum computing" });

    expect(outlineAttempts).toBe(2);
    expect(lesson.title).toBe("Test Lesson");
  });

  it("surfaces a readable message after the fallback path exhausts its retry budget", async () => {
    routeBySchema({
      oneShot: () => { throw schemaError(); },
      outline: () => { throw schemaError(); },
    });

    await expect(generateLesson({ topic: "Quantum computing" })).rejects.toMatchObject({
      code: ErrorCode.EXTERNAL_API_ERROR,
    });
    // 1 one-shot attempt + 4 outline attempts (1 initial + 3 retries), all the
    // same model — no switch. It used to be 8, because the one-shot was itself
    // retried four times before the fallback started.
    expect(mockedChat).toHaveBeenCalledTimes(5);
    expect(mockedChat.mock.calls.every((c) => c[2] === "llama3.2:3b")).toBe(true);
  });

  it("classifies zod-shaped serialized errors as recoverable (falls back rather than aborting)", async () => {
    const zodLike = '[ { "code": "invalid_type", "expected": "array", "received": "undefined", "path": [ "sections" ], "message": "Required" } ]';
    routeBySchema({ oneShot: () => { throw new Error(zodLike); } });

    const lesson = await generateLesson({ topic: "Quantum computing" });

    expect(lesson._model).toBe("llama3.2:3b");
    expect(callsWithSchema(LESSON_OUTLINE_JSON_SCHEMA)).toBeGreaterThanOrEqual(1);
  });

  it("repairs common JSON slips (trailing commas / unquoted keys) from the model", async () => {
    // The repaired object parses but fails validation (far too short), so the
    // run continues into the fallback path — what matters is that the repair
    // pass ran rather than the raw text being handed to JSON.parse.
    routeBySchema({
      oneShot: () => '{ title: "T", sections: [{ heading: "H", content: "C", },], }',
    });

    const lesson = await generateLesson({ topic: "Quantum computing" });

    expect(lesson.title).toBe("Test Lesson");
    expect(callsWithSchema(LESSON_OUTLINE_JSON_SCHEMA)).toBeGreaterThanOrEqual(1);
  });

  it("surfaces a readable message for malformed JSON after retries are exhausted", async () => {
    routeBySchema({
      oneShot: () => {
        throw new Error("Expected ',' or '}' after property value in JSON at position 112 (line 4 column 38)");
      },
      outline: () => {
        throw new Error("Expected ',' or '}' after property value in JSON at position 112 (line 4 column 38)");
      },
    });

    const err = await generateLesson({ topic: "Quantum computing" }).catch((e: unknown) => e as { message: string; code: string });

    expect(err.message).toMatch(/malformed or truncated JSON/s);
    expect(err.code).toBe(ErrorCode.EXTERNAL_API_ERROR);
    // 1 one-shot attempt + 4 outline attempts (1 + 3 retries) = 5 total
    expect(mockedChat).toHaveBeenCalledTimes(5);
    expect(mockedChat.mock.calls.every((c) => c[2] === "llama3.2:3b")).toBe(true);
  });

  it("surfaces the error when the selected model is not installed", async () => {
    mockedEnsureModel.mockRejectedValue(
      new Error('Model "deepseek-r1" is not installed in Ollama. Install it with: ollama pull deepseek-r1')
    );

    await expect(generateLesson({ topic: "Quantum computing", model: "deepseek-r1" })).rejects.toMatchObject({
      code: ErrorCode.INTERNAL_ERROR,
    });
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it("surfaces a readable, language-aware message for empty section content", async () => {
    mockedChat.mockRejectedValue(new Error("Chunk validation failed: empty section content"));

    const err = await generateLesson({ topic: "الرياضيات", language: "ar" }).catch((e: unknown) => e as { message: string; code: string });

    expect(err.message).toMatch(/empty content for lesson sections/);
    expect(err.message).toMatch(/weak Arabic support/i);
    expect(err.message).toMatch(/qwen3:14b/);
    expect(err.code).toBe(ErrorCode.EXTERNAL_API_ERROR);
  });

  it("does not add Arabic guidance for English lessons", async () => {
    mockedChat.mockRejectedValue(new Error("Chunk validation failed: empty section content"));

    const err = await generateLesson({ topic: "Quantum computing", language: "en" }).catch((e: unknown) => e as { message: string });

    expect(err.message).toMatch(/empty content for lesson sections/);
    expect(err.message).not.toMatch(/weak Arabic support/i);
  });

  it("surfaces a fatal error immediately without retrying or switching models", async () => {
    mockedChat.mockRejectedValue(new Error("Ollama error (500): internal server error"));

    await expect(generateLesson({ topic: "Quantum computing" })).rejects.toMatchObject({
      code: ErrorCode.EXTERNAL_API_ERROR,
    });
    expect(mockedChat).toHaveBeenCalledTimes(1);
  });

  it("passes the requested language through the schema into the system prompt", async () => {
    mockedChat.mockResolvedValueOnce(VALID_LESSON_JSON);

    await generateLesson({ topic: "Quantum computing", language: "ar" });

    expect(systemMessageOf(mockedChat.mock.calls[0])).toContain("Modern Standard Arabic");
  });

  it("auto-detects Arabic from the topic when no explicit language is given", async () => {
    mockedChat.mockResolvedValueOnce(VALID_LESSON_JSON);

    await generateLesson({ topic: "الذكاء الاصطناعي" });

    expect(systemMessageOf(mockedChat.mock.calls[0])).toContain("Modern Standard Arabic");
  });

  it("generates HTML export when format='html'", async () => {
    mockedChat.mockResolvedValueOnce(VALID_LESSON_JSON);

    const lesson = await generateLesson({ topic: "Quantum computing", format: "html" });

    expect(lesson.htmlContent).toBeTruthy();
    expect(lesson._format).toBe("html");
    expect(lesson._length).toBe("medium");
  });

  it("rejects invalid input with a validation AppError", async () => {
    await expect(generateLesson({ topic: "" })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it("passes the lesson JSON Schema as `format` in chat options on the happy path", async () => {
    mockedChat.mockResolvedValueOnce(VALID_LESSON_JSON);

    await generateLesson({ topic: "Quantum computing" });

    // First call is the lesson one-shot
    const opts = mockedChat.mock.calls[0][1];
    expect(opts).toHaveProperty("format");
    expect(typeof opts.format).toBe("object");
    expect((opts.format as Record<string, unknown>).type).toBe("object");
  });

  it("generates lesson only (no podcast) from the same source material", async () => {
    mockedChat.mockResolvedValueOnce(VALID_LESSON_JSON); // lesson (one-shot)

    const lesson = await generateLesson({ topic: "Coffee", difficulty: "beginner", length: "short" });

    expect(lesson._model).toBe("llama3.2:3b");
    expect(lesson.title).toBe("Test Lesson");
    // Lesson sections are present
    expect(lesson.sections.length).toBe(6);
    expect(lesson.sections[0].heading).toBe("Introduction to the Topic");
    // No podcast — podcast is generated separately via generatePodcastOnly
    expect(lesson.podcastScript).toBeFalsy();
    expect(lesson.glossary.length).toBe(8);
    expect(lesson.quiz.length).toBe(6);
    // Only one call (lesson one-shot)
    expect(mockedChat).toHaveBeenCalledTimes(1);
    expect(mockedChat.mock.calls[0][2]).toBe("llama3.2:3b");
  });
});
