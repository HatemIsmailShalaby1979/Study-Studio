// The AI Runtime.
//
// The runtime is the brain. Providers are merely drivers. Business logic
// (routing, selection, session, health, config, structured-output repair)
// lives here; providers only execute capabilities.

import { noCapabilities, supportedCapabilities, supports } from "./capabilities";
import { createConfig, type AIRuntimeConfig } from "./config";
import { HealthMonitor } from "./healthMonitor";
import { ModelRegistry } from "./modelRegistry";
import { ProviderRegistry } from "./providerRegistry";
import { SessionManager } from "./session";
import type {
  AICapability,
  AICompletionOptions,
  AIHealth,
  AIMessage,
  AIModel,
  AIModelLoadOptions,
  AIModelLoadResult,
  AIModelProfile,
  AIProvider,
  AIProviderCapabilities,
  AIProviderSelectionCriteria,
  AIProviderStatus,
} from "./types";

export interface AIRuntimeOptions {
  config?: AIRuntimeConfig;
}

export class AIRuntime {
  readonly providers: ProviderRegistry;
  readonly models: ModelRegistry;
  readonly session: SessionManager;
  readonly config: Readonly<AIRuntimeConfig>;
  private readonly healthMonitor: HealthMonitor;
  /**
   * Provider ids that answered the last discovery pass, in registration order.
   *
   * {@link resolveProviderId} consults this so an un-pinned request goes to a
   * runtime that is actually serving models. It used to fall straight through
   * to "first registered provider", which on every real install is Ollama —
   * so a machine running only LM Studio had every un-pinned call (and the
   * whole init handshake) aimed at a server that was never started.
   */
  private lastAvailableIds: string[] = [];

  constructor(opts: AIRuntimeOptions = {}) {
    this.providers = new ProviderRegistry();
    this.models = new ModelRegistry();
    this.session = new SessionManager();
    this.config = createConfig(opts.config);
    this.healthMonitor = new HealthMonitor();
  }

  // ─── Registration ──────────────────────────────────────────────────────

  registerProvider(provider: AIProvider): void {
    this.providers.register(provider);
  }

  provider(providerId: string): AIProvider | undefined {
    return this.providers.get(providerId);
  }

  // ─── Capability query ──────────────────────────────────────────────────

  /** Whether a provider advertises a capability (regardless of availability). */
  supportsCapability(providerId: string, capability: AICapability): boolean {
    const provider = this.providers.get(providerId);
    return provider ? supports(provider.capabilities(), capability) : false;
  }

  /** Providers advertising every required capability. */
  providersWithCapability(...required: AICapability[]): AIProvider[] {
    return this.providers.withCapabilities(required);
  }

  // ─── Discovery ─────────────────────────────────────────────────────────

  /**
   * Capabilities, or an empty report — never throws.
   *
   * This exists because the per-provider catch in `discoverAll` used to call
   * `provider.capabilities()` directly. That is one of the calls that can throw
   * in the first place, so a provider whose `capabilities()` threw escaped its
   * own handler and rejected `discoverAll()` for EVERY provider — the exact
   * outcome the per-provider catch was written to prevent.
   */
  private safeCapabilities(provider: AIProvider): AIProviderCapabilities {
    try {
      return provider.capabilities();
    } catch {
      return noCapabilities();
    }
  }

  /**
   * Full discovery across every registered provider: health + models +
   * recommended model + capability report. Never throws — unavailable
   * providers are reported with `available: false`.
   *
   * Providers are probed **concurrently**. Sequentially, a discovery pass cost
   * the *sum* of every provider's timeout (up to 5 s each for the hosted
   * providers, plus a 3 s liveness probe for Ollama) even though the app only
   * ever needed the first one that answered — on a machine with one local
   * runtime up and three providers unreachable that was 10-20 s of dead time
   * on every launch and every "Re-scan". Concurrently it costs the *slowest*
   * single probe. Result order still follows registration order, because
   * `Promise.all` preserves it.
   */
  async discoverAll(): Promise<AIProviderStatus[]> {
    const providers = this.providers.all();
    const statuses = await Promise.all(providers.map((provider) => this.discoverOne(provider)));
    this.lastAvailableIds = statuses.filter((s) => s.available).map((s) => s.providerId);
    return statuses;
  }

