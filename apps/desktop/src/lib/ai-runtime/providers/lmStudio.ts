// Native LM Studio provider for the AI Runtime.
//
// Why this exists as its own class rather than another `openAIProviderProfiles`
// entry: the OpenAI-compatible profile can only see models LM Studio has
// *already loaded*, so a downloaded-but-idle model is invisible to the app and
// the user has to go load it by hand in the LM Studio GUI. That is exactly the
// workflow Study Studio is meant to remove.
//
// LM Studio ships a native REST API that separates downloaded from loaded and
// lets a client load a model on demand. Verified against
// https://lmstudio.ai/docs/developer/rest:
//
//   GET  /api/v1/models         all downloaded models + loaded_instances[]
//   POST /api/v1/models/load    { model, context_length?, flash_attention? }
//   POST /api/v1/models/unload  { instance_id }
//
// Inference still goes over the OpenAI-compatible `/v1` surface (inherited), so
// only discovery, model lifecycle, and profiling are overridden here. That
// keeps chat/stream/embeddings on one code path for every /v1 runtime.
//
// Older LM Studio builds (0.3.x) expose `/api/v0/models` with `state:
// "loaded" | "not-loaded"` and no load endpoint. The provider degrades to
// v0 listing, and if no load endpoint answers it falls back to reporting what
// the server will serve — the pre-existing behaviour, but with an honest
// message instead of a silent failure.

import { DISCOVERY_TIMEOUT_MS, OpenAICompatibleProvider, OpenAICompatibleHTTPError } from "./openaiCompatible";
import type { OpenAICompatibleProviderOptions } from "./openaiCompatible";
import { runtimeFetch } from "../transport";
import type {
  AIHealth,
  AIModel,
  AIModelLoadOptions,
  AIModelLoadResult,
  AIModelProfile,
  AIProviderCapabilities,
  AIProviderStatus,
} from "../types";

/**
 * How long to wait for a model to finish loading before reporting failure.
 *
 * Measured, not guessed: loading `ibm/granite-4-h-tiny` (4.23 GB) on a cold
 * cache took **165.9 s**. The previous 180 s ceiling left ~8% headroom, so the
 * user's 7 GB and 9 GB models — and any model on a slower disk — would have
 * timed out mid-load and been reported as a failure while loading perfectly
 * well. Ten minutes comfortably covers a 9 GB model at the observed ~25 MB/s.
 */
const DEFAULT_LOAD_TIMEOUT_MS = 600_000;
/** Poll interval while waiting for a load to complete. */
const LOAD_POLL_INTERVAL_MS = 750;
/** Context window requested when the caller does not specify one. */
const DEFAULT_LOAD_CONTEXT = 16_384;
/**
 * Ceiling on the context window we will ask for automatically.
 *
 * A model's own `max_context_length` can be enormous — the models on this
 * machine report 262144, 1010000 and 1048576. Requesting that allocates a KV
 * cache proportional to the context, which costs memory and load time for
 * capacity a study app will never use: 32k tokens is roughly 24k words, longer
 * than any lesson this app generates.
 *
 * This is a deliberate policy default, not a measured optimum. Users who want a
 * larger window should set it in LM Studio itself and load the model there; the
 * app treats an already-loaded model as authoritative and will not reload it.
 */
const MAX_AUTO_CONTEXT = 32_768;

// ─── Native API shapes ───────────────────────────────────────────────────────

/** One entry from `GET /api/v1/models`. */
interface NativeModel {
  type?: "llm" | "embedding";
  publisher?: string;
  key?: string;
  display_name?: string;
  architecture?: string | null;
  quantization?: { name?: string | null; bits_per_weight?: number | null } | null;
  size_bytes?: number;
  params_string?: string | null;
  loaded_instances?: { id?: string; config?: { context_length?: number } }[];
  max_context_length?: number;
  format?: "gguf" | "mlx" | null;
  capabilities?: {
    vision?: boolean;
    trained_for_tool_use?: boolean;
  };
}

/** One entry from the legacy `GET /api/v0/models`. */
interface V0Model {
  id?: string;
  type?: string;
  publisher?: string;
  arch?: string;
  quantization?: string;
  state?: "loaded" | "not-loaded";
  max_context_length?: number;
}

interface NativeListResponse {
  models?: NativeModel[];
}

interface V0ListResponse {
  data?: V0Model[];
}

interface LoadResponse {
  type?: string;
  instance_id?: string;
  load_time_seconds?: number;
  status?: string;
  load_config?: { context_length?: number };
}

