import { AIRuntime } from "@/lib/ai-runtime/runtime";
import { capabilitiesFrom } from "@/lib/ai-runtime/capabilities";
import type { AICapability, AIProvider } from "@/lib/ai-runtime/types";

// Characterisation tests for the AI Runtime — the orchestration layer.
//
// This is the file the architecture rules in MEMORY.md are actually about: the
// runtime owns routing, selection, the session model policy and capability
// dispatch, and "application code never branches on provider identity — it
// branches on supports(...)". That rule is only meaningful if selection and
// capability filtering behave exactly as documented, so those are what these
// tests pin.
//
// The registries, session, config and health monitor are REAL. Only the
// providers are stubs, because they are the I/O boundary. Mocking the
// orchestration internals would mean testing the mock instead of the policy.

type StubProvider = AIProvider & Record<string, jest.Mock>;

function makeProvider(
  id: string,
  capabilities: AICapability[] = ["chat"],
  over: Record<string, unknown> = {}
): StubProvider {
  return {
    descriptor: { id, name: id, description: "", transport: "http" },
    capabilities: jest.fn(() => capabilitiesFrom(capabilities)),
    health: jest.fn().mockResolvedValue({ status: "running", available: true, modelsCount: 1, recommendedModel: "m" }),
    listModels: jest.fn().mockResolvedValue([{ id: "m", name: "m" }]),
    getRecommendedModel: jest.fn().mockResolvedValue("m"),
    ensureModel: jest.fn().mockResolvedValue("m"),
    getModelProfile: jest.fn().mockResolvedValue({ id: "m", parameters: "1B", contextWindow: 4096, supportsTools: false }),
    chat: jest.fn().mockResolvedValue("chat reply"),
    generate: jest.fn().mockResolvedValue("gen reply"),
    ...over,
  } as unknown as StubProvider;
}

/** A runtime with the given providers registered in order. */
function runtimeWith(...providers: AIProvider[]) {
  const runtime = new AIRuntime();
  for (const p of providers) runtime.registerProvider(p);
  return runtime;
}

describe("AIRuntime — registration", () => {
  it("registers and looks up a provider", () => {
    const p = makeProvider("a");
    const runtime = runtimeWith(p);

    expect(runtime.provider("a")).toBe(p);
    expect(runtime.provider("missing")).toBeUndefined();
  });

  it("refuses a duplicate provider id", () => {
    const runtime = runtimeWith(makeProvider("a"));

    expect(() => runtime.registerProvider(makeProvider("a"))).toThrow(/already registered/);
  });
});

describe("AIRuntime — capability query", () => {
  it("reports a capability the provider advertises", () => {
    const runtime = runtimeWith(makeProvider("a", ["chat", "streaming"]));

    expect(runtime.supportsCapability("a", "chat")).toBe(true);
    expect(runtime.supportsCapability("a", "streaming")).toBe(true);
  });

  it("reports false for a capability the provider lacks", () => {
    const runtime = runtimeWith(makeProvider("a", ["chat"]));

    expect(runtime.supportsCapability("a", "embeddings")).toBe(false);
  });

  it("reports false for an unknown provider rather than throwing", () => {
    expect(runtimeWith().supportsCapability("nope", "chat")).toBe(false);
  });

  it("lists providers advertising every required capability", () => {
    const both = makeProvider("both", ["chat", "streaming"]);
    const onlyChat = makeProvider("only-chat", ["chat"]);
    const runtime = runtimeWith(both, onlyChat);

    expect(runtime.providersWithCapability("chat")).toHaveLength(2);
    expect(runtime.providersWithCapability("chat", "streaming")).toEqual([both]);
  });

  it("reports the advertised capability set for the UI", () => {
    const runtime = runtimeWith(makeProvider("a", ["chat", "vision"]));

    expect(runtime.advertisedCapabilities("a")).toEqual(["chat", "vision"]);
  });

  it("reports no advertised capabilities for an unknown provider", () => {
    expect(runtimeWith().advertisedCapabilities("nope")).toEqual([]);
  });
});