  /** Discovery for one provider. Isolated so one failure cannot affect another. */
  private async discoverOne(provider: AIProvider): Promise<AIProviderStatus> {
    const providerId = provider.descriptor.id;
    try {
      const health = await this.healthMonitor.check(provider);
      let models: AIModel[] = [];
      let recommendedModel = "";
      if (health.available) {
        try {
          models = await provider.listModels(true);
          this.models.setModels(providerId, models);
          recommendedModel = models.length > 0 ? await provider.getRecommendedModel(models) : "";
        } catch {
          models = [];
          recommendedModel = "";
        }
      }
      return {
        providerId,
        available: health.available && models.length > 0,
        models,
        recommendedModel,
        // Deliberately NOT `safeCapabilities` here. A provider that cannot
        // report its capabilities is reported unavailable (the catch below
        // handles it), which is the pinned contract — a caller must never act
        // on a capability report that was never produced. `safeCapabilities` is
        // only for the catch, where the throw is already being handled and the
        // handler must not be able to throw again.
        capabilities: provider.capabilities(),
        message: health.message,
      };
    } catch (e) {
      return {
        providerId,
        available: false,
        models: [],
        recommendedModel: "",
        capabilities: this.safeCapabilities(provider),
        message: e instanceof Error ? e.message : "Discovery failed",
      };
    }
  }

  /**
   * Drop the cached health snapshots so the next discovery performs real
   * probes. An explicit "Re-scan" must not be answered from a cache — that is
   * the one moment the user is asking the app to look again.
   */
  invalidateHealth(): void {
    this.healthMonitor.invalidateAll();
  }

