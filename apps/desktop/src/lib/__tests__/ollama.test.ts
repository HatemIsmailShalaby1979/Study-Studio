/**
 * Unit tests for ollama.ts. In jsdom `isTauri()` is false, so the real HTTP
 * code paths run against a mocked `global.fetch` — these tests exercise the
 * actual `ensureModel`, `chat`, `generate`, and `listModels` implementations
 * (no network calls).
 */

import {
  chat,
  generate,
  ensureModel,
  listModels,
  listResidentModels,
  releaseOtherModels,
  extractJsonFromResponse,
  repairJson,
} from "@/lib/ollama";

// ---------------------------------------------------------------------------
// fetch mocking helpers
// ---------------------------------------------------------------------------

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

let lastRequest: CapturedRequest | null = null;

function mockFetchJson(payload: unknown): jest.Mock {
  const mock = jest.fn(async (_url: string, init?: RequestInit) => {
    lastRequest = {
      url: String(_url),
      body: init?.body ? JSON.parse(init.body as string) : {},
    };
    return {
      ok: true,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

function mockFetchStatus(status: number, body = ""): jest.Mock {
  const mock = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => body,
  }));
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

// ---------------------------------------------------------------------------
// listModels – payload shaping and caching
// ---------------------------------------------------------------------------
describe("listModels", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("maps /api/tags payloads into OllamaModelInfo", async () => {
    mockFetchJson({
      models: [
        { name: "gemma3:12b", model: "gemma3:12b", size: 5_000_000_000, details: { loaded: true } },
        { name: "llama3.2:3b", model: "llama3.2:3b", size: 1_000_000_000, details: { loaded: false } },
      ],
    });

    const models = await listModels(true);
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({ id: "gemma3:12b", name: "gemma3:12b", loaded: true });
    expect(models[1].size).toContain("0.9 GB");
  });

  it("throws a helpful error when fetch fails (Ollama not running)", async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(listModels(true)).rejects.toThrow(/connection failed|ollama/i);
  });

  it("throws when Ollama returns a non-2xx status", async () => {
    mockFetchStatus(500, "boom");
    await expect(listModels(true)).rejects.toThrow(/500/);
  });
});

// ---------------------------------------------------------------------------
// ensureModel – tag-tolerant matching + NO auto-switch
// ---------------------------------------------------------------------------
describe("ensureModel", () => {
  const models = {
    models: [
      { name: "gemma3:12b", model: "gemma3:12b", size: 5_000_000_000, details: { loaded: false } },
      { name: "llama3.2:3b", model: "llama3.2:3b", size: 2_000_000_000, details: { loaded: false } },
      { name: "qwen3:8b", model: "qwen3:8b", size: 5_000_000_000, details: { loaded: false } },
    ],
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    mockFetchJson(models);
    // prime the 30s in-memory cache so ensureModel() reads it
    return listModels(true);
  });

  it("returns the exact match when preferred model id is installed", async () => {
    await expect(ensureModel("gemma3:12b")).resolves.toBe("gemma3:12b");
    await expect(ensureModel("llama3.2:3b")).resolves.toBe("llama3.2:3b");
  });

  it("tag-tolerant: 'gemma3' resolves to 'gemma3:12b'", async () => {
    await expect(ensureModel("gemma3")).resolves.toBe("gemma3:12b");
  });

  it("tag-tolerant: 'llama3.2' resolves to 'llama3.2:3b'", async () => {
    await expect(ensureModel("llama3.2")).resolves.toBe("llama3.2:3b");
  });

  it("tag-tolerant: colon-terminated input resolves correctly", async () => {
    await expect(ensureModel("qwen3:")).resolves.toBe("qwen3:8b");
  });

  it("rejects (no auto-switch) when the preferred model is not installed", async () => {
    await expect(ensureModel("nonexistent")).rejects.toThrow(/not installed/i);
    await expect(ensureModel("deepseek-r1")).rejects.toThrow(/ollama pull deepseek-r1/);
  });

  it("throws when no models are installed", async () => {
    mockFetchJson({ models: [] });
    await listModels(true);
    await expect(ensureModel("anything")).rejects.toThrow(/no models/i);
  });
});