/**
 * Shape guards. Each native listing has a distinguishing field, and matching on
 * that field (not merely on a status code) is what keeps a generic
 * OpenAI-compatible `/models` payload from being mistaken for a native one.
 *
 * - v1 entries carry `key` (the model identifier) and `loaded_instances`.
 * - v0 entries carry `state` ("loaded" | "not-loaded") and `max_context_length`.
 *
 * An OpenAI-compatible payload has neither, so both guards reject it and the
 * provider falls through to the /v1 listing — which is the correct behaviour for
 * a server that only speaks the OpenAI protocol.
 */
function isNativeV1Response(value: unknown): value is NativeListResponse {
  const models = (value as NativeListResponse | undefined)?.models;
  if (!Array.isArray(models)) return false;
  // An empty list is a legitimate native answer (LM Studio with nothing
  // downloaded), so only validate entries when there are any.
  return models.length === 0 || models.some((m) => typeof m?.key === "string");
}

function isNativeV0Response(value: unknown): value is V0ListResponse {
  const entries = (value as V0ListResponse | undefined)?.data;
  if (!Array.isArray(entries)) return false;
  return entries.length === 0 || entries.some((m) => typeof m?.state === "string");
}

/** Which listing API this server answered. Decided once per provider lifetime. */
type ListingMode = "v1" | "v0" | "openai" | "unknown";

/** LM Studio's default local server origin (the `/v1` suffix is stripped). */
const DEFAULT_LM_STUDIO_ORIGIN = "http://localhost:1234";

/**
 * Derive the server origin from the configured base URL, so a user who points
 * the profile at a non-default port still gets native model management.
 * `http://localhost:1234/v1` -> `http://localhost:1234`
 */
export function lmStudioOrigin(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
}

export class LMStudioProvider extends OpenAICompatibleProvider {
  /** Cached native listing, refreshed with the same TTL as the base class. */
  private nativeModels: NativeModel[] = [];
  private listingMode: ListingMode = "unknown";
  /** Set once we learn the server has no load endpoint, so we stop retrying. */
  private loadEndpointAvailable: boolean | null = null;

  constructor(options: OpenAICompatibleProviderOptions) {
    super(options);
  }

  /** Server origin without the `/v1` suffix, for the native REST API. */
  protected get origin(): string {
    return lmStudioOrigin(this.baseUrl) || DEFAULT_LM_STUDIO_ORIGIN;
  }

  // ─── Capability reporting ────────────────────────────────────────────────

  override capabilities(): AIProviderCapabilities {
    const base = super.capabilities();
    // The native API can manage model lifecycle, so a caller may rely on it.
    // `chat`/`structuredOutput`/`streaming` remain the /v1 protocol contract.
    return base;
  }

  // ─── Discovery ───────────────────────────────────────────────────────────

  override async discover(): Promise<AIProviderStatus> {
    const health = await this.health();
    let models: AIModel[] = [];
    let recommendedModel = "";
    let capabilities = this.capabilities();
    let message = health.message;

    if (health.available) {
      try {
        models = await this.listModels(true);
        recommendedModel = models.length > 0 ? await this.getRecommendedModel(models) : "";
        capabilities = await this.refineCapabilities(models);
      } catch {
        models = [];
        recommendedModel = "";
      }
    }

    if (models.length === 0 && health.available) {
      message =
        "LM Studio is running but reports no downloaded models. Download one in LM Studio, then re-scan.";
    }

    return {
      providerId: this.descriptor.id,
      available: health.available && models.length > 0,
      models,
      recommendedModel,
      capabilities,
      message,
    };
  }

  // ─── Health ──────────────────────────────────────────────────────────────

