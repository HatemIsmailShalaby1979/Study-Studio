import {
  LMStudioProvider,
  createLMStudioProvider,
  lmStudioOrigin,
} from "@/lib/ai-runtime/providers/lmStudio";
import { runtimeFetch } from "@/lib/ai-runtime/transport";

// Characterisation tests for the native LM Studio provider.
//
// This is the PRIMARY runtime for the app, and it was the least-tested file in
// the codebase. An earlier note in QA-WORKFLOW.md claimed it "needs the live
// lane, not unit tests" — that was wrong. Most of what is hard-won here is pure
// logic over response *shapes*: which listing API a server speaks, whether an
// entry is an embedding model, how big a context window to ask for. Those are
// exactly the decisions that were made by reading LM Studio's docs and are
// exactly the ones a mock can pin.
//
// Only the transport is mocked. `runtimeFetch` is a thin wrapper over global
// fetch outside Tauri, so stubbing it exercises the provider's real request
// construction — URLs, headers, bodies, timeouts — rather than a paraphrase of it.
//
// The genuinely live-only surface (a real model actually loading) stays in
// lmStudio.live.test.ts, gated behind LMSTUDIO_LIVE=1.

jest.mock("@/lib/ai-runtime/transport", () => ({
  runtimeFetch: jest.fn(),
}));

const mockFetch = runtimeFetch as jest.MockedFunction<typeof runtimeFetch>;

/** A Response whose JSON body is the given value. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function errorResponse(status: number, text = "nope"): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => text,
  } as unknown as Response;
}

/** Route fetch by URL suffix so a test only declares the endpoints it cares about. */
function routeFetch(routes: Record<string, () => Response>) {
  mockFetch.mockImplementation(async (input) => {
    const url = String(input);
    for (const [suffix, make] of Object.entries(routes)) {
      if (url.endsWith(suffix)) return make();
    }
    throw new Error(`unrouted request: ${url}`);
  });
}

/** A native v1 entry with sane defaults. */
function nativeModel(over: Record<string, unknown> = {}) {
  return {
    type: "llm",
    key: "ibm/granite-4-h-tiny",
    display_name: "Granite 4 H Tiny",
    params_string: "4B",
    size_bytes: 4_540_000_000,
    loaded_instances: [],
    max_context_length: 262_144,
    capabilities: { trained_for_tool_use: true },
    ...over,
  };
}