describe("AIRuntime — provider selection", () => {
  it("prefers the session provider", () => {
    const a = makeProvider("a");
    const b = makeProvider("b");
    const runtime = runtimeWith(a, b);
    runtime.session.setProvider("b");

    expect(runtime.selectProvider({ requires: ["chat"] })).toBe(b);
  });

  it("falls back to the configured default provider", () => {
    const a = makeProvider("a");
    const b = makeProvider("b");
    const runtime = new AIRuntime({ config: { defaultProviderId: "b" } });
    runtime.registerProvider(a);
    runtime.registerProvider(b);

    expect(runtime.selectProvider({ requires: ["chat"] })).toBe(b);
  });

  it("falls back to the first provider that can do the job", () => {
    const noChat = makeProvider("no-chat", ["embeddings"]);
    const canChat = makeProvider("can-chat", ["chat"]);
    const runtime = runtimeWith(noChat, canChat);

    expect(runtime.selectProvider({ requires: ["chat"] })).toBe(canChat);
  });

  it("ignores a session provider that cannot do the job", () => {
    // The pinned provider must not win when it cannot serve the request; the
    // runtime asks "can this provider do X?" rather than trusting the pin.
    const noChat = makeProvider("no-chat", ["embeddings"]);
    const canChat = makeProvider("can-chat", ["chat"]);
    const runtime = runtimeWith(noChat, canChat);
    runtime.session.setProvider("no-chat");

    expect(runtime.selectProvider({ requires: ["chat"] })).toBe(canChat);
  });

  // The three tests below exist because of a mutation-testing survivor.
  //
  // `every` and `some` are INDISTINGUISHABLE when only one capability is
  // required — a single-element list makes the two identical. Every test above
  // asks for `["chat"]` alone, so flipping `every` to `some` in any of
  // selectProvider's three checks changed nothing observable and survived the
  // whole suite. The distinction only shows up when a provider satisfies a
  // strict SUBSET of a multi-capability request, which is what these pin.
  it("ignores a session provider that satisfies only SOME of the required capabilities", () => {
    const chatOnly = makeProvider("chat-only", ["chat"]);
    const chatAndVision = makeProvider("chat-and-vision", ["chat", "vision"]);
    const runtime = runtimeWith(chatOnly, chatAndVision);
    runtime.session.setProvider("chat-only");

    expect(runtime.selectProvider({ requires: ["chat", "vision"] })).toBe(chatAndVision);
  });

  it("ignores a configured default that satisfies only SOME of the required capabilities", () => {
    const chatOnly = makeProvider("chat-only", ["chat"]);
    const chatAndVision = makeProvider("chat-and-vision", ["chat", "vision"]);
    const runtime = new AIRuntime({ config: { defaultProviderId: "chat-only" } });
    runtime.registerProvider(chatOnly);
    runtime.registerProvider(chatAndVision);

    expect(runtime.selectProvider({ requires: ["chat", "vision"] })).toBe(chatAndVision);
  });

  it("skips a partial match when scanning for the first capable provider", () => {
    const chatOnly = makeProvider("chat-only", ["chat"]);
    const chatAndVision = makeProvider("chat-and-vision", ["chat", "vision"]);
    const runtime = runtimeWith(chatOnly, chatAndVision);

    expect(runtime.selectProvider({ requires: ["chat", "vision"] })).toBe(chatAndVision);
  });

  it("ignores a session provider that is no longer registered", () => {
    const runtime = runtimeWith(makeProvider("a"));
    runtime.session.setProvider("gone");

    expect(runtime.selectProvider({ requires: ["chat"] })).toBe(runtime.provider("a"));
  });

  it("throws when nothing can satisfy the request", () => {
    const runtime = runtimeWith(makeProvider("a", ["embeddings"]));

    expect(() => runtime.selectProvider({ requires: ["chat"] })).toThrow(
      /No AI provider supports the required capability: chat/
    );
  });

  it("names the missing capabilities in the error", () => {
    const runtime = runtimeWith(makeProvider("a", ["chat"]));

    expect(() => runtime.selectProvider({ requires: ["chat", "vision"] })).toThrow(/vision/);
  });

  it("throws when no providers are registered at all", () => {
    expect(() => runtimeWith().selectProvider()).toThrow(/chat/);
  });
});