// ---------------------------------------------------------------------------
// chat / generate – real HTTP payloads (num_predict, num_ctx, keep_alive)
// ---------------------------------------------------------------------------
describe("chat", () => {
  afterEach(() => jest.restoreAllMocks());

  it("sends num_predict, num_ctx and keep_alive in the Ollama options", async () => {
    mockFetchJson({ model: "llama3.2:3b", message: { role: "assistant", content: "hi" }, done: true });

    const result = await chat(
      [{ role: "user", content: "explain" }],
      { num_predict: 12345, temperature: 0.3 },
      "llama3.2:3b"
    );

    expect(result).toBe("hi");
    expect(lastRequest?.url).toContain("/api/chat");
    const body = lastRequest!.body;
    expect(body.model).toBe("llama3.2:3b");
    const options = body.options as Record<string, unknown>;
    expect(options.num_predict).toBe(12345);
    expect(options.num_ctx).toBe(24576);
    expect(options.keep_alive).toBe("10m");
    expect(options.temperature).toBe(0.3);
  });

  it("maps the legacy max_tokens alias onto num_predict", async () => {
    mockFetchJson({ model: "m", message: { role: "assistant", content: "ok" }, done: true });

    await chat([{ role: "user", content: "x" }], { max_tokens: 4096 }, "m");
    const options = lastRequest!.body.options as Record<string, unknown>;
    expect(options.num_predict).toBe(4096);
  });

  it("surfaces a non-2xx response as a descriptive error", async () => {
    mockFetchStatus(404, '{"error":"model not found"}');
    await expect(
      chat([{ role: "user", content: "x" }], {}, "missing-model")
    ).rejects.toThrow(/404/);
  });

  it("forwards an AbortSignal to the underlying fetch call", async () => {
    let capturedSignal: AbortSignal | undefined;
    const mock = jest.fn(async (_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal;
      return {
        ok: true,
        json: async () => ({ model: "m", message: { role: "assistant", content: "hi" }, done: true }),
        text: async () => "",
      };
    });
    global.fetch = mock as unknown as typeof fetch;

    const controller = new AbortController();
    await chat([{ role: "user", content: "x" }], {}, "m", controller.signal);

    expect(capturedSignal).toBe(controller.signal);
  });

  it("rejects when the request is aborted mid-flight", async () => {
    const mock = jest.fn(async (_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    global.fetch = mock as unknown as typeof fetch;

    const controller = new AbortController();
    const promise = chat([{ role: "user", content: "x" }], {}, "m", controller.signal);
    controller.abort();

    await expect(promise).rejects.toThrow();
  });
});

describe("generate", () => {
  afterEach(() => jest.restoreAllMocks());

  it("sends prompt/system and Ollama options on /api/generate", async () => {
    mockFetchJson({ model: "m", response: "answer", done: true });

    const result = await generate("prompt here", "be helpful", { num_ctx: 4096 }, "m");

    expect(result).toBe("answer");
    expect(lastRequest?.url).toContain("/api/generate");
    const body = lastRequest!.body;
    expect(body.prompt).toBe("prompt here");
    expect(body.system).toBe("be helpful");
    expect((body.options as Record<string, unknown>).num_ctx).toBe(4096);
  });

  it("forwards an AbortSignal to the underlying fetch call", async () => {
    let capturedSignal: AbortSignal | undefined;
    const mock = jest.fn(async (_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal;
      return { ok: true, json: async () => ({ model: "m", response: "ok", done: true }), text: async () => "" };
    });
    global.fetch = mock as unknown as typeof fetch;

    const controller = new AbortController();
    await generate("p", "s", {}, "m", controller.signal);

    expect(capturedSignal).toBe(controller.signal);
  });
});

// ---------------------------------------------------------------------------
// extractJsonFromResponse
// ---------------------------------------------------------------------------
describe("extractJsonFromResponse", () => {
  it("strips markdown code fences", () => {
    expect(extractJsonFromResponse("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
    expect(extractJsonFromResponse('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("leaves plain JSON untouched", () => {
    expect(extractJsonFromResponse('{"a":1}')).toBe('{"a":1}');
  });

  it("salvages a JSON object from surrounding prose", () => {
    const raw = 'Sure! Here is your lesson:\n{"title":"X","sections":[]}\nEnjoy!';
    expect(extractJsonFromResponse(raw)).toBe('{"title":"X","sections":[]}');
  });

  it("salvages JSON when a model appends commentary after it", () => {
    expect(extractJsonFromResponse('{"a":1}\n\nHope this helps!')).toBe('{"a":1}');
  });

  it("returns the input unchanged when no JSON object is present", () => {
    expect(extractJsonFromResponse("No structured output here.")).toBe("No structured output here.");
  });
});

// ---------------------------------------------------------------------------
// repairJson – trailing commas + unquoted keys, outside strings only
// ---------------------------------------------------------------------------
describe("repairJson", () => {
  it("removes trailing commas before } and ]", () => {
    expect(repairJson('{ "a": 1, "b": [1, 2,], }')).toBe('{ "a": 1, "b": [1, 2] }');
  });

  it("quotes unquoted object keys", () => {
    expect(repairJson('{ a: 1, "b": { c: 2 } }')).toBe('{ "a": 1, "b": { "c": 2 } }');
  });

  it("repairs combined slips so the result parses", () => {
    const repaired = repairJson('{ title: "T", sections: [{ heading: "H", content: "C", },], }');
    expect(() => JSON.parse(repaired)).not.toThrow();
    expect(JSON.parse(repaired)).toMatchObject({
      title: "T",
      sections: [{ heading: "H", content: "C" }],
    });
  });

  it("never touches string contents (commas, colons, apostrophes)", () => {
    const input = '{ "content": "In JSON, key: value", "note": "it\'s fine", }';
    expect(repairJson(input)).toBe('{ "content": "In JSON, key: value", "note": "it\'s fine" }');
  });

  it("leaves already-valid JSON unchanged", () => {
    const input = '{ "a": 1, "b": [true, null, "x"] }';
    expect(repairJson(input)).toBe(input);
  });

  it("escapes raw control characters inside strings", () => {
    // \n and \t inside a JSON string literal are invalid when unescaped
    const input = '{ "content": "Line one\nLine two\tTabbed" }';
    const repaired = repairJson(input);
    expect(() => JSON.parse(repaired)).not.toThrow();
    const parsed = JSON.parse(repaired);
    expect(parsed.content).toBe("Line one\nLine two\tTabbed");
  });

  it("escapes carriage returns and backspace chars inside strings", () => {
    const input = '{ "content": "before\rafter\bhit" }';
    const repaired = repairJson(input);
    expect(() => JSON.parse(repaired)).not.toThrow();
    const parsed = JSON.parse(repaired);
    expect(parsed.content).toBe("before\rafter\bhit");
  });

  it("never escapes control characters outside strings", () => {
    // Newlines between properties (not inside a string) are just whitespace
    const input = '{ "a": 1,\n "b": 2 }';
    expect(repairJson(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// chat / generate – format option forwarding
// ---------------------------------------------------------------------------
describe("chat format option", () => {
  afterEach(() => jest.restoreAllMocks());

  it("sends `format` at the top level of the request body (not inside options)", async () => {
    mockFetchJson({ model: "m", message: { role: "assistant", content: '{}' }, done: true });

    const schema = { type: "object", properties: { title: { type: "string" } }, required: ["title"] };
    await chat([{ role: "user", content: "test" }], { format: schema }, "m");

    const body = lastRequest!.body;
    expect(body.format).toEqual(schema);
    // format is NOT nested inside options
    expect((body.options as Record<string, unknown>)?.format).toBeUndefined();
  });

  it("omits `format` when not provided", async () => {
    mockFetchJson({ model: "m", message: { role: "assistant", content: '{}' }, done: true });

    await chat([{ role: "user", content: "test" }], {}, "m");

    const body = lastRequest!.body;
    expect(body.format).toBeUndefined();
  });
});

describe("generate format option", () => {
  afterEach(() => jest.restoreAllMocks());

  it("sends `format` at the top level of the /api/generate request body", async () => {
    mockFetchJson({ model: "m", response: '{}', done: true });

    const schema = { type: "object", properties: { x: { type: "integer" } } };
    await generate("test prompt", undefined, { format: schema }, "m");

    const body = lastRequest!.body;
    expect(body.format).toEqual(schema);
    expect((body.options as Record<string, unknown>)?.format).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// think option — hybrid thinking models burn num_predict on reasoning first
// ---------------------------------------------------------------------------
describe("think option", () => {
  afterEach(() => jest.restoreAllMocks());

  it("sends think: false as a TOP-LEVEL field on /api/chat", async () => {
    mockFetchJson({
      model: "granite4.2:latest",
      message: { role: "assistant", content: '{"title":"x"}', thinking: "" },
      done: true,
      done_reason: "stop",
    });

    await chat([{ role: "user", content: "title" }], { think: false, num_predict: 512 }, "granite4.2:latest");

    expect(lastRequest!.body.think).toBe(false);
    // think is NOT nested inside options
    expect((lastRequest!.body.options as Record<string, unknown>)?.think).toBeUndefined();
  });

  it("omits think when not provided", async () => {
    mockFetchJson({ model: "m", message: { role: "assistant", content: "{}" }, done: true });

    await chat([{ role: "user", content: "x" }], {}, "m");

    expect(lastRequest!.body.think).toBeUndefined();
  });

  it("sends think as a top-level field on /api/generate too", async () => {
    mockFetchJson({ model: "m", response: "{}", done: true });

    await generate("p", undefined, { think: false }, "m");

    expect(lastRequest!.body.think).toBe(false);
    expect((lastRequest!.body.options as Record<string, unknown>)?.think).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// reasoning starvation — empty answer + thinking evidence must NOT parse as JSON
// ---------------------------------------------------------------------------
describe("reasoning starvation detection", () => {
  afterEach(() => jest.restoreAllMocks());

  it("throws ReasoningBudgetExhaustedError when chat content is empty but thinking is full", async () => {
    mockFetchJson({
      model: "granite4.2:latest",
      message: {
        role: "assistant",
        content: "",
        thinking: "The user wants a title. I shall think for a long time...",
      },
      done: true,
      done_reason: "length",
    });

    await expect(
      chat([{ role: "user", content: "title" }], { num_predict: 512 }, "granite4.2:latest")
    ).rejects.toThrow(/spent its entire token budget on internal reasoning/);
  });

  it("throws ReasoningBudgetExhaustedError when generate response is empty but thinking is full", async () => {
    mockFetchJson({
      model: "m",
      response: "",
      thinking: "pondering...",
      done: true,
      done_reason: "length",
    });

    await expect(
      generate("p", undefined, { num_predict: 512 }, "m")
    ).rejects.toThrow(/spent its entire token budget on internal reasoning/);
  });

  it("returns content normally when thinking is present alongside a real answer", async () => {
    mockFetchJson({
      model: "m",
      message: { role: "assistant", content: '{"title":"ok"}', thinking: "brief thought" },
      done: true,
      done_reason: "stop",
    });

    await expect(
      chat([{ role: "user", content: "x" }], { num_predict: 512 }, "m")
    ).resolves.toBe('{"title":"ok"}');
  });

  it("returns empty content as-is when there is no thinking evidence", async () => {
    mockFetchJson({ model: "m", message: { role: "assistant", content: "" }, done: true });

    await expect(chat([{ role: "user", content: "x" }], {}, "m")).resolves.toBe("");
  });
});

// ---------------------------------------------------------------------------
// one-model-per-provider — /api/ps + keep_alive:0 release
// ---------------------------------------------------------------------------
describe("listResidentModels / releaseOtherModels", () => {
  afterEach(() => jest.restoreAllMocks());

  it("lists models currently resident from /api/ps", async () => {
    mockFetchJson({
      models: [
        { name: "gemma3:12b", model: "gemma3:12b" },
        { name: "llama3.2:3b" },
        { name: "" },
      ],
    });

    await expect(listResidentModels()).resolves.toEqual(["gemma3:12b", "llama3.2:3b"]);
    expect(lastRequest?.url).toContain("/api/ps");
  });

  it("returns an empty list when /api/ps is unreachable", async () => {
    mockFetchStatus(500, "boom");
    await expect(listResidentModels()).resolves.toEqual([]);
  });

  it("unloads every other resident model with keep_alive: 0", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const mock = jest.fn(async (_url: string, init?: RequestInit) => {
      requests.push({
        url: String(_url),
        body: init?.body ? JSON.parse(init.body as string) : {},
      });
      // First call is /api/ps, subsequent are /api/generate unload probes.
      if (String(_url).endsWith("/api/ps")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: [{ model: "gemma3:12b" }, { model: "llama3.2:3b" }],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ model: "llama3.2:3b", done: true }) };
    });
    global.fetch = mock as unknown as typeof fetch;

    await releaseOtherModels("gemma3:12b");

    const generates = requests.filter((r) => r.url.endsWith("/api/generate"));
    expect(generates).toHaveLength(1);
    expect(generates[0].body.model).toBe("llama3.2:3b");
    expect(generates[0].body.keep_alive).toBe(0);
    expect(generates[0].body.prompt).toBe("");
  });

  it("does nothing when the keep-list is already the only resident model", async () => {
    const mock = jest.fn(async (_url: string) => {
      if (String(_url).endsWith("/api/ps")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ models: [{ model: "gemma3:12b" }] }),
        };
      }
      throw new Error("should not generate");
    });
    global.fetch = mock as unknown as typeof fetch;

    await releaseOtherModels("gemma3:12b");
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("swallows release failures so the selected model still serves", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const mock = jest.fn(async (_url: string) => {
      if (String(_url).endsWith("/api/ps")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: [{ model: "gemma3:12b" }, { model: "broken" }],
          }),
        };
      }
      throw new Error("server exploded");
    });
    global.fetch = mock as unknown as typeof fetch;

    await expect(releaseOtherModels("gemma3:12b")).resolves.toBeUndefined();
  });
});
