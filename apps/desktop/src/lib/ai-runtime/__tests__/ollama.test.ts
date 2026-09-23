import { OllamaProvider } from "@/lib/ai-runtime/providers/ollama";
import * as transport from "@/lib/ollama";
import { isTauri, invokeTauri } from "@/lib/tauri";

// Characterisation tests for the Ollama adapter.
//
// This provider is a thin translation layer, and that is precisely why it needs
// tests: its whole job is mapping between the runtime's vocabulary and Ollama's,
// and a silent mismatch there is invisible until a request behaves oddly. The
// option mapping is the clearest example — the runtime says `maxTokens`, Ollama
// wants `num_predict`, and the adapter sends BOTH.
//
// The transport and the Tauri bridge are mocked; the adapter's own mapping is
// exercised for real.

jest.mock("@/lib/ollama", () => ({
  OLLAMA_URL: "http://localhost:11434",
  checkHealth: jest.fn(),
  listModels: jest.fn(),
  getRecommendedModel: jest.fn(),
  ensureModel: jest.fn(),
  chat: jest.fn(),
  generate: jest.fn(),
  releaseOtherModels: jest.fn().mockResolvedValue(undefined),
  listResidentModels: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/tauri", () => ({
  isTauri: jest.fn(),
  invokeTauri: jest.fn(),
}));

const mockTransport = transport as jest.Mocked<typeof transport>;
const mockIsTauri = isTauri as jest.MockedFunction<typeof isTauri>;
const mockInvoke = invokeTauri as jest.MockedFunction<typeof invokeTauri>;

/** A fetch stub for the browser-mode /api/show path. */
function stubFetch(res: Partial<Response> & { json?: () => Promise<unknown> }) {
  const spy = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    ...res,
  });
  Object.defineProperty(globalThis, "fetch", { writable: true, configurable: true, value: spy });
  return spy;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockIsTauri.mockReturnValue(false);
  mockTransport.checkHealth.mockResolvedValue({
    ollama_available: true,
    models_count: 3,
    model: "llama3.2:3b",
  } as never);
  mockTransport.listModels.mockResolvedValue([]);
  mockTransport.getRecommendedModel.mockResolvedValue("llama3.2:3b");
  mockTransport.ensureModel.mockResolvedValue("llama3.2:3b");
  mockTransport.chat.mockResolvedValue("reply");
  mockTransport.generate.mockResolvedValue("generated");
  mockTransport.releaseOtherModels.mockResolvedValue(undefined);
  mockTransport.listResidentModels.mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("OllamaProvider — descriptor and capabilities", () => {
  it("identifies itself as the Ollama provider", () => {
    const p = new OllamaProvider();

    expect(p.descriptor.id).toBe("ollama");
    expect(p.descriptor.transport).toBe("tauri");
  });

  it("advertises chat, structured output and streaming", () => {
    expect(new OllamaProvider().capabilities()).toEqual(
      expect.objectContaining({ chat: true, structuredOutput: true, streaming: true })
    );
  });
});

describe("OllamaProvider — health", () => {
  it("reports running when Ollama answers", async () => {
    const health = await new OllamaProvider().health();

    expect(health.status).toBe("running");
    expect(health.available).toBe(true);
    expect(health.modelsCount).toBe(3);
    expect(health.recommendedModel).toBe("llama3.2:3b");
  });

  it("reports offline when Ollama is not running", async () => {
    mockTransport.checkHealth.mockResolvedValue({
      ollama_available: false,
      models_count: 0,
      model: "",
    } as never);

    const health = await new OllamaProvider().health();

    expect(health.status).toBe("offline");
    expect(health.available).toBe(false);
  });

  it("reports offline instead of throwing when the probe fails", async () => {
    mockTransport.checkHealth.mockRejectedValue(new Error("ECONNREFUSED"));

    const health = await new OllamaProvider().health();

    expect(health).toEqual({
      status: "offline",
      available: false,
      modelsCount: 0,
      recommendedModel: "",
    });
  });
});

