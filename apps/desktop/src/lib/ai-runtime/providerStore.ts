// Runtime-configurable provider state (API keys + base-URL overrides).
//
// Providers are constructed once at module load with no credentials (the local
// OpenAI-compatible profiles have no key; Ollama needs none). This module is
// the single source of truth for *user-supplied* configuration that has to
// survive an app restart: online API keys and any base-URL override.
//
// Storage backend: localStorage (same store lessons/journeys use). Works
// identically inside the Tauri webview and a plain browser — no new
// infrastructure, no Rust dependency. Keys are kept client-side only and are
// never logged.
//
// All functions are defensive: they never throw. A missing/unavailable
// localStorage (SSR, privacy mode) degrades to in-memory state.

import type { AIRuntime } from "./runtime";
import type { AIProvider } from "./types";

const STORAGE_KEY = "study-studio-provider-config";

/** Persistent, per-provider user configuration. */
export interface ProviderConfig {
  /** Bearer key for hosted OpenAI-compatible providers. Empty = none. */
  apiKey?: string;
  /** Base-URL override (self-hosted endpoints). Empty = profile default. */
  baseUrl?: string;
}

type ProviderConfigMap = Record<string, ProviderConfig>;

// In-memory mirror so reads work even when localStorage is unavailable, and so
// a config set during a single session is consistent across calls.
let cache: ProviderConfigMap = load();

function load(): ProviderConfigMap {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ProviderConfigMap) : {};
  } catch {
    return {};
  }
}

function persist(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Quota / privacy mode — state still lives in-memory for this session.
  }
}

/** Read the stored config for a provider (or all providers when id omitted). */
export function getProviderConfig(id: string): ProviderConfig {
  return { ...(cache[id] ?? {}) };
}
export function getAllProviderConfigs(): ProviderConfigMap {
  const out: ProviderConfigMap = {};
  for (const [id, cfg] of Object.entries(cache)) out[id] = { ...cfg };
  return out;
}

/** Whether a non-empty API key is stored for the provider. */
export function hasApiKey(id: string): boolean {
  return Boolean(cache[id]?.apiKey);
}

/**
 * Persist config for a provider. Only defined fields are written; passing
 * `undefined` for a field clears it. Merges with existing stored values.
 */
export function setProviderConfig(id: string, cfg: ProviderConfig): void {
  if (!id) return;
  const current = cache[id] ?? {};
  const next: ProviderConfig = { ...current };
  if (cfg.apiKey !== undefined) {
    next.apiKey = cfg.apiKey ? cfg.apiKey.trim() : undefined;
  }
  if (cfg.baseUrl !== undefined) {
    next.baseUrl = cfg.baseUrl ? cfg.baseUrl.trim() : undefined;
  }
  cache[id] = next;
  persist();
}

/** Remove all stored config for a provider (e.g. user clears their key). */
export function clearProviderConfig(id: string): void {
  if (!id) return;
  delete cache[id];
  persist();
}

/**
 * Apply a stored config to a provider instance via its optional mutators.
 * No-op for providers without mutators (Ollama) or with no stored config.
 * Never throws.
 */
export function applyConfig(provider: AIProvider): void {
  const cfg = cache[provider.descriptor.id];
  if (!cfg) return;
  try {
    if (cfg.apiKey && provider.setApiKey) provider.setApiKey(cfg.apiKey);
    if (cfg.baseUrl && provider.setBaseUrl) provider.setBaseUrl(cfg.baseUrl);
  } catch {
    // Reconfiguration is best-effort; never block on it.
  }
}

/**
 * Apply ALL stored configs to every provider in a runtime. Called once at
 * module load (before the first discovery) and again from the Settings page
 * after the user edits a key.
 */
export function applyStoredConfigs(runtime: AIRuntime): void {
  for (const provider of runtime.providers.all()) applyConfig(provider);
}
