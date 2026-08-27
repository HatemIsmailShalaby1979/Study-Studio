import { isTauri, invokeTauri } from "./tauri";

export const OLLAMA_URL = process.env["OLLAMA_URL"] || "http://localhost:11434";
let CACHED_MODELS: OllamaModelInfo[] = [];
let MODEL_CACHE_TIMESTAMP = 0;
const CACHE_TTL_MS = 30000; // 30 seconds

async function selectModelForTauri(model?: string): Promise<void> {
  if (!model) return;
  try {
    await invokeTauri<void>("set_model", { modelName: model });
  } catch (e) {
    console.warn(`[Ollama] set_model(${model}) failed:`, e);
  }
}

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaGenerateOptions {
  temperature?: number;
  top_p?: number;
  /** Max tokens to predict. Maps to Ollama's `num_predict` option. */
  num_predict?: number;
  /**
   * Back-compat alias for {@link num_predict}. Older callers pass `max_tokens`.
   * Kept so existing call sites don't break; prefer `num_predict`.
   */
  max_tokens?: number;
  num_gpu?: number;
  num_ctx?: number;
  keep_alive?: string;
  /**
   * Ollama structured-output payload (`format`). A TOP-LEVEL request field
   * (not part of `options`), forwarded separately by `chat`/`generate`. When
   * set to a JSON-Schema object, Ollama constrains generation to valid JSON
   * matching that shape. Use the `*_JSON_SCHEMA` constants from
   * `./validation`.
   */
  format?: unknown;
}

export interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
}

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

export interface OllamaModelInfo {
  id: string;
  name: string;
  size: string;
  loaded: boolean;
}

async function ollamaFetch<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${OLLAMA_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * Build Ollama options with sensible hardware defaults.
 *
 * - `num_ctx: 8192` widens the default ~2048 context window so longer lessons
 *   aren't truncated.
 * - `keep_alive: "10m"` keeps the model resident between regenerations so we
 *   don't reload weights on every request (avoids GPU/CPU thrashing).
 * - `num_predict` is Ollama's real token-cap option (the legacy `max_tokens`
 *   field is silently ignored by Ollama).
 * - `num_gpu` is only forwarded when explicitly requested; Ollama's own
 *   auto-detection is usually right.
 */
function buildOllamaOptions(opts: OllamaGenerateOptions): Record<string, unknown> {
  const numPredict = opts.num_predict ?? opts.max_tokens ?? 8192;
  return {
    temperature: opts.temperature ?? 0.7,
    top_p: opts.top_p ?? 0.9,
    num_predict: numPredict,
    num_ctx: opts.num_ctx ?? 24576,
    keep_alive: opts.keep_alive ?? "10m",
    ...(opts.num_gpu !== undefined ? { num_gpu: opts.num_gpu } : {}),
  };
}

/**
 * Resolve the effective token-cap value, preferring `num_predict` and falling
 * back to the legacy `max_tokens` alias. Used by the Tauri path where the Rust
 * side takes a single `maxTokens` argument.
 */
function resolveNumPredict(opts: OllamaGenerateOptions): number {
  return opts.num_predict ?? opts.max_tokens ?? 8192;
}
export async function chat(
  messages: OllamaChatMessage[],
  options: OllamaGenerateOptions = {},
  model?: string,
  signal?: AbortSignal
): Promise<string> {
  if (isTauri()) {
    await selectModelForTauri(model);
    return invokeTauri<string>("chat", {
      messages,
      temperature: options.temperature ?? 0.7,
      topP: options.top_p ?? 0.9,
      maxTokens: resolveNumPredict(options),
      numCtx: options.num_ctx ?? 16384,
      numGpu: options.num_gpu,
      keepAlive: options.keep_alive ?? "10m",
      format: options.format,
    });
  }

  // If no model specified, auto-select the best available
  const selectedModel = model || await ensureModel();

  const body: Record<string, unknown> = {
    model: selectedModel,
    messages,
    stream: false,
    options: buildOllamaOptions(options),
  };
  if (options.format !== undefined) body["format"] = options.format;
  const result = await ollamaFetch<OllamaChatResponse>("/api/chat", body, signal);
  return result.message.content;
}

export async function generate(
  prompt: string,
  system?: string,
  options: OllamaGenerateOptions = {},
  model?: string,
  signal?: AbortSignal
): Promise<string> {
  if (isTauri()) {
    await selectModelForTauri(model);
    return invokeTauri<string>("generate", {
      prompt,
      systemPrompt: system,
      temperature: options.temperature ?? 0.7,
      topP: options.top_p ?? 0.9,
      maxTokens: resolveNumPredict(options),
      numCtx: options.num_ctx ?? 16384,
      numGpu: options.num_gpu,
      keepAlive: options.keep_alive ?? "10m",
      format: options.format,
    });
  }

  // If no model specified, auto-select the best available
  const selectedModel = model || await ensureModel();

  const body: Record<string, unknown> = {
    model: selectedModel,
    prompt,
    system,
    stream: false,
    options: buildOllamaOptions(options),
  };
  if (options.format !== undefined) body["format"] = options.format;
  const result = await ollamaFetch<OllamaGenerateResponse>("/api/generate", body, signal);
  return result.response;
}

