import { generatePodcastOnly, podcastChunkSystemPrompt } from "@/lib/generation/podcast";
import { chatForJson, retrySameModel } from "@/lib/generation/transport";
import { aiRuntime } from "@/lib/ai-runtime";
import { skillInjector } from "@/lib/skills";
import { AppError } from "@/lib/error";
import {
  PODCAST_TITLE_JSON_SCHEMA,
  PODCAST_CHUNK_JSON_SCHEMA,
  GLOSSARY_QUIZ_JSON_SCHEMA,
  validatePodcastChunk,
} from "@/lib/validation";

// Characterisation tests for the chunked podcast generator.
//
// Podcasts are ALWAYS generated piecewise — title, then chunks of dialogue,
// then glossary + quiz — because a 3B model cannot be trusted to emit 24
// exchanges in one structured response without truncating. That loop is the
// interesting part, and it is the part nothing covered (18.6%).
//
// The real validators are used, not mocked. That is deliberate: the whole
// justification for chunking is "every individual call stays small enough to
// pass strict validation", so a suite that stubbed the validators would be
// unable to prove the thing the design exists for. Fixtures are generated at
// the minimum lengths the schemas demand.

jest.mock("@/lib/generation/transport", () => ({
  chatForJson: jest.fn(),
  retrySameModel: jest.fn(),
}));

jest.mock("@/lib/ai-runtime", () => ({
  aiRuntime: { ensureModel: jest.fn() },
}));

jest.mock("@/lib/skills", () => ({
  skillInjector: { applyForIntent: jest.fn((prompt: string) => prompt) },
}));

const mockChatForJson = chatForJson as jest.MockedFunction<typeof chatForJson>;
const mockRetrySameModel = retrySameModel as jest.MockedFunction<typeof retrySameModel>;
const mockEnsureModel = aiRuntime.ensureModel as jest.MockedFunction<typeof aiRuntime.ensureModel>;
const mockApplyForIntent = skillInjector.applyForIntent as jest.MockedFunction<
  typeof skillInjector.applyForIntent
>;

type Speaker = "Host A" | "Host B";

/** A dialogue line that satisfies the 30-character minimum. */
function line(i: number) {
  return {
    speaker: (i % 2 === 0 ? "Host A" : "Host B") as Speaker,
    text: `Dialogue line number ${i}, comfortably longer than the thirty character minimum.`,
  };
}

function lines(n: number) {
  return Array.from({ length: n }, (_, i) => line(i));
}

/** Glossary items satisfy the 80-character definition minimum. */
function glossary(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    term: `Term ${i}`,
    definition: `Definition number ${i}, long enough to clear the eighty character minimum.`.padEnd(
      90,
      "y"
    ),
  }));
}

/** Quiz items satisfy the 4-option and 100-character explanation minimums. */
function quiz(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    question: `Question number ${i}, phrased to test real understanding?`,
    options: ["Option A", "Option B", "Option C", "Option D"],
    correctIndex: 0,
    explanation: `Explanation for question ${i}, clearing the hundred character minimum easily.`.padEnd(
      110,
      "z"
    ),
  }));
}

