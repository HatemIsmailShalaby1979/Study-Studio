// AI Runtime — core contracts.
//
// The runtime owns intelligence. Providers are adapters that only execute
// capabilities (HTTP/SDK/IPC transport, auth, streaming, model listing,
// capability reporting, health). No business logic lives in a provider.
//
// The application asks "can the selected runtime do X?" — never
// "are we using provider Y?".

/** Roles used in chat-style conversations. */
export type AIMessageRole = "system" | "user" | "assistant";

export interface AIMessage {
  role: AIMessageRole;
  content: string;
}

/**
 * Provider-agnostic completion options. The runtime maps these onto whatever
 * the concrete provider understands (e.g. Ollama's `options` object vs an
 * OpenAI-compatible `max_tokens`).
 */
export interface AICompletionOptions {
  temperature?: number;
  topP?: number;
  /** Token cap. `maxTokens` is the canonical name (maps to provider specifics). */
  maxTokens?: number;
  /** Legacy alias kept for back-compat; prefer {@link maxTokens}. */
  max_tokens?: number;
  /** Context window requested for this request. */
  numContext?: number;
  numGpu?: number;
  keepAlive?: string;
  /**
   * Structured-output JSON Schema. Providers that do not advertise
   * `structuredOutput` ignore it (the runtime falls back to prompt-only +
   * repair). TOP-LEVEL request field, not part of transport options.
   */
  format?: unknown;
  /** Tool descriptors for function calling (provider-agnostic JSON schema). */
  tools?: unknown[];
  /** Tool selection control (e.g. "auto", "none", or a specific tool name). */
  toolChoice?: unknown;
  /** Cancellation signal. */
  signal?: AbortSignal;
}

/** A model as reported by a provider's model listing. */
export interface AIModel {
  id: string;
  name: string;
  size?: string;
  loaded?: boolean;
}

/** Rich per-model metadata (parameters, context window, tool support). */
export interface AIModelProfile {
  id: string;
  parameters: string;
  contextWindow: number;
  supportsTools: boolean;
}

/**
 * A discrete capability the app can ask about. Feature enablement is driven
 * by these flags, never by provider identity.
 */
export type AICapability =
  | "chat"
  | "structuredOutput"
  | "streaming"
  | "vision"
  | "reasoning"
  | "tools"
  | "functionCalling"
  | "embeddings"
  | "speech"
  | "rag"
  | "mcp"
  | "imageGeneration";

/** Immutable capability report for a provider. */
export interface AIProviderCapabilities {
  chat: boolean;
  structuredOutput: boolean;
  streaming: boolean;
  vision: boolean;
  reasoning: boolean;
  tools: boolean;
  functionCalling: boolean;
  embeddings: boolean;
  speech: boolean;
  rag: boolean;
  mcp: boolean;
  imageGeneration: boolean;
}

export interface AIHealth {
  status: "running" | "offline" | "degraded";
  /** Whether the provider is reachable and usable right now. */
  available: boolean;
  modelsCount: number;
  recommendedModel: string;
  message?: string;
}

/** Static identity of a provider. */
export interface AIProviderDescriptor {
  /** Stable id, e.g. "ollama". Used in config + persisted selections. */
  id: string;
  /** Human-facing name, e.g. "Ollama (Local)". */
  name: string;
  description?: string;
  /** How this provider talks to its inference runtime. */
  transport: "http" | "tauri" | "sdk";
}

/** Result of a full provider discovery pass (health + models + caps). */
export interface AIProviderStatus {
  providerId: string;
  available: boolean;
  models: AIModel[];
  recommendedModel: string;
  capabilities: AIProviderCapabilities;
  message?: string;
}

/** Criteria used to select a provider for a request. */
export interface AIProviderSelectionCriteria {
  /** Provider must advertise every listed capability. */
  requires?: AICapability[];
  /** Provider must currently be available (health ok). */
  mustBeAvailable?: boolean;
}

/**
 * The Provider contract. A provider owns ONLY transport, auth, streaming,
 * model listing, capability reporting, and health. Everything else belongs
 * to the AI Runtime.
 */
export interface AIProvider {
  readonly descriptor: AIProviderDescriptor;

  /** Static capability report advertised by this provider. */
  capabilities(): AIProviderCapabilities;

  /** Full dynamic discovery: health + models + recommended model + caps. */
  discover(): Promise<AIProviderStatus>;

  /** Current health snapshot. */
  health(): Promise<AIHealth>;

  /** List available models. */
  listModels(forceRefresh?: boolean): Promise<AIModel[]>;

  /** Pick the best available model (provider-specific heuristic). */
  getRecommendedModel(models?: AIModel[]): Promise<string>;

  /**
   * Resolve the model to use for a request. Implementations enforce the
   * session model policy (never auto-switch) and throw on missing models.
   */
  ensureModel(preferredModel?: string): Promise<string>;

  /** Rich metadata for a model (used by the pre-flight profiler). */
  getModelProfile(modelId: string): Promise<AIModelProfile | null>;

  /** Chat completion returning the assistant text. */
  chat(
    messages: AIMessage[],
    options?: AICompletionOptions,
    model?: string
  ): Promise<string>;

  /** Single-prompt completion returning the model text. */
  generate(
    prompt: string,
    system?: string,
    options?: AICompletionOptions,
    model?: string
  ): Promise<string>;

  /** Optional capability: streamed chat completion (token deltas). */
  streamChat?(
    messages: AIMessage[],
    options?: AICompletionOptions,
    model?: string
  ): AsyncIterable<string>;

  /** Optional capability: text embeddings (vector per input string). */
  embeddings?(input: string | string[], model?: string): Promise<number[][]>;

  /** Optional lifecycle hook: start the provider's local server. */
  startRuntime?(): Promise<void>;

  /** Optional capability: install/pull a model by id. */
  pullModel?(modelId: string): Promise<void>;

  /**
   * Optional mutator: inject a bearer key at runtime (hosted OpenAI-compatible
   * providers). Implementations must clear any cached model list / probes so
   * the next call re-discovers against the new credentials. No-op when the
   * provider doesn't use keys (e.g. Ollama). Never throws.
   */
  setApiKey?(apiKey: string): void;

  /**
   * Optional mutator: override the base URL at runtime (e.g. a self-hosted
   * OpenAI-compatible endpoint). Implementations clear cached state. Never
   * throws.
   */
  setBaseUrl?(baseUrl: string): void;
}