describe("OllamaProvider — models", () => {
  it("maps the transport's model shape", async () => {
    mockTransport.listModels.mockResolvedValue([
      { id: "llama3.2:3b", name: "llama3.2:3b", size: "2 GB", loaded: true },
    ] as never);

    const models = await new OllamaProvider().listModels();

    expect(models).toEqual([
      { id: "llama3.2:3b", name: "llama3.2:3b", size: "2 GB", loaded: true },
    ]);
  });

  it("passes the refresh flag through", async () => {
    await new OllamaProvider().listModels(true);
    expect(mockTransport.listModels).toHaveBeenCalledWith(true);
  });

  it("defaults to a non-refreshing listing", async () => {
    await new OllamaProvider().listModels();
    expect(mockTransport.listModels).toHaveBeenCalledWith(false);
  });

  it("fills in missing size and loaded when recommending from a partial list", async () => {
    // AIModel's size/loaded are optional but OllamaModelInfo's are not, so the
    // adapter has to supply defaults rather than pass undefined through.
    await new OllamaProvider().getRecommendedModel([{ id: "m", name: "m" }]);

    expect(mockTransport.getRecommendedModel).toHaveBeenCalledWith([
      { id: "m", name: "m", size: "", loaded: false },
    ]);
  });

  it("delegates the recommendation to the transport when given a list", async () => {
    await new OllamaProvider().getRecommendedModel([{ id: "a", name: "a", loaded: true }]);
    expect(mockTransport.getRecommendedModel).toHaveBeenCalledTimes(1);
  });

  it("delegates the recommendation without a list", async () => {
    await new OllamaProvider().getRecommendedModel();

    expect(mockTransport.getRecommendedModel).toHaveBeenCalledWith();
  });

  it("delegates model resolution and releases other resident models", async () => {
    await new OllamaProvider().ensureModel("llama3.2:3b");
    expect(mockTransport.ensureModel).toHaveBeenCalledWith("llama3.2:3b");
    // One-model-per-provider: whatever else was resident is unloaded.
    expect(mockTransport.releaseOtherModels).toHaveBeenCalledWith("llama3.2:3b");
  });
});

describe("OllamaProvider — discover", () => {
  it("is available only when models are actually present", async () => {
    mockTransport.listModels.mockResolvedValue([
      { id: "m", name: "m", size: "1 GB", loaded: false },
    ] as never);

    const status = await new OllamaProvider().discover();

    expect(status.available).toBe(true);
    expect(status.models).toHaveLength(1);
    expect(status.recommendedModel).toBe("llama3.2:3b");
  });

  it("is unavailable when the server runs but has no models", async () => {
    mockTransport.listModels.mockResolvedValue([] as never);

    const status = await new OllamaProvider().discover();

    expect(status.available).toBe(false);
    expect(status.recommendedModel).toBe("");
  });

  it("is unavailable when the server is down", async () => {
    mockTransport.checkHealth.mockResolvedValue({
      ollama_available: false,
      models_count: 0,
      model: "",
    } as never);

    const status = await new OllamaProvider().discover();

    expect(status.available).toBe(false);
    expect(mockTransport.listModels).not.toHaveBeenCalled();
  });

  it("survives a listing failure without throwing", async () => {
    mockTransport.listModels.mockRejectedValue(new Error("boom"));

    const status = await new OllamaProvider().discover();

    expect(status.available).toBe(false);
    expect(status.models).toEqual([]);
  });
});

