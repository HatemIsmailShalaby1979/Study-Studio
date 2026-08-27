/**
 * OpenAICompatibleProvider tests.
 *
 * Part 1 — transport: the provider speaks the OpenAI /v1 protocol
 * (chat completions, embeddings, streaming, model discovery, health).
 *
 * Part 2 — architectural validation: the REAL business module
 * (`generateLesson` from generation.ts) runs against an OpenAI-compatible
 * runtime with ZERO application changes. This is the proof that the runtime
 * is genuinely runtime-independent — switching AI runtimes must not change
 * application behavior.
 */

import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "node:util";
import { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
  OpenAICompatibleProvider,
  OpenAICompatibleHTTPError,
  openAIProviderProfiles,
} from "@/lib/ai-runtime";
import { aiRuntime, createRuntime } from "@/lib/ai-runtime";
import { generateLesson } from "@/lib/generation";
import { LESSON_OUTPUT_JSON_SCHEMA } from "@/lib/validation";
import { ErrorCode } from "@/lib/error";

// jsdom's environment does not expose Web Streams globals; the SSE test needs
// them (the provider itself relies on the standard `fetch`/streams contract).
const webGlobals = globalThis as unknown as {
  ReadableStream?: unknown;
  TextEncoder?: unknown;
  TextDecoder?: unknown;
};
if (!webGlobals.ReadableStream) webGlobals.ReadableStream = NodeReadableStream;
if (!webGlobals.TextEncoder) webGlobals.TextEncoder = NodeTextEncoder;
if (!webGlobals.TextDecoder) webGlobals.TextDecoder = NodeTextDecoder;

// ---------------------------------------------------------------------------
// fetch mocking helpers
// ---------------------------------------------------------------------------

type RouteResult = {
  status?: number;
  payload?: unknown;
  text?: string;
  body?: ReadableStream<Uint8Array>;
};

type RouteHandler = () => RouteResult;

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

const requests: CapturedRequest[] = [];