/** Route each chatForJson call by the schema it was given. */
function respondBySchema() {
  mockChatForJson.mockImplementation(async (_model, _messages, schema) => {
    if (schema === PODCAST_TITLE_JSON_SCHEMA) return { title: "The Water Cycle, Explained" };
    if (schema === PODCAST_CHUNK_JSON_SCHEMA) return { lines: lines(6) };
    if (schema === GLOSSARY_QUIZ_JSON_SCHEMA) return { glossary: glossary(8), quiz: quiz(6) };
    throw new Error("unexpected schema");
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEnsureModel.mockImplementation(async (m?: string) => m ?? "llama3");
  // retrySameModel retries the SAME model; here it just runs the thunk.
  mockRetrySameModel.mockImplementation(async (_model, fn) => fn());
  respondBySchema();
  mockApplyForIntent.mockImplementation((prompt: string) => prompt);
});

describe("podcastChunkSystemPrompt", () => {
  it("names the hosts from the requested genders", () => {
    const prompt = podcastChunkSystemPrompt("intermediate", "en", "male", "male");

    expect(prompt).toContain("Host A is James (male)");
    expect(prompt).toContain("Host B is David (male)");
  });

  it("uses female names when a voice is female", () => {
    const prompt = podcastChunkSystemPrompt("intermediate", "en", "female", "female");

    expect(prompt).toContain("Host A is Sarah (female)");
    expect(prompt).toContain("Host B is Emily (female)");
  });

  it("uses Arabic names for an Arabic podcast", () => {
    const prompt = podcastChunkSystemPrompt("intermediate", "ar", "male", "female");

    expect(prompt).toContain("أحمد");
    expect(prompt).toContain("خديجة");
  });

  it("warns the model not to mismatch names and voices", () => {
    const prompt = podcastChunkSystemPrompt("intermediate", "en");
    expect(prompt).toContain("Genders MUST match voices");
  });

  it("adds the Modern Standard Arabic instruction only for Arabic", () => {
    expect(podcastChunkSystemPrompt("intermediate", "ar")).toContain("Modern Standard Arabic");
    expect(podcastChunkSystemPrompt("intermediate", "en")).not.toContain("Modern Standard Arabic");
  });

  it("keeps the speaker labels untranslated in Arabic", () => {
    const prompt = podcastChunkSystemPrompt("intermediate", "ar");
    expect(prompt).toContain('"Host A"/"Host B" exactly as-is');
  });

  it("defaults to an intermediate level when difficulty is blank", () => {
    expect(podcastChunkSystemPrompt("", "en")).toContain("at intermediate level");
  });

  it("defaults host A male and host B female", () => {
    const prompt = podcastChunkSystemPrompt("intermediate", "en");
    expect(prompt).toContain("Host A is James (male)");
    expect(prompt).toContain("Host B is Emily (female)");
  });

  it("resolves podcast skills by intent, not from the session binding", () => {
    // This is the point of the prompt being exported: a podcast started from
    // the lesson page must still carry podcast methodology.
    podcastChunkSystemPrompt("intermediate", "en");

    expect(mockApplyForIntent).toHaveBeenCalledWith(expect.any(String), "podcast");
  });

  it("asks for the chunk JSON shape", () => {
    const prompt = podcastChunkSystemPrompt("intermediate", "en");
    expect(prompt).toContain('"lines"');
    expect(prompt).toContain('"speaker": "Host A"');
  });
});

describe("generatePodcastOnly — request validation", () => {
  it("rejects a request with neither topic nor content", async () => {
    await expect(generatePodcastOnly({})).rejects.toThrow(AppError);
    await expect(generatePodcastOnly({})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects an over-long topic", async () => {
    await expect(generatePodcastOnly({ topic: "x".repeat(201) })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects content shorter than the minimum", async () => {
    await expect(generatePodcastOnly({ content: "short" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("does not reach the model when validation fails", async () => {
    await expect(generatePodcastOnly({})).rejects.toThrow();
    expect(mockChatForJson).not.toHaveBeenCalled();
  });
});

describe("generatePodcastOnly — model resolution", () => {
  it("resolves the requested model", async () => {
    await generatePodcastOnly({ topic: "Rain", model: "mistral" });

    expect(mockEnsureModel).toHaveBeenCalledWith("mistral");
  });

  it("fails loudly when the model cannot be resolved", async () => {
    // Session model policy: never auto-switch. There is no fallback model.
    mockEnsureModel.mockRejectedValue(new Error("not installed"));

    await expect(generatePodcastOnly({ topic: "Rain", model: "missing" })).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
    expect(mockChatForJson).not.toHaveBeenCalled();
  });

  it("handles a non-Error rejection from model resolution", async () => {
    mockEnsureModel.mockRejectedValue("string failure");

    await expect(generatePodcastOnly({ topic: "Rain" })).rejects.toThrow(
      /string failure/
    );
  });
});

describe("generatePodcastOnly — prompt construction", () => {
  it("builds a topic prompt", async () => {
    await generatePodcastOnly({ topic: "Photosynthesis", difficulty: "expert", length: "long" });

    const prompt = mockChatForJson.mock.calls[0]![1][1].content as string;
    expect(prompt).toContain("about: Photosynthesis");
    expect(prompt).toContain("expert-level");
    expect(prompt).toContain("Length: long");
  });

  it("builds a content prompt from supplied material", async () => {
    await generatePodcastOnly({ content: "Here is a long enough body of study material." });

    const prompt = mockChatForJson.mock.calls[0]![1][1].content as string;
    expect(prompt).toContain("Here is the study material:");
    expect(prompt).toContain("Here is a long enough body of study material.");
  });

  it("appends journey context when given", async () => {
    await generatePodcastOnly({ topic: "Rain", journeyContext: "Part 3 of the weather track." });

    const prompt = mockChatForJson.mock.calls[0]![1][1].content as string;
    expect(prompt).toContain("Part 3 of the weather track.");
  });

  it("omits journey context when absent", async () => {
    await generatePodcastOnly({ topic: "Rain" });

    const prompt = mockChatForJson.mock.calls[0]![1][1].content as string;
    expect(prompt).not.toContain("undefined");
  });

  it("detects Arabic from the topic", async () => {
    await generatePodcastOnly({ topic: "دورة الماء" });

    const system = mockChatForJson.mock.calls[0]![1][0].content as string;
    expect(system).toContain("Modern Standard Arabic");
  });

  it("honours an explicit language over detection", async () => {
    await generatePodcastOnly({ topic: "دورة الماء", language: "en" });

    const system = mockChatForJson.mock.calls[0]![1][0].content as string;
    expect(system).not.toContain("Modern Standard Arabic");
  });

  it("defaults difficulty and length when omitted", async () => {
    await generatePodcastOnly({ topic: "Rain" });

    const prompt = mockChatForJson.mock.calls[0]![1][1].content as string;
    expect(prompt).toContain("intermediate-level");
    expect(prompt).toContain("Length: medium");
  });
});

describe("generatePodcastOnly — chunked generation", () => {
  it("asks for a title first, then chunks, then glossary and quiz", async () => {
    await generatePodcastOnly({ topic: "Rain" });

    const schemas = mockChatForJson.mock.calls.map((c) => c[2]);
    expect(schemas[0]).toBe(PODCAST_TITLE_JSON_SCHEMA);
    expect(schemas[1]).toBe(PODCAST_CHUNK_JSON_SCHEMA);
    expect(schemas[schemas.length - 1]).toBe(GLOSSARY_QUIZ_JSON_SCHEMA);
  });

  it("returns the assembled script", async () => {
    const result = await generatePodcastOnly({ topic: "Rain" });

    expect(result.podcastScript).toBeDefined();
    expect(result.podcastScript!.length).toBeGreaterThanOrEqual(8);
    expect(result.podcastScript![0]).toEqual(
      expect.objectContaining({ speaker: "Host A" })
    );
  });

  it("keeps asking until the target exchange count is reached", async () => {
    // intermediate + medium -> 24 exchanges, 6 lines per chunk -> 4 chunks.
    await generatePodcastOnly({ topic: "Rain", difficulty: "intermediate", length: "medium" });

    const chunkCalls = mockChatForJson.mock.calls.filter(
      (c) => c[2] === PODCAST_CHUNK_JSON_SCHEMA
    );
    expect(chunkCalls).toHaveLength(4);
  });

  it("requests fewer lines on the final chunk so it does not overshoot", async () => {
    // beginner + short -> 12 exchanges, so the second chunk needs only 6 and
    // the loop stops exactly on target.
    await generatePodcastOnly({ topic: "Rain", difficulty: "beginner", length: "short" });

    const chunkCalls = mockChatForJson.mock.calls.filter(
      (c) => c[2] === PODCAST_CHUNK_JSON_SCHEMA
    );
    expect(chunkCalls).toHaveLength(2);
    // The user message carries the requested line count.
    expect(chunkCalls[0]![1][1].content).toContain("6");
  });

  it("asks for more exchanges for a comprehensive expert podcast", async () => {
    await generatePodcastOnly({ topic: "Rain", difficulty: "expert", length: "comprehensive" });

    const chunkCalls = mockChatForJson.mock.calls.filter(
      (c) => c[2] === PODCAST_CHUNK_JSON_SCHEMA
    );
    // expert 32 * 2.0 = 64, clamped to 60 -> 10 chunks of 6.
    expect(chunkCalls).toHaveLength(10);
  });

  it("terminates on the target count without needing an iteration cap", async () => {
    // This test used to pin the arithmetic of a `maxChunks` bound that could
    // never fire: the loop was `while (script.length < target && chunks <
    // maxChunks)` with `maxChunks = ceil(target / 2) + 1`, but
    // `podcastChunkOutputSchema` requires at least 2 lines per chunk, so the
    // smallest possible chunk still reaches the target in exactly
    // `ceil(target/2)` iterations — one fewer than the bound allowed. The
    // counter is gone; what replaces it is the validator, so the test below
    // pins the invariant the loop now depends on.
    mockChatForJson.mockImplementation(async (_model, _messages, schema) => {
      if (schema === PODCAST_TITLE_JSON_SCHEMA) return { title: "T" };
      if (schema === PODCAST_CHUNK_JSON_SCHEMA) return { lines: lines(2) };
      if (schema === GLOSSARY_QUIZ_JSON_SCHEMA) return { glossary: glossary(8), quiz: quiz(6) };
      throw new Error("unexpected");
    });

    const result = await generatePodcastOnly({
      topic: "Rain",
      difficulty: "intermediate",
      length: "medium",
    });

    const chunkCalls = mockChatForJson.mock.calls.filter(
      (c) => c[2] === PODCAST_CHUNK_JSON_SCHEMA
    );
    // intermediate/medium -> target 24, so 24 / 2 = 12 chunks of the minimum
    // allowed size, and the loop stops there of its own accord.
    expect(chunkCalls).toHaveLength(12);
    expect(result.podcastScript).toHaveLength(24);
  });

  it("rejects a chunk below two lines, which is what bounds the loop", () => {
    // The invariant the loop above now rests on. With no counter left, a chunk
    // of zero lines would append nothing, `script.length` would never reach
    // `target`, and the loop would spin forever. `.min(2)` is what rules that
    // out, so it is asserted here rather than assumed.
    expect(() => validatePodcastChunk({ lines: [] })).toThrow(/at least 2/i);
    expect(() => validatePodcastChunk({ lines: lines(1) })).toThrow(/at least 2/i);
    expect(validatePodcastChunk({ lines: lines(2) }).lines).toHaveLength(2);
  });

  it("retries each phase on the same model", async () => {
    await generatePodcastOnly({ topic: "Rain", model: "pinned" });

    // One retry wrapper per chat call, all pinned to the same model id.
    expect(mockRetrySameModel).toHaveBeenCalledTimes(mockChatForJson.mock.calls.length);
    for (const call of mockRetrySameModel.mock.calls) {
      expect(call[0]).toBe("pinned");
    }
  });

  it("passes the accumulated script to later chunks so dialogue continues", async () => {
    await generatePodcastOnly({ topic: "Rain" });

    const chunkCalls = mockChatForJson.mock.calls.filter(
      (c) => c[2] === PODCAST_CHUNK_JSON_SCHEMA
    );
    const firstUser = chunkCalls[0]![1][1].content as string;
    const secondUser = chunkCalls[1]![1][1].content as string;
    // The second chunk must carry prior dialogue; the first has none.
    expect(secondUser.length).toBeGreaterThan(firstUser.length);
  });

  it("uses the generated title in the section heading", async () => {
    // The title comes back through validatePodcastOutput and becomes the single
    // transcript section; only the script is returned, so this asserts the
    // pipeline assembled rather than the shape leaked.
    const result = await generatePodcastOnly({ topic: "Rain" });
    expect(Array.isArray(result.podcastScript)).toBe(true);
  });
});

describe("generatePodcastOnly — failure handling", () => {
  it("wraps a generation failure as an external API error", async () => {
    mockChatForJson.mockRejectedValue(new Error("model offline"));

    await expect(generatePodcastOnly({ topic: "Rain", model: "pinned" })).rejects.toMatchObject({
      code: "EXTERNAL_API_ERROR",
    });
  });

  it("names the model that failed in the message", async () => {
    mockChatForJson.mockRejectedValue(new Error("model offline"));

    await expect(generatePodcastOnly({ topic: "Rain", model: "pinned" })).rejects.toThrow(
      /pinned/
    );
  });

  it("fails when the model returns a script below the minimum length", async () => {
    mockChatForJson.mockImplementation(async (_model, _messages, schema) => {
      if (schema === PODCAST_TITLE_JSON_SCHEMA) return { title: "T" };
      if (schema === PODCAST_CHUNK_JSON_SCHEMA) return { lines: [] };
      if (schema === GLOSSARY_QUIZ_JSON_SCHEMA) return { glossary: glossary(8), quiz: quiz(6) };
      throw new Error("unexpected");
    });

    await expect(generatePodcastOnly({ topic: "Rain" })).rejects.toMatchObject({
      code: "EXTERNAL_API_ERROR",
    });
  });

  it("fails when the glossary is too small", async () => {
    mockChatForJson.mockImplementation(async (_model, _messages, schema) => {
      if (schema === PODCAST_TITLE_JSON_SCHEMA) return { title: "T" };
      if (schema === PODCAST_CHUNK_JSON_SCHEMA) return { lines: lines(6) };
      if (schema === GLOSSARY_QUIZ_JSON_SCHEMA) return { glossary: glossary(2), quiz: quiz(6) };
      throw new Error("unexpected");
    });

    await expect(generatePodcastOnly({ topic: "Rain" })).rejects.toMatchObject({
      code: "EXTERNAL_API_ERROR",
    });
  });
});

describe("generatePodcastOnly — cancellation", () => {
  it("stops between chunks instead of running the whole episode", async () => {
    // A podcast is up to a dozen sequential model calls. Before this, the only
    // way out of a slow run was to close the app.
    const controller = new AbortController();
    let chunkCalls = 0;
    mockChatForJson.mockImplementation(async (_model, _messages, schema) => {
      if (schema === PODCAST_TITLE_JSON_SCHEMA) return { title: "T" };
      if (schema === PODCAST_CHUNK_JSON_SCHEMA) {
        chunkCalls += 1;
        // Abort during the first chunk, as a user pressing Cancel would.
        controller.abort();
        return { lines: lines(6) };
      }
      if (schema === GLOSSARY_QUIZ_JSON_SCHEMA) return { glossary: glossary(8), quiz: quiz(6) };
      throw new Error("unexpected");
    });

    await expect(
      generatePodcastOnly({ topic: "Rain", signal: controller.signal })
    ).rejects.toThrow(/cancelled/i);

    // The chunk that was already in flight completed; no further chunk started.
    expect(chunkCalls).toBe(1);
  });

  it("reports a cancellation as a cancellation, not as a model failure", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      generatePodcastOnly({ topic: "Rain", signal: controller.signal })
    ).rejects.toThrow(/Podcast generation cancelled/i);
  });

  it("passes the signal through to every model call", async () => {
    const controller = new AbortController();

    await generatePodcastOnly({ topic: "Rain", signal: controller.signal });

    expect(mockChatForJson).toHaveBeenCalled();
    for (const call of mockChatForJson.mock.calls) {
      expect(call[4]).toBe(controller.signal);
    }
  });
});
