"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import {
  initializeRuntime,
  type ApiModel,
  type RuntimeInitResult,
} from "@/lib/api";
import type { AIProviderStatus } from "@/lib/ai-runtime/types";
import { aiRuntime } from "@/lib/ai-runtime";
import { applyStoredConfigs, hasApiKey } from "@/lib/ai-runtime/providerStore";

export interface AIRuntimeContextValue {
  /** True once the initial handshake (start + model list) has completed. */
  initialized: boolean;
  /** True when the handshake is in progress. */
  initializing: boolean;
  /** Whether the AI runtime is reachable and has models. */
  available: boolean;
  /** Whether generation is allowed (online gate: local provider OR API key). */
  canGenerate: boolean;
  /** Models reported by the runtime after init. Empty until init completes. */
  models: ApiModel[];
  /** The recommended model auto-selected during init. */
  recommendedModel: string;
  /** Human-readable status / error message. */
  message?: string;
  /** Per-provider discovery (all registered providers). */
  providerStatuses: AIProviderStatus[];
  /** Provider id currently routing generation (local-first / online fallback). */
  activeProviderId: string;
  /** Derived operating mode shown in the Settings mode summary. */
  mode: "offline" | "online" | "hybrid" | "unavailable";
  /** Whether a local TTS engine (Piper) appears to be available. */
  ttsAvailable: boolean;
  /**
   * True when the init completed and NO local AI server answered. The UI uses
   * this to prompt the user to enter an online API key (OpenAI / OpenRouter).
   */
  needsApiKey: boolean;
  /** Re-run the full init handshake (e.g. after the user pulls a model). */
  refresh: () => void;
  /** Re-run discovery only (lighter than refresh — no Ollama bootstrap). */
  refreshProviders: () => void;
  /** Pin a different provider for the session (Settings page). */
  setActiveProvider: (providerId: string) => void;
}

const AIRuntimeContext = createContext<AIRuntimeContextValue>({
  initialized: false,
  initializing: true,
  available: false,
  canGenerate: false,
  models: [],
  recommendedModel: "",
  providerStatuses: [],
  activeProviderId: "",
  mode: "unavailable",
  ttsAvailable: false,
  needsApiKey: false,
  refresh: () => {},
  refreshProviders: () => {},
  setActiveProvider: () => {},
});

export function useAIRuntime(): AIRuntimeContextValue {
  return useContext(AIRuntimeContext);
}

/**
 * Every provider id that counts as a LOCAL runtime. Any of these answering the
 * universal localhost scan marks the app as able to generate offline. Kept in
 * sync with LOCAL_PROBE_TARGETS in providerProbe.ts.
 */
const LOCAL_PROVIDER_IDS = ["ollama", "lm-studio", "localai", "vllm", "litellm", "fastchat"];
const ONLINE_PROVIDER_IDS = ["openai", "openrouter"];

/** Compute whether generation is allowed (online gate). */
function computeCanGenerate(statuses: AIProviderStatus[]): boolean {
  const localUp = statuses.some(
    (s) => LOCAL_PROVIDER_IDS.includes(s.providerId) && s.available
  );
  if (localUp) return true;
  // Online provider with a stored key counts as available for generation.
  const onlineUp = statuses.some(
    (s) => ONLINE_PROVIDER_IDS.includes(s.providerId) && s.available && hasApiKey(s.providerId)
  );
  return onlineUp;
}

/** Derive the operating mode from provider statuses + TTS availability. */
function deriveMode(
  statuses: AIProviderStatus[],
  ttsAvailable: boolean
): "offline" | "online" | "hybrid" | "unavailable" {
  const localUp = statuses.some(
    (s) => LOCAL_PROVIDER_IDS.includes(s.providerId) && s.available
  );
  const onlineUp = statuses.some(
    (s) => ONLINE_PROVIDER_IDS.includes(s.providerId) && s.available
  );
  if (localUp && onlineUp) return "hybrid";
  if (localUp) return ttsAvailable ? "offline" : "offline"; // local LLM up; TTS is independent
  if (onlineUp) return ttsAvailable ? "hybrid" : "online";
  return "unavailable";
}

