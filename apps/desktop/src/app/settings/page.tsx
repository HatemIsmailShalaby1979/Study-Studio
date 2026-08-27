"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useAIRuntime } from "@/components/AIRuntimeProvider";
import {
  aiRuntime,
  getProviderConfig,
  setProviderConfig,
  clearProviderConfig,
  hasApiKey,
  validateOnlineProvider,
} from "@/lib/ai-runtime";
import {
  discoverInstalledVoices,
  listInstalledLanguages,
  downloadVoice,
  unifiedVoiceCatalog,
  type DiscoveredVoiceInfo,
  type UnifiedVoice,
} from "@/lib/tts";

// ---------------------------------------------------------------------------
// Mode summary definitions (spec §6)
// ---------------------------------------------------------------------------

interface ModeInfo {
  id: "offline" | "online" | "hybrid" | "unavailable";
  label: string;
  emoji: string;
  color: string;
  borderColor: string;
  bgColor: string;
  features: string[];
  condition: string;
}

const MODES: ModeInfo[] = [
  {
    id: "offline",
    label: "Offline Mode",
    emoji: "🖥️",
    color: "text-green-600 dark:text-green-400",
    borderColor: "border-green-300 dark:border-green-700",
    bgColor: "bg-green-50 dark:bg-green-900/15",
    features: ["HTML lessons", "Quizzes", "Glossary", "Podcast generation", "Audiobook generation", "Full download support"],
    condition: "Local models + local TTS detected",
  },
  {
    id: "online",
    label: "Online Mode",
    emoji: "☁️",
    color: "text-blue-600 dark:text-blue-400",
    borderColor: "border-blue-300 dark:border-blue-700",
    bgColor: "bg-blue-50 dark:bg-blue-900/15",
    features: ["HTML lessons", "Quizzes", "Glossary", "No audio (requires local TTS)"],
    condition: "Online API key active, no local server",
  },
  {
    id: "hybrid",
    label: "Hybrid Mode",
    emoji: "🔀",
    color: "text-purple-600 dark:text-purple-400",
    borderColor: "border-purple-300 dark:border-purple-700",
    bgColor: "bg-purple-50 dark:bg-purple-900/15",
    features: ["HTML via online", "Audio via local TTS", "Full download support"],
    condition: "Online LLM + local TTS engine",
  },
  {
    id: "unavailable",
    label: "No Provider",
    emoji: "⚠️",
    color: "text-red-600 dark:text-red-400",
    borderColor: "border-red-300 dark:border-red-700",
    bgColor: "bg-red-50 dark:bg-red-900/15",
    features: [],
    condition: "Start a local server or add an API key",
  },
];

// ---------------------------------------------------------------------------
// Provider display info
// ---------------------------------------------------------------------------

interface ProviderDisplay {
  id: string;
  name: string;
  emoji: string;
  type: "local" | "online";
}

const PROVIDERS: ProviderDisplay[] = [
  { id: "ollama", name: "Ollama (Local)", emoji: "🦙", type: "local" },
  { id: "lm-studio", name: "LM Studio (Local)", emoji: "🔬", type: "local" },
  { id: "openai", name: "OpenAI (Hosted)", emoji: "🤖", type: "online" },
  { id: "openrouter", name: "OpenRouter (Hosted)", emoji: "🌐", type: "online" },
];

// ---------------------------------------------------------------------------
// Settings page component
// ---------------------------------------------------------------------------

