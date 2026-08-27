// Provider auto-detection + online-key validation.
//
// Used on app mount and from the Settings page. Every function here is
// defensive: failures become `available: false` / `valid: false` with a
// friendly message — never an exception. The app must keep running and the
// user must keep navigating no matter what is (or isn't) reachable.
//
// Local probes speak raw HTTP so they work before any provider is wired up;
// online validation goes through the runtime's provider instance so it reuses
// the real auth + transport path.

import type { AIRuntime } from "./runtime";
import type { AIModel } from "./types";
import { runtimeFetch } from "./transport";

/** One row of the spec's `{ providers: [{name, available}] }` discovery list. */
export interface ProviderProbeResult {
  /** Provider id matching an `AIProviderDescriptor.id` (e.g. "ollama"). */
  id: string;
  /** Human-facing name (e.g. "Local (Ollama)"). */
  name: string;
  /** Whether the server responded successfully within the timeout. */
  available: boolean;
  /** Optional human-readable note (why it's unavailable, or model count). */
  message?: string;
}

const PROBE_TIMEOUT_MS = 2500;

/**
 * Catalog of known local AI runtimes and their liveness endpoints. The probe is
 * endpoint-driven, NOT name-driven: it asks "what is alive?" and reports
 * whatever answers, so the app auto-detects Ollama, LM Studio, LocalAI, vLLM,
 * LiteLLM, FastChat, or any future OpenAI-compatible server without code
 * changes. A provider id may have multiple candidate URLs (alt port); the first
 * one that answers wins.
 */
interface LocalProbeTarget {
  id: string;
  name: string;
  /** Liveness URLs (any 2xx = up). The /v1/models and /api/tags paths confirm
   *  the server actually serves models, not just an open port. */
  urls: string[];
}

const LOCAL_PROBE_TARGETS: LocalProbeTarget[] = [
  {
    id: "ollama",
    name: "Local (Ollama)",
    urls: ["http://localhost:11434/api/tags"],
  },
  {
    id: "lm-studio",
    name: "Local (LM Studio)",
    urls: ["http://localhost:1234/v1/models"],
  },
  {
    id: "localai",
    name: "Local (LocalAI)",
    urls: ["http://localhost:8080/v1/models", "http://localhost:3980/v1/models"],
  },
  {
    id: "vllm",
    name: "Local (vLLM)",
    urls: ["http://localhost:8000/v1/models"],
  },
  {
    id: "litellm",
    name: "Local (LiteLLM Proxy)",
    urls: ["http://localhost:4000/v1/models"],
  },
  {
    id: "fastchat",
    name: "Local (FastChat)",
    urls: ["http://localhost:8000/v1/models", "http://localhost:21002/v1/models"],
  },
];

/** Probe a single URL with a short timeout. Returns true on any 2xx. */
async function probeUrl(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await runtimeFetch(url, {
      method: "GET",
      signal: controller.signal,
      // No credentials / cache for a bare liveness probe.
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Detect local LLM servers by scanning every known local endpoint in parallel.
 * Reports whatever answers — no single provider is assumed. When nothing local
 * is alive, online providers are still listed with `available: false` so the
 * caller can prompt for an API key. Never throws.
 */
export async function probeLocalProviders(): Promise<ProviderProbeResult[]> {
  const probeResults = await Promise.all(
    LOCAL_PROBE_TARGETS.map(async (target) => {
      const urlResults = await Promise.all(target.urls.map((u) => probeUrl(u)));
      const up = urlResults.some(Boolean);
      const upUrl = up ? target.urls.find((_, i) => urlResults[i]) ?? null : null;
      return { target, up, upUrl };
    })
  );

  const results: ProviderProbeResult[] = probeResults.map(({ target, up, upUrl }) => ({
    id: target.id,
    name: target.name,
    available: up,
    message: up && upUrl
      ? `Reachable at ${upUrl.replace(/\/v1\/models$|\/api\/tags$/, "")}`
      : undefined,
  }));

  // Always include the online providers so the UI can prompt for a key when no
  // local server is found. Their availability is decided by stored keys +
  // validation elsewhere, not by this probe.
  results.push(
    {
      id: "openai",
      name: "Online (OpenAI)",
      available: false,
      message: "Requires an API key",
    },
    {
      id: "openrouter",
      name: "Online (OpenRouter)",
      available: false,
      message: "Requires an API key",
    },
  );

  return results;
}

/**
 * Convenience: just the provider ids that answered the local scan. Empty array
 * when no local runtime is running — caller should prompt for an API key.
 * Never throws.
 */
export async function detectLocalProviderIds(): Promise<string[]> {
  try {
    const probed = await probeLocalProviders();
    return probed.filter((p) => p.available).map((p) => p.id);
  } catch {
    return [];
  }
}

/** Result of validating an online provider's API key. */
export interface OnlineValidationResult {
  valid: boolean;
  message?: string;
  /** Models listed on success (used to confirm connectivity in the UI). */
  models?: AIModel[];
}

/**
 * Validate an online provider by injecting the key into the runtime's provider
 * instance and asking for its health + model list. The key is applied
 * in-memory only — the caller decides whether to persist it (providerStore)
 * based on this result. Never throws.
 */
export async function validateOnlineProvider(
  runtime: AIRuntime,
  providerId: string,
  apiKey: string
): Promise<OnlineValidationResult> {
  const provider = runtime.providers.get(providerId);
  if (!provider) {
    return { valid: false, message: `Unknown provider "${providerId}".` };
  }
  if (!provider.setApiKey) {
    return { valid: false, message: "This provider does not use an API key." };
  }

  // Apply the candidate key in-memory (caller persists only on success).
  try {
    provider.setApiKey(apiKey);
  } catch {
    return { valid: false, message: "Could not apply the API key." };
  }

  try {
    const health = await provider.health();
    if (!health.available) {
      return {
        valid: false,
        message: health.message || "This API key didn't work. Please check it and try again.",
      };
    }
    let models: AIModel[] = [];
    try {
      models = await provider.listModels(true);
    } catch {
      // Health ok but listing failed — still valid, just no model list.
    }
    return {
      valid: true,
      models,
      message: models.length > 0 ? `${models.length} models available` : "Connected",
    };
  } catch {
    return {
      valid: false,
      message: "This API key didn't work. Please check it and try again.",
    };
  }
}