describe("AIRuntime — resolveProviderId", () => {
  it("prefers the session provider for model operations", async () => {
    const a = makeProvider("a");
    const b = makeProvider("b");
    const runtime = runtimeWith(a, b);
    runtime.session.setProvider("b");

    await runtime.ensureModel();

    expect(b.ensureModel).toHaveBeenCalled();
    expect(a.ensureModel).not.toHaveBeenCalled();
  });

  it("falls back to the configured default", async () => {
    const a = makeProvider("a");
    const b = makeProvider("b");
    const runtime = new AIRuntime({ config: { defaultProviderId: "b" } });
    runtime.registerProvider(a);
    runtime.registerProvider(b);

    await runtime.ensureModel();

    expect(b.ensureModel).toHaveBeenCalled();
  });

  it("falls back to the first registered provider", async () => {
    const a = makeProvider("a");
    const b = makeProvider("b");
    const runtime = runtimeWith(a, b);

    await runtime.ensureModel();

    expect(a.ensureModel).toHaveBeenCalled();
  });
});

describe("AIRuntime — discovery", () => {
  it("reports health, models and a recommendation per provider", async () => {
    const runtime = runtimeWith(makeProvider("a"));

    const [status] = await runtime.discoverAll();

    expect(status).toEqual(
      expect.objectContaining({
        providerId: "a",
        available: true,
        recommendedModel: "m",
      })
    );
    expect(status!.models).toHaveLength(1);
  });

  it("marks a provider unavailable when it has no models", async () => {
    const p = makeProvider("a", ["chat"], { listModels: jest.fn().mockResolvedValue([]) });

    const [status] = await runtimeWith(p).discoverAll();

    expect(status!.available).toBe(false);
    expect(status!.recommendedModel).toBe("");
  });

  it("marks a provider unavailable when its health check fails", async () => {
    const p = makeProvider("a", ["chat"], {
      health: jest.fn().mockRejectedValue(new Error("down")),
    });

    const [status] = await runtimeWith(p).discoverAll();

    expect(status!.available).toBe(false);
    expect(p.listModels).not.toHaveBeenCalled();
  });

  it("survives a listing failure without throwing", async () => {
    const p = makeProvider("a", ["chat"], {
      listModels: jest.fn().mockRejectedValue(new Error("boom")),
    });

    const [status] = await runtimeWith(p).discoverAll();

    expect(status!.available).toBe(false);
    expect(status!.models).toEqual([]);
  });

  it("NOTE — lets a throwing capabilities() escape, despite the never-throws contract", async () => {
    // Characterises a real defect. `discoverAll` documents "Never throws —
    // unavailable providers are reported with `available: false`", and it has a
    // catch block per provider to enforce that. But the catch block itself calls
    // `provider.capabilities()` — the same call that just threw — so the
    // exception escapes and `discoverAll()` rejects.
    //
    // The practical consequence: one misbehaving provider takes down discovery
    // for every other provider, which is exactly what the per-provider catch was
    // written to prevent. Fixing it means defaulting `capabilities` to
    // `noCapabilities()` inside the catch; rewrite this assertion when that
    // happens.
    const p = makeProvider("a");
    (p.capabilities as jest.Mock).mockImplementation(() => {
      throw new Error("capability explosion");
    });

    await expect(runtimeWith(p).discoverAll()).rejects.toThrow(/capability explosion/);
  });

  it("reports a provider as unavailable when only its health check throws", async () => {
    // The contract DOES hold for the failure modes the catch block can handle.
    const p = makeProvider("a", ["chat"], {
      health: jest.fn().mockRejectedValue(new Error("down")),
    });

    const [status] = await runtimeWith(p).discoverAll();

    expect(status!.available).toBe(false);
    expect(status!.capabilities.chat).toBe(true);
  });

  it("discovers every registered provider", async () => {
    const runtime = runtimeWith(makeProvider("a"), makeProvider("b"));

    expect((await runtime.discoverAll()).map((s) => s.providerId)).toEqual(["a", "b"]);
  });
});

