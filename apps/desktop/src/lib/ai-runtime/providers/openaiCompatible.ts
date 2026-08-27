// OpenAI-compatible provider for the AI Runtime.
//
// This is NOT an "LM Studio provider". It is one provider class that speaks
// the OpenAI `/v1` protocol, which is the de-facto standard for local and
// hosted AI runtimes. LM Studio, OpenRouter, LocalAI, LiteLLM, vLLM and
// FastChat are all just *configuration profiles* of this single class.
//
// The runtime must not be able to tell them apart.
//
// Capabilities are discovered, not hardcoded:
//  - `chat`, `structuredOutput`, `streaming` are the /v1 chat-completions
//    protocol contract (every compliant endpoint must speak them).
//  - `embeddings` is probed at discovery time via `POST /v1/embeddings`.
//  - `tools` / `vision` are derived from per-model metadata when the model
//    listing reports it (e.g. OpenRouter). When the server cannot tell us,
//    the capability is left unadvertised rather than guessed.
// An explicit `capabilities` override exists for hosts that document support
// but do not expose metadata (that is configuration, not code).

import { capabilitiesFrom } from "../capabilities";
import { runtimeFetch } from "../transport";
import type {
  AICompletionOptions,
  AIHealth,
  AIMessage,
  AIModel,
  AIModelProfile,
  AIProvider,
  AIProviderCapabilities,
  AIProviderDescriptor,
  AIProviderStatus,
} from "../types";

const MODEL_LIST_TTL_MS = 30_000; // 30 seconds
const DISCOVERY_TIMEOUT_MS = 5000;

/** Thrown on a non-2xx response. Carries the raw HTTP status for probing. */
export class OpenAICompatibleHTTPError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`OpenAI error (${status}): ${body}`);
    this.name = "OpenAICompatibleHTTPError";
    this.status = status;
    this.body = body;
  }
}

/** Raw model entry from `GET /v1/models` (extra fields vary by host). */
interface ModelEntry {
  id: string;
  owned_by?: string;
  context_length?: number;
  tool_use?: { supports?: boolean };
  modalities?: { input?: string[]; output?: string[] };
}

/** A preset for a known OpenAI-compatible runtime. */
export interface OpenAICompatibleProviderOptions {
  /** Provider identity (stable id + human name shown in the runtime). */
  descriptor: AIProviderDescriptor;
  /** Base URL of the `/v1` endpoint, e.g. `http://localhost:1234/v1`. */
  baseUrl: string;
  /** Optional bearer token (hosted runtimes). */
  apiKey?: string;
  /** Extra request headers (e.g. OpenRouter `HTTP-Referer`, `X-Title`). */
  headers?: Record<string, string>;
  /**
   * Static capability overrides for capabilities that cannot be discovered by
   * probing the endpoint. When unset, the /v1 protocol contract applies.
   */
  capabilities?: Partial<AIProviderCapabilities>;
}

/** Model selection heuristic shared by `getRecommendedModel`/`ensureModel`. */
const PRIORITY_PATTERNS = [
  /qwen/i,
  /gemma/i,
  /llama/i,
  /mistral/i,
  /phi/i,
  /gpt/i,
  /claude/i,
  /deepseek/i,
  /gemini/i,
];

