// AI Runtime public surface.
//
// Application code imports from here — never from a provider directly.
// The runtime owns intelligence; providers execute capabilities.

import { AIRuntime } from "./runtime";
import { OllamaProvider } from "./providers/ollama";
import { OpenAICompatibleProvider, openAIProviderProfiles } from "./providers/openaiCompatible";
import { applyStoredConfigs } from "./providerStore";

export { AIRuntime } from "./runtime";
export { ProviderRegistry } from "./providerRegistry";
export { ModelRegistry } from "./modelRegistry";
export { SessionManager } from "./session";
export { HealthMonitor } from "./healthMonitor";
export { createConfig } from "./config";
export type { AIRuntimeConfig } from "./config";
export type { AIRuntimeOptions } from "./runtime";
export { OllamaProvider } from "./providers/ollama";
export {
  OpenAICompatibleProvider,
  OpenAICompatibleHTTPError,
  openAIProviderProfiles,
} from "./providers/openaiCompatible";
export {
  getProviderConfig,
  getAllProviderConfigs,
  setProviderConfig,
  clearProviderConfig,
  hasApiKey,
  applyConfig,
  applyStoredConfigs,
  type ProviderConfig,
} from "./providerStore";
export {
  probeLocalProviders,
  validateOnlineProvider,
  type ProviderProbeResult,
  type OnlineValidationResult,
} from "./providerProbe";
export {
  ALL_CAPABILITIES,
  noCapabilities,
  capabilitiesFrom,
  supports,
  supportedCapabilities,
  commonCapabilities,
} from "./capabilities";
export {
  extractJsonFromResponse,
  repairJson,
  parseJsonResponse,
  extractOutermostJsonObject,
} from "./jsonRepair";
export type {
  AIMessage,
  AIMessageRole,
  AICompletionOptions,
  AIModel,
  AIModelProfile,
  AICapability,
  AIProviderCapabilities,
  AIHealth,
  AIProviderDescriptor,
  AIProviderStatus,
  AIProviderSelectionCriteria,
  AIProvider,
} from "./types";

/**
 * Build a runtime with the stock providers registered.
 *
 * Providers are injected here so tests can build a runtime with any
 * combination (or a fake provider) without touching globals.
 */
export function createRuntime(...providers: import("./types").AIProvider[]): AIRuntime {
  const runtime = new AIRuntime();
  for (const provider of providers) runtime.registerProvider(provider);
  return runtime;
}

/**
 * OpenAI-compatible profiles registered in the default singleton. Each is a
 * configuration profile of ONE provider class. Ollama remains the default;
 * these are additional runtimes the app can switch to with zero code changes.
 * Order matters for the Settings UI: local-first, then online.
 */
const DEFAULT_OPENAI_PROFILES = ["lmStudio", "openai", "openRouter"] as const;

/** App-wide singleton with the default provider set. */
export const aiRuntime: AIRuntime = createRuntime(
  new OllamaProvider(),
  ...DEFAULT_OPENAI_PROFILES.map(
    (name) => new OpenAICompatibleProvider(openAIProviderProfiles[name]!())
  )
);

// Apply any persisted user config (online API keys, base-URL overrides) before
// the first discovery so a returning user's online provider is immediately
// usable. Safe no-op on first run / SSR.
applyStoredConfigs(aiRuntime);
