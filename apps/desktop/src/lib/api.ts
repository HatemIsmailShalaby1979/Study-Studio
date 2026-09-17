// Client-side backend adapter for the Study Studio frontend.
//
// The desktop app is a static Next.js export bundled inside Tauri, so there
// are no /api routes at runtime. This module is the single entry point the
// UI uses for every backend operation. All provider-specific work is delegated
// to the AI Runtime (`./ai-runtime`), which dispatches to the active provider
// (Tauri IPC in the desktop shell, direct HTTP in a plain browser).
import { aiRuntime } from "./ai-runtime";
import type { AIProviderStatus } from "./ai-runtime/types";
import { applyStoredConfigs } from "./ai-runtime/providerStore";
import { generateLesson, generatePodcastOnly, type GenerateRequest, type GeneratedLesson } from "./generation";
import { evaluateQuiz, type EvaluationResult } from "./evaluation";
import { generateDiagnosticQuiz, type GenerateDiagnosticQuizOptions } from "./quizEngine";
import { isTauri } from "./tauri";
import { log } from "./logger";

export interface ApiModel {
  id: string;
  name: string;
  size?: string;
}

/**
 * Provider grouping is defined in `ai-runtime/providerIds.ts` and re-exported
 * here so existing importers keep working.
 *
 * It lives in a leaf module because `api.ts` imports the runtime and the
 * runtime's routing needs these lists — declaring them here would be a cycle.
 * (The previous comment claimed `providerProbe.ts` imported them; it does not,
 * and never did.)
 */
import { LOCAL_PROVIDER_IDS, ONLINE_PROVIDER_IDS } from "./ai-runtime/providerIds";

export { LOCAL_PROVIDER_IDS, ONLINE_PROVIDER_IDS };

export interface FetchModelsResult {
  success: boolean;
  models: ApiModel[];
  error?: string;
  message?: string;
}

export interface RuntimeInitResult {
  available: boolean;
  models: ApiModel[];
  recommendedModel: string;
  message?: string;
  /**
   * Full per-provider discovery for the Settings page. Available across all
   * registered providers (Ollama, LM Studio, OpenAI, OpenRouter). Each entry
   * is `{ providerId, available, models, recommendedModel, ... }`. Populated
   * best-effort; absent on older callers.
   */
  providerStatuses?: AIProviderStatus[];
  /**
   * Provider id of the first available local provider, else the first
   * available online provider (with a stored key), else "". Drives the
   * Offline / Online / Hybrid mode summary.
   */
  activeProviderId?: string;
  /**
   * The model that was resolved and made resident during init. Present when a
   * model was successfully loaded (or when the provider manages its own
   * lifecycle). Drives the "Ready — model loaded" status in the UI.
   */
  loadedModel?: string;
  /** True when init actually had to load weights into memory. */
  didLoadModel?: boolean;
  /** Human-readable note about the model-loading step (e.g. why it was skipped). */
  modelLoadMessage?: string;
}

/** Delay helper — returns a promise that resolves after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One-stop AI runtime bootstrap called on app mount.
 *
 * 1. In Tauri: asks the active provider (via the Rust backend) to start its
 *    local server if it isn't already running.
 * 2. Retries listing models a few times to tolerate the brief window between
 *    process spawn and HTTP readiness.
 * 3. Runs full multi-provider discovery so the Settings page can show every
 *    provider's status, and picks an active provider: local-first, else an
 *    online provider with a stored key (seamless fallback).
 * 4. **Loads the selected model into memory.** On a runtime that separates
 *    downloaded from loaded (LM Studio), this is what removes the need to
 *    pre-load a model in the runtime's own UI. Best-effort: a failed load
 *    degrades to a clear message, never a crash.
 * 5. Auto-selects the recommended model so it's pinned for subsequent calls.
 *
 * Never throws.
 */
