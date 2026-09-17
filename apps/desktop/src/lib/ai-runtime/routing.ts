// Provider routing — the pure decision layer.
//
// These three decisions used to live inline in `AIRuntimeProvider.tsx`:
//   * can the app generate at all?
//   * what mode is it operating in?
//   * does it need an API key from the user?
//
// They are extracted here for one reason: everything else in the app depends on
// them, and they had 0% branch coverage — the dead branch
// `ttsAvailable ? "offline" : "offline"` survived precisely because nothing
// exercised them. See AUDIT.md P1-2.
//
// Determinism: the functions take no hidden inputs. `hasKey` is a parameter, so
// a test can enumerate every combination without touching localStorage.

import type { AIProviderStatus } from "./types";
import { LOCAL_PROVIDER_IDS, ONLINE_PROVIDER_IDS } from "./providerIds";
import { hasApiKey } from "./providerStore";

/** How the app is currently operating. */
export type RuntimeMode = "offline" | "online" | "hybrid" | "unavailable";

export interface RoutingDeps {
  /** Whether a stored API key exists for an online provider. */
  hasKey: (providerId: string) => boolean;
  /** Provider ids treated as local. */
  localIds: readonly string[];
  /** Provider ids treated as online (key required). */
  onlineIds: readonly string[];
}

/** Production defaults. Tests inject their own and never touch the store. */
export const DEFAULT_ROUTING_DEPS: RoutingDeps = {
  hasKey: hasApiKey,
  localIds: LOCAL_PROVIDER_IDS,
  onlineIds: ONLINE_PROVIDER_IDS,
};

/**
 * Is any local runtime reachable?
 *
 * "Reachable" is `available` — for a local provider that means it answered its
 * health probe. No API key is involved.
 */
export function isLocalUp(
  statuses: readonly AIProviderStatus[],
  deps: RoutingDeps = DEFAULT_ROUTING_DEPS
): boolean {
  return statuses.some((s) => deps.localIds.includes(s.providerId) && s.available);
}

/**
 * Is any online provider reachable?
 *
 * Note this is *reachability only* — it deliberately does not consider the API
 * key, because `deriveMode` reports connectivity while `computeCanGenerate`
 * reports permission. A provider that answers `/models` without auth is
 * reachable but not usable. Use `isOnlineUsable` when you mean the latter.
 */
export function isOnlineUp(
  statuses: readonly AIProviderStatus[],
  deps: RoutingDeps = DEFAULT_ROUTING_DEPS
): boolean {
  return statuses.some((s) => deps.onlineIds.includes(s.providerId) && s.available);
}

/** Is an online provider reachable *and* configured with a stored key? */
export function isOnlineUsable(
  statuses: readonly AIProviderStatus[],
  deps: RoutingDeps = DEFAULT_ROUTING_DEPS
): boolean {
  return statuses.some(
    (s) =>
      deps.onlineIds.includes(s.providerId) && s.available && deps.hasKey(s.providerId)
  );
}

/**
 * May the app generate right now?
 *
 * Local-first: any local runtime is enough. Otherwise an online provider counts
 * only when a key is actually stored for it — reachability alone is not enough,
 * because the request would come back 401.
 */
export function computeCanGenerate(
  statuses: readonly AIProviderStatus[],
  deps: RoutingDeps = DEFAULT_ROUTING_DEPS
): boolean {
  if (isLocalUp(statuses, deps)) return true;
  return isOnlineUsable(statuses, deps);
}

/**
 * Derive the operating mode.
 *
 * TTS is an independent capability, so it only ever *promotes* an online-only
 * setup: local LLM + local TTS is still "offline" (nothing leaves the machine),
 * whereas an online LLM paired with local audio is genuinely mixed and reports
 * "hybrid".
 *
 * This function previously contained `ttsAvailable ? "offline" : "offline"` —
 * both branches identical, so the parameter was dead. It is now used, and the
 * behaviour is asserted for all eight reachability × TTS combinations.
 */
export function deriveMode(
  statuses: readonly AIProviderStatus[],
  ttsAvailable: boolean,
  deps: RoutingDeps = DEFAULT_ROUTING_DEPS
): RuntimeMode {
  const localUp = isLocalUp(statuses, deps);
  const onlineUp = isOnlineUp(statuses, deps);

  if (localUp && onlineUp) return "hybrid";
  if (localUp) return "offline";
  if (onlineUp) return ttsAvailable ? "hybrid" : "online";
  return "unavailable";
}

/**
 * Should the UI ask the user for an API key?
 *
 * True once init has settled, generation is blocked, and no local runtime
 * answered — i.e. the only way forward is an online key.
 */
export function needsApiKey(
  statuses: readonly AIProviderStatus[],
  state: { initialized: boolean; canGenerate: boolean },
  deps: RoutingDeps = DEFAULT_ROUTING_DEPS
): boolean {
  if (!state.initialized) return false;
  if (state.canGenerate) return false;
  return !isLocalUp(statuses, deps);
}