function provider() {
  return new LMStudioProvider({
    descriptor: { id: "lm-studio", name: "LM Studio", description: "", transport: "http" },
    baseUrl: "http://localhost:1234/v1",
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("lmStudioOrigin", () => {
  it("strips the /v1 suffix", () => {
    expect(lmStudioOrigin("http://localhost:1234/v1")).toBe("http://localhost:1234");
  });

  it("strips a trailing slash after /v1", () => {
    expect(lmStudioOrigin("http://localhost:1234/v1/")).toBe("http://localhost:1234");
  });

  it("strips bare trailing slashes", () => {
    expect(lmStudioOrigin("http://localhost:1234///")).toBe("http://localhost:1234");
  });

  it("leaves an origin without /v1 alone", () => {
    expect(lmStudioOrigin("http://localhost:1234")).toBe("http://localhost:1234");
  });

  it("preserves a non-default port", () => {
    expect(lmStudioOrigin("http://127.0.0.1:4321/v1")).toBe("http://127.0.0.1:4321");
  });

  it("only strips a trailing /v1, not one in the middle", () => {
    expect(lmStudioOrigin("http://host/v1/proxy/v1")).toBe("http://host/v1/proxy");
  });
});

describe("LMStudioProvider — health", () => {
  it("reports running and counts models from the v1 listing", async () => {
    routeFetch({
      "/api/v1/models": () =>
        jsonResponse({ models: [nativeModel(), nativeModel({ key: "b", type: "llm" })] }),
    });

    const health = await provider().health();

    expect(health.status).toBe("running");
    expect(health.available).toBe(true);
    expect(health.modelsCount).toBe(2);
  });

  it("names a recommended model rather than returning an empty string", async () => {
    // An empty recommendedModel here silently broke every caller that reads it
    // off health() — the app knew there were models and could not name one.
    routeFetch({ "/api/v1/models": () => jsonResponse({ models: [nativeModel()] }) });

    const health = await provider().health();

    expect(health.recommendedModel).toBe("ibm/granite-4-h-tiny");
  });

  it("treats an empty v1 list as a valid native answer", async () => {
    // LM Studio with nothing downloaded legitimately answers with no models.
    routeFetch({ "/api/v1/models": () => jsonResponse({ models: [] }) });

    const health = await provider().health();

    expect(health.available).toBe(true);
    expect(health.modelsCount).toBe(0);
    expect(health.message).toMatch(/no downloaded models/i);
  });

  it("falls back to the v0 listing for LM Studio 0.3.x", async () => {
    routeFetch({
      "/api/v1/models": () => jsonResponse({ nonsense: true }),
      "/api/v0/models": () =>
        jsonResponse({
          data: [
            { id: "legacy-a", state: "not-loaded", max_context_length: 4096 },
            { id: "legacy-b", state: "loaded", max_context_length: 8192 },
          ],
        }),
    });

    const health = await provider().health();

    expect(health.available).toBe(true);
    expect(health.modelsCount).toBe(2);
    // The loaded one wins.
    expect(health.recommendedModel).toBe("legacy-b");
  });

  it("does not recommend an embedding model from a v0 listing", async () => {
    routeFetch({
      "/api/v1/models": () => jsonResponse({ nonsense: true }),
      "/api/v0/models": () =>
        jsonResponse({
          data: [
            { id: "embed-only", type: "embedding", state: "loaded" },
            { id: "chat-model", type: "llm", state: "not-loaded" },
          ],
        }),
    });

    const health = await provider().health();

    expect(health.recommendedModel).toBe("chat-model");
  });

  it("reports an auth failure rather than a generic offline", async () => {
    routeFetch({
      "/api/v1/models": () => errorResponse(401, "unauthorized"),
      "/api/v0/models": () => errorResponse(404),
      "/v1/models": () => errorResponse(401),
    });

    const health = await provider().health();

    expect(health.available).toBe(false);
    expect(health.message).toMatch(/rejected the request/i);
    expect(health.message).toMatch(/API token/i);
  });

  it("treats 403 the same as 401", async () => {
    routeFetch({
      "/api/v1/models": () => errorResponse(403),
      "/api/v0/models": () => errorResponse(404),
      "/v1/models": () => errorResponse(403),
    });

    const health = await provider().health();

    expect(health.message).toMatch(/rejected the request/i);
  });

  it("does not mistake a wrong-shaped 200 for the native API", async () => {
    // A proxy answering 200 with an OpenAI payload must not be read as
    // "zero models" — that is the silent-failure mode the shape guards prevent.
    routeFetch({
      "/api/v1/models": () => jsonResponse({ object: "list", data: [{ id: "gpt" }] }),
      "/api/v0/models": () => jsonResponse({ object: "list", data: [{ id: "gpt" }] }),
      "/v1/models": () => jsonResponse({ object: "list", data: [{ id: "gpt" }] }),
    });

    const health = await provider().health();

    expect(health.available).toBe(true);
    expect(health.message).toMatch(/native API is unavailable/i);
  });

  it("reports offline when nothing answers", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const health = await provider().health();

    expect(health.available).toBe(false);
  });
});

describe("LMStudioProvider — listModels", () => {
  it("maps native entries onto the provider-agnostic shape", async () => {
    routeFetch({ "/api/v1/models": () => jsonResponse({ models: [nativeModel()] }) });

    const models = await provider().listModels(true);

    expect(models).toEqual([
      {
        id: "ibm/granite-4-h-tiny",
        name: "Granite 4 H Tiny",
        size: "4B",
        loaded: false,
        contextWindow: 262_144,
        supportsTools: true,
      },
    ]);
  });

  it("marks a model loaded only when it has a live instance", async () => {
    routeFetch({
      "/api/v1/models": () =>
        jsonResponse({
          models: [
            nativeModel({ key: "idle", loaded_instances: [] }),
            nativeModel({ key: "busy", loaded_instances: [{ id: "inst-1" }] }),
          ],
        }),
    });

    const models = await provider().listModels(true);

    expect(models.find((m) => m.id === "idle")!.loaded).toBe(false);
    expect(models.find((m) => m.id === "busy")!.loaded).toBe(true);
  });

  it("falls back to a formatted byte size when params are unknown", async () => {
    routeFetch({
      "/api/v1/models": () =>
        jsonResponse({
          models: [
            nativeModel({ params_string: null, size_bytes: 4_540_000_000 }),
            nativeModel({ key: "small", params_string: null, size_bytes: 120_000_000 }),
          ],
        }),
    });

    const models = await provider().listModels(true);

    expect(models.find((m) => m.id === "ibm/granite-4-h-tiny")!.size).toBe("4.2 GB");
    expect(models.find((m) => m.id === "small")!.size).toBe("114 MB");
  });

  it("drops entries with no key", async () => {
    routeFetch({
      "/api/v1/models": () => jsonResponse({ models: [nativeModel(), { display_name: "orphan" }] }),
    });

    const models = await provider().listModels(true);

    expect(models).toHaveLength(1);
  });

  it("serves a repeat call from cache", async () => {
    routeFetch({ "/api/v1/models": () => jsonResponse({ models: [nativeModel()] }) });
    const p = provider();

    await p.listModels();
    await p.listModels();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("refetches when a refresh is forced", async () => {
    routeFetch({ "/api/v1/models": () => jsonResponse({ models: [nativeModel()] }) });
    const p = provider();

    await p.listModels();
    await p.listModels(true);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("maps a v0 listing when v1 is not native", async () => {
    routeFetch({
      "/api/v1/models": () => jsonResponse({ data: [{ id: "x" }] }),
      "/api/v0/models": () =>
        jsonResponse({ data: [{ id: "legacy", quantization: "Q4_K_M", state: "loaded" }] }),
    });

    const models = await provider().listModels(true);

    expect(models).toEqual([
      { id: "legacy", name: "legacy", size: "Q4_K_M", loaded: true, contextWindow: undefined },
    ]);
  });
});

describe("LMStudioProvider — getRecommendedModel", () => {
  it("prefers an already-loaded model over any heuristic", async () => {
    routeFetch({
      "/api/v1/models": () =>
        jsonResponse({
          models: [
            nativeModel({ key: "aaa-big", loaded_instances: [] }),
            nativeModel({ key: "zzz-loaded", loaded_instances: [{ id: "i" }] }),
          ],
        }),
    });

    expect(await provider().getRecommendedModel()).toBe("zzz-loaded");
  });

  it("skips embedding models", async () => {
    routeFetch({
      "/api/v1/models": () =>
        jsonResponse({
          models: [
            nativeModel({ key: "embed", type: "embedding", loaded_instances: [{ id: "i" }] }),
            nativeModel({ key: "chat", type: "llm" }),
          ],
        }),
    });

    expect(await provider().getRecommendedModel()).toBe("chat");
  });

  it("still names something when only an embedding model exists", async () => {
    // Never end up with an empty pool: a machine with only an embedding model
    // should get a name back rather than an exception.
    routeFetch({
      "/api/v1/models": () => jsonResponse({ models: [nativeModel({ key: "embed", type: "embedding" })] }),
    });

    expect(await provider().getRecommendedModel()).toBe("embed");
  });

  it("throws a helpful error when there are no models at all", async () => {
    routeFetch({ "/api/v1/models": () => jsonResponse({ models: [] }) });

    await expect(provider().getRecommendedModel()).rejects.toThrow(/Download one in LM Studio/i);
  });
});

/**
 * Capture the `context_length` the provider asks for during `ensureModel`.
 *
 * `ensureModel` is the app's entry point, so it is the route worth asserting on
 * end to end. `loadModel` now applies the same cap when its caller omits one —
 * see the `LMStudioProvider — loadModel` tests below — but the capping POLICY
 * still lives in `preferredContext`, and `ensureModel` is what wires it to the
 * resolved model id.
 *
 * The listing must also report the model as NOT resident until a load has been
 * POSTed, or `ensureModel` short-circuits and never sends a body to inspect.
 */
async function captureEnsureModelContext(p: LMStudioProvider, models: Record<string, unknown> = {}) {
  let loadCount = 0;
  let sentBody: Record<string, unknown> | undefined;
  mockFetch.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/v1/models/load")) {
      loadCount += 1;
      sentBody = JSON.parse(String(init?.body));
      return jsonResponse({});
    }
    return jsonResponse({
      models: [nativeModel({ ...models, loaded_instances: loadCount > 0 ? [{ id: "i" }] : [] })],
    });
  });
  await p.ensureModel("ibm/granite-4-h-tiny");
  return sentBody;
}

describe("LMStudioProvider — loadModel", () => {
  it("requires a model id", async () => {
    await expect(provider().loadModel("")).rejects.toThrow(/requires a model id/i);
  });

  it("returns immediately when the model is already resident", async () => {
    routeFetch({
      "/api/v1/models": () => jsonResponse({ models: [nativeModel({ loaded_instances: [{ id: "i" }] })] }),
    });

    const result = await provider().loadModel("ibm/granite-4-h-tiny");

    expect(result).toEqual({
      modelId: "ibm/granite-4-h-tiny",
      loaded: true,
      message: "Already loaded.",
    });
  });

  it("explains a 404 as an outdated server rather than a failure", async () => {
    // The 404 is how a pre-0.4.0 server is detected; it must not read as a
    // generic error.
    routeFetch({
      "/api/v1/models": () => jsonResponse({ models: [nativeModel()] }),
      "/api/v1/models/load": () => errorResponse(404),
    });

    await expect(provider().loadModel("ibm/granite-4-h-tiny")).rejects.toThrow(
      /no model-load API/i
    );
  });

  it("tells the user to enable just-in-time loading", async () => {
    routeFetch({
      "/api/v1/models": () => jsonResponse({ models: [nativeModel()] }),
      "/api/v1/models/load": () => errorResponse(404),
    });

    await expect(provider().loadModel("ibm/granite-4-h-tiny")).rejects.toThrow(
      /Just-In-Time model loading/i
    );
  });

  it("reports the load time and context length on success", async () => {
    let loadCount = 0;
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/models/load")) {
        loadCount += 1;
        return jsonResponse({ instance_id: "inst", load_time_seconds: 12.5, load_config: { context_length: 32768 } });
      }
      // Not resident until the load call has happened, then resident.
      return jsonResponse({
        models: [nativeModel({ loaded_instances: loadCount > 0 ? [{ id: "inst" }] : [] })],
      });
    });

    const result = await provider().loadModel("ibm/granite-4-h-tiny", { timeoutMs: 5_000 });

    expect(result.loaded).toBe(true);
    expect(result.loadTimeSeconds).toBe(12.5);
    expect(result.contextLength).toBe(32768);
  });

  it("caps the requested context at 32768 even when the model reports more", async () => {
    // A 1M-token context would allocate a KV cache far larger than any lesson
    // this app generates.
    const sentBody = await captureEnsureModelContext(provider(), { max_context_length: 1_048_576 });

    expect(sentBody!["context_length"]).toBe(32_768);
  });

  it("requests the model's own smaller window when it is below the cap", async () => {
    const sentBody = await captureEnsureModelContext(provider(), { max_context_length: 2048 });

    expect(sentBody!["context_length"]).toBe(2048);
  });

  it("falls back to 16384 when the model reports no context length", async () => {
    const sentBody = await captureEnsureModelContext(provider(), { max_context_length: undefined });

    expect(sentBody!["context_length"]).toBe(16_384);
  });

  it("says so when the load reports success but the model is not resident", async () => {
    routeFetch({
      "/api/v1/models": () => jsonResponse({ models: [nativeModel()] }),
      "/api/v1/models/load": () => jsonResponse({}),
    });

    // timeoutMs 0 makes the deadline lapse on the first poll, so this does not
    // wait 600 seconds or sleep between attempts.
    const result = await provider().loadModel("ibm/granite-4-h-tiny", { timeoutMs: 0 });

    expect(result.loaded).toBe(false);
    expect(result.message).toMatch(/not resident yet/i);
  });

  it("applies the capped default when the caller does not ask for one", async () => {
    // Was a pinned defect. `context_length` used to be sent only when the
    // caller passed one, which made the capping policy reachable only through
    // `ensureModel`: every other caller silently got LM Studio's own default,
    // which is the model's FULL window. A direct `AIRuntime.loadModel(id)`
    // could therefore allocate far more memory than the app budgets, and
    // nothing in the result said which context had been used — so it read as
    // though the cap had been applied. This is the path that had no assertion
    // at all, because the old test asserted the omission.
    let sentBody: Record<string, unknown> | undefined;
    let loadCount = 0;
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/models/load")) {
        loadCount += 1;
        sentBody = JSON.parse(String(init?.body));
        return jsonResponse({});
      }
      return jsonResponse({
        models: [nativeModel({ loaded_instances: loadCount > 0 ? [{ id: "i" }] : [] })],
      });
    });

    await provider().loadModel("ibm/granite-4-h-tiny");

    // nativeModel() reports max_context_length 262144, capped to 32768.
    expect(sentBody).toEqual({
      model: "ibm/granite-4-h-tiny",
      echo_load_config: true,
      context_length: 32_768,
    });
  });

  it("never asks a small model for more context than it reports", async () => {
    // The other half of the default: the cap is a ceiling, not a target. An
    // embedding model reporting 2048 must be loaded with 2048.
    let sentBody: Record<string, unknown> | undefined;
    let loadCount = 0;
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/models/load")) {
        loadCount += 1;
        sentBody = JSON.parse(String(init?.body));
        return jsonResponse({});
      }
      return jsonResponse({
        models: [
          nativeModel({
            max_context_length: 2048,
            loaded_instances: loadCount > 0 ? [{ id: "i" }] : [],
          }),
        ],
      });
    });

    await provider().loadModel("ibm/granite-4-h-tiny");

    expect(sentBody!["context_length"]).toBe(2048);
  });

  it("falls back to the default window when the model reports no maximum", async () => {
    let sentBody: Record<string, unknown> | undefined;
    let loadCount = 0;
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/models/load")) {
        loadCount += 1;
        sentBody = JSON.parse(String(init?.body));
        return jsonResponse({});
      }
      return jsonResponse({
        models: [
          nativeModel({
            max_context_length: undefined,
            loaded_instances: loadCount > 0 ? [{ id: "i" }] : [],
          }),
        ],
      });
    });

    await provider().loadModel("ibm/granite-4-h-tiny");

    expect(sentBody!["context_length"]).toBe(16_384);
  });

  it("passes an explicit context length through when the caller supplies one", async () => {
    let sentBody: Record<string, unknown> | undefined;
    let loadCount = 0;
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/models/load")) {
        loadCount += 1;
        sentBody = JSON.parse(String(init?.body));
        return jsonResponse({});
      }
      return jsonResponse({
        models: [nativeModel({ loaded_instances: loadCount > 0 ? [{ id: "i" }] : [] })],
      });
    });

    await provider().loadModel("ibm/granite-4-h-tiny", { contextLength: 8192, flashAttention: true });

    expect(sentBody!["context_length"]).toBe(8192);
    expect(sentBody!["flash_attention"]).toBe(true);
  });
});