describe("OllamaProvider — option mapping", () => {
  it("collapses maxTokens onto Ollama's num_predict", async () => {
    // The runtime says maxTokens; Ollama wants num_predict. The adapter sends
    // both so either vocabulary works.
    await new OllamaProvider().chat([{ role: "user", content: "hi" }], { maxTokens: 512 });

    expect(mockTransport.chat).toHaveBeenCalledWith(
      [{ role: "user", content: "hi" }],
      expect.objectContaining({ num_predict: 512, max_tokens: 512 }),
      undefined,
      undefined
    );
  });

  it("accepts max_tokens as an alias", async () => {
    await new OllamaProvider().chat([{ role: "user", content: "hi" }], { max_tokens: 256 });

    expect(mockTransport.chat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ num_predict: 256, max_tokens: 256 }),
      undefined,
      undefined
    );
  });

  it("maps the remaining option names to Ollama's snake_case", async () => {
    await new OllamaProvider().chat([{ role: "user", content: "hi" }], {
      temperature: 0.5,
      topP: 0.9,
      numContext: 8192,
      numGpu: 4,
      keepAlive: "5m",
    });

    expect(mockTransport.chat).toHaveBeenCalledWith(
      expect.anything(),
      {
        temperature: 0.5,
        top_p: 0.9,
        num_predict: undefined,
        max_tokens: undefined,
        num_ctx: 8192,
        num_gpu: 4,
        keep_alive: "5m",
        format: undefined,
      },
      undefined,
      undefined
    );
  });

  it("passes a JSON schema through as the format", async () => {
    const format = { type: "object", properties: {} };
    await new OllamaProvider().chat([{ role: "user", content: "hi" }], { format });

    expect(mockTransport.chat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ format }),
      undefined,
      undefined
    );
  });

  it("sends an empty option object when none are given", async () => {
    await new OllamaProvider().chat([{ role: "user", content: "hi" }]);

    expect(mockTransport.chat).toHaveBeenCalledWith(
      expect.anything(),
      {},
      undefined,
      undefined
    );
  });

  it("strips extra fields from messages", async () => {
    await new OllamaProvider().chat([
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
    ]);

    expect(mockTransport.chat).toHaveBeenCalledWith(
      [
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
      ],
      expect.anything(),
      undefined,
      undefined
    );
  });

  it("forwards the model and the abort signal", async () => {
    const controller = new AbortController();
    await new OllamaProvider().chat([{ role: "user", content: "hi" }], {
      model: undefined,
      signal: controller.signal,
    } as never, "llama3.2:3b");

    expect(mockTransport.chat).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "llama3.2:3b",
      controller.signal
    );
  });

  it("maps options for generate too", async () => {
    await new OllamaProvider().generate("prompt", "system", { maxTokens: 100 }, "m");

    expect(mockTransport.generate).toHaveBeenCalledWith(
      "prompt",
      "system",
      expect.objectContaining({ num_predict: 100 }),
      "m",
      undefined
    );
  });

  // Reasoning budget: Ollama models that advertise `thinking` spend tokens from
  // the same `num_predict` budget on reasoning first. A 512-token title request
  // then comes back with empty `content`, which the structured-output path
  // reports as "Unexpected end of JSON input". The runtime's answer is
  // `reasoningEffort: "none"`; Ollama's answer is the TOP-LEVEL `think: false`
  // field (not an option inside `options`). Without this mapping the podcast
  // defect was unreachable from the Ollama path.
  it("maps reasoningEffort: none onto Ollama's top-level think: false", async () => {
    await new OllamaProvider().chat([{ role: "user", content: "hi" }], {
      reasoningEffort: "none",
    });

    expect(mockTransport.chat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ think: false }),
      undefined,
      undefined
    );
  });

  it("does not set think when reasoningEffort is not none", async () => {
    await new OllamaProvider().chat([{ role: "user", content: "hi" }], {
      reasoningEffort: "low",
    });

    const options = mockTransport.chat.mock.calls[0]![1];
    expect(options).not.toHaveProperty("think");
  });

  it("does not set think when reasoningEffort is omitted", async () => {
    await new OllamaProvider().chat([{ role: "user", content: "hi" }], { maxTokens: 10 });

    const options = mockTransport.chat.mock.calls[0]![1];
    expect(options).not.toHaveProperty("think");
  });

  it("maps reasoningEffort: none for generate too", async () => {
    await new OllamaProvider().generate("prompt", "system", { reasoningEffort: "none" }, "m");

    expect(mockTransport.generate).toHaveBeenCalledWith(
      "prompt",
      "system",
      expect.objectContaining({ think: false }),
      "m",
      undefined
    );
  });
});

