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
   */
  async discoverAll(): Promise<AIProviderStatus[]> {
    const statuses: AIProviderStatus[] = [];
    for (const provider of this.providers.all()) {
      try {
        const health = await this.healthMonitor.check(provider);
        let models: AIModel[] = [];
        let recommendedModel = "";
        if (health.available) {
          try {
            models = await provider.listModels(true);
            this.models.setModels(provider.descriptor.id, models);
            recommendedModel = models.length > 0 ? await provider.getRecommendedModel(models) : "";
          } catch {
            models = [];
            recommendedModel = "";
          }
        }
        statuses.push({
          providerId: provider.descriptor.id,
          available: health.available && models.length > 0,
          models,
          recommendedModel,
          capabilities: provider.capabilities(),
          message: health.message,
        });
      } catch (e) {
        // Everything in this block must be incapable of throwing for the same
        // reason the try block just did, or the catch is decorative.
        // `capabilities()` is exactly such a call, hence `safeCapabilities`.
        statuses.push({
          providerId: provider.descriptor.id,
          available: false,
          models: [],
          recommendedModel: "",
          capabilities: this.safeCapabilities(provider),
          message: e instanceof Error ? e.message : "Discovery failed",
        });
      }
    }
    return statuses;
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
    if (provider.loadModel) {
      const model = await provider.ensureModel(preferredModel);
      this.session.setModel(model);
      return { model, loaded: true };
    }

    const model = await provider.ensureModel(preferredModel);
    this.session.setModel(model);
    return { model, loaded: true, message: "Provider manages its own model lifecycle." };
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private resolveProviderId(): string {
    return (
      this.session.getProvider() ??
      this.config.defaultProviderId ??
      this.providers.all()[0]?.descriptor.id ?? ""
    );
  }

  /** All capability flags a provider advertises (for capability UI). */
  advertisedCapabilities(providerId: string): AICapability[] {
    const provider = this.providers.get(providerId);
    if (!provider) return [];
    return supportedCapabilities(provider.capabilities());
  }
}