  override async health(): Promise<AIHealth> {
    // Prefer the native endpoint: it answers even when no model is loaded,
    // whereas /v1/models can legitimately return an empty list.
    //
    // Each attempt validates the SHAPE, not just the status code. A reverse
    // proxy or a server that answers 200 with an unexpected body must not be
    // mistaken for the native API — that is how a provider silently reports
    // zero models while the server is healthy.
    try {
      const data = await this.nativeGet<unknown>("/api/v1/models");
      if (isNativeV1Response(data)) {
        this.listingMode = "v1";
        this.nativeModels = data.models ?? [];
        const count = this.nativeModels.length;
        // Reuse the recommendation policy rather than hard-coding "". An empty
        // recommendedModel here silently broke every caller that reads it off
        // health() — the app knew there were 5 models and could not name one.
        // getRecommendedModel() is given the list explicitly so this costs no
        // extra request.
        let recommendedModel = "";
        if (count > 0) {
          try {
            recommendedModel = await this.getRecommendedModel(this.toNativeModels());
          } catch {
            recommendedModel = "";
          }
        }
        return {
          status: "running",
          available: true,
          modelsCount: count,
          recommendedModel,
          message: count === 0 ? "LM Studio is running with no downloaded models." : undefined,
        };
      }
    } catch (e) {
      if (e instanceof OpenAICompatibleHTTPError && (e.status === 401 || e.status === 403)) {
        return {
          status: "offline",
          available: false,
          modelsCount: 0,
          recommendedModel: "",
          message: "LM Studio rejected the request. Check the API token in Settings.",
        };
      }
    }

    // v0 fallback (LM Studio 0.3.x).
    try {
      const data = await this.nativeGet<unknown>("/api/v0/models");
      if (isNativeV0Response(data)) {
        this.listingMode = "v0";
        const entries = data.data ?? [];
        // Same rule as the v1 branch: never point the app at an embedding-only
        // model for generation.
        const chat = entries.filter((m) => m.type !== "embedding");
        const pool = chat.length > 0 ? chat : entries;
        const loaded = pool.find((m) => m.state === "loaded");
        return {
          status: "running",
          available: true,
          modelsCount: entries.length,
          recommendedModel: (loaded ?? pool[0])?.id ?? "",
        };
      }
    } catch {
      // fall through to the /v1 probe
    }

    // Neither native endpoint answered with the expected shape. Fall back to the
    // /v1 probe so a proxied or partially-configured server is still usable.
    const fallback = await super.health();
    if (fallback.available) {
      this.listingMode = "openai";
      return {
        ...fallback,
        message: "LM Studio's native API is unavailable; using the OpenAI-compatible endpoint.",
      };
    }
    this.listingMode = "unknown";
    return fallback;
  }

  // ─── Models ──────────────────────────────────────────────────────────────

  override async listModels(forceRefresh = false): Promise<AIModel[]> {
    const now = Date.now();
    if (!forceRefresh && this.nativeModels.length > 0 && now - this.listTimestamp < 30_000) {
      return this.toNativeModels();
    }

    if (this.listingMode === "openai") {
      // The native API never answered with a usable shape; defer to /v1.
      return super.listModels(forceRefresh);
    }

    // Each native attempt validates the response shape before accepting it. A
    // 200 carrying the wrong body (proxy, stub, or a server that only speaks
    // /v1) must not be read as "zero models".
    try {
      const data = await this.nativeGet<unknown>("/api/v1/models");
      if (isNativeV1Response(data)) {
        this.listingMode = "v1";
        this.nativeModels = data.models ?? [];
        this.listTimestamp = now;
        return this.toNativeModels();
      }
    } catch {
      // fall through to v0
    }

    try {
      const data = await this.nativeGet<unknown>("/api/v0/models");
      if (isNativeV0Response(data)) {
        this.listingMode = "v0";
        this.listTimestamp = now;
        return (data.data ?? [])
          .filter((m): m is V0Model => !!m && typeof m.id === "string")
          .map((m) => ({
            id: m.id!,
            name: m.id!,
            size: m.quantization || m.publisher,
            loaded: m.state === "loaded",
            contextWindow: m.max_context_length,
          }));
      }
    } catch {
      // fall through to the OpenAI-compatible listing
    }

    this.listingMode = "openai";
    return super.listModels(forceRefresh);
  }

  /**
   * Map native entries onto the provider-agnostic model shape.
   * `loaded` is the field that drives load-on-demand, so it must be accurate:
   * `loaded_instances` non-empty means the model is serving right now.
   */
  private toNativeModels(): AIModel[] {
    return this.nativeModels
      .filter((m): m is NativeModel => !!m && typeof m.key === "string")
      .map((m) => ({
        id: m.key!,
        name: m.display_name || m.key!,
        size: m.params_string || formatBytes(m.size_bytes),
        loaded: Array.isArray(m.loaded_instances) && m.loaded_instances.length > 0,
        contextWindow: m.max_context_length,
        supportsTools: m.capabilities?.trained_for_tool_use,
      }));
  }

  /**
   * True when the native listing marks this id as an embedding-only model.
   *
   * `GET /api/v1/models` returns embedding models alongside LLMs. They are
   * legitimately part of the catalogue, but recommending one for a lesson or
   * podcast fails at generation time — so the recommendation paths skip them
   * while `listModels()` still reports the full set.
   */
  private isEmbeddingModel(id: string): boolean {
    return this.nativeModels.some((m) => m.key === id && m.type === "embedding");
  }

