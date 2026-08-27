// Capability helpers for the AI Runtime.
//
// Capability flags drive feature enablement. The application never branches
// on provider identity — it branches on `supports(...)`.

import type { AICapability, AIProviderCapabilities } from "./types";

/** Every capability, in a stable order (useful for iteration / UI lists). */
export const ALL_CAPABILITIES: readonly AICapability[] = [
  "chat",
  "structuredOutput",
  "streaming",
  "vision",
  "reasoning",
  "tools",
  "functionCalling",
  "embeddings",
  "speech",
  "rag",
  "mcp",
  "imageGeneration",
];

/** Default report: nothing supported. Providers start here and opt in. */
export function noCapabilities(): AIProviderCapabilities {
  return {
    chat: false,
    structuredOutput: false,
    streaming: false,
    vision: false,
    reasoning: false,
    tools: false,
    functionCalling: false,
    embeddings: false,
    speech: false,
    rag: false,
    mcp: false,
    imageGeneration: false,
  };
}

/** Build a capability report from a set of supported capabilities. */
export function capabilitiesFrom(supported: readonly AICapability[]): AIProviderCapabilities {
  const caps = noCapabilities();
  for (const c of supported) {
    (caps as Record<AICapability, boolean>)[c] = true;
  }
  return caps;
}

/** Whether a report advertises a specific capability. */
export function supports(caps: AIProviderCapabilities, capability: AICapability): boolean {
  return caps[capability] === true;
}

/** All capabilities a report advertises as supported. */
export function supportedCapabilities(caps: AIProviderCapabilities): AICapability[] {
  return ALL_CAPABILITIES.filter((c) => caps[c]);
}

/** Intersection: caps that are supported by every report in the list. */
export function commonCapabilities(reports: AIProviderCapabilities[]): AICapability[] {
  if (reports.length === 0) return [];
  return ALL_CAPABILITIES.filter((c) => reports.every((r) => r[c]));
}
