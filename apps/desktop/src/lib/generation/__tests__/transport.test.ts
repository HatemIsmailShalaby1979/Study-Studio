import { chatForJson } from "@/lib/generation/transport";
import { aiRuntime } from "@/lib/ai-runtime";

// Tests for the structured-output funnel — the one function every structured
// generation call in the app goes through (lesson one-shot, lesson chunks,
// podcast title, podcast chunks, glossary + quiz, evaluation, diagnostics).
//
// Why this file exists: the podcast suite mocks `chatForJson` out, so the
// options it hands the runtime were never asserted anywhere. That is precisely
// where the podcast defect lived — `reasoningEffort: "none"` is a single line,
// and without it a reasoning model spends its entire token budget thinking and
// returns an empty answer.
//
// Only the runtime is stubbed. `extractJsonFromResponse` and `repairJson` are
// the REAL implementations, because parsing and repair are what this function
// is for; stubbing them would leave the suite proving nothing about the
// behaviour under test.

jest.mock("@/lib/ai-runtime", () => ({
  ...jest.requireActual("@/lib/ai-runtime"),
  aiRuntime: { chat: jest.fn() },
}));

const mockChat = aiRuntime.chat as jest.MockedFunction<typeof aiRuntime.chat>;

const MESSAGES = [{ role: "user" as const, content: "make a podcast" }];
const SCHEMA = { type: "object", properties: { title: { type: "string" } }, required: ["title"] };

function reply(content: string) {
  mockChat.mockResolvedValueOnce(content);
}

describe("chatForJson", () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  it("asks the model to answer without thinking", async () => {
    // The line the whole reasoning-model fix rests on.
    reply('{"title":"Photosynthesis"}');

    await chatForJson("qwen/qwen3.5-9b", MESSAGES, SCHEMA, 512);

    expect(mockChat).toHaveBeenCalledWith(
      MESSAGES,
      expect.objectContaining({ reasoningEffort: "none" }),
      "qwen/qwen3.5-9b"
    );
  });

  it("constrains the request with the caller's schema", async () => {
    reply('{"title":"Photosynthesis"}');

    await chatForJson("m", MESSAGES, SCHEMA, 512);

    expect(mockChat).toHaveBeenCalledWith(
      MESSAGES,
      expect.objectContaining({ format: SCHEMA }),
      "m"
    );
  });

  it("budgets the token cap the caller asked for", async () => {
    reply('{"title":"Photosynthesis"}');

    await chatForJson("m", MESSAGES, SCHEMA, 6144);

    expect(mockChat).toHaveBeenCalledWith(
      MESSAGES,
      expect.objectContaining({ maxTokens: 6144 }),
      "m"
    );
  });

  it("threads the cancellation signal to the runtime", async () => {
    reply('{"title":"Photosynthesis"}');
    const controller = new AbortController();

    await chatForJson("m", MESSAGES, SCHEMA, 512, controller.signal);

    expect(mockChat).toHaveBeenCalledWith(
      MESSAGES,
      expect.objectContaining({ signal: controller.signal }),
      "m"
    );
  });

  it("parses a well-formed reply", async () => {
    reply('{"title":"Photosynthesis"}');

    await expect(chatForJson("m", MESSAGES, SCHEMA, 512)).resolves.toEqual({
      title: "Photosynthesis",
    });
  });

  it("repairs a reply the model wrapped in prose", async () => {
    // Local models routinely ignore "respond ONLY with JSON".
    reply('Here is the JSON you asked for:\n{"title":"Photosynthesis"}\nHope that helps!');

    await expect(chatForJson("m", MESSAGES, SCHEMA, 512)).resolves.toEqual({
      title: "Photosynthesis",
    });
  });

  it("rejects an array where an object was required", async () => {
    reply('["not","an","object"]');

    await expect(chatForJson("m", MESSAGES, SCHEMA, 512)).rejects.toThrow(
      /expected an object/i
    );
  });

  it("rejects a JSON null", async () => {
    reply("null");

    await expect(chatForJson("m", MESSAGES, SCHEMA, 512)).rejects.toThrow(
      /expected an object/i
    );
  });

  it("fails loudly when the reply is not JSON at all", async () => {
    // The empty answer a starved reasoning model returns lands here — which is
    // exactly why the provider now raises its own error before this point.
    reply("");

    await expect(chatForJson("m", MESSAGES, SCHEMA, 512)).rejects.toThrow();
  });
});
