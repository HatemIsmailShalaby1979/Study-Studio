/**
 * @jest-environment node
 */
//
// Live integration test against a real LM Studio server.
//
// The `node` environment above is required, not cosmetic: the default jsdom
// environment in this project does not expose a global `fetch`, and
// `runtimeFetch` falls back to the native fetch outside Tauri. Under jsdom this
// file fails with "ReferenceError: fetch is not defined" before it reaches the
// network at all.
//
// Opt-in, because it needs a running server and real models:
//
//   LMSTUDIO_LIVE=1                                        # list/profile/state
//   LMSTUDIO_LIVE=1 LMSTUDIO_LIVE_MODEL=<model-key>        # + load/unload cycle
//
// Why this file exists: every unit test mocks the HTTP layer, so the native
// endpoint contract is never actually exercised. The entire point of this
// provider is that it can take a *downloaded but unloaded* model and make it
// resident — if that endpoint's shape or status codes are wrong, the mocks
// cannot tell us. This file can.
//
// Without the env var it asserts the gate and exits, so CI stays hermetic and
// lint-clean (no disabled tests, no assertion-free tests).

import { createLMStudioProvider } from "@/lib/ai-runtime/providers/lmStudio";

const RUN = process.env["LMSTUDIO_LIVE"] === "1";
const LOAD_MODEL = process.env["LMSTUDIO_LIVE_MODEL"] ?? "";
// Deliberately small: the point is to prove the load path, not to benchmark.
// Context length drives KV-cache allocation, so keeping it low keeps the test
// light on memory.
const LOAD_CONTEXT = Number(process.env["LMSTUDIO_LIVE_CONTEXT"] ?? 4096);

describe("LM Studio provider — live server", () => {
  if (!RUN) {
    test("is opt-in via LMSTUDIO_LIVE=1", () => {
      expect(process.env["LMSTUDIO_LIVE"]).not.toBe("1");
    });
    return;
  }

  jest.setTimeout(240_000);

  const provider = createLMStudioProvider();

  it("reports healthy against the live server", async () => {
    const health = await provider.health();
    expect(health.status).toBe("running");
    expect(health.available).toBe(true);
    expect(health.modelsCount).toBeGreaterThan(0);
    expect(health.recommendedModel.length).toBeGreaterThan(0);
  });

  it("lists downloaded models using the native listing", async () => {
    const models = await provider.listModels(true);
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(typeof m.id).toBe("string");
      expect(m.id.length).toBeGreaterThan(0);
    }
  });

  it("knows the load state of every model (the /v1 listing cannot tell you this)", async () => {
    const models = await provider.listModels(true);
    // `undefined` means "this provider cannot tell" — for the native listing
    // that would be a bug, because loaded_instances is always present.
    for (const m of models) {
      expect(m.loaded).not.toBeUndefined();
      expect(typeof m.loaded).toBe("boolean");
    }
  });

  it("exposes load state through discover() — the exact path the Settings UI reads", async () => {
    // Settings renders its Loaded/Downloaded badge from
    // providerStatuses[].models[].loaded, which comes from discover(). If this
    // stops carrying `loaded`, the badge silently disappears rather than
    // failing loudly — so it is asserted here.
    const status = await provider.discover();
    expect(status.available).toBe(true);
    expect(status.models.length).toBeGreaterThan(0);
    for (const m of status.models) {
      expect(typeof m.loaded).toBe("boolean");
    }
  });

  it("reads a real context window and tool-use support from the native profile", async () => {
    const models = await provider.listModels(true);
    const withContext = models.find((m) => typeof m.contextWindow === "number");
    expect(withContext).toBeDefined();

    const profile = await provider.getModelProfile(withContext!.id);
    expect(profile).not.toBeNull();
    expect(profile!.contextWindow).toBeGreaterThan(0);
    // The old /v1-only path always returned null here, which silently turned
    // validateModelForTask's suitability gate into a no-op (AUDIT.md P3).
    expect(typeof profile!.supportsTools).toBe("boolean");
  });

  it("recommends a real model, preferring one that is already resident", async () => {
    const models = await provider.listModels(true);
    const recommended = await provider.getRecommendedModel(models);

    // Always true, on any machine: the recommendation names a model that exists.
    expect(models.map((m) => m.id)).toContain(recommended);

    // Written as one unconditional assertion rather than an if/else, so it does
    // not depend on whether anything happens to be loaded right now (and so
    // jest/no-conditional-expect stays happy). When nothing is resident the
    // candidate set is every model; when something is, it must be the winner.
    const loadedIds = models.filter((m) => m.loaded === true).map((m) => m.id);
    const expected = loadedIds.length > 0 ? loadedIds : models.map((m) => m.id);
    expect(expected).toContain(recommended);
  });

  it("never recommends an embedding-only model for generation", async () => {
    // /api/v1/models returns embedding models alongside LLMs, and recommending
    // one would fail at generation time. This asserts the filter actually
    // works against a machine that has one.
    const res = await fetch("http://localhost:1234/api/v1/models");
    const raw = (await res.json()) as { models?: { key?: string; type?: string }[] };
    const embeddingIds = (raw.models ?? [])
      .filter((m) => m.type === "embedding")
      .map((m) => m.key ?? "");

    const models = await provider.listModels(true);
    const recommended = await provider.getRecommendedModel(models);

    expect(embeddingIds.length).toBeGreaterThan(0);
    expect(embeddingIds).not.toContain(recommended);
  });

  describe("load cycle", () => {
    if (!LOAD_MODEL) {
      test("needs LMSTUDIO_LIVE_MODEL to exercise load/unload", () => {
        // Set LMSTUDIO_LIVE_MODEL to a downloaded model key, e.g.
        // ibm/granite-4-h-tiny
        expect(LOAD_MODEL).toBe("");
      });
      return;
    }

    afterAll(async () => {
      // Always leave the machine as we found it — never leave a model resident
      // that we loaded for a test.
      await provider.unloadModel(LOAD_MODEL).catch(() => {});
    });

    it("starts from an unloaded state", async () => {
      await provider.unloadModel(LOAD_MODEL).catch(() => {});
      expect(await provider.isModelLoaded(LOAD_MODEL)).toBe(false);
    });

    it("ensureModel() loads a downloaded-but-unloaded model — the core requirement", async () => {
      // This is exactly the user-facing promise: pick a model from the
      // dropdown, and the app makes it resident without the user touching the
      // LM Studio UI first.
      const resolved = await provider.ensureModel(LOAD_MODEL);
      expect(resolved).toBe(LOAD_MODEL);
      expect(await provider.isModelLoaded(LOAD_MODEL)).toBe(true);
    });

    it("is idempotent — loading an already-resident model is a no-op", async () => {
      const result = await provider.loadModel(LOAD_MODEL, {
        contextLength: LOAD_CONTEXT,
      });
      expect(result.loaded).toBe(true);
      expect(await provider.isModelLoaded(LOAD_MODEL)).toBe(true);
    });

    it("unloads, and reports the model as unloaded afterwards", async () => {
      await provider.unloadModel(LOAD_MODEL);
      expect(await provider.isModelLoaded(LOAD_MODEL)).toBe(false);
    });
  });
});
