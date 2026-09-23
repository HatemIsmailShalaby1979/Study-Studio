"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react";
import {
  initializeRuntime,
  type ApiModel,
  type RuntimeInitResult,
} from "@/lib/api";
import type { AIProviderStatus } from "@/lib/ai-runtime/types";
import { aiRuntime } from "@/lib/ai-runtime";
import { applyStoredConfigs } from "@/lib/ai-runtime/providerStore";
import { LOCAL_PROVIDER_IDS, ONLINE_PROVIDER_IDS } from "@/lib/ai-runtime/providerIds";
import {
  computeCanGenerate,
  deriveMode,
  needsApiKey as computeNeedsApiKey,
  type RuntimeMode,
} from "@/lib/ai-runtime/routing";
import { bindDefaultSkills, type ActiveSkillSummary } from "@/lib/skills";
import { log } from "@/lib/logger";

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
  mode: RuntimeMode;
  /** Whether a local TTS engine (Piper) appears to be available. */
  ttsAvailable: boolean;
  /**
   * True when the init completed and NO local AI server answered. The UI uses
   * this to prompt the user to enter an online API key (OpenAI / OpenRouter).
   */
  needsApiKey: boolean;
  /**
   * The model that was resolved and made resident during init. On a runtime
   * that separates downloaded from loaded (LM Studio) this is the model the app
   * loaded for the user — no manual pre-load in the runtime's own UI.
   */
  loadedModel: string;
  /** True when init actually had to load weights into memory. */
  didLoadModel: boolean;
  /** Note about the model-loading step (why it was skipped, or what failed). */
  modelLoadMessage?: string;
  /**
   * The skills bound for this session. Populated automatically once a local
   * provider is detected, so generation is skill-guided without the user having
   * to touch the skill selector.
   */
  activeSkills: ActiveSkillSummary[];
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
  loadedModel: "",
  didLoadModel: false,
  modelLoadMessage: undefined,
  activeSkills: [],
  refresh: () => {},
  refreshProviders: () => {},
  setActiveProvider: () => {},
});

export function useAIRuntime(): AIRuntimeContextValue {
  return useContext(AIRuntimeContext);
}

// LOCAL_PROVIDER_IDS / ONLINE_PROVIDER_IDS live in ai-runtime/providerIds.ts so
// the init handshake, the provider probe, and this component cannot drift apart.
//
// computeCanGenerate / deriveMode / needsApiKey live in ai-runtime/routing.ts as
// pure functions. They gate the Generate button, the mode badge, and the API-key
// prompt, and they previously sat here with 0% branch coverage — including a dead
// `ttsAvailable ? "offline" : "offline"`. See AUDIT.md P1-2.

/** Every provider id that counts as a local runtime, as a plain array. */
const LOCAL_IDS: string[] = [...LOCAL_PROVIDER_IDS];
const ONLINE_IDS: string[] = [...ONLINE_PROVIDER_IDS];

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
  const [activeSkills, setActiveSkills] = useState<ActiveSkillSummary[]>([]);
  /**
   * Guards the launch-time skill binding so a re-init (Settings "Full Refresh")
   * does not re-bind and clobber a skill the user chose by hand.
   */
  const skillsBoundRef = useRef(false);

  const runInit = useCallback(async () => {
    setInitializing(true);
    try {
      const result = await initializeRuntime();
      const canGenerate = computeCanGenerate(result.providerStatuses ?? []);
      setState({ ...result, canGenerate });

      // ── Auto-inject skills ──────────────────────────────────────────────
      // The requirement: once the app launches and finds a usable model, the
      // skill set is applied automatically so every subsequent generation is
      // skill-guided without the user touching the selector. Binding only
      // happens once per session; the user's manual choice wins afterwards.
      if (canGenerate && !skillsBoundRef.current) {
        skillsBoundRef.current = true;
        try {
          const bound = bindDefaultSkills({
            model: result.loadedModel || result.recommendedModel || "auto",
            providerId: result.activeProviderId || "auto",
          });
          setActiveSkills(bound);
          log(
            `[Skills] Bound ${bound.length} skill pack(s): ${bound.map((s) => s.id).join(", ")}`
          );
        } catch (e) {
          console.warn("[Skills] Auto-binding failed:", e);
        }
      }
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
  // bootstrap retry loop. Used by the Settings "Re-scan" button and after a
  // model load/unload.
  const refreshProviders = useCallback(async () => {
    applyStoredConfigs(aiRuntime);
    // An explicit re-scan must perform real probes. Without this the health
    // monitor answered from its 10 s cache, so "Re-scan" reported what the app
    // already believed instead of what is actually running.
    aiRuntime.invalidateHealth();
    const statuses = await aiRuntime.discoverAll().catch(() => [] as AIProviderStatus[]);
    const isUp = (id: string) => statuses.find((s) => s.providerId === id && s.available);
    const active =
      LOCAL_IDS.map((id) => isUp(id)).find(Boolean)?.providerId ??
      ONLINE_IDS.map((id) => isUp(id)).find(Boolean)?.providerId ??
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
  const needsApiKey = computeNeedsApiKey(state.providerStatuses ?? [], {
    initialized,
    canGenerate: state.canGenerate,
  });

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
        loadedModel: state.loadedModel ?? "",
        didLoadModel: state.didLoadModel ?? false,
        modelLoadMessage: state.modelLoadMessage,
        activeSkills,
        refresh: runInit,
        refreshProviders,
        setActiveProvider,
      }}
    >
      {children}
    </AIRuntimeContext.Provider>
  );
}