describe("AIRuntime — health", () => {
  it("returns an offline snapshot for an unknown provider", async () => {
    const health = await runtimeWith().healthOf("nope");

    expect(health).toEqual({
      status: "offline",
      available: false,
      modelsCount: 0,
      recommendedModel: "",
    });
  });

  it("checks the named provider", async () => {
    const a = makeProvider("a");
    const runtime = runtimeWith(a);

    await runtime.healthOf("a");

    expect(a.health).toHaveBeenCalled();
  });

  it("checks the chat-capable provider for the default health()", async () => {
    const a = makeProvider("a", ["chat"]);
    const runtime = runtimeWith(a);

    await runtime.health();

    expect(a.health).toHaveBeenCalled();
  });

  it("caches a health result within the TTL", async () => {
    const a = makeProvider("a");
    const runtime = runtimeWith(a);

    await runtime.healthOf("a");
    await runtime.healthOf("a");

    expect(a.health).toHaveBeenCalledTimes(1);
  });

  it("reports offline instead of throwing when a health check fails", async () => {
    const p = makeProvider("a", ["chat"], {
      health: jest.fn().mockRejectedValue(new Error("down")),
    });

    expect((await runtimeWith(p).health()).available).toBe(false);
  });

  it("starts the local runtime when the provider supports it", async () => {
    const startRuntime = jest.fn().mockResolvedValue(undefined);
    const runtime = runtimeWith(makeProvider("a", ["chat"], { startRuntime }));

    await runtime.startRuntime();

    expect(startRuntime).toHaveBeenCalled();
  });

  it("does nothing when the provider has no runtime to start", async () => {
    await expect(runtimeWith(makeProvider("a")).startRuntime()).resolves.toBeUndefined();
  });
});

