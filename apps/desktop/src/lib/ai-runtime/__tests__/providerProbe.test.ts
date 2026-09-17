import {
  probeLocalProviders,
  detectLocalProviderIds,
  validateOnlineProvider,
} from "@/lib/ai-runtime/providerProbe";
import { runtimeFetch } from "@/lib/ai-runtime/transport";
import type { AIRuntime } from "@/lib/ai-runtime/runtime";
import type { AIProvider } from "@/lib/ai-runtime/types";

// Characterisation tests for provider auto-detection.
//
// This module runs on app mount, before any provider is wired up, and its whole
// contract is "never throw, never block navigation". Every failure mode has to
// degrade to `available: false` / `valid: false` rather than an exception, so
// each of those degradations is pinned here.
//
// The probe is endpoint-driven, not name-driven: it asks "what is alive?" and
// reports whatever answers. That means the endpoint catalog and the
// any-URL-answers rule are the load-bearing parts.

jest.mock("@/lib/ai-runtime/transport", () => ({ runtimeFetch: jest.fn() }));

const mockFetch = runtimeFetch as jest.MockedFunction<typeof runtimeFetch>;

/** Answer only the given URLs with 200; everything else rejects. */
function onlyUp(urls: string[]) {
  mockFetch.mockImplementation(async (input) => {
    const url = String(input);
    if (urls.includes(url)) return { ok: true, status: 200 } as Response;
    throw new Error("ECONNREFUSED");
  });
}

const OLLAMA = "http://localhost:11434/api/tags";
const LMSTUDIO_NATIVE = "http://localhost:1234/api/v1/models";
const LMSTUDIO_V1 = "http://localhost:1234/v1/models";

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
});

describe("probeLocalProviders", () => {
  it("reports a target up when its liveness endpoint answers", async () => {
    onlyUp([OLLAMA]);

    const results = await probeLocalProviders();
    const ollama = results.find((r) => r.id === "ollama")!;

    expect(ollama.available).toBe(true);
  });

  it("reports a target down when nothing answers", async () => {
    const results = await probeLocalProviders();

    expect(results.find((r) => r.id === "ollama")!.available).toBe(false);
    expect(results.find((r) => r.id === "vllm")!.available).toBe(false);
  });

  it("treats a target as up when any one of its candidate URLs answers", async () => {
    // LM Studio may expose either its native API or only the OpenAI-compatible
    // surface depending on how it is proxied.
    onlyUp([LMSTUDIO_V1]);

    const results = await probeLocalProviders();

    expect(results.find((r) => r.id === "lm-studio")!.available).toBe(true);
  });

  it("prefers the first answering URL when several do", async () => {
    onlyUp([LMSTUDIO_NATIVE, LMSTUDIO_V1]);

    const results = await probeLocalProviders();
    const lmStudio = results.find((r) => r.id === "lm-studio")!;

    expect(lmStudio.message).toContain("1234");
  });

  it("treats a non-2xx response as down", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 } as Response);

    const results = await probeLocalProviders();

    expect(results.find((r) => r.id === "ollama")!.available).toBe(false);
  });

  it("never throws when every endpoint rejects", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));

    await expect(probeLocalProviders()).resolves.toBeInstanceOf(Array);
  });

  it("names the reachable origin in the message", async () => {
    onlyUp([OLLAMA]);

    const results = await probeLocalProviders();

    expect(results.find((r) => r.id === "ollama")!.message).toBe(
      "Reachable at http://localhost:11434"
    );
  });

  it("NOTE — leaves a stray /api on the LM Studio native URL", async () => {
    // Characterises a cosmetic bug. The message strips `/v1/models` or
    // `/api/tags`, but LM Studio's native liveness URL is
    // `http://localhost:1234/api/v1/models` — stripping only the `/v1/models`
    // tail leaves `http://localhost:1234/api`, so the UI advertises a URL with a
    // meaningless trailing `/api`. The origin is `http://localhost:1234`.
    // Rewrite this assertion if the stripper is fixed to normalise to an origin.
    onlyUp([LMSTUDIO_NATIVE]);

    const results = await probeLocalProviders();

    expect(results.find((r) => r.id === "lm-studio")!.message).toBe(
      "Reachable at http://localhost:1234/api"
    );
  });

  it("omits the message when the target is down", async () => {
    const results = await probeLocalProviders();

    expect(results.find((r) => r.id === "ollama")!.message).toBeUndefined();
  });

  it("always lists the online providers so the UI can prompt for a key", async () => {
    const results = await probeLocalProviders();

    const openai = results.find((r) => r.id === "openai")!;
    const openrouter = results.find((r) => r.id === "openrouter")!;

    expect(openai.available).toBe(false);
    expect(openai.message).toBe("Requires an API key");
    expect(openrouter.available).toBe(false);
  });

  it("does not let the local scan decide online availability", async () => {
    onlyUp([OLLAMA]);

    const results = await probeLocalProviders();

    expect(results.filter((r) => r.available).map((r) => r.id)).toEqual(["ollama"]);
  });

  it("probes every endpoint, in parallel", async () => {
    onlyUp([OLLAMA]);
    const before = mockFetch.mock.calls.length;

    await probeLocalProviders();

    // Ollama 1 + LM Studio 2 + LocalAI 2 + vLLM 1 + LiteLLM 1 + FastChat 2 = 9.
    expect(mockFetch.mock.calls.length - before).toBe(9);
  });

  it("covers the documented local runtimes", async () => {
    const ids = (await probeLocalProviders()).map((r) => r.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "ollama",
        "lm-studio",
        "localai",
        "vllm",
        "litellm",
        "fastchat",
      ])
    );
  });
});