function normalizeModelId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly descriptor: AIProviderDescriptor;
  /**
   * Mutable runtime config. Held separately from the constructor snapshot so
   * `setApiKey`/`setBaseUrl` can reconfigure a long-lived singleton (the app
   * constructs providers once at module load and never replaces them).
   */
  private apiKey: string | undefined;
  private baseUrl: string;
  private headers: Record<string, string> | undefined;
  private capabilityOverrides: Partial<AIProviderCapabilities> | undefined;

  private entries: ModelEntry[] = [];
  private listTimestamp = 0;
  private embeddingsProbed = false;
  private embeddingsSupported = false;

  constructor(options: OpenAICompatibleProviderOptions) {
    if (!options?.descriptor?.id || !options?.baseUrl) {
      throw new Error("OpenAICompatibleProvider requires descriptor.id and baseUrl");
    }
    this.descriptor = options.descriptor;
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.headers = options.headers;
    this.capabilityOverrides = options.capabilities;
  }

  // ─── Runtime reconfiguration ───────────────────────────────────────────

  /**
   * Inject (or clear) the bearer key at runtime. Clears cached discovery so
   * the next call re-probes with the new credentials. Never throws.
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey || undefined;
    this.invalidateCache();
  }

  /** Override the base URL at runtime. Never throws. */
  setBaseUrl(baseUrl: string): void {
    if (baseUrl) {
      this.baseUrl = baseUrl.replace(/\/+$/, ""); // strip trailing slashes
      this.invalidateCache();
    }
  }

  /** Drop cached model list + capability probes so the next call re-discovers. */
  private invalidateCache(): void {
    this.entries = [];
    this.listTimestamp = 0;
    this.embeddingsProbed = false;
    this.embeddingsSupported = false;
  }

  // ─── Capability reporting ──────────────────────────────────────────────

  capabilities(): AIProviderCapabilities {
    // The /v1 chat-completions protocol contract. This is a protocol
    // assertion, NOT a provider-name assumption — every compliant endpoint
    // must offer these. Discovery (below) refines with probes + metadata.
    const base = capabilitiesFrom(["chat", "structuredOutput", "streaming"]);
    return { ...base, ...this.capabilityOverrides };
  }

  // ─── Discovery ─────────────────────────────────────────────────────────

  async discover(): Promise<AIProviderStatus> {
    const health = await this.health();
    let models: AIModel[] = [];
    let recommendedModel = "";
    let capabilities = this.capabilities();
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
    return {
      providerId: this.descriptor.id,
      available: health.available && models.length > 0,
      models,
      recommendedModel,
      capabilities,
      message: health.message,
    };
  }

  /** Refine the protocol-contract capability report from live signals. */
  private async refineCapabilities(models: AIModel[]): Promise<AIProviderCapabilities> {
    const caps = this.capabilities();
    if (models.length === 0) return caps;

    const anyTools = this.entries.some((e) => e.tool_use?.supports === true);
    if (anyTools) {
      caps.tools = true;
      caps.functionCalling = true;
    }
    const anyVision = this.entries.some((e) => e.modalities?.input?.includes("image"));
    if (anyVision) caps.vision = true;

    caps.embeddings = await this.probeEmbeddings(models[0]!.id);
    return caps;
  }

  /**
   * Probe whether the server exposes `/v1/embeddings`. Best-effort, cached
   * for the provider lifetime. 404/405/422/501 mean "no embeddings here".
   */
  private async probeEmbeddings(modelId: string): Promise<boolean> {
    if (this.embeddingsProbed) return this.embeddingsSupported;
    this.embeddingsProbed = true;
    try {
      await this.request<unknown>(
        "/embeddings",
        { method: "POST", body: JSON.stringify({ model: modelId, input: "ping" }) },
        DISCOVERY_TIMEOUT_MS
      );
      this.embeddingsSupported = true;
    } catch (e) {
      const status = e instanceof OpenAICompatibleHTTPError ? e.status : undefined;
      this.embeddingsSupported = !(
        status === 404 || status === 405 || status === 422 || status === 501
      );
    }
    return this.embeddingsSupported;
  }

  // ─── Health ────────────────────────────────────────────────────────────

  async health(): Promise<AIHealth> {
    try {
      const data = await this.request<{ data?: unknown[] }>("/models", {}, DISCOVERY_TIMEOUT_MS);
      const count = Array.isArray(data.data) ? data.data.length : 0;
      return { status: "running", available: true, modelsCount: count, recommendedModel: "" };
    } catch (e) {
      const status = e instanceof OpenAICompatibleHTTPError ? e.status : undefined;
      if (status === 401 || status === 403) {
        return {
          status: "offline",
          available: false,
          modelsCount: 0,
          recommendedModel: "",
          message: "Authentication failed. Check the API key for this provider.",
        };
      }
      return { status: "offline", available: false, modelsCount: 0, recommendedModel: "" };
    }
  }

  // ─── Models ────────────────────────────────────────────────────────────

  async listModels(forceRefresh = false): Promise<AIModel[]> {
    const now = Date.now();
    if (!forceRefresh && this.entries.length > 0 && now - this.listTimestamp < MODEL_LIST_TTL_MS) {
      return this.toModels();
    }
    const data = await this.request<{ data?: ModelEntry[] }>("/models", {}, DISCOVERY_TIMEOUT_MS);
    this.entries = Array.isArray(data.data)
      ? data.data.filter((m): m is ModelEntry => !!m && typeof m.id === "string")
      : [];
    this.listTimestamp = now;
    return this.toModels();
  }

  private toModels(): AIModel[] {
    return this.entries.map((e) => ({
      id: e.id,
      name: e.id,
      size: e.owned_by || undefined,
      loaded: true,
    }));
  }

  async getRecommendedModel(models?: AIModel[]): Promise<string> {
    const available = models || (await this.listModels());
    if (available.length === 0) {
      throw new Error(`No models available on ${this.descriptor.name}. Load one in your AI server.`);
    }
    for (const pattern of PRIORITY_PATTERNS) {
      const match = available.find((m) => pattern.test(m.id));
      if (match) return match.id;
    }
    return available[0]!.id;
  }

  async ensureModel(preferredModel?: string): Promise<string> {
    const models = await this.listModels();
    if (models.length === 0) {
      throw new Error(`No models available on ${this.descriptor.name}. Load one in your AI server.`);
    }
    if (!preferredModel) return this.getRecommendedModel(models);

    const exact = models.find((m) => m.id === preferredModel);
    if (exact) return exact.id;

    // Tag/base-name tolerance: "qwen2.5" matches "qwen2.5-7b-instruct",
    // "gemma3" matches "gemma3-12b", "llama3.1" matches "llama-3.1-8b".
    const np = normalizeModelId(preferredModel.replace(/:latest$/i, ""));
    if (np) {
      const byNorm = models.find((m) => normalizeModelId(m.id).startsWith(np));
      if (byNorm) return byNorm.id;
    }

    // The user-selected model is genuinely not available. NO auto-switch:
    // surface the problem so the user decides.
    throw new Error(
      `Model "${preferredModel}" is not available on ${this.descriptor.name}. ` +
        `Load it in your AI server, or pick another model.`
    );
  }

  async getModelProfile(modelId: string): Promise<AIModelProfile | null> {
    try {
      const entry = this.entries.find((e) => e.id === modelId);
      if (!entry || (entry.context_length === undefined && !entry.tool_use)) {
        // No metadata available → unknown. Profilers treat null as
        // "assume suitable" — honest, never a false warning.
        return null;
      }
      return {
        id: entry.id,
        parameters: "",
        contextWindow: entry.context_length ?? 8192,
        supportsTools: entry.tool_use?.supports ?? false,
      };
    } catch {
      return null;
    }
  }

  // ─── Chat ──────────────────────────────────────────────────────────────

  async chat(
    messages: AIMessage[],
    options: AICompletionOptions = {},
    model?: string
  ): Promise<string> {
    const selectedModel = model || (await this.ensureModel());
    const body = this.buildChatBody(messages, options, selectedModel, false);
    try {
      const data = await this.postChatCompletion(body);
      return this.extractContent(data);
    } catch (e) {
      // Some servers reject `json_schema` but accept `json_object`. Degrade
      // the constraint rather than failing the whole request — the runtime's
      // repair layer re-validates content anyway.
      const format = body["response_format"] as { type?: string } | undefined;
      if (this.isSchemaRejection(e) && format?.type === "json_schema") {
        const retryBody = { ...body, response_format: { type: "json_object" } };
        const data = await this.postChatCompletion(retryBody);
        return this.extractContent(data);
      }
      throw e;
    }
  }

  /** Single-prompt completion via the chat protocol (universally supported). */
  async generate(
    prompt: string,
    system?: string,
    options: AICompletionOptions = {},
    model?: string
  ): Promise<string> {
    const messages: AIMessage[] = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: prompt });
    return this.chat(messages, options, model);
  }

  async *streamChat(
    messages: AIMessage[],
    options: AICompletionOptions = {},
    model?: string
  ): AsyncIterable<string> {
    const selectedModel = model || (await this.ensureModel());
    const body = this.buildChatBody(messages, options, selectedModel, true);
    const res = await runtimeFetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new OpenAICompatibleHTTPError(res.status, text.slice(0, 500));
    }
    if (!res.body) {
      throw new Error("Streaming not supported by this runtime");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const chunk = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // Ignore partial / keep-alive frames.
        }
      }
    }
  }

  // ─── Embeddings ────────────────────────────────────────────────────────

  async embeddings(input: string | string[], model?: string): Promise<number[][]> {
    const selectedModel = model || (await this.ensureModel());
    const data = await this.request<{ data: { embedding: number[] }[] }>("/embeddings", {
      method: "POST",
      body: JSON.stringify({ model: selectedModel, input: Array.isArray(input) ? input : [input] }),
    });
    return data.data.map((d) => d.embedding);
  }

  // ─── Transport internals ───────────────────────────────────────────────

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    return { ...headers, ...this.headers };
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    timeoutMs?: number
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = timeoutMs
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    try {
      const res = await runtimeFetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...this.authHeaders(), ...(init.headers as Record<string, string> | undefined) },
        signal: init.signal ?? (timeout ? controller.signal : undefined),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new OpenAICompatibleHTTPError(res.status, body.slice(0, 500));
      }
      return (await res.json()) as T;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private buildChatBody(
    messages: AIMessage[],
    options: AICompletionOptions,
    model: string,
    stream: boolean
  ): Record<string, unknown> {
    const body: Record<string, unknown> = { model, messages, stream };
    if (options.temperature !== undefined) body["temperature"] = options.temperature;
    if (options.topP !== undefined) body["top_p"] = options.topP;
    if (options.maxTokens !== undefined) body["max_tokens"] = options.maxTokens;
    if (options.tools && options.tools.length > 0) body["tools"] = options.tools;
    if (options.toolChoice !== undefined) body["tool_choice"] = options.toolChoice;
    if (options.format) {
      body["response_format"] = {
        type: "json_schema",
        json_schema: { name: "structured_output", schema: options.format },
      };
    }
    return body;
  }

  private async postChatCompletion(body: Record<string, unknown>): Promise<ChatCompletion> {
    return this.request<ChatCompletion>("/chat/completions", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  private extractContent(data: ChatCompletion): string {
    return data.choices?.[0]?.message?.content ?? "";
  }

  /** Whether an error signals "json_schema not supported by this server". */
  private isSchemaRejection(e: unknown): boolean {
    return (
      e instanceof OpenAICompatibleHTTPError &&
      (e.status === 400 || e.status === 422) &&
      /json_schema|response_format|structured output/i.test(e.body)
    );
  }
}

interface ChatCompletion {
  choices?: { message?: { content?: string | null } }[];
}

/**
 * Configuration profiles for known OpenAI-compatible runtimes. Each is just
 * options — there is exactly one provider class underneath. The runtime does
 * not distinguish between these hosts.
 */
export const openAIProviderProfiles: Record<
  string,
  () => OpenAICompatibleProviderOptions
> = {
  openai: () => ({
    descriptor: {
      id: "openai",
      name: "OpenAI (Hosted)",
      description: "Hosted GPT models via the official OpenAI API (https://api.openai.com/v1).",
      transport: "http",
    },
    baseUrl: "https://api.openai.com/v1",
    apiKey: process.env["OPENAI_API_KEY"] || undefined,
  }),
  lmStudio: () => ({
    descriptor: {
      id: "lm-studio",
      name: "LM Studio (Local)",
      description: "Local inference via the LM Studio server (http://localhost:1234/v1).",
      transport: "http",
    },
    baseUrl: "http://localhost:1234/v1",
  }),
  openRouter: () => ({
    descriptor: {
      id: "openrouter",
      name: "OpenRouter (Hosted)",
      description: "Unified access to hundreds of hosted models (https://openrouter.ai/api/v1).",
      transport: "http",
    },
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: process.env["OPENROUTER_API_KEY"] || undefined,
  }),
  localAI: () => ({
    descriptor: {
      id: "localai",
      name: "LocalAI",
      description: "Local/self-hosted OpenAI-compatible runtime (http://localhost:8080/v1).",
      transport: "http",
    },
    baseUrl: "http://localhost:8080/v1",
  }),
  liteLLM: () => ({
    descriptor: {
      id: "litellm",
      name: "LiteLLM Proxy",
      description: "Unified gateway in front of many model backends (http://localhost:4000/v1).",
      transport: "http",
    },
    baseUrl: "http://localhost:4000/v1",
  }),
  vllm: () => ({
    descriptor: {
      id: "vllm",
      name: "vLLM",
      description: "High-throughput self-hosted OpenAI-compatible runtime (http://localhost:8000/v1).",
      transport: "http",
    },
    baseUrl: "http://localhost:8000/v1",
  }),
  fastChat: () => ({
    descriptor: {
      id: "fastchat",
      name: "FastChat",
      description: "FastChat serving engine (http://localhost:8000/v1).",
      transport: "http",
    },
    baseUrl: "http://localhost:8000/v1",
  }),
};