describe("AIRuntime — completions", () => {
  it("routes chat through the selected provider", async () => {
    const a = makeProvider("a");
    const runtime = runtimeWith(a);

    await expect(runtime.chat([{ role: "user", content: "hi" }])).resolves.toBe("chat reply");
    expect(a.chat).toHaveBeenCalledWith([{ role: "user", content: "hi" }], expect.anything(), undefined);
  });

  it("routes generate through the selected provider", async () => {
    const a = makeProvider("a");
    const runtime = runtimeWith(a);

    await expect(runtime.generate("prompt", "system")).resolves.toBe("gen reply");
    expect(a.generate).toHaveBeenCalledWith("prompt", "system", expect.anything(), undefined);
  });

  it("merges config defaults under the caller's options", async () => {
    const a = makeProvider("a");
    const runtime = new AIRuntime({
      config: { defaults: { temperature: 0.2, maxTokens: 1000, keepAlive: "5m", numContext: 4096, topP: 0.8 } },
    });
    runtime.registerProvider(a);

    await runtime.chat([{ role: "user", content: "hi" }], { temperature: 0.9 });

    expect(a.chat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ temperature: 0.9, maxTokens: 1000, keepAlive: "5m" }),
      undefined
    );
  });

  it("lets an explicit option win over the config default", async () => {
    const a = makeProvider("a");
    const runtime = new AIRuntime({ config: { defaults: { maxTokens: 1000 } } });
    runtime.registerProvider(a);

    await runtime.chat([{ role: "user", content: "hi" }], { maxTokens: 250 });

    expect(a.chat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxTokens: 250 }),
      undefined
    );
  });

  it("accepts max_tokens as an alias for maxTokens", async () => {
    const a = makeProvider("a");
    const runtime = runtimeWith(a);

    await runtime.chat([{ role: "user", content: "hi" }], { max_tokens: 300 });

    expect(a.chat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxTokens: 300 }),
      undefined
    );
  });

  it("forwards the model and the abort signal untouched", async () => {
    const a = makeProvider("a");
    const runtime = runtimeWith(a);
    const controller = new AbortController();

    await runtime.chat([{ role: "user", content: "hi" }], { signal: controller.signal }, "pinned");

    expect(a.chat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal: controller.signal }),
      "pinned"
    );
  });

  it("routes streaming through a streaming-capable provider", () => {
    const streamChat = jest.fn().mockReturnValue((async function* () {})());
    const runtime = runtimeWith(makeProvider("a", ["chat", "streaming"], { streamChat }));

    runtime.streamChat([{ role: "user", content: "hi" }]);

    expect(streamChat).toHaveBeenCalled();
  });

  it("throws when the selected provider cannot stream", () => {
    const runtime = runtimeWith(makeProvider("a", ["streaming"]));

    expect(() => runtime.streamChat([{ role: "user", content: "hi" }])).toThrow(
      /does not expose streaming chat/
    );
  });

  it("routes embeddings through an embeddings-capable provider", async () => {
    const embeddings = jest.fn().mockResolvedValue([[1, 2, 3]]);
    const runtime = runtimeWith(makeProvider("a", ["embeddings"], { embeddings }));

    await expect(runtime.embeddings("text")).resolves.toEqual([[1, 2, 3]]);
  });

  it("throws when the selected provider cannot embed", async () => {
    const runtime = runtimeWith(makeProvider("a", ["embeddings"]));

    await expect(runtime.embeddings("text")).rejects.toThrow(/does not expose embeddings/);
  });
});

describe("AIRuntime — models", () => {
  it("lists models for a named provider", async () => {
    const a = makeProvider("a");
    const runtime = runtimeWith(a);

    const models = await runtime.listModels("a");

    expect(models).toHaveLength(1);
    expect(a.listModels).toHaveBeenCalledWith(false);
  });

  it("returns an empty list for an unknown provider", async () => {
    expect(await runtimeWith().listModels("nope")).toEqual([]);
  });

  it("resolves a model and pins it in the session", async () => {
    const a = makeProvider("a", ["chat"], { ensureModel: jest.fn().mockResolvedValue("chosen") });
    const runtime = runtimeWith(a);

    await expect(runtime.ensureModel()).resolves.toBe("chosen");
    expect(runtime.session.getModel()).toBe("chosen");
  });

  it("throws when ensuring a model on an unknown provider", async () => {
    await expect(runtimeWith().ensureModel(undefined, "nope")).rejects.toThrow(
      /No AI provider registered with id "nope"/
    );
  });

  it("recommends a model through the provider", async () => {
    const a = makeProvider("a");

    await expect(runtimeWith(a).getRecommendedModel("a")).resolves.toBe("m");
  });

  it("throws when recommending on an unknown provider", async () => {
    await expect(runtimeWith().getRecommendedModel("nope")).rejects.toThrow(
      /No AI provider registered/
    );
  });

  it("profiles a model through the provider", async () => {
    const runtime = runtimeWith(makeProvider("a"));

    expect(await runtime.getModelProfile("m", "a")).toEqual(
      expect.objectContaining({ id: "m", parameters: "1B" })
    );
  });

  it("returns null when profiling on an unknown provider", async () => {
    expect(await runtimeWith().getModelProfile("m", "nope")).toBeNull();
  });
});

