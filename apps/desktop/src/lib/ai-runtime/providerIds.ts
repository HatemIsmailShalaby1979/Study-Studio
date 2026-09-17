// The single source of truth for how providers are grouped.
//
// This lives in a leaf module with no imports of its own on purpose: the init
// handshake (`lib/api.ts`), the routing decisions (`routing.ts`) and the UI all
// need these lists, and putting them in `api.ts` would create a cycle —
// `api.ts` imports the runtime, and the runtime's routing needs the lists.
//
// Previously these were declared in `api.ts` and re-declared in
// `AIRuntimeProvider.tsx`, which is exactly how the three copies drift.

/**
 * Providers that run on the user's machine.
 *
 * Order matters: it is the local-first preference order used when picking an
 * active provider and when presenting the list in Settings.
 */
export const LOCAL_PROVIDER_IDS = [
  "ollama",
  "lm-studio",
  "localai",
  "vllm",
  "litellm",
  "fastchat",
] as const;

/** Hosted providers that require an API key. */
export const ONLINE_PROVIDER_IDS = ["openai", "openrouter"] as const;

export type LocalProviderId = (typeof LOCAL_PROVIDER_IDS)[number];
export type OnlineProviderId = (typeof ONLINE_PROVIDER_IDS)[number];
