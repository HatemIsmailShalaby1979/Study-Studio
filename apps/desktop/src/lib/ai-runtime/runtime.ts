// The AI Runtime.
//
// The runtime is the brain. Providers are merely drivers. Business logic
// (routing, selection, session, health, config, structured-output repair)
// lives here; providers only execute capabilities.

import { supportedCapabilities, supports } from "./capabilities";
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
  AIModelProfile,
  AIProvider,
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
      } catch {
        statuses.push({
          providerId: provider.descriptor.id,
          available: false,
          models: [],
          recommendedModel: "",
          capabilities: provider.capabilities(),
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