describe("LMStudioProvider — unloadModel", () => {
  it("does nothing when the model is not loaded", async () => {
    routeFetch({ "/api/v1/models": () => jsonResponse({ models: [nativeModel()] }) });

    await provider().unloadModel("ibm/granite-4-h-tiny");

    expect(mockFetch.mock.calls.map((c) => String(c[0])).some((u) => u.endsWith("/unload"))).toBe(
      false
    );
  });

  it("unloads by instance id", async () => {
    let unloaded: unknown;
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/models/unload")) {
        unloaded = JSON.parse(String(init?.body));
        return jsonResponse({});
      }
      return jsonResponse({ models: [nativeModel({ loaded_instances: [{ id: "inst-7" }] })] });
    });

    await provider().unloadModel("ibm/granite-4-h-tiny");

    expect(unloaded).toEqual({ instance_id: "inst-7" });
  });

  it("ignores an empty model id", async () => {
    await provider().unloadModel("");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("LMStudioProvider — isModelLoaded", () => {
  it("is true for a resident model", async () => {
    routeFetch({
      "/api/v1/models": () => jsonResponse({ models: [nativeModel({ loaded_instances: [{ id: "i" }] })] }),
    });

    expect(await provider().isModelLoaded("ibm/granite-4-h-tiny")).toBe(true);
  });

  it("is false for a known but idle model", async () => {
    routeFetch({ "/api/v1/models": () => jsonResponse({ models: [nativeModel()] }) });

    expect(await provider().isModelLoaded("ibm/granite-4-h-tiny")).toBe(false);
  });

  it("is false for a model the server does not have", async () => {
    routeFetch({ "/api/v1/models": () => jsonResponse({ models: [nativeModel()] }) });

    expect(await provider().isModelLoaded("not-installed")).toBe(false);
  });

  it("is undefined when the listing fails", async () => {
    mockFetch.mockRejectedValue(new Error("down"));

    expect(await provider().isModelLoaded("anything")).toBeUndefined();
  });

  it("is undefined once the server is known to lack a load endpoint", async () => {
    routeFetch({
      "/api/v1/models": () => jsonResponse({ models: [nativeModel()] }),
      "/api/v1/models/load": () => errorResponse(404),
    });
    const p = provider();

    // The 404 teaches the provider the endpoint is absent...
    await expect(p.loadModel("ibm/granite-4-h-tiny")).rejects.toThrow();

    // ...after which it stops guessing.
    expect(await p.isModelLoaded("ibm/granite-4-h-tiny")).toBeUndefined();
  });
});

describe("LMStudioProvider — getModelProfile", () => {
  it("returns real metadata from the native listing", async () => {
    routeFetch({ "/api/v1/models": () => jsonResponse({ models: [nativeModel()] }) });
    const p = provider();
    await p.listModels(true);

    expect(await p.getModelProfile("ibm/granite-4-h-tiny")).toEqual({
      id: "ibm/granite-4-h-tiny",
      parameters: "4B",
      contextWindow: 262_144,
      supportsTools: true,
    });
  });

  it("defaults the context window when the model omits it", async () => {
    routeFetch({
      "/api/v1/models": () => jsonResponse({ models: [nativeModel({ max_context_length: undefined })] }),
    });
    const p = provider();
    await p.listModels(true);

    expect((await p.getModelProfile("ibm/granite-4-h-tiny"))!.contextWindow).toBe(8192);
  });
});

describe("LMStudioProvider — ensureModel", () => {
  it("returns the resolved model without loading when already resident", async () => {
    routeFetch({
      "/api/v1/models": () =>
        jsonResponse({
          models: [nativeModel({ loaded_instances: [{ id: "i" }] })],
        }),
    });

    expect(await provider().ensureModel("ibm/granite-4-h-tiny")).toBe("ibm/granite-4-h-tiny");
  });

  it("explains a failed load without pretending model resolution failed", async () => {
    routeFetch({
      "/api/v1/models": () => jsonResponse({ models: [nativeModel()] }),
      "/api/v1/models/load": () => errorResponse(500, "out of memory"),
    });

    await expect(provider().ensureModel("ibm/granite-4-h-tiny")).rejects.toThrow(
      /could not load it into memory/i
    );
  });

  it("suggests a smaller model when the load fails", async () => {
    routeFetch({
      "/api/v1/models": () => jsonResponse({ models: [nativeModel()] }),
      "/api/v1/models/load": () => errorResponse(500, "out of memory"),
    });

    await expect(provider().ensureModel("ibm/granite-4-h-tiny")).rejects.toThrow(
      /pick a smaller model/i
    );
  });
});

describe("createLMStudioProvider", () => {
  it("builds a provider pointed at the default local server", () => {
    const p = createLMStudioProvider();

    expect(p.descriptor.id).toBe("lm-studio");
    expect(p.descriptor.transport).toBe("http");
    expect(p.baseUrl).toBe("http://localhost:1234/v1");
  });
});