export function AIRuntimeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RuntimeInitResult & { canGenerate: boolean }>({
    available: false,
    canGenerate: false,
    models: [],
    recommendedModel: "",
    message: undefined,
    providerStatuses: [],
    activeProviderId: "",
  });
  const [initializing, setInitializing] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [ttsAvailable, setTtsAvailable] = useState(false);

  const runInit = useCallback(async () => {
    setInitializing(true);
    try {
      const result = await initializeRuntime();
      const canGenerate = computeCanGenerate(result.providerStatuses ?? []);
      setState({ ...result, canGenerate });
    } catch (e) {
      setState({
        available: false,
        canGenerate: false,
        models: [],
        recommendedModel: "",
        message: e instanceof Error ? e.message : "AI runtime initialization failed",
        providerStatuses: [],
        activeProviderId: "",
      });
    } finally {
      setInitializing(false);
      setInitialized(true);
    }
  }, []);

  // Lighter refresh: re-run discovery + re-pick active provider without the
  // Ollama bootstrap retry loop. Used by the Settings "Re-scan" button.
  const refreshProviders = useCallback(async () => {
    applyStoredConfigs(aiRuntime);
    const statuses = await aiRuntime.discoverAll().catch(() => [] as AIProviderStatus[]);
    const isUp = (id: string) => statuses.find((s) => s.providerId === id && s.available);
    const active =
      LOCAL_PROVIDER_IDS.map((id) => isUp(id)).find(Boolean)?.providerId ??
      ONLINE_PROVIDER_IDS.map((id) => isUp(id)).find(Boolean)?.providerId ??
      "";
    if (active) aiRuntime.session.setProvider(active);

    const activeStatus = active
      ? statuses.find((s) => s.providerId === active)
      : undefined;
    const models = activeStatus?.models ?? [];
    const canGenerate = computeCanGenerate(statuses);
    setState((prev) => ({
      ...prev,
      providerStatuses: statuses,
      activeProviderId: active,
      available: Boolean(active) && models.length > 0,
      canGenerate,
      models: models.map((m) => ({
        id: m.id,
        name: m.name.replace(":latest", ""),
        size: m.size,
      })),
      recommendedModel: activeStatus?.recommendedModel ?? prev.recommendedModel,
      message: active
        ? prev.message
        : "No local model server detected. Start one (Ollama, LM Studio, vLLM, etc.) or add an online API key in Settings.",
    }));
  }, []);

  // Pin a provider for the session from the Settings page. When the target is
  // available, also swap the model list + routing so the Generate page follows
  // the selection. Unreachable providers stay selectable for configuration but
  // never hijack generation routing.
  const setActiveProvider = useCallback(
    (providerId: string) => {
      const statuses = state.providerStatuses ?? [];
      const target = statuses.find((s) => s.providerId === providerId);
      const targetAvailable = Boolean(target?.available);

      if (providerId && !targetAvailable) {
        setState((prev) => ({ ...prev, activeProviderId: prev.activeProviderId ?? "" }));
        return;
      }

      aiRuntime.session.setProvider(providerId || null);
      const models = target?.models ?? [];
      setState((prev) => ({
        ...prev,
        activeProviderId: providerId,
        available: Boolean(providerId) && models.length > 0,
        models: models.map((m) => ({
          id: m.id,
          name: m.name.replace(":latest", ""),
          size: m.size,
        })),
        recommendedModel: target?.recommendedModel ?? "",
      }));
    },
    [state.providerStatuses]
  );

  useEffect(() => {
    runInit();
  }, [runInit]);

  // Detect TTS availability once (best-effort, non-blocking). Lazy import so
  // the Tauri-only TTS module never loads in SSR.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { isTtsAvailable } = await import("@/lib/tts");
        const up = await isTtsAvailable();
        if (!cancelled) setTtsAvailable(up);
      } catch {
        if (!cancelled) setTtsAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const mode = deriveMode(state.providerStatuses ?? [], ttsAvailable);

  // True once init has settled and NO local provider answered the universal
  // scan. Drives the "enter an API key" prompt on the Generate page.
  const needsApiKey =
    initialized &&
    !state.canGenerate &&
    !(state.providerStatuses ?? []).some(
      (s) => LOCAL_PROVIDER_IDS.includes(s.providerId) && s.available
    );

  return (
    <AIRuntimeContext.Provider
      value={{
        initialized,
        initializing,
        available: state.available,
        canGenerate: state.canGenerate,
        models: state.models,
        recommendedModel: state.recommendedModel,
        message: state.message,
        providerStatuses: state.providerStatuses ?? [],
        activeProviderId: state.activeProviderId ?? "",
        mode,
        ttsAvailable,
        needsApiKey,
        refresh: runInit,
        refreshProviders,
        setActiveProvider,
      }}
    >
      {children}
    </AIRuntimeContext.Provider>
  );
}