function mockFetchRoutes(routes: Record<string, RouteHandler>): jest.Mock {
  requests.length = 0;
  const mock = jest.fn(async (url: string, init?: RequestInit) => {
    requests.push({ url: String(url), body: init?.body ? JSON.parse(init.body as string) : {} });
    for (const [suffix, handler] of Object.entries(routes)) {
      if (String(url).endsWith(suffix)) {
        const r = handler();
        const status = r.status ?? 200;
        const ok = status >= 200 && status < 300;
        const text = r.text ?? (r.payload ? JSON.stringify(r.payload) : "");
        return {
          ok,
          status,
          json: async () => r.payload,
          text: async () => text,
          body: r.body ?? null,
        };
      }
    }
    throw new Error(`No route configured for ${url}`);
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

const chatCompletion = (content: string): unknown => ({
  id: "chatcmpl-test",
  object: "chat.completion",
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
});

const LMSTUDIO_MODELS = {
  object: "list",
  data: [
    { id: "qwen2.5-7b-instruct", object: "model", created: 0, owned_by: "local" },
    { id: "llama-3.1-8b-instruct", object: "model", created: 0, owned_by: "local" },
  ],
};

const OPENROUTER_MODELS = {
  object: "list",
  data: [
    {
      id: "qwen/qwen2.5-72b-instruct",
      object: "model",
      context_length: 131072,
      tool_use: { supports: true },
      modalities: { input: ["text", "image"], output: ["text"] },
      owned_by: "qwen",
    },
    {
      id: "openai/gpt-4o-mini",
      object: "model",
      context_length: 128000,
      tool_use: { supports: true },
      modalities: { input: ["text", "image"], output: ["text"] },
      owned_by: "openai",
    },
  ],
};

const realFetch = global.fetch;

// ---------------------------------------------------------------------------
// Part 1 — transport
// ---------------------------------------------------------------------------

describe("OpenAICompatibleProvider — transport", () => {
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("discovers and maps models from GET /v1/models", async () => {
    mockFetchRoutes({ "/models": () => ({ payload: LMSTUDIO_MODELS }) });
    const provider = new OpenAICompatibleProvider(openAIProviderProfiles.lmStudio!());

    const models = await provider.listModels(true);

    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({ id: "qwen2.5-7b-instruct", loaded: true });
    expect(models[1]?.id).toBe("llama-3.1-8b-instruct");
  });

  it("reports offline when the server is unreachable", async () => {
    mockFetchRoutes({}); // no route → fetch throws
    const provider = new OpenAICompatibleProvider(openAIProviderProfiles.lmStudio!());

    const health = await provider.health();

    expect(health.available).toBe(false);
    expect(health.status).toBe("offline");
  });

  it("reports auth failure distinctly when the server returns 401", async () => {
    mockFetchRoutes({
      "/models": () => ({ status: 401, text: '{"error":"unauthorized"}' }),
    });
    const provider = new OpenAICompatibleProvider(openAIProviderProfiles.openRouter!());

    const health = await provider.health();

    expect(health.available).toBe(false);
    expect(health.message).toMatch(/api key/i);
  });

  it("sends a mapped chat completion and returns the assistant content", async () => {
    const schema = { type: "object", properties: {} };
    mockFetchRoutes({
      "/models": () => ({ payload: LMSTUDIO_MODELS }),
      "/chat/completions": () => ({ payload: chatCompletion("Hello there") }),
    });
    const provider = new OpenAICompatibleProvider(openAIProviderProfiles.lmStudio!());

    const result = await provider.chat(
      [
        { role: "system", content: "Be terse." },
        { role: "user", content: "Hi" },
      ],
      { temperature: 0.3, maxTokens: 128, topP: 0.8, format: schema },
      "qwen2.5-7b-instruct"
    );

    expect(result).toBe("Hello there");
    const body = requests[0]!.body;
    expect(body["model"]).toBe("qwen2.5-7b-instruct");
    expect(body["stream"]).toBe(false);
    expect(body["temperature"]).toBe(0.3);
    expect(body["max_tokens"]).toBe(128);
    expect(body["top_p"]).toBe(0.8);
    expect(body["messages"]).toEqual([
      { role: "system", content: "Be terse." },
      { role: "user", content: "Hi" },
    ]);
    const rf = body["response_format"] as Record<string, unknown>;
    expect(rf["type"]).toBe("json_schema");
    expect((rf["json_schema"] as Record<string, unknown>)["schema"]).toEqual(schema);
  });

  it("degrades json_schema to json_object when the server rejects it", async () => {
    let chatCalls = 0;
    mockFetchRoutes({
      "/models": () => ({ payload: LMSTUDIO_MODELS }),
      "/chat/completions": () => {
        chatCalls += 1;
        if (chatCalls === 1) {
          return { status: 400, text: '{"error":{"message":"response_format json_schema not supported"}}' };
        }
        return { payload: chatCompletion("{\"ok\":true}") };
      },
    });
    const provider = new OpenAICompatibleProvider(openAIProviderProfiles.lmStudio!());

    const result = await provider.chat(
      [{ role: "user", content: "do it" }],
      { format: { type: "object" } },
      "qwen2.5-7b-instruct"
    );

    expect(result).toBe('{"ok":true}');
    expect(chatCalls).toBe(2);
    const retryBody = requests[1]!.body;
    expect((retryBody["response_format"] as Record<string, unknown>)["type"]).toBe("json_object");
  });

  it("surfaces a 404 model-missing error without swallowing it", async () => {
    mockFetchRoutes({
      "/models": () => ({ payload: LMSTUDIO_MODELS }),
      "/chat/completions": () => ({ status: 404, text: '{"error":{"message":"model \'nope-1b\' not found"}}' }),
    });
    const provider = new OpenAICompatibleProvider(openAIProviderProfiles.lmStudio!());

    const error = await provider
      .chat([{ role: "user", content: "hi" }], {}, "nope-1b")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OpenAICompatibleHTTPError);
    expect(error).toMatchObject({ status: 404 });
    expect((error as Error).message).toMatch(/404/);
  });

  it("routes generate() through the chat protocol", async () => {
    mockFetchRoutes({
      "/models": () => ({ payload: LMSTUDIO_MODELS }),
      "/chat/completions": () => ({ payload: chatCompletion("answer") }),
    });
    const provider = new OpenAICompatibleProvider(openAIProviderProfiles.lmStudio!());

    const result = await provider.generate("What is 2+2?", "Math tutor", {}, "qwen2.5-7b-instruct");

    expect(result).toBe("answer");
    const body = requests[0]!.body;
    expect(body["messages"]).toEqual([
      { role: "system", content: "Math tutor" },
      { role: "user", content: "What is 2+2?" },
    ]);
  });

  it("returns embeddings from POST /v1/embeddings", async () => {
    mockFetchRoutes({
      "/models": () => ({ payload: LMSTUDIO_MODELS }),
      "/embeddings": () => ({
        payload: {
          object: "list",
          data: [
            { object: "embedding", embedding: [0.1, 0.2], index: 0 },
            { object: "embedding", embedding: [0.3, 0.4], index: 1 },
          ],
        },
      }),
    });
    const provider = new OpenAICompatibleProvider(openAIProviderProfiles.lmStudio!());

    const vectors = await provider.embeddings(["cat", "dog"], "qwen2.5-7b-instruct");

    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    const body = requests[0]!.body;
    expect(body["model"]).toBe("qwen2.5-7b-instruct");
    expect(body["input"]).toEqual(["cat", "dog"]);
  });

  it("streams SSE token deltas from a streamed chat completion", async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
      "data: [DONE]\n\n";
    mockFetchRoutes({
      "/models": () => ({ payload: LMSTUDIO_MODELS }),
      "/chat/completions": () => ({
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sse));
            controller.close();
          },
        }),
      }),
    });
    const provider = new OpenAICompatibleProvider(openAIProviderProfiles.lmStudio!());

    const parts: string[] = [];
    for await (const delta of provider.streamChat!([{ role: "user", content: "hi" }], {}, "qwen2.5-7b-instruct")) {
      parts.push(delta);
    }

    expect(parts).toEqual(["Hel", "lo"]);
    const body = requests[0]!.body;
    expect(body["stream"]).toBe(true);
  });

  it("discover() probes embeddings and derives tools/vision from metadata", async () => {
    mockFetchRoutes({
      "/models": () => ({ payload: OPENROUTER_MODELS }),
      "/embeddings": () => ({ status: 404, text: "no embeddings" }),
    });
    const provider = new OpenAICompatibleProvider(openAIProviderProfiles.openRouter!());

    const status = await provider.discover();

    expect(status.available).toBe(true);
    expect(status.models).toHaveLength(2);
    expect(status.recommendedModel).toBe("qwen/qwen2.5-72b-instruct");
    expect(status.capabilities.chat).toBe(true);
    expect(status.capabilities.structuredOutput).toBe(true);
    expect(status.capabilities.streaming).toBe(true);
    expect(status.capabilities.tools).toBe(true);
    expect(status.capabilities.functionCalling).toBe(true);
    expect(status.capabilities.vision).toBe(true);
    expect(status.capabilities.embeddings).toBe(false);
  });

  it("leaves tools/vision unadvertised when the server reports no metadata", async () => {
    mockFetchRoutes({
      "/models": () => ({ payload: LMSTUDIO_MODELS }),
      "/embeddings": () => ({ status: 404, text: "no embeddings" }),
    });
    const provider = new OpenAICompatibleProvider(openAIProviderProfiles.lmStudio!());

    const status = await provider.discover();

    expect(status.capabilities.tools).toBe(false);
    expect(status.capabilities.vision).toBe(false);
    expect(status.capabilities.embeddings).toBe(false);
  });

  it("advertises embeddings when the server exposes /v1/embeddings", async () => {
    mockFetchRoutes({
      "/models": () => ({ payload: LMSTUDIO_MODELS }),
      "/embeddings": () => ({ payload: { object: "list", data: [{ embedding: [1], index: 0 }] } }),
    });
    const provider = new OpenAICompatibleProvider(openAIProviderProfiles.lmStudio!());

    const status = await provider.discover();

    expect(status.capabilities.embeddings).toBe(true);
  });

  it("getModelProfile() uses metadata when present and returns null otherwise", async () => {
    mockFetchRoutes({
      "/models": () => ({ payload: OPENROUTER_MODELS }),
    });
    const rich = new OpenAICompatibleProvider(openAIProviderProfiles.openRouter!());
    await rich.listModels(true);
    const profile = await rich.getModelProfile("qwen/qwen2.5-72b-instruct");
    expect(profile).toMatchObject({ contextWindow: 131072, supportsTools: true });

    mockFetchRoutes({
      "/models": () => ({ payload: LMSTUDIO_MODELS }),
    });
    const minimal = new OpenAICompatibleProvider(openAIProviderProfiles.lmStudio!());
    await minimal.listModels(true);
    expect(await minimal.getModelProfile("qwen2.5-7b-instruct")).toBeNull();
  });

  it("ensureModel() matches base names tolerantly and never auto-switches", async () => {
    mockFetchRoutes({
      "/models": () => ({ payload: LMSTUDIO_MODELS }),
    });
    const provider = new OpenAICompatibleProvider(openAIProviderProfiles.lmStudio!());

    expect(await provider.ensureModel("qwen2.5")).toBe("qwen2.5-7b-instruct");
    expect(await provider.ensureModel("llama-3.1-8b-instruct")).toBe("llama-3.1-8b-instruct");
    expect(await provider.ensureModel()).toBe("qwen2.5-7b-instruct");

    await expect(provider.ensureModel("not-installed-1b")).rejects.toThrow(
      /not available on LM Studio/
    );
  });

  it("honors a static capabilities override for hosts that document support", () => {
    const provider = new OpenAICompatibleProvider({
      ...openAIProviderProfiles.lmStudio!(),
      capabilities: { tools: true, functionCalling: true },
    });

    expect(provider.capabilities().tools).toBe(true);
    expect(provider.capabilities().chat).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Part 2 — architectural validation (zero application changes)
// ---------------------------------------------------------------------------

function makeValidLesson(): string {
  const sections = Array.from({ length: 6 }, (_, i) => ({
    heading: `Section ${i + 1}`,
    content: `Section ${i + 1} provides substantial, detailed analysis of the topic with concrete examples, depth, context, and practical significance for learners at every level. `.repeat(12),
  }));
  const glossary = Array.from({ length: 8 }, (_, i) => ({
    term: `Term ${i + 1}`,
    definition: `Definition ${i + 1} gives a clear, precise meaning with context and practical significance. `.repeat(4),
  }));
  const quiz = Array.from({ length: 6 }, (_, i) => ({
    question: `What is the primary concept discussed in section ${i + 1} and why does it matter?`,
    options: ["Option A", "Option B", "Option C", "Option D"],
    correctIndex: i % 4,
    explanation: `Option ${"ABCD"[i % 4]!} is correct because it directly explains the concept with reasoning, evidence, and a clear comparison to the other options. `.repeat(3),
  }));
  return JSON.stringify({ title: "OpenAI Runtime Lesson", sections, glossary, quiz });
}

const VALID_LESSON = makeValidLesson();

describe("Architectural validation — switching runtimes requires zero app changes", () => {
  const session = aiRuntime.session;

  beforeEach(() => {
    session.setProvider("lm-studio");
    session.setModel(null);
    process.env["STUDIO_STUDIO_RETRY_BACKOFF_MS"] = "0";
  });

  afterEach(() => {
    global.fetch = realFetch;
    session.setProvider(null);
    session.setModel(null);
  });

  it("generateLesson() (unchanged business logic) produces a valid lesson via LM Studio", async () => {
    mockFetchRoutes({
      "/models": () => ({ payload: LMSTUDIO_MODELS }),
      "/chat/completions": () => ({ payload: chatCompletion(VALID_LESSON) }),
    });

    const lesson = await generateLesson({ topic: "Quantum computing" });

    expect(lesson.title).toBe("OpenAI Runtime Lesson");
    expect(lesson._model).toBe("qwen2.5-7b-instruct");
    expect(lesson.sections.length).toBe(6);

    // The provider received the REAL structured-output schema from validation.ts
    // and the REAL lesson system prompt from generation.ts — nothing adapted.
    const chatCall = requests.find((r) => r.url.endsWith("/chat/completions"))!;
    const rf = chatCall.body["response_format"] as Record<string, unknown>;
    expect(rf["type"]).toBe("json_schema");
    expect((rf["json_schema"] as Record<string, unknown>)["schema"]).toEqual(
      LESSON_OUTPUT_JSON_SCHEMA
    );
    const system = (chatCall.body["messages"] as { role: string; content: string }[]).find(
      (m) => m.role === "system"
    )!;
    expect(system.content).toContain("world-class");
  });

  it("failure semantics are identical: a missing model surfaces EXTERNAL_API_ERROR with no retry and no switch", async () => {
    let chatCalls = 0;
    mockFetchRoutes({
      "/models": () => ({ payload: LMSTUDIO_MODELS }),
      "/chat/completions": () => {
        chatCalls += 1;
        return { status: 404, text: '{"error":{"message":"model \'qwen2.5-7b-instruct\' not found"}}' };
      },
    });

    await expect(generateLesson({ topic: "Quantum computing" })).rejects.toMatchObject({
      code: ErrorCode.EXTERNAL_API_ERROR,
    });

    // exactly one attempt — same model policy, no fallback switch
    expect(chatCalls).toBe(1);
  });

  it("a fresh runtime routes capability calls to the provider that advertises them", async () => {
    const provider = new OpenAICompatibleProvider({
      ...openAIProviderProfiles.lmStudio!(),
      capabilities: { embeddings: true },
    });
    const runtime = createRuntime(provider);
    runtime.session.setProvider("lm-studio");

    // Chat resolves to the OpenAI-compatible provider.
    mockFetchRoutes({
      "/models": () => ({ payload: LMSTUDIO_MODELS }),
      "/chat/completions": () => ({ payload: chatCompletion("ok") }),
    });
    const text = await runtime.chat([{ role: "user", content: "hi" }]);
    expect(text).toBe("ok");

    // Embeddings resolve to the same provider through the capability system.
    mockFetchRoutes({
      "/models": () => ({ payload: LMSTUDIO_MODELS }),
      "/embeddings": () => ({
        payload: { object: "list", data: [{ embedding: [0.5], index: 0 }] },
      }),
    });
    const vectors = await runtime.embeddings("hello");
    expect(vectors).toEqual([[0.5]]);
  });

  it("all profiles are just configuration of one provider class", () => {
    const profiles = [
      "lmStudio",
      "openRouter",
      "localAI",
      "liteLLM",
      "vllm",
      "fastChat",
    ] as const;

    for (const name of profiles) {
      const provider = new OpenAICompatibleProvider(openAIProviderProfiles[name]!());
      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
      expect(provider.descriptor.id).toBeTruthy();
      expect(provider.capabilities().chat).toBe(true);
    }
  });
});