describe("detectLocalProviderIds", () => {
  it("returns only the ids that answered", async () => {
    onlyUp([OLLAMA, "http://localhost:8000/v1/models"]);

    const ids = await detectLocalProviderIds();

    expect(ids).toEqual(expect.arrayContaining(["ollama"]));
    expect(ids).not.toContain("litellm");
  });

  it("returns an empty array when nothing local is running", async () => {
    expect(await detectLocalProviderIds()).toEqual([]);
  });

  it("never throws", async () => {
    mockFetch.mockRejectedValue(new Error("boom"));

    await expect(detectLocalProviderIds()).resolves.toEqual([]);
  });
});

describe("validateOnlineProvider", () => {
  /** A runtime stub whose provider registry returns the given provider. */
  function runtimeWith(provider: AIProvider | undefined) {
    return { providers: { get: () => provider } } as unknown as AIRuntime;
  }

  function onlineProvider(over: Partial<Record<string, unknown>> = {}) {
    return {
      descriptor: { id: "openai", name: "OpenAI", description: "", transport: "http" },
      setApiKey: jest.fn(),
      health: jest.fn().mockResolvedValue({ available: true }),
      listModels: jest.fn().mockResolvedValue([]),
      ...over,
    } as unknown as AIProvider & { setApiKey: jest.Mock; health: jest.Mock };
  }

  it("rejects an unknown provider id", async () => {
    const result = await validateOnlineProvider(runtimeWith(undefined), "nope", "sk");

    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/Unknown provider "nope"/);
  });

  it("rejects a provider that does not take a key", async () => {
    const provider = onlineProvider({ setApiKey: undefined });

    const result = await validateOnlineProvider(runtimeWith(provider), "ollama", "sk");

    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/does not use an API key/);
  });

  it("accepts a key that lists models, and reports the count", async () => {
    const provider = onlineProvider({
      listModels: jest.fn().mockResolvedValue([{ id: "gpt-4o", name: "gpt-4o" }]),
    });

    const result = await validateOnlineProvider(runtimeWith(provider), "openai", "sk-good");

    expect(result.valid).toBe(true);
    expect(result.message).toBe("1 models available");
    expect(result.models).toHaveLength(1);
  });

  it("applies the candidate key in memory before checking", async () => {
    // The caller persists only on success, so the key must be injected first.
    const provider = onlineProvider();

    await validateOnlineProvider(runtimeWith(provider), "openai", "sk-candidate");

    expect(provider.setApiKey).toHaveBeenCalledWith("sk-candidate");
  });

  it("rejects a key the server refuses, using the server's own message", async () => {
    const provider = onlineProvider({
      health: jest.fn().mockResolvedValue({ available: false, message: "Incorrect API key" }),
    });

    const result = await validateOnlineProvider(runtimeWith(provider), "openai", "sk-bad");

    expect(result.valid).toBe(false);
    expect(result.message).toBe("Incorrect API key");
  });

  it("supplies a friendly message when the server gives none", async () => {
    const provider = onlineProvider({
      health: jest.fn().mockResolvedValue({ available: false }),
    });

    const result = await validateOnlineProvider(runtimeWith(provider), "openai", "sk-bad");

    expect(result.message).toMatch(/didn't work/i);
  });

  it("still accepts the key when health passes but listing fails", async () => {
    // A key can be valid while the model list endpoint is flaky; refusing it
    // would lock the user out of a working configuration.
    const provider = onlineProvider({
      listModels: jest.fn().mockRejectedValue(new Error("listing unavailable")),
    });

    const result = await validateOnlineProvider(runtimeWith(provider), "openai", "sk-good");

    expect(result.valid).toBe(true);
    expect(result.models).toEqual([]);
    expect(result.message).toBe("Connected");
  });

  it("reports a friendly failure when health itself throws", async () => {
    const provider = onlineProvider({
      health: jest.fn().mockRejectedValue(new Error("socket hang up")),
    });

    const result = await validateOnlineProvider(runtimeWith(provider), "openai", "sk");

    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/didn't work/i);
  });

  it("reports a friendly failure when the key cannot be applied", async () => {
    const provider = onlineProvider({
      setApiKey: jest.fn().mockImplementation(() => {
        throw new Error("bad key object");
      }),
    });

    const result = await validateOnlineProvider(runtimeWith(provider), "openai", "sk");

    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/Could not apply the API key/);
  });

  it("never throws, whatever the provider does", async () => {
    const provider = onlineProvider({
      health: jest.fn().mockRejectedValue("a string, not an Error"),
    });

    await expect(validateOnlineProvider(runtimeWith(provider), "openai", "sk")).resolves.toEqual(
      expect.objectContaining({ valid: false })
    );
  });
});