  /** Health snapshot for a provider (cached; falls back to offline). */
  async healthOf(providerId: string): Promise<AIHealth> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return { status: "offline", available: false, modelsCount: 0, recommendedModel: "" };
    }
    return this.healthMonitor.check(provider);
  }

  /** Health snapshot for the active/default provider. */
  async health(): Promise<AIHealth> {
    const provider = this.selectProvider({ requires: ["chat"] });
    return this.healthMonitor.check(provider);
  }

  /** Ask the active/default provider to start its local runtime (if it has one). */
  async startRuntime(): Promise<void> {
    const provider = this.selectProvider({ requires: ["chat"] });
    if (provider.startRuntime) await provider.startRuntime();
  }

  // ─── Selection ─────────────────────────────────────────────────────────

  /**
   * Select a provider for a request. Uses the session provider when set and
   * matching; otherwise the default provider; otherwise the first provider
   * advertising the required capabilities.
   */
  selectProvider(criteria: AIProviderSelectionCriteria = {}): AIProvider {
    const required = criteria.requires ?? [];

    const sessionProviderId = this.session.getProvider();
    if (sessionProviderId) {
      const p = this.providers.get(sessionProviderId);
      if (p && required.every((c) => supports(p.capabilities(), c))) return p;
    }

    if (this.config.defaultProviderId) {
      const p = this.providers.get(this.config.defaultProviderId);
      if (p && required.every((c) => supports(p.capabilities(), c))) return p;
    }

    const candidates = this.providers
      .all()
      .filter((p) => required.every((c) => supports(p.capabilities(), c)));
    if (candidates.length > 0) return candidates[0]!;

    throw new Error(
      `No AI provider supports the required capability: ${required.join(", ") || "chat"}`
    );
  }

  // ─── Completion ────────────────────────────────────────────────────────

  /** Merge runtime config defaults under the caller's explicit options. */
  private mergeOptions(options: AICompletionOptions = {}): AICompletionOptions {
    const d = this.config.defaults;
    return {
      temperature: options.temperature ?? d?.temperature,
      topP: options.topP ?? d?.topP,
      maxTokens: options.maxTokens ?? options.max_tokens ?? d?.maxTokens,
      numContext: options.numContext ?? d?.numContext,
      numGpu: options.numGpu,
      keepAlive: options.keepAlive ?? d?.keepAlive,
      // Passed through, never defaulted. A reasoning directive changes the
      // shape of the model's answer, so the app must never apply one the caller
      // did not ask for — and never assume one took effect. See
      // `AICompletionOptions.reasoningEffort`.
      reasoningEffort: options.reasoningEffort,
      format: options.format,
      tools: options.tools,
      toolChoice: options.toolChoice,
      signal: options.signal,
    };
  }

  /** Chat completion through the selected provider. */
  async chat(
    messages: AIMessage[],
    options?: AICompletionOptions,
    model?: string
  ): Promise<string> {
    const provider = this.selectProvider({ requires: ["chat"] });
    return provider.chat(messages, this.mergeOptions(options), model);
  }

  /** Single-prompt completion through the selected provider. */
  async generate(
    prompt: string,
    system?: string,
    options?: AICompletionOptions,
    model?: string
  ): Promise<string> {
    const provider = this.selectProvider({ requires: ["chat"] });
    return provider.generate(prompt, system, this.mergeOptions(options), model);
  }

  /** Streamed chat completion through a provider advertising `streaming`. */
  streamChat(
    messages: AIMessage[],
    options?: AICompletionOptions,
    model?: string
  ): AsyncIterable<string> {
    const provider = this.selectProvider({ requires: ["streaming"] });
    if (!provider.streamChat) {
      throw new Error("Selected provider does not expose streaming chat");
    }
    return provider.streamChat(messages, this.mergeOptions(options), model);
  }

  /** Embeddings through a provider advertising `embeddings`. */
  async embeddings(input: string | string[], model?: string): Promise<number[][]> {
    const provider = this.selectProvider({ requires: ["embeddings"] });
    if (!provider.embeddings) {
      throw new Error("Selected provider does not expose embeddings");
    }
    return provider.embeddings(input, model);
  }

  // ─── Models ────────────────────────────────────────────────────────────

  /** Models for a provider (direct listing, bypassing the registry). */
  async listModels(providerId?: string, forceRefresh = false): Promise<AIModel[]> {
    const id = providerId ?? this.resolveProviderId();
    const provider = this.providers.get(id);
    if (!provider) return [];
    const models = await provider.listModels(forceRefresh);
    this.models.setModels(id, models);
    return models;
  }

  /** Resolve a model id to use for a request (pinned session model wins). */
  async ensureModel(preferredModel?: string, providerId?: string): Promise<string> {
    const id = providerId ?? this.resolveProviderId();
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`No AI provider registered with id "${id}"`);
    }
    const resolved = await provider.ensureModel(preferredModel);
    this.session.setModel(resolved);
    return resolved;
  }

  /** Best available model for a provider. */
  async getRecommendedModel(providerId?: string, models?: AIModel[]): Promise<string> {
    const id = providerId ?? this.resolveProviderId();
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`No AI provider registered with id "${id}"`);
    return provider.getRecommendedModel(models);
  }

  /** Rich metadata for a model (pre-flight profiling). */
  async getModelProfile(modelId: string, providerId?: string): Promise<AIModelProfile | null> {
    const id = providerId ?? this.resolveProviderId();
    const provider = this.providers.get(id);
    if (!provider) return null;
    return provider.getModelProfile(modelId);
  }

  // ─── Model lifecycle ───────────────────────────────────────────────────

  /**
   * Whether the active provider can load a model into memory on demand.
   * False for providers that only serve what their runtime already has loaded.
   */
  supportsModelLoading(providerId?: string): boolean {
    const id = providerId ?? this.resolveProviderId();
    return typeof this.providers.get(id)?.loadModel === "function";
  }

  /** Whether a model is resident. `undefined` when the provider cannot tell. */
  async isModelLoaded(modelId: string, providerId?: string): Promise<boolean | undefined> {
    const id = providerId ?? this.resolveProviderId();
    const provider = this.providers.get(id);
    if (!provider?.isModelLoaded) return undefined;
    return provider.isModelLoaded(modelId);
  }

  /**
   * Make a model resident. Throws when the provider has no load capability —
   * callers should gate on {@link supportsModelLoading} when a missing load
   * path is a normal outcome rather than an error.
   */
  async loadModel(
    modelId: string,
    options?: AIModelLoadOptions,
    providerId?: string
  ): Promise<AIModelLoadResult> {
    const id = providerId ?? this.resolveProviderId();
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`No AI provider registered with id "${id}"`);
    if (!provider.loadModel) {
      throw new Error(
        `Provider "${id}" cannot load models on demand. Load the model in its own runtime first.`
      );
    }
    return provider.loadModel(modelId, options);
  }

  /** Release a model from memory. No-op when the provider cannot unload. */
  async unloadModel(modelId: string, providerId?: string): Promise<void> {
    const id = providerId ?? this.resolveProviderId();
    await this.providers.get(id)?.unloadModel?.(modelId);
  }

  /**
   * Resolve the model for a request AND guarantee it is resident, in one call.
   *
   * This is the app's "just works" entry point. On a runtime that separates
   * downloaded from loaded (LM Studio), the user's selection is loaded here, so
   * no manual pre-load in the runtime's own UI is ever required. On runtimes
   * that cannot load (Ollama pulls implicitly, hosted APIs always serve), it
   * degrades to plain resolution.
   *
   * The reported `loaded` flag is *checked*, not assumed. It used to be the
   * constant `true`, so a provider that resolved a model it could not make
   * resident still had the UI announce "ready" — and the very next request
   * failed. Callers that only need a model id (generation) are unaffected;
   * callers that report status to the user get the truth.
   */
  async ensureModelLoaded(
    preferredModel?: string,
    providerId?: string
  ): Promise<{ model: string; loaded: boolean; loadTimeSeconds?: number; message?: string }> {
    const id = providerId ?? this.resolveProviderId();
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`No AI provider registered with id "${id}"`);

    // Providers that implement load-on-demand (LM Studio) do the work inside
    // ensureModel, so a single call both resolves and loads.
    const model = await provider.ensureModel(preferredModel);
    this.session.setModel(model);

    // Ask the provider whether the model is actually serving. `undefined` means
    // it cannot tell, which is not the same as "not loaded".
    let resident: boolean | undefined;
    if (provider.isModelLoaded) {
      try {
        resident = await provider.isModelLoaded(model);
      } catch {
        resident = undefined;
      }
    }

    if (resident === false) {
      return {
        model,
        loaded: false,
        message:
          "The runtime resolved this model but is not serving it yet. It will be loaded on the " +
          "first request if the server allows that; if generation fails, pick a smaller model " +
          "or lower the context window in the runtime's own settings.",
      };
    }

    return {
      model,
      loaded: true,
      message: provider.loadModel ? undefined : "Provider manages its own model lifecycle.",
    };
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private resolveProviderId(): string {
    const session = this.session.getProvider();
    if (session && this.providers.has(session)) return session;

    // An explicitly configured default is intent, so it outranks discovery.
    if (this.config.defaultProviderId && this.providers.has(this.config.defaultProviderId)) {
      return this.config.defaultProviderId;
    }

    // Otherwise prefer a provider that actually answered the last discovery
    // pass. Registration order is an implementation detail of the module that
    // builds the runtime, and using it as the fallback meant "the first
    // provider someone happened to register" — Ollama — decided where every
    // un-pinned request went, whatever was actually running.
    const available = this.lastAvailableIds.find((id) => this.providers.has(id));
    if (available) return available;

    return this.providers.all()[0]?.descriptor.id ?? "";
  }

  /** All capability flags a provider advertises (for capability UI). */
  advertisedCapabilities(providerId: string): AICapability[] {
    const provider = this.providers.get(providerId);
    if (!provider) return [];
    return supportedCapabilities(provider.capabilities());
  }
}