  /**
   * Recommend a model. A model that is already loaded always wins: it costs
   * nothing and it is almost certainly what the user was just working with.
   * Otherwise fall back to the inherited name-priority heuristic.
   */
  override async getRecommendedModel(models?: AIModel[]): Promise<string> {
    const all = models ?? (await this.listModels());
    if (all.length === 0) {
      throw new Error(
        "No models available on LM Studio. Download one in LM Studio, then re-scan."
      );
    }
    // Filter embedding models out of the recommendation, but never end up with
    // an empty pool — a machine with only an embedding model should still get a
    // name back rather than an exception.
    const chatCapable = all.filter((m) => !this.isEmbeddingModel(m.id));
    const pool = chatCapable.length > 0 ? chatCapable : all;

    const loaded = pool.find((m) => m.loaded === true);
    if (loaded) return loaded.id;
    return super.getRecommendedModel(pool);
  }

  /**
   * Resolve the model for a request and guarantee it is resident.
   *
   * This is the behaviour the app is built around: the user picks a model from
   * the dropdown and generation just works, whether or not the model happened
   * to be loaded. Resolution policy (never silently switch models) is inherited
   * from the base class; only the load step is added.
   */
  override async ensureModel(preferredModel?: string): Promise<string> {
    const resolved = await super.ensureModel(preferredModel);
    if (!this.loadModel) return resolved;

    const isLoaded = await this.isModelLoaded(resolved);
    if (isLoaded === true) return resolved;

    // `undefined` means the server cannot tell us. Attempting the load is still
    // correct: LM Studio treats a load of an already-loaded model as a no-op.
    try {
      await this.loadModel(resolved, { contextLength: this.preferredContext(resolved) });
    } catch (e) {
      // A failed load must not masquerade as a model-resolution failure. The
      // chat call that follows will surface the real error, and the message
      // here tells the user which step broke.
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Found "${resolved}" in LM Studio but could not load it into memory: ${detail}. ` +
          `Load it manually in LM Studio, or pick a smaller model.`
      );
    }
    return resolved;
  }

  /**
   * Context window to request: the model's max, capped at MAX_AUTO_CONTEXT.
   *
   * Never exceeds what the model itself reports, so a small model (the
   * embedding models here report 2048) is not asked for more than it can hold.
   */
  private preferredContext(modelId: string): number {
    const entry = this.nativeModels.find((m) => m.key === modelId);
    const max = entry?.max_context_length;
    if (typeof max === "number" && max > 0) {
      return Math.min(max, MAX_AUTO_CONTEXT);
    }
    return DEFAULT_LOAD_CONTEXT;
  }

  // ─── Model lifecycle ─────────────────────────────────────────────────────

  /**
   * Load a model into memory via `POST /api/v1/models/load`, then poll until
   * the server reports it as resident.
   *
   * Idempotent: if the model is already loaded the call returns immediately.
   *
   * A context window is always requested — `options.contextLength` when the
   * caller supplies one, otherwise `preferredContext(modelId)`. Omitting it
   * would let LM Studio apply its own default (the model's full window), so
   * every entry point now loads a model with the same memory policy.
   */
  async loadModel(
    modelId: string,
    options: AIModelLoadOptions = {}
  ): Promise<AIModelLoadResult> {
    if (!modelId) throw new Error("loadModel requires a model id");

    if ((await this.isModelLoaded(modelId)) === true) {
      return { modelId, loaded: true, message: "Already loaded." };
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
    const body: Record<string, unknown> = {
      model: modelId,
      echo_load_config: true,
    };
    // Always send a context length.
    //
    // This used to be conditional on the caller passing one, which made the
    // capping policy reachable only through `ensureModel` — every other caller
    // got whatever LM Studio defaults to, which is the model's full window. A
    // direct `AIRuntime.loadModel(id)` could therefore allocate far more memory
    // than the app budgets, and nothing in the result said which context the
    // model had actually been loaded with, so it read as though the cap had
    // been applied. `preferredContext` is the same cap `ensureModel` passes, so
    // both routes now load a model identically.
    body["context_length"] = options.contextLength ?? this.preferredContext(modelId);
    if (options.flashAttention !== undefined) body["flash_attention"] = options.flashAttention;

    let response: LoadResponse;
    try {
      response = await this.nativePost<LoadResponse>("/api/v1/models/load", body, timeoutMs);
      this.loadEndpointAvailable = true;
    } catch (e) {
      if (e instanceof OpenAICompatibleHTTPError && e.status === 404) {
        // Server predates the load endpoint (LM Studio < 0.4.0).
        this.loadEndpointAvailable = false;
        throw new Error(
          "This LM Studio version has no model-load API. Enable 'Just-In-Time model loading' " +
            "in LM Studio's server settings, or update LM Studio to 0.4.0 or newer."
        );
      }
      throw e;
    }

    // Some builds answer 200 before the weights are resident. Poll briefly.
    const loaded = await this.waitUntilLoaded(modelId, timeoutMs);

    // Refresh the cached listing so `loaded` flags in the UI are correct.
    await this.listModels(true).catch(() => []);

    return {
      modelId,
      loaded,
      loadTimeSeconds: response.load_time_seconds,
      contextLength: response.load_config?.context_length,
      message: loaded ? undefined : "Load reported success but the model is not resident yet.",
    };
  }

  /** Release a model from memory via `POST /api/v1/models/unload`. */
  async unloadModel(modelId: string): Promise<void> {
    if (!modelId) return;
    const instanceId = await this.resolveInstanceId(modelId);
    if (!instanceId) return; // not loaded — nothing to release
    await this.nativePost<unknown>("/api/v1/models/unload", { instance_id: instanceId }, 30_000);
    await this.listModels(true).catch(() => []);
  }

  /**
   * Whether a model is resident. Returns `undefined` when the server cannot
   * tell (native API unavailable and no load endpoint known).
   */
  async isModelLoaded(modelId: string): Promise<boolean | undefined> {
    if (this.loadEndpointAvailable === false) return undefined;
    try {
      const models = await this.listModels(true);
      const entry = models.find((m) => m.id === modelId);
      return entry ? entry.loaded === true : false;
    } catch {
      return undefined;
    }
  }

  /** Poll the listing until the model reports as loaded, or the timeout lapses. */
  private async waitUntilLoaded(modelId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const models = await this.listModels(true);
        const entry = models.find((m) => m.id === modelId);
        if (entry?.loaded === true) return true;
      } catch {
        // Transient listing failure while the model loads — keep waiting.
      }
      if (Date.now() >= deadline) return false;
      await sleep(LOAD_POLL_INTERVAL_MS);
    }
  }

  /** Find the loaded instance id for a model key, for the unload call. */
  private async resolveInstanceId(modelId: string): Promise<string | null> {
    try {
      const data = await this.nativeGet<unknown>("/api/v1/models");
      if (!isNativeV1Response(data)) return null;
      const entry = (data.models ?? []).find((m) => m.key === modelId);
      const instance = entry?.loaded_instances?.[0];
      return instance?.id ?? null;
    } catch {
      return null;
    }
  }

  // ─── Profiling ───────────────────────────────────────────────────────────

  /**
   * Real per-model metadata from the native listing, so the pre-flight
   * "Patriot Check" can actually fire. The base implementation returns null for
   * anything the /v1 listing does not describe, which made the gate a no-op.
   */
  override async getModelProfile(modelId: string): Promise<AIModelProfile | null> {
    if (this.listingMode === "openai" || this.listingMode === "unknown") {
      return super.getModelProfile(modelId);
    }
    try {
      if (this.nativeModels.length === 0) await this.listModels(true);
      const entry = this.nativeModels.find((m) => m.key === modelId);
      if (!entry) return super.getModelProfile(modelId);
      return {
        id: modelId,
        parameters: entry.params_string ?? "",
        contextWindow: entry.max_context_length ?? 8192,
        supportsTools: entry.capabilities?.trained_for_tool_use ?? false,
      };
    } catch {
      return null;
    }
  }

  // ─── Native transport ────────────────────────────────────────────────────

  private async nativeGet<T>(path: string): Promise<T> {
    return this.nativeRequest<T>(path, { method: "GET" }, DISCOVERY_TIMEOUT_MS);
  }

  private async nativePost<T>(
    path: string,
    body: unknown,
    timeoutMs: number
  ): Promise<T> {
    return this.nativeRequest<T>(
      path,
      { method: "POST", body: JSON.stringify(body) },
      timeoutMs
    );
  }

  private async nativeRequest<T>(
    path: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await runtimeFetch(`${this.origin}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          ...(this.headers ?? {}),
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new OpenAICompatibleHTTPError(res.status, text.slice(0, 500));
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBytes(bytes?: number): string | undefined {
  if (typeof bytes !== "number" || bytes <= 0) return undefined;
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

/**
 * The LM Studio profile as a native provider. Kept as a factory so the runtime
 * constructs it the same way it constructs every other provider.
 */
export function createLMStudioProvider(): LMStudioProvider {
  return new LMStudioProvider({
    descriptor: {
      id: "lm-studio",
      name: "LM Studio (Local)",
      description:
        "Local inference via the LM Studio server. Models are listed and loaded on demand — no need to pre-load them in LM Studio.",
      transport: "http",
    },
    baseUrl: "http://localhost:1234/v1",
  });
}