function SettingsContent() {
  const {
    initialized,
    available,
    models,
    recommendedModel,
    message,
    providerStatuses,
    activeProviderId,
    mode,
    ttsAvailable,
    refresh,
    refreshProviders,
    setActiveProvider,
  } = useAIRuntime();

  const [scanning, setScanning] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(activeProviderId);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyStatus, setApiKeyStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [validating, setValidating] = useState(false);
  const [installedVoices, setInstalledVoices] = useState<DiscoveredVoiceInfo[]>([]);
  const [installedLanguages, setInstalledLanguages] = useState<string[]>([]);
  const [downloadingVoice, setDownloadingVoice] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState("");

  // Sync the active provider from context.
  useEffect(() => {
    if (activeProviderId) setSelectedProvider(activeProviderId);
  }, [activeProviderId]);

  // Load TTS voice data on mount.
  useEffect(() => {
    (async () => {
      const [voices, langs] = await Promise.all([
        discoverInstalledVoices(),
        listInstalledLanguages(),
      ]);
      setInstalledVoices(voices);
      setInstalledLanguages(langs);
    })();
  }, []);

  // Populate the API key input when switching to an online provider.
  useEffect(() => {
    const provider = PROVIDERS.find((p) => p.id === selectedProvider);
    if (provider?.type === "online") {
      const stored = getProviderConfig(selectedProvider);
      setApiKeyInput(stored.apiKey ?? "");
      setApiKeyStatus(null);
    } else {
      setApiKeyInput("");
      setApiKeyStatus(null);
    }
  }, [selectedProvider]);

  const handleRescan = useCallback(async () => {
    setScanning(true);
    try {
      await refreshProviders();
      // Re-fetch voice data.
      const [voices, langs] = await Promise.all([
        discoverInstalledVoices(),
        listInstalledLanguages(),
      ]);
      setInstalledVoices(voices);
      setInstalledLanguages(langs);
    } catch {
      // Silent — the provider statuses already reflect the failure.
    } finally {
      setScanning(false);
    }
  }, [refreshProviders]);

  const handleProviderChange = useCallback(
    (id: string) => {
      setSelectedProvider(id);
      setActiveProvider(id);
    },
    [setActiveProvider]
  );

  const handleValidateKey = useCallback(async () => {
    setValidating(true);
    setApiKeyStatus(null);
    try {
      const result = await validateOnlineProvider(aiRuntime, selectedProvider, apiKeyInput.trim());
      if (result.valid) {
        // Persist the key on success.
        setProviderConfig(selectedProvider, { apiKey: apiKeyInput.trim() });
        // Apply to the live provider singleton.
        const provider = aiRuntime.providers.get(selectedProvider);
        provider?.setApiKey?.(apiKeyInput.trim());
        // Re-discover so the UI updates.
        await refreshProviders();
        setApiKeyStatus({ ok: true, msg: result.message ?? "Connected" });
      } else {
        setApiKeyStatus({ ok: false, msg: result.message ?? "This API key didn't work. Please check it and try again." });
      }
    } catch {
      setApiKeyStatus({ ok: false, msg: "Validation failed. Please check your connection and try again." });
    } finally {
      setValidating(false);
    }
  }, [selectedProvider, apiKeyInput, refreshProviders]);

  const handleClearKey = useCallback(() => {
    clearProviderConfig(selectedProvider);
    const provider = aiRuntime.providers.get(selectedProvider);
    provider?.setApiKey?.("");
    setApiKeyInput("");
    setApiKeyStatus(null);
    refreshProviders();
  }, [selectedProvider, refreshProviders]);

  const handleDownloadVoice = useCallback(async (voiceId: string) => {
    setDownloadingVoice(voiceId);
    setVoiceError("");
    try {
      await downloadVoice(voiceId);
      const voices = await discoverInstalledVoices();
      const langs = await listInstalledLanguages();
      setInstalledVoices(voices);
      setInstalledLanguages(langs);
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : "Voice download failed");
    } finally {
      setDownloadingVoice(null);
    }
  }, []);

  const selectedProviderDisplay = PROVIDERS.find((p) => p.id === selectedProvider);
  const selectedStatus = providerStatuses.find((s) => s.providerId === selectedProvider);
  const isOnlineProvider = selectedProviderDisplay?.type === "online";

  return (
    <div className="min-h-screen flex flex-col items-center px-4 pt-20 pb-16">
      {/* Header */}
      <div className="w-full max-w-3xl text-center mb-8 animate-fade-in">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary-soft dark:bg-opacity-20 text-primary text-xs font-medium mb-4">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          Model & Provider Configuration
        </div>
        <h1 className="text-4xl font-bold tracking-tight mb-3 bg-gradient-to-r from-primary to-accent-blue bg-clip-text text-transparent">
          Settings
        </h1>
        <p className="text-sm text-muted max-w-lg mx-auto">
          Configure AI providers, manage API keys, and discover installed TTS voices.
          Changes take effect immediately.
        </p>
      </div>

      {/* Mode Summary */}
      <section className="w-full max-w-3xl mb-6 animate-slide-up">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">📊</span>
          <h2 className="font-semibold text-sm">Current Mode</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {MODES.map((m) => {
            const active = mode === m.id;
            return (
              <div
                key={m.id}
                className={`p-4 rounded-xl border-2 transition-all ${
                  active
                    ? `${m.borderColor} ${m.bgColor} shadow-sm`
                    : "border-card-border bg-card opacity-60"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{m.emoji}</span>
                  <span className={`font-semibold text-sm ${active ? m.color : "text-muted"}`}>
                    {m.label}
                    {active && (
                      <span className="ml-2 text-[10px] font-normal badge" style={{ background: "var(--primary)", color: "#fff" }}>
                        ACTIVE
                      </span>
                    )}
                  </span>
                </div>
                {active && (
                  <p className="text-xs text-muted mb-2">{m.condition}</p>
                )}
                {m.features.length > 0 && (
                  <ul className="text-xs text-muted space-y-1">
                    {m.features.map((f) => (
                      <li key={f} className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-current" : "bg-gray-300"}`} />
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Provider Status */}
      <section className="w-full max-w-3xl mb-6 animate-slide-up">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🔌</span>
            <h2 className="font-semibold text-sm">Provider Status</h2>
          </div>
          <button
            onClick={handleRescan}
            disabled={scanning}
            className="btn btn-secondary text-xs !py-1 !px-3"
          >
            {scanning ? (
              <span className="flex items-center gap-1.5">
                <span className="animate-spin h-3 w-3 border border-current border-t-transparent rounded-full" />
                Scanning…
              </span>
            ) : (
              "🔄 Re-scan"
            )}
          </button>
        </div>
        <div className="card">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PROVIDERS.map((p) => {
              const status = providerStatuses.find((s) => s.providerId === p.id);
              const up = status?.available ?? false;
              const modelCount = status?.models?.length ?? 0;
              const isActive = activeProviderId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => handleProviderChange(p.id)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    isActive
                      ? "border-primary bg-primary-soft dark:bg-primary-soft/20"
                      : up
                        ? "border-green-300 dark:border-green-700/50 bg-green-50/50 dark:bg-green-900/10 hover:border-primary/50"
                        : "border-card-border bg-card hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-lg">{p.emoji}</span>
                    <span className={`w-2.5 h-2.5 rounded-full ${up ? "bg-green-400" : "bg-gray-300"}`} />
                  </div>
                  <div className="text-xs font-semibold truncate">{p.name}</div>
                  <div className="text-[10px] text-muted">
                    {up ? `${modelCount} model${modelCount !== 1 ? "s" : ""}` : "Unavailable"}
                  </div>
                  {p.type === "online" && hasApiKey(p.id) && (
                    <div className="text-[9px] text-blue-500 mt-1">🔑 Key stored</div>
                  )}
                </button>
              );
            })}
          </div>
          {!available && initialized && (
            <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800/30 text-amber-700 dark:text-amber-400 text-xs">
              💡 No local model detected. Start Ollama or LM Studio, or add an online API key below to generate HTML, quizzes, and glossaries. Audio requires a local TTS engine.
            </div>
          )}
        </div>
      </section>

      {/* Active Provider Config */}
      <section className="w-full max-w-3xl mb-6 animate-slide-up">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🎯</span>
          <h2 className="font-semibold text-sm">
            Active Provider: {selectedProviderDisplay?.name ?? "None"}
          </h2>
        </div>
        <div className="card">
          {/* Online: API key entry */}
          {isOnlineProvider && (
            <div className="mb-4">
              <label className="text-[11px] text-muted block mb-1.5">API Key</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => {
                    setApiKeyInput(e.target.value);
                    setApiKeyStatus(null);
                  }}
                  placeholder="sk-… or sk-or-…"
                  className="input-field text-xs flex-1 font-mono"
                />
                <button
                  onClick={handleValidateKey}
                  disabled={validating || !apiKeyInput.trim()}
                  className="btn btn-primary text-xs !py-1.5 !px-3 whitespace-nowrap"
                >
                  {validating ? "Validating…" : "Validate"}
                </button>
              </div>
              {apiKeyStatus && (
                <div
                  className={`mt-2 p-2.5 rounded-lg text-xs border ${
                    apiKeyStatus.ok
                      ? "bg-green-50 dark:bg-green-900/15 border-green-200 dark:border-green-800/30 text-green-700 dark:text-green-400"
                      : "bg-red-50 dark:bg-red-900/15 border-red-200 dark:border-red-800/30 text-red-600 dark:text-red-400"
                  }`}
                >
                  {apiKeyStatus.ok ? "✅" : "❌"} {apiKeyStatus.msg}
                </div>
              )}
              {hasApiKey(selectedProvider) && (
                <button
                  onClick={handleClearKey}
                  className="mt-2 text-xs text-muted hover:text-red-500 underline transition-colors"
                >
                  Clear stored key
                </button>
              )}
            </div>
          )}

          {/* Model list */}
          <div>
            <label className="text-[11px] text-muted block mb-1.5">
              Models {selectedStatus?.available ? `(${selectedStatus.models.length})` : ""}
            </label>
            {selectedStatus?.available && selectedStatus.models.length > 0 ? (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-card-border">
                {selectedStatus.models.map((m, i) => (
                  <div
                    key={m.id}
                    className={`flex items-center justify-between px-3 py-1.5 text-xs ${
                      i !== 0 ? "border-t border-card-border" : ""
                    } ${m.id === recommendedModel ? "bg-primary-soft/30" : ""}`}
                  >
                    <span className="truncate">{m.name}</span>
                    {m.id === recommendedModel && (
                      <span className="badge badge-primary text-[9px] ml-2 shrink-0">Best</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted">
                {selectedStatus?.available === false
                  ? "Provider is not reachable."
                  : "No models available for this provider."}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Voice & Language Discovery */}
      <section className="w-full max-w-3xl mb-6 animate-slide-up">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🔊</span>
          <h2 className="font-semibold text-sm">Voices & Languages</h2>
          <span className={`badge text-[10px] ${ttsAvailable ? "badge-green" : "badge-secondary"}`}>
            {ttsAvailable ? `${installedVoices.length} installed` : "No TTS detected"}
          </span>
        </div>
        <div className="card">
          {/* Installed languages */}
          {installedLanguages.length > 0 && (
            <div className="mb-4">
              <label className="text-[11px] text-muted block mb-1.5">Installed Languages</label>
              <div className="flex flex-wrap gap-1.5">
                {installedLanguages.map((lang) => (
                  <span key={lang} className="pill text-xs">{lang.toUpperCase()}</span>
                ))}
              </div>
            </div>
          )}

          {/* Installed voices table */}
          {installedVoices.length > 0 ? (
            <div className="mb-4">
              <label className="text-[11px] text-muted block mb-1.5">Installed Piper Voices</label>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-card-border">
                {installedVoices.map((v, i) => (
                  <div
                    key={v.id}
                    className={`flex items-center justify-between px-3 py-2 text-xs ${
                      i !== 0 ? "border-t border-card-border" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="badge badge-secondary text-[9px] shrink-0">{v.language}</span>
                      <span className="truncate">{v.id}</span>
                    </div>
                    <span className="text-muted text-[10px] shrink-0">{v.quality}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800/30 text-amber-700 dark:text-amber-400 text-xs">
              No TTS voices installed. Audio generation requires a local TTS engine (Piper). HTML, quizzes, and glossary are still available.
            </div>
          )}

          {/* Download curated seed voices */}
          <div>
            <label className="text-[11px] text-muted block mb-1.5">Download Recommended Voices</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "en_US-lessac-medium", label: "English (US) — Lessac", lang: "en" },
                { id: "en_US-amy-medium", label: "English (US) — Amy", lang: "en" },
                { id: "en_GB-alba-medium", label: "English (UK) — Alba", lang: "en" },
                { id: "ar_JO-kareem-medium", label: "العربية (JO) — كريم", lang: "ar" },
              ].map((seed) => {
                const installed = installedVoices.some((v) => v.id === seed.id);
                return (
                  <button
                    key={seed.id}
                    onClick={() => handleDownloadVoice(seed.id)}
                    disabled={installed || downloadingVoice === seed.id}
                    className={`p-2 rounded-xl border text-left text-xs transition-all ${
                      installed
                        ? "border-green-300 dark:border-green-700/50 bg-green-50/50 dark:bg-green-900/10"
                        : downloadingVoice === seed.id
                          ? "border-primary bg-primary-soft/30"
                          : "border-card-border hover:border-primary/50 bg-card"
                    }`}
                  >
                    <span className="font-medium">{seed.label}</span>
                    <div className="text-[10px] text-muted mt-0.5">
                      {installed
                        ? "✓ Installed"
                        : downloadingVoice === seed.id
                          ? "Downloading…"
                          : "⬇ Click to download"}
                    </div>
                  </button>
                );
              })}
            </div>
            {voiceError && (
              <p className="mt-2 text-xs text-red-500">{voiceError}</p>
            )}
          </div>
        </div>
      </section>

      {/* Actions */}
      <div className="w-full max-w-3xl flex items-center justify-between pt-4 border-t border-card-border animate-slide-up">
        <button onClick={() => refresh()} className="btn btn-secondary text-sm">
          🔄 Full Refresh
        </button>
        <Link href="/generate" className="btn btn-primary text-sm">
          Generate New →
        </Link>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center pt-16">
          <div className="animate-spin h-8 w-8 border-[3px] border-primary border-t-transparent rounded-full" />
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}
