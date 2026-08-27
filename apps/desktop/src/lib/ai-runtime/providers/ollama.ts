// Ollama provider adapter for the AI Runtime.
//
// This is the FIRST provider implementation. It wraps the Ollama transport
// (Tauri IPC inside the desktop shell, direct HTTP in the browser) and
// exposes it through the AIProvider contract. Business logic — retries,
// session pinning, prompt engineering, JSON repair — lives in the runtime,
// NOT here.

import { capabilitiesFrom } from "../capabilities";
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
import { isTauri, invokeTauri } from "../../tauri";
import * as transport from "../../ollama";
import type { OllamaChatMessage, OllamaGenerateOptions, OllamaModelInfo } from "../../ollama";

const DESCRIPTOR: AIProviderDescriptor = {
  id: "ollama",
  name: "Ollama (Local)",
  description: "Local inference via the Ollama runtime at localhost:11434.",
  transport: "tauri",
};

/** Ollama's /api/show profile shape (returned by the Tauri command too). */
interface OllamaShowProfile {
  name: string;
  parameters: string;
  context_window: number;
  supports_tools: boolean;
}

/** Models known to support tool calling in Ollama (community-proven list). */
const TOOL_CAPABLE = [
  "qwen2.5",
  "qwen3",
  "llama3.1",
  "llama3.2",
  "mistral",
  "gemma3",
  "phi4",
];

/** Fallback context window when Ollama doesn't report one. */
const FALLBACK_CONTEXT_WINDOW = 8192;

/**
 * Map runtime options onto Ollama's option names. `maxTokens`/`max_tokens`
 * collapse to `num_predict` (Ollama's real token-cap option).
 */
function toOllamaOptions(options?: AICompletionOptions): OllamaGenerateOptions {
  if (!options) return {};
  return {
    temperature: options.temperature,
    top_p: options.topP,
    num_predict: options.maxTokens ?? options.max_tokens,
    max_tokens: options.maxTokens ?? options.max_tokens,
    num_ctx: options.numContext,
    num_gpu: options.numGpu,
    keep_alive: options.keepAlive,
    format: options.format,
  };
}

function toChatMessages(messages: AIMessage[]): OllamaChatMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function toModels(models: OllamaModelInfo[]): AIModel[] {
  return models.map((m) => ({ id: m.id, name: m.name, size: m.size, loaded: m.loaded }));
}

export class OllamaProvider implements AIProvider {
  readonly descriptor = DESCRIPTOR;

  capabilities(): AIProviderCapabilities {
    // Provider-level API capabilities. Model-level capabilities (vision,
    // tools, embeddings) are reported per-model via getModelProfile().
    return capabilitiesFrom(["chat", "structuredOutput", "streaming"]);
  }

  async discover(): Promise<AIProviderStatus> {
    const health = await this.health();
    let models: AIModel[] = [];
    let recommendedModel = "";
    if (health.available) {
      try {
        models = await this.listModels(true);
        recommendedModel =
          models.length > 0 ? await this.getRecommendedModel(models) : "";
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
      capabilities: this.capabilities(),
      message: health.message,
    };
  }

  async health(): Promise<AIHealth> {
    try {
      const h = await transport.checkHealth();
      return {
        status: h.ollama_available ? "running" : "offline",
        available: h.ollama_available,
        modelsCount: h.models_count,
        recommendedModel: h.model,
      };
    } catch {
      return { status: "offline", available: false, modelsCount: 0, recommendedModel: "" };
    }
  }

  async listModels(forceRefresh = false): Promise<AIModel[]> {
    return toModels(await transport.listModels(forceRefresh));
  }

  async getRecommendedModel(models?: AIModel[]): Promise<string> {
    if (models) {
      return transport.getRecommendedModel(
        models.map((m) => ({
          id: m.id,
          name: m.name,
          size: m.size ?? "",
          loaded: m.loaded ?? false,
        }))
      );
    }
    return transport.getRecommendedModel();
  }

  async ensureModel(preferredModel?: string): Promise<string> {
    return transport.ensureModel(preferredModel);
  }

  async getModelProfile(modelId: string): Promise<AIModelProfile | null> {
    try {
      let profile: AIModelProfile | null = null;
      if (isTauri()) {
        const p = await invokeTauri<OllamaShowProfile | null>("model_profile", {
          modelName: modelId,
        });
        if (p) {
          profile = {
            id: p.name,
            parameters: p.parameters,
            contextWindow: p.context_window,
            supportsTools: p.supports_tools,
          };
        }
      } else {
        profile = await this.fetchShowProfile(modelId);
      }
      return profile;
    } catch {
      // Profiling is best-effort: on failure assume suitable and let the
      // actual generation be the source of truth.
      return null;
    }
  }

  async chat(
    messages: AIMessage[],
    options?: AICompletionOptions,
    model?: string
  ): Promise<string> {
    return transport.chat(toChatMessages(messages), toOllamaOptions(options), model, options?.signal);
  }

  async generate(
    prompt: string,
    system?: string,
    options?: AICompletionOptions,
    model?: string
  ): Promise<string> {
    return transport.generate(prompt, system, toOllamaOptions(options), model, options?.signal);
  }

  /** Start `ollama serve` via the Tauri backend when not already running. */
  async startRuntime(): Promise<void> {
    if (!isTauri()) return;
    await invokeTauri<string>("start_ollama_if_needed").catch((e) => {
      console.warn("[OllamaProvider] start_ollama_if_needed:", e);
    });
  }

  async pullModel(modelId: string): Promise<void> {
    if (!isTauri()) return;
    await invokeTauri<string>("pull_model", { modelName: modelId });
  }

  /**
   * Browser-mode profile fetch against Ollama's `/api/show`. Mirrors the
   * Tauri command so both shells report the same shape.
   */
  private async fetchShowProfile(modelName: string): Promise<AIModelProfile | null> {
    const res = await fetch(`${transport.OLLAMA_URL}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, verbose: true }),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const details = data.details ?? {};
    const modelInfo = data.model_info ?? {};
    const params = details.parameters ?? data.parameters ?? "";
    const parameters = String(params || "");
    const contextWindow = (modelInfo as Record<string, unknown>)["llama.context_length"];

    return {
      id: modelName,
      parameters,
      contextWindow:
        typeof contextWindow === "number"
          ? contextWindow
          : FALLBACK_CONTEXT_WINDOW,
      supportsTools: TOOL_CAPABLE.some((base) => modelName.toLowerCase().startsWith(base)),
    };
  }
}