describe("AIRuntime — model lifecycle", () => {
  it("reports model loading support only when the provider can load", () => {
    const canLoad = makeProvider("a", ["chat"], { loadModel: jest.fn() });
    const cannotLoad = makeProvider("b", ["chat"]);

    expect(runtimeWith(canLoad).supportsModelLoading("a")).toBe(true);
    expect(runtimeWith(cannotLoad).supportsModelLoading("b")).toBe(false);
  });

  it("reports no model loading support for an unknown provider", () => {
    expect(runtimeWith().supportsModelLoading("nope")).toBe(false);
  });

  it("reports load state through the provider", async () => {
    const isModelLoaded = jest.fn().mockResolvedValue(true);
    const runtime = runtimeWith(makeProvider("a", ["chat"], { isModelLoaded }));

    expect(await runtime.isModelLoaded("m", "a")).toBe(true);
  });

  it("reports undefined when the provider cannot tell", async () => {
    expect(await runtimeWith(makeProvider("a")).isModelLoaded("m", "a")).toBeUndefined();
  });

  it("loads a model through a capable provider", async () => {
    const loadModel = jest.fn().mockResolvedValue({ modelId: "m", loaded: true });
    const runtime = runtimeWith(makeProvider("a", ["chat"], { loadModel }));

    expect(await runtime.loadModel("m", {}, "a")).toEqual({ modelId: "m", loaded: true });
  });

  it("explains that an incapable provider must be loaded by hand", async () => {
    const runtime = runtimeWith(makeProvider("a"));

    await expect(runtime.loadModel("m", {}, "a")).rejects.toThrow(
      /cannot load models on demand/
    );
  });

  it("throws when loading on an unknown provider", async () => {
    await expect(runtimeWith().loadModel("m", {}, "nope")).rejects.toThrow(
      /No AI provider registered/
    );
  });

  it("unloads through the provider", async () => {
    const unloadModel = jest.fn().mockResolvedValue(undefined);
    const runtime = runtimeWith(makeProvider("a", ["chat"], { unloadModel }));

    await runtime.unloadModel("m", "a");

    expect(unloadModel).toHaveBeenCalledWith("m");
  });

  it("is a no-op when the provider cannot unload", async () => {
    await expect(runtimeWith(makeProvider("a")).unloadModel("m", "a")).resolves.toBeUndefined();
  });

  it("is a no-op when the provider is unknown", async () => {
    await expect(runtimeWith().unloadModel("m", "nope")).resolves.toBeUndefined();
  });
});

describe("AIRuntime — ensureModelLoaded", () => {
  it("resolves and pins the model on a load-on-demand provider", async () => {
    const provider = makeProvider("a", ["chat"], {
      loadModel: jest.fn(),
      ensureModel: jest.fn().mockResolvedValue("loaded-model"),
    });
    const runtime = runtimeWith(provider);

    const result = await runtime.ensureModelLoaded(undefined, "a");

    expect(result).toEqual({ model: "loaded-model", loaded: true });
    expect(runtime.session.getModel()).toBe("loaded-model");
  });

  it("does not claim a load happened on a self-managing provider", async () => {
    // Ollama pulls implicitly and hosted APIs always serve, so the runtime must
    // not imply it loaded anything.
    const runtime = runtimeWith(makeProvider("a", ["chat"]));

    const result = await runtime.ensureModelLoaded(undefined, "a");

    expect(result.loaded).toBe(true);
    expect(result.message).toMatch(/manages its own model lifecycle/);
  });

  it("throws when the provider is unknown", async () => {
    await expect(runtimeWith().ensureModelLoaded(undefined, "nope")).rejects.toThrow(
      /No AI provider registered/
    );
  });

  it("propagates a model resolution failure", async () => {
    const provider = makeProvider("a", ["chat"], {
      ensureModel: jest.fn().mockRejectedValue(new Error("not installed")),
    });

    await expect(runtimeWith(provider).ensureModelLoaded(undefined, "a")).rejects.toThrow(
      /not installed/
    );
  });
});