describe("OllamaProvider — model profile (browser mode)", () => {
  it("reads parameters and context window from /api/show", async () => {
    stubFetch({
      json: async () => ({
        details: { parameters: "8B" },
        model_info: { "llama.context_length": 131072 },
      }),
    });

    const profile = await new OllamaProvider().getModelProfile("llama3.2:3b");

    expect(profile).toEqual({
      id: "llama3.2:3b",
      parameters: "8B",
      contextWindow: 131072,
      supportsTools: true,
    });
  });

  it("falls back to a top-level parameters field", async () => {
    stubFetch({ json: async () => ({ parameters: "7B", model_info: {} }) });

    expect((await new OllamaProvider().getModelProfile("m"))!.parameters).toBe("7B");
  });

  it("uses the fallback context window when Ollama omits one", async () => {
    stubFetch({ json: async () => ({ details: {}, model_info: {} }) });

    expect((await new OllamaProvider().getModelProfile("m"))!.contextWindow).toBe(8192);
  });

  it("ignores a non-numeric context window", async () => {
    stubFetch({ json: async () => ({ model_info: { "llama.context_length": "lots" } }) });

    expect((await new OllamaProvider().getModelProfile("m"))!.contextWindow).toBe(8192);
  });

  it("marks a known tool-capable model as supporting tools", async () => {
    stubFetch({ json: async () => ({}) });

    expect((await new OllamaProvider().getModelProfile("qwen2.5:7b"))!.supportsTools).toBe(true);
  });

  it("does not claim tool support for an unknown model", async () => {
    stubFetch({ json: async () => ({}) });

    expect((await new OllamaProvider().getModelProfile("mystery-model"))!.supportsTools).toBe(
      false
    );
  });

  it("returns null on a non-ok response", async () => {
    stubFetch({ ok: false, status: 404 });

    expect(await new OllamaProvider().getModelProfile("m")).toBeNull();
  });

  it("returns null instead of throwing when the fetch fails", async () => {
    Object.defineProperty(globalThis, "fetch", {
      writable: true,
      configurable: true,
      value: jest.fn().mockRejectedValue(new Error("down")),
    });

    expect(await new OllamaProvider().getModelProfile("m")).toBeNull();
  });

  it("posts the model name and asks for verbose detail", async () => {
    const spy = stubFetch({ json: async () => ({}) });

    await new OllamaProvider().getModelProfile("llama3.2:3b");

    expect(spy).toHaveBeenCalledWith(
      "http://localhost:11434/api/show",
      expect.objectContaining({ method: "POST" })
    );
    expect(JSON.parse(spy.mock.calls[0]![1].body)).toEqual({
      name: "llama3.2:3b",
      verbose: true,
    });
  });
});

describe("OllamaProvider — model profile (desktop mode)", () => {
  it("uses the Tauri command when running in the shell", async () => {
    mockIsTauri.mockReturnValue(true);
    mockInvoke.mockResolvedValue({
      name: "llama3.2:3b",
      parameters: "3B",
      context_window: 131072,
      supports_tools: true,
    } as never);

    const profile = await new OllamaProvider().getModelProfile("llama3.2:3b");

    expect(mockInvoke).toHaveBeenCalledWith("model_profile", { modelName: "llama3.2:3b" });
    expect(profile).toEqual({
      id: "llama3.2:3b",
      parameters: "3B",
      contextWindow: 131072,
      supportsTools: true,
    });
  });

  it("returns null when the command reports no profile", async () => {
    mockIsTauri.mockReturnValue(true);
    mockInvoke.mockResolvedValue(null as never);

    expect(await new OllamaProvider().getModelProfile("m")).toBeNull();
  });

  it("does not fall back to fetch when the Tauri command fails", async () => {
    // Profiling is best-effort; a failure must not turn into a second, slower
    // attempt against a server the shell may not be able to reach.
    mockIsTauri.mockReturnValue(true);
    mockInvoke.mockRejectedValue(new Error("command failed"));
    const fetchSpy = stubFetch({});

    expect(await new OllamaProvider().getModelProfile("m")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("OllamaProvider — runtime lifecycle", () => {
  it("does nothing outside the desktop shell", async () => {
    await new OllamaProvider().startRuntime();
    await new OllamaProvider().pullModel("llama3.2:3b");

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("starts the server through the backend", async () => {
    mockIsTauri.mockReturnValue(true);
    mockInvoke.mockResolvedValue("started" as never);

    await new OllamaProvider().startRuntime();

    expect(mockInvoke).toHaveBeenCalledWith("start_ollama_if_needed");
  });

  it("does not throw when starting the server fails", async () => {
    // A failure to start is not fatal: the health check reports the truth.
    mockIsTauri.mockReturnValue(true);
    mockInvoke.mockRejectedValue(new Error("no binary"));

    await expect(new OllamaProvider().startRuntime()).resolves.toBeUndefined();
  });

  it("pulls a model through the backend", async () => {
    mockIsTauri.mockReturnValue(true);
    mockInvoke.mockResolvedValue("pulled" as never);

    await new OllamaProvider().pullModel("llama3.2:3b");

    expect(mockInvoke).toHaveBeenCalledWith("pull_model", { modelName: "llama3.2:3b" });
  });
});