export async function listModels(forceRefresh = false): Promise<OllamaModelInfo[]> {
  if (isTauri()) {
    try {
      const models = await invokeTauri<OllamaModelInfo[]>("list_models");
      CACHED_MODELS = models;
      MODEL_CACHE_TIMESTAMP = Date.now();
      return models;
    } catch (error) {
      CACHED_MODELS = [];
      MODEL_CACHE_TIMESTAMP = 0;
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("[Ollama] Tauri list_models failed:", errorMsg);
      throw new Error(`Ollama connection failed: ${errorMsg}. Please ensure 'ollama serve' is running.`);
    }
  }

  const now = Date.now();
  if (!forceRefresh && CACHED_MODELS.length > 0 && (now - MODEL_CACHE_TIMESTAMP) < CACHE_TTL_MS) {
    return CACHED_MODELS;
  }

  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { 
      signal: AbortSignal.timeout(5000),
      headers: { "Accept": "application/json" }
    });
    
    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      CACHED_MODELS = [];
      const errorMsg = `Ollama returned ${res.status}: ${errorText}`;
      console.error("[Ollama] HTTP error:", errorMsg);
      throw new Error(errorMsg);
    }
    
    const data = await res.json();
    
    if (!data.models || !Array.isArray(data.models)) {
      CACHED_MODELS = [];
      console.warn("[Ollama] Invalid response format:", data);
      return [];
    }
    
    // Properly handle all model formats including quantized models from modelfiles
    CACHED_MODELS = data.models.map((m: any) => {
      const modelName = m.name || m.model || "unknown";
      const modelId = m.model || m.name || "unknown";
      const sizeGB = m.size ? (m.size / 1_073_741_824).toFixed(1) : "unknown";
      
      return {
        id: modelId,
        name: modelName,
        size: `${sizeGB} GB`,
        loaded: m.details?.loaded || false,
      };
    });
    
    MODEL_CACHE_TIMESTAMP = now;
    console.log(`[Ollama] ✅ Found ${CACHED_MODELS.length} models:`, CACHED_MODELS.map(m => m.name).join(", "));
    return CACHED_MODELS;
  } catch (error) {
    CACHED_MODELS = [];
    MODEL_CACHE_TIMESTAMP = 0;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[Ollama] ❌ Failed to list models:", errorMsg);
    throw new Error(`Ollama connection failed: ${errorMsg}. Please ensure 'ollama serve' is running.`);
  }
}

export async function getRecommendedModel(models?: OllamaModelInfo[]): Promise<string> {
  const availableModels = models || await listModels();
  if (availableModels.length === 0) {
    throw new Error("No Ollama models available. Please pull a model first (e.g., 'ollama pull llama3.2:3b')");
  }
  
  // Priority order based on quality and performance balance
  const priorityOrder = [
    /gemma3/i, /qwen3/i, /llama3/i, /qwen2\.5/i, /mistral/i, /codellama/i, /phi3/i, /gemma2/i
  ];
  
  for (const pattern of priorityOrder) {
    const match = availableModels.find(m => pattern.test(m.name));
    if (match) return match.id;
  }
  
  // Return the first available model as fallback
  const firstModel = availableModels[0];
  if (!firstModel) {
    throw new Error("No models available after filtering");
  }
  return firstModel.id;
}

export async function checkHealth(): Promise<{ status: string; model: string; ollama_available: boolean; models_count: number }> {
  if (isTauri()) {
    try {
      const health = await invokeTauri<{ status: string; model: string; ollama_available: boolean }>("check_health");
      let count = 0;
      try {
        count = (await listModels(true)).length;
      } catch {
        count = 0;
      }
      return {
        status: health.status,
        model: health.model,
        ollama_available: health.ollama_available,
        models_count: count,
      };
    } catch {
      return { status: "offline", model: "", ollama_available: false, models_count: 0 };
    }
  }

  try {
    const models = await listModels(true);
    if (models.length > 0) {
      const recommended = await getRecommendedModel(models);
      return { 
        status: "running", 
        model: recommended, 
        ollama_available: true,
        models_count: models.length
      };
    }
  } catch {
    // Ollama not running or no models
  }
  return { 
    status: "offline", 
    model: "", 
    ollama_available: false,
    models_count: 0
  };
}

/**
 * Resolve the model to use for a request.
 *
 * Matching is tag-tolerant: `gemma3` matches `gemma3:12b`, and `llama3.2`
 * matches `llama3.2:3b`, so a user picking a base name still resolves to the
 * installed tag of that SAME model.
 *
 * Session model policy: the model the user selects is pinned for the whole
 * session — generation NEVER auto-switches to a different model. If the
 * preferred model isn't installed, we throw a clear error so the user can pull
 * it or pick another one themselves. (Only when no preference is given do we
 * auto-select the recommended model.)
 */
export async function ensureModel(preferredModel?: string): Promise<string> {
  const models = await listModels();

  if (models.length === 0) {
    throw new Error("No models available in Ollama. Please pull a model first using 'ollama pull <model-name>'");
  }

  if (preferredModel) {
    const exact = models.find((m) => m.id === preferredModel || m.name === preferredModel);
    if (exact) return exact.id;

    // Tag-tolerant match: "gemma3" -> "gemma3:12b", "llama3.2" -> "llama3.2:3b"
    const prefix = preferredModel.endsWith(":") ? preferredModel : `${preferredModel}:`;
    const byTag = models.find(
      (m) => m.id.startsWith(prefix) || m.name.startsWith(prefix) || m.id === preferredModel || m.name === preferredModel
    );
    if (byTag) return byTag.id;

    // The user-selected model is genuinely not installed. NO auto-switch:
    // surface the problem so the user decides.
    throw new Error(
      `Model "${preferredModel}" is not installed in Ollama. ` +
        `Install it with: ollama pull ${preferredModel}`
    );
  }

  // No preference: auto-select the best available model
  return await getRecommendedModel(models);
}

// Structured-output parsing + JSON repair live in the AI Runtime
// (`src/lib/ai-runtime/jsonRepair.ts`) — they are provider-independent.
// Re-exported here for back-compat so existing callers keep working during
// the migration. New code should import from `@/lib/ai-runtime`.
export { extractJsonFromResponse, repairJson } from "./ai-runtime/jsonRepair";