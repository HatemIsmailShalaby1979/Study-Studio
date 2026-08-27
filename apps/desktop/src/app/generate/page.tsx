"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { v4 as uuidv4 } from "uuid";
import { Lesson, Difficulty } from "@/types";
import { generateLesson } from "@/lib/api";
import { detectLanguage, type LessonLanguage } from "@/lib/generation";
import { profileAndValidate } from "@/lib/modelProfiler";
import { skillInjector, listSkills } from "@/lib/skills";
import { useMetacognitiveObserver } from "@/hooks/useMetacognitive";
import MetacognitivePulse from "@/components/MetacognitivePulse";
import { getJourney, addTopicToJourney, buildJourneyContextPrompt, type Journey } from "@/lib/journeys";
import { useAIRuntime } from "@/components/AIRuntimeProvider";
import { friendlyErrorByKind } from "@/lib/friendlyErrors";

const LANGUAGES: { value: LessonLanguage | "auto"; label: string; desc: string; emoji: string }[] = [
  { value: "auto", label: "Auto", desc: "Detect from topic", emoji: "🌐" },
  { value: "en", label: "English", desc: "English content", emoji: "🇬🇧" },
  { value: "ar", label: "العربية", desc: "Arabic content (RTL)", emoji: "🇸🇦" },
];

const SUGGESTIONS = [
  { label: "Quantum Computing", emoji: "⚛️" },
  { label: "Renaissance Art", emoji: "🎨" },
  { label: "Python Basics", emoji: "🐍" },
  { label: "Neural Networks", emoji: "🧠" },
  { label: "World War II", emoji: "🌍" },
  { label: "Photosynthesis", emoji: "🌿" },
  { label: "الذكاء الاصطناعي", emoji: "🤖" },
  { label: "تاريخ الحضارة الإسلامية", emoji: "🕌" },
];

const DIFFICULTIES: { value: Difficulty; label: string; desc: string; emoji: string }[] = [
  { value: "beginner", label: "Beginner", desc: "Simple language, first principles", emoji: "🌱" },
  { value: "intermediate", label: "Intermediate", desc: "Technical depth, real examples", emoji: "📚" },
  { value: "expert", label: "Expert", desc: "Advanced, rigorous & comprehensive", emoji: "🎓" },
];

/** Human-readable names for every provider the runtime may report. */
const PROVIDER_NAMES: Record<string, string> = {
  ollama: "Ollama (Local)",
  "lm-studio": "LM Studio (Local)",
  openai: "OpenAI (Hosted)",
  openrouter: "OpenRouter (Hosted)",
  localai: "LocalAI",
  vllm: "vLLM",
  litellm: "LiteLLM Proxy",
  fastchat: "FastChat",
};

function GenerateContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { initialized, initializing, available, canGenerate, models, recommendedModel, message, refresh, mode, activeProviderId, providerStatuses, ttsAvailable, needsApiKey, setActiveProvider } = useAIRuntime();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [error, setError] = useState("");
  const [length, setLength] = useState<"short" | "medium" | "long" | "comprehensive">("medium");
  const [difficulty, setDifficulty] = useState<Difficulty>("intermediate");
  const [language, setLanguage] = useState<LessonLanguage | "auto">("auto");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [profilerWarning, setProfilerWarning] = useState("");
  const [selectedSkill, setSelectedSkill] = useState("default");
  const [profilingModel, setProfilingModel] = useState(false);
  const [activeJourney, setActiveJourney] = useState<Journey | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const metacognitive = useMetacognitiveObserver();

  // Derive a friendly provider hint for the model selector. The runtime
  // auto-detects any local server (Ollama, LM Studio, vLLM, LocalAI, LiteLLM,
  // FastChat) — not a single hardcoded one. When none is up, or only an online
  // provider is active, we point the user to /settings.
  const LOCAL_IDS = ["ollama", "lm-studio", "localai", "vllm", "litellm", "fastchat"];
  const hasLocalProvider = providerStatuses.some(
    (s) => LOCAL_IDS.includes(s.providerId) && s.available
  );
  const hasOnlineProvider = providerStatuses.some(
    (s) => ["openai", "openrouter"].includes(s.providerId) && s.available
  );
  const showProviderHint = initialized && (!hasLocalProvider || hasOnlineProvider);

  // Providers the user can switch to right now: anything that answered the
  // scan (or has a stored key), plus the currently active one even if it went
  // offline. Local runtimes sort first so local-first stays the default.
  const selectableProviders = providerStatuses
    .filter((s) => s.available || s.providerId === activeProviderId)
    .sort((a, b) => {
      const la = LOCAL_IDS.includes(a.providerId) ? 0 : 1;
      const lb = LOCAL_IDS.includes(b.providerId) ? 0 : 1;
      return la - lb || a.providerId.localeCompare(b.providerId);
    });

  // Determine the hint message based on current mode
  const getProviderHint = () => {
    if (hasLocalProvider && ttsAvailable) {
      return "🟢 Local model + TTS detected — full offline generation (HTML, quizzes, glossary, podcast, audiobook) enabled.";
    }
    if (hasLocalProvider && !ttsAvailable) {
      return "🟡 Local model detected — HTML, quizzes, glossary, podcast ready. Download a TTS voice in Settings for audio.";
    }
    if (hasOnlineProvider) {
      return "☁️ Online provider active — HTML, quizzes, glossary available. Audio requires a local TTS engine (download a voice in Settings).";
    }
    return "⚠️ No model detected. Start a local server (Ollama, LM Studio, vLLM, etc.) or add an OpenAI / OpenRouter API key in Settings.";
  };

  // Sync models from the app-level AI runtime context into local state. When
  // the active provider changes (e.g. Ollama → OpenRouter), reset a stale model
  // selection that no longer exists in the new provider's list.
  useEffect(() => {
    if (initialized) {
      const known = models.some((m) => m.id === selectedModel);
      if (canGenerate && models.length > 0 && !known) {
        setSelectedModel(recommendedModel || models[0]!.id);
      } else if (!canGenerate && message) {
        setError("I couldn't find a local model or API key. Start Ollama/LM Studio or enter an API key to continue.");
      }
    }
  }, [initialized, available, models, selectedModel, canGenerate, recommendedModel, message]);

  useEffect(() => {
    const edit = searchParams.get("edit");
    if (edit) {
      setEditingId(edit);
      const stored = localStorage.getItem("study-studio-library");
      if (stored) {
        const library: Lesson[] = JSON.parse(stored);
        const found = library.find((l) => l.id === edit);
        if (found) {
          setInput(found.inputText || found.title);
          if (found.difficulty) setDifficulty(found.difficulty);
        }
      }
    }
    const journeyId = searchParams.get("journey");
    if (journeyId) {
      setActiveJourney(getJourney(journeyId));
    }
  }, [searchParams]);

  const handleModelChange = useCallback(
    async (modelId: string) => {
      setSelectedModel(modelId);
      setProfilerWarning("");
      setProfilingModel(true);
      if (!modelId) {
        setProfilingModel(false);
        return;
      }
      try {
        const { validation } = await profileAndValidate(modelId, "lesson");
        if (validation.suitable === false) {
          setProfilerWarning(validation.message || "");
        }
      } catch {
        // Profiling is best-effort; never block generation on it.
      } finally {
        setProfilingModel(false);
      }
    },
    []
  );

  const handleGenerate = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setError("");
    const controller = new AbortController();
    abortRef.current = controller;

    // Bind the selected skill to the model (re-injection only on change).
    skillInjector.bind(selectedModel || "auto", selectedSkill);

    try {
      const isContent = input.length > 80 || input.includes("\n");
      // Journey context: pull existing topics so the new one builds on prior
      // material in the same track.
      let journeyContextPrompt: string | undefined;
      if (activeJourney) {
        try {
          const stored = localStorage.getItem("study-studio-library");
          const lessons: Lesson[] = stored ? JSON.parse(stored) : [];
          const topics = activeJourney.topicIds
            .map((id) => lessons.find((l) => l.id === id))
            .filter((l): l is Lesson => Boolean(l))
            .map((l) => ({ id: l.id, title: l.title }));
          journeyContextPrompt = buildJourneyContextPrompt(activeJourney, topics);
        } catch {
          journeyContextPrompt = activeJourney.description ?? `Journey: ${activeJourney.title}`;
        }
      }

      const data = await generateLesson({
        topic: isContent ? undefined : input.trim(),
        content: isContent ? input.trim() : undefined,
        model: selectedModel || undefined,
        difficulty,
        language: language === "auto" ? undefined : language,
        length,
        journeyContext: journeyContextPrompt,
        signal: controller.signal,
      });

      if (!data.sections || data.sections.length === 0) {
        throw new Error("Response missing lesson content");
      }

      const lesson: Lesson = {
        id: editingId || uuidv4(),
        title: data.title || "Untitled Lesson",
        sections: data.sections,
        glossary: data.glossary || [],
        quiz: data.quiz || [],
        createdAt: new Date().toISOString(),
        type: "lesson",
        podcastScript: undefined,
        difficulty,
        inputText: input.trim(),
        inputMode: isContent ? "content" : "topic",
        htmlContent: data.htmlContent || null,
        audioUrl: null,
        format: data._format || "text",
        length: data._length || "medium",
        modelName: data._model || selectedModel,
        ttsVoice: undefined,
        ttsVoiceB: undefined,
        audioFormat: "mp3",
      };

      const stored = localStorage.getItem("study-studio-library");
      const library: Lesson[] = stored ? JSON.parse(stored) : [];

      if (editingId) {
        const idx = library.findIndex((l) => l.id === editingId);
        if (idx >= 0) library[idx] = lesson;
        else library.unshift(lesson);
      } else {
        library.unshift(lesson);
      }

      localStorage.setItem("study-studio-library", JSON.stringify(library));

      // Journey container: register the freshly generated topic into the active
      // journey so it appears in the track and future topics build on it.
      if (activeJourney && lesson.id) {
        addTopicToJourney(activeJourney.id, lesson.id);
        lesson.journeyId = activeJourney.id;
        const libIdx = library.findIndex((l) => l.id === lesson.id);
        if (libIdx >= 0) library[libIdx] = lesson;
        localStorage.setItem("study-studio-library", JSON.stringify(library));
      }

      // Metacognitive tracking: record topic completion (fires pulse every 5).
      metacognitive.recordTopicCompletion();

      if (editingId) {
        router.replace(`/lesson?id=${lesson.id}`);
      } else {
        router.push(`/lesson?id=${lesson.id}`);
      }
    } catch (e) {
      if (controller.signal.aborted) {
        setError("Generation cancelled.");
      } else {
        const friendly = friendlyErrorByKind("generic");
        const message = e instanceof Error ? e.message : String(e);
        const mapped = friendlyErrorByKind(
          message.includes("401") || message.includes("unauthor") || message.includes("api key") ? "api-key-invalid"
            : message.includes("tts") || message.includes("piper") || message.includes("voice") ? "audio-generation-failed"
            : message.includes("localhost") || message.includes("11434") || message.includes("1234") || message.includes("ollama") || message.includes("lm studio") ? "local-server-unreachable"
            : message.includes("network") || message.includes("timeout") || message.includes("fetch failed") ? "network"
            : "generic"
        );
        setError(`${mapped.message}${mapped.hint ? `\n\n${mapped.hint}` : ""}`);
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  };

  // Abort any in-flight generation when the user navigates away.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center px-4 pt-20 pb-16">
      <div className="w-full max-w-2xl text-center mb-6 animate-fade-in">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary-soft dark:bg-opacity-20 text-primary text-xs font-medium mb-4">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          Architecture of Knowledge
        </div>
        <h1 className="text-5xl font-bold tracking-tight mb-3 bg-gradient-to-r from-primary to-accent-blue bg-clip-text text-transparent">
          {editingId ? "Regenerate" : "Pursue Truth"}
        </h1>
        <p className="text-lg text-muted max-w-lg mx-auto">
          {editingId
            ? "Edit and regenerate your lesson"
            : "Type a topic. Earn understanding through deep, structured exploration."}
        </p>
      </div>

      {/* Active journey banner */}
      {activeJourney && (
        <Link
          href={`/journey?id=${activeJourney.id}`}
          className="w-full max-w-2xl mb-4 flex items-center justify-between gap-3 p-3 rounded-xl border border-primary/40 bg-primary-soft dark:bg-primary-soft/15 animate-slide-up"
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">🗺️</span>
            <div>
              <div className="text-xs text-muted">Adding to journey</div>
              <div className="text-sm font-semibold">{activeJourney.title}</div>
            </div>
          </div>
          <span className="text-xs text-primary font-medium whitespace-nowrap">
            View journey →
          </span>
        </Link>
      )}

      <div className="w-full max-w-2xl card card-lg animate-slide-up">
        {/* Difficulty selector */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-muted">Difficulty Level</label>
            <span className="badge badge-primary text-xs">{difficulty}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.value}
                onClick={() => setDifficulty(d.value)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  difficulty === d.value
                    ? "border-primary bg-primary-soft dark:bg-primary-soft/20"
                    : "border-card-border hover:border-primary/50 bg-card"
                }`}
              >
                <div className="text-lg mb-0.5">{d.emoji}</div>
                <div className="text-sm font-semibold">{d.label}</div>
                <div className="text-[10px] text-muted leading-tight mt-0.5">{d.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Length selector */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-muted">Content Length</label>
            <span className="badge badge-primary text-xs">{length}</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { value: "short", label: "Short", desc: "Quick overview" },
              { value: "medium", label: "Medium", desc: "Balanced" },
              { value: "long", label: "Long", desc: "Detailed" },
              { value: "comprehensive", label: "Comprehensive", desc: "Exhaustive" },
            ].map((l) => (
              <button
                key={l.value}
                onClick={() => setLength(l.value as any)}
                className={`p-2 rounded-xl border text-center transition-all ${
                  length === l.value
                    ? "border-primary bg-primary-soft dark:bg-primary-soft/20"
                    : "border-card-border hover:border-primary/50 bg-card"
                }`}
              >
                <div className="text-sm font-semibold">{l.label}</div>
                <div className="text-[9px] text-muted">{l.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Provider selector */}
        {selectableProviders.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-muted">Provider</label>
              <span className="badge badge-primary text-[10px]">
                {activeProviderId === ""
                  ? "Auto"
                  : LOCAL_IDS.includes(activeProviderId)
                    ? "Local-first"
                    : "Online"}
              </span>
            </div>
            <select
              value={activeProviderId}
              onChange={(e) => setActiveProvider(e.target.value)}
              className="input-field text-sm"
            >
              {selectableProviders.map((s) => (
                <option key={s.providerId} value={s.providerId}>
                  {PROVIDER_NAMES[s.providerId] ?? s.providerId}
                  {s.available ? "" : " (offline)"}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Model selector */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-muted">AI Model</label>
            <span className="badge badge-primary">{models.length > 0 ? `${models.length} models` : "Auto"}</span>
          </div>
          <select
            value={selectedModel}
            onChange={(e) => handleModelChange(e.target.value)}
            className="input-field text-sm"
          >
            <option value="">🤖 Auto (best available)</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          {profilingModel && (
            <div className="flex items-center gap-2 mt-2 text-xs text-muted">
              <div className="skeleton h-3 w-3 rounded-full" />
              Profiling model capabilities...
            </div>
          )}
          {profilerWarning && (
            <div className="mt-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800/30 text-amber-700 dark:text-amber-400 text-xs">
              ⚠️ {profilerWarning}
            </div>
          )}
          {initializing && (
            <div className="flex items-center gap-2 mt-2 text-xs text-muted">
              <div className="skeleton h-3 w-3 rounded-full" />
              Connecting to AI runtime...
            </div>
          )}
          {showProviderHint && (
            <div className="mt-2 p-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/15 border border-blue-200 dark:border-blue-800/30 text-blue-700 dark:text-blue-400 text-xs flex items-start gap-2">
              <span className="flex-1">{getProviderHint()}</span>
              <Link href="/settings" className="font-medium underline hover:no-underline whitespace-nowrap shrink-0 mt-0.5">
                Settings →
              </Link>
            </div>
          )}
        </div>

        {/* Skill selector */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-muted">Skill Injection</label>
            <span className="badge badge-primary text-[10px]">Session-scoped</span>
          </div>
          <select
            value={selectedSkill}
            onChange={(e) => setSelectedSkill(e.target.value)}
            className="input-field text-sm"
          >
            {listSkills().map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <p className="text-[10px] text-muted mt-1.5 px-1">
            Pinned system instructions prepended to every request for this session.
          </p>
        </div>

        {/* Language selector */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-muted">Output Language</label>
            <span className="badge badge-primary text-xs">
              {language === "auto" ? (detectLanguage(input) === "ar" ? "🇸🇦 Arabic" : "🇬🇧 English") : language === "ar" ? "🇸🇦 العربية" : "🇬🇧 English"}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {LANGUAGES.map((l) => (
              <button
                key={l.value}
                onClick={() => setLanguage(l.value)}
                className={`p-2 rounded-xl border text-center transition-all ${
                  language === l.value
                    ? "border-primary bg-primary-soft dark:bg-primary-soft/20"
                    : "border-card-border hover:border-primary/50 bg-card"
                }`}
              >
                <div className="text-lg mb-0.5">{l.emoji}</div>
                <div className="text-sm font-semibold">{l.label}</div>
                <div className="text-[9px] text-muted">{l.desc}</div>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted mt-1.5 px-1">Your topic can be in any language — the lesson will be generated in the selected language above.</p>
        </div>

        {/* Text input */}
        <div className="relative mb-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a topic — any language works.&#10;&#10;Examples: 'INTJ Personality Type', 'Quantum Computing', 'الذكاء الاصطناعي'&#10;&#10;Output language is controlled by the selector below."
            className="input-field h-44 resize-y mb-2"
          />
          <div className="flex items-center justify-between text-xs text-muted px-1">
            <span>{input.length} chars</span>
            {input.length > 80 && <span className="badge badge-green">📄 Content mode</span>}
          </div>
        </div>

        {/* Topic suggestions */}
        {!input.trim() && (
          <div className="mb-4">
            <p className="text-xs text-muted mb-2">Try a topic:</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => setInput(s.label)}
                  className="pill text-xs"
                >
                  <span>{s.emoji}</span> {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 p-3.5 rounded-xl bg-red-50 dark:bg-red-900/15 border border-red-200 dark:border-red-800/30 text-red-600 dark:text-red-400 text-sm animate-scale-in">
            <div className="flex items-start gap-2">
              <span className="mt-0.5">⚠️</span>
              <div className="flex-1">
                <span className="block whitespace-pre-line">{error}</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  <button
                    onClick={() => { setError(""); refresh(); }}
                    className="text-xs font-medium underline hover:no-underline"
                  >
                    Retry connection
                  </button>
                  <button
                    onClick={() => router.push("/settings")}
                    className="text-xs font-medium underline hover:no-underline"
                  >
                    Open Settings
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Generate button — lesson only; podcast is a separate action */}
        <button
          onClick={handleGenerate}
          disabled={loading || !input.trim() || !canGenerate}
          className="btn btn-primary w-full py-3.5 text-base font-semibold"
        >
          {loading ? (
            <span className="flex items-center gap-2.5">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Generating Lesson...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              {editingId ? "🔄" : "✨"}
              {editingId ? "Update & Regenerate" : "Generate Lesson"}
            </span>
          )}
        </button>

        {loading && (
          <button
            onClick={() => abortRef.current?.abort()}
            className="btn btn-secondary w-full mt-2 text-xs"
          >
            ⏹ Cancel
          </button>
        )}

        {editingId && (
          <button
            onClick={() => { setEditingId(null); setInput(""); router.replace("/generate"); }}
            className="btn btn-ghost w-full mt-2 text-xs"
          >
            Cancel edit
          </button>
        )}
      </div>

      <MetacognitivePulse
        showPulse={metacognitive.showPulse}
        rating={metacognitive.rating}
        setRating={metacognitive.setRating}
        feedback={metacognitive.feedback}
        setFeedback={metacognitive.setFeedback}
        optimizationAdvice={metacognitive.optimizationAdvice}
        retentionSummary={metacognitive.retentionSummary}
        onSubmit={metacognitive.submitPulse}
        onDismiss={metacognitive.dismissPulse}
      />
    </div>
  );
}

export default function Generate() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center pt-16">
        <div className="animate-spin h-8 w-8 border-[3px] border-primary border-t-transparent rounded-full" />
      </div>
    }>
      <GenerateContent />
    </Suspense>
  );
}
