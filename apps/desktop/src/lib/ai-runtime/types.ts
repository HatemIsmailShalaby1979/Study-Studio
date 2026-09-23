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
 * How much internal "thinking" a reasoning-capable model should spend before it
 * answers.
 *
 * `"none"` asks the runtime to answer directly. This matters more than a
 * latency tweak: a reasoning model's thinking tokens are drawn from the SAME
 * `maxTokens` budget as its answer, so a request with a small cap can be
 * answered with **no answer at all** — every token spent thinking, `content`
 * empty, `finish_reason: "length"`. Measured on this machine against
 * `qwen/qwen3.5-9b` with the app's real 512-token title budget: 512/512 tokens
 * went to reasoning and `content` was empty. With `"none"` the same request
 * returned valid JSON in 0 reasoning tokens and 6x faster.
 *
 * Providers that cannot express this ignore it; the runtime never assumes it
 * was honoured. See `AIModelReasoning`.
 */
export type AIReasoningEffort = "none" | "low" | "medium" | "high";

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
   * Requested reasoning effort. `"none"` means "answer without thinking".
   * Honoured only by providers that report the model can turn reasoning off —
   * see {@link AIModel.reasoning}. Never assume it took effect: a model whose
   * runtime mandates reasoning will still think, and the answer can still be
   * crowded out of the token budget.
   */
  reasoningEffort?: AIReasoningEffort;
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

/**
 * Reasoning behaviour of a specific model, as reported by its runtime.
 *
 * This is per-MODEL metadata, not a provider capability flag: one runtime
 * routinely serves both reasoning and non-reasoning models, and the decision
 * that matters ("can I stop this model from thinking, so it spends its token
 * budget on the answer?") is a property of the model.
 */
export interface AIModelReasoning {
  /** The model can emit internal reasoning tokens. */
  supported: boolean;
  /**
   * The runtime lets reasoning be turned off for this model.
   *
   * `false` means reasoning is mandatory: every request will spend part of its
   * `maxTokens` budget thinking, so a small budget yields an empty answer.
   * Callers must budget for it rather than assume `reasoningEffort: "none"`
   * will take effect.
   */
  canDisable: boolean;
  /** What the runtime does when a request says nothing about reasoning. */
  default: "on" | "off";
}

/** A model as reported by a provider's model listing. */
export interface AIModel {
  id: string;
  name: string;
  size?: string;
  /**
   * Whether the model is resident in memory and ready to serve right now.
   * `undefined` means the provider cannot tell. Local runtimes that separate
   * "downloaded" from "loaded" (LM Studio, llama.cpp servers) must report this
   * accurately — it is what drives load-on-demand.
   */
  loaded?: boolean;
  /** Maximum context window in tokens, when the provider reports it. */
  contextWindow?: number;
  /** Whether the model was trained for tool/function calling, when known. */
  supportsTools?: boolean;
  /**
   * Reasoning behaviour, when the runtime reports it. Absent means unknown —
   * callers must not assume either way.
   */
  reasoning?: AIModelReasoning;
}

/** Rich per-model metadata (parameters, context window, tool support). */
export interface AIModelProfile {
  id: string;
  parameters: string;
  contextWindow: number;
  supportsTools: boolean;
}

/** Options for {@link AIProvider.loadModel}. Provider-specific fields are ignored. */
export interface AIModelLoadOptions {
  /** Context window to allocate. Omitted = the runtime's own default. */
  contextLength?: number;
  /** Enable Flash Attention when the backend supports it. */
  flashAttention?: boolean;
  /** How long to wait for the load to complete before giving up. */
  timeoutMs?: number;
}

/** Outcome of a {@link AIProvider.loadModel} call. */
export interface AIModelLoadResult {
  modelId: string;
  /** Whether the model is serving now. */
  loaded: boolean;
  /** Seconds the runtime reported for the load, when available. */
  loadTimeSeconds?: number;
  /** The context window actually applied, when the runtime echoes it back. */
  contextLength?: number;
  /** Human-readable note (e.g. why a load was skipped). */
  message?: string;
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
   * Optional capability: make a model resident in memory.
   *
   * Providers whose runtime separates "downloaded" from "loaded" (LM Studio,
   * llama.cpp servers) implement this so the app can load the user's selection
   * on demand — the user never has to pre-load a model in the runtime's own UI.
   *
   * Must resolve once the model is actually serving. Idempotent: loading an
   * already-loaded model succeeds without a second allocation. Implementations
   * that cannot manage model lifecycle omit this method entirely.
   */
  loadModel?(modelId: string, options?: AIModelLoadOptions): Promise<AIModelLoadResult>;

  /** Optional capability: release a model from memory. */
  unloadModel?(modelId: string): Promise<void>;

  /**
   * Optional capability: report whether a specific model is resident.
   * Returns `undefined` when the provider cannot tell.
   */
  isModelLoaded?(modelId: string): Promise<boolean | undefined>;

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