export async function initializeRuntime(): Promise<RuntimeInitResult> {
  // Re-apply any persisted user config (online keys) so an online provider is
  // usable when no local server is present.
  applyStoredConfigs(aiRuntime);

  // Step 1 — let the provider start its local runtime if needed.
  if (isTauri()) {
    try {
      await aiRuntime.startRuntime();
    } catch (e) {
      console.warn("[AiInit] startRuntime:", e);
    }
  }

  // Step 2 — fetch models with retries (default/local provider).
  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 2000;

  let localReady = false;
  let models = await aiRuntime.listModels(undefined, true).catch(() => []);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (models.length > 0) {
      localReady = true;
      break;
    }
    console.warn(
      `[AiInit] Attempt ${attempt + 1}/${MAX_RETRIES}: no local models yet.`
    );
    if (attempt < MAX_RETRIES - 1) {
      await sleep(RETRY_DELAY_MS);
      models = await aiRuntime.listModels(undefined, true).catch(() => []);
    }
  }
  void localReady;

  // Step 3 — full multi-provider discovery (best-effort, never throws).
  const providerStatuses = await aiRuntime.discoverAll().catch(() => [] as AIProviderStatus[]);

  // Step 4 — pick an active provider: local-first, else online with a key.
  // Keep this list in sync with LOCAL_PROVIDER_IDS in AIRuntimeProvider.tsx.
  const localProviderIds: readonly string[] = LOCAL_PROVIDER_IDS;
  const onlineProviderIds: readonly string[] = ONLINE_PROVIDER_IDS;
  const isAvailable = (id: string) =>
    providerStatuses.find((s) => s.providerId === id && s.available);

  let activeProviderId =
    localProviderIds.map((id) => isAvailable(id)).find(Boolean)?.providerId ??
    onlineProviderIds.map((id) => isAvailable(id)).find(Boolean)?.providerId ??
    "";

  // If the default/local provider is ready, pin the session provider to it so
  // generation routes there. Otherwise route to the online fallback.
  if (activeProviderId) {
    aiRuntime.session.setProvider(activeProviderId);
  }

  // Build the "primary" model list + recommended model from the active
  // provider's status (falls back to the local list for back-compat).
  const activeStatus = activeProviderId
    ? providerStatuses.find((s) => s.providerId === activeProviderId)
    : undefined;
  const primaryModels = activeStatus?.models?.length
    ? activeStatus.models
    : models;
  const recommended = activeStatus?.recommendedModel
    ? activeStatus.recommendedModel
    : primaryModels.length > 0
      ? await aiRuntime.getRecommendedModel(activeProviderId || undefined, primaryModels).catch(() => "")
      : "";

  const apiModels = primaryModels.map((m) => ({
    id: m.id,
    name: m.name.replace(":latest", ""),
    size: m.size,
  }));

  // Step 5 — assemble the result. `available` is true when ANY usable provider
  // exists (local OR online), so online-mode generation is not blocked.
  const available = Boolean(activeProviderId) && apiModels.length > 0;

  if (!available) {
    // Nothing available — friendly guidance, never a crash.
    const localDown = providerStatuses.every(
      (s) => !localProviderIds.includes(s.providerId) || !s.available
    );
    return {
      available: false,
      models: [],
      recommendedModel: "",
      message: localDown
        ? "No local model detected. Start LM Studio or Ollama, or add an online API key in Settings to generate HTML, quizzes, and glossaries."
        : "The AI runtime is running but has no models available. Download a model in your runtime, or check its model configuration.",
      providerStatuses,
      activeProviderId,
    };
  }

  // Step 6 — guarantee the resolved model is resident in memory. This is the
  // step that means the user never has to pre-load a model in LM Studio.
  let loadedModel = recommended;
  let didLoadModel = false;
  let modelLoadMessage: string | undefined;
  const target = recommended || apiModels[0]!.id;

  const alreadyLoaded = activeStatus?.models.find((m) => m.id === target)?.loaded === true;

  try {
    if (aiRuntime.supportsModelLoading(activeProviderId || undefined)) {
      const result = await aiRuntime.ensureModelLoaded(target, activeProviderId || undefined);
      loadedModel = result.model;
      didLoadModel = !alreadyLoaded;
      modelLoadMessage = result.message;
      log(
        `[AiInit] 🧠 Model "${loadedModel}" ${didLoadModel ? "loaded into memory" : "already resident"}.`
      );
    } else {
      // Provider manages its own lifecycle (Ollama pulls on demand, hosted
      // APIs always serve). Nothing to do beyond pinning the model.
      loadedModel = await aiRuntime.ensureModel(target, activeProviderId || undefined);
      modelLoadMessage = "Provider manages its own model lifecycle.";
    }
  } catch (e) {
    // A failed load is not fatal to init: the app still starts, the model list
    // is still shown, and the user gets a specific message instead of a blank
    // screen. Generation will surface the same error with a retry affordance.
    modelLoadMessage = e instanceof Error ? e.message : "Could not load the selected model.";
    console.warn("[AiInit] model load failed:", modelLoadMessage);
  }

  log(
    `[AiInit] ✅ Ready — provider=${activeProviderId}, ${apiModels.length} models, model: ${loadedModel}`
  );
  return {
    available: true,
    models: apiModels,
    recommendedModel: recommended,
    providerStatuses,
    activeProviderId,
    loadedModel,
    didLoadModel,
    modelLoadMessage,
  };
}

export async function fetchModels(): Promise<FetchModelsResult> {
  try {
    const models = await aiRuntime.listModels(undefined, true);
    return {
      success: true,
      models: models.map((m) => ({
        id: m.id,
        name: m.name.replace(":latest", ""),
        size: m.size,
      })),
    };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Unknown error";
    return {
      success: false,
      models: [],
      error: errorMsg,
      message: "The AI runtime is not running. Please start it (e.g., 'ollama serve')",
    };
  }
}

export { isTauri };
export { generateLesson, generatePodcastOnly };
export { evaluateQuiz };
export { generateDiagnosticQuiz };
export type { GenerateRequest, GeneratedLesson, EvaluationResult, GenerateDiagnosticQuizOptions };
