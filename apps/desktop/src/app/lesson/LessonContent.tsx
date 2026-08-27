"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Lesson, QuizEvaluation } from "@/types";
import Quiz from "@/components/Quiz";
import DiagnosticQuiz from "@/components/DiagnosticQuiz";
import AudioPlayer from "@/components/AudioPlayer";
import PodcastPlayer from "@/components/PodcastPlayer";
import AudioFileDownload from "@/components/AudioFileDownload";
import Breadcrumbs from "@/components/Breadcrumbs";
import LessonTabs, { type TabId } from "@/components/LessonTabs";
import { markAccessed, markQuizComplete } from "@/lib/progress";
import { detectLanguage, type LessonLanguage } from "@/lib/generation";
import { generatePodcastOnly } from "@/lib/api";
import {
  listAvailableVoices,
  downloadVoice,
  checkFfmpeg,
  unifiedVoiceCatalog,
  unifiedVoicesForLanguage,
  isTtsAvailable,
  type UnifiedVoice,
} from "@/lib/tts";
import { useTopicAudioPipeline } from "@/hooks/useTopicAudioPipeline";
import { buildTtsText } from "@/lib/tts";

export default function LessonPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [activeSection, setActiveSection] = useState(0);
  const [showGlossary, setShowGlossary] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);
  const [progress, setProgress] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [evaluation, setEvaluation] = useState<QuizEvaluation | null>(null);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Tab + voice state
  const [activeTab, setActiveTab] = useState<TabId>("lesson");
  const [currentVoice, setCurrentVoice] = useState("en_US-lessac-medium");
  const [currentVoiceB, setCurrentVoiceB] = useState("en_US-amy-medium");
  const [podcastLang, setPodcastLang] = useState<LessonLanguage>("en");
  const [currentFormat, setCurrentFormat] = useState<"mp3" | "wav">("mp3");
  const [availableVoices, setAvailableVoices] = useState<string[]>([]);
  const [allVoices, setAllVoices] = useState<UnifiedVoice[]>([]);
  const [isTts, setIsTts] = useState(false);
  const [downloadingVoice, setDownloadingVoice] = useState<string | null>(null);
  const [ffmpegAvailable, setFfmpegAvailable] = useState(false);
  const [generatingPodcast, setGeneratingPodcast] = useState(false);
  const [podcastError, setPodcastError] = useState("");
  const [exitPending, setExitPending] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const pipeline = useTopicAudioPipeline();

  const lessonId = searchParams.get("id") || "";

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("study-studio-library");
    if (!stored) { router.push("/"); return; }
    const library: Lesson[] = JSON.parse(stored);
    const found = library.find((l) => l.id === lessonId);
    if (found) {
      setLesson(found);
      setAudioPath(found.audioPath ?? null);
      if (found.ttsVoice) setCurrentVoice(found.ttsVoice);
      if (found.ttsVoiceB) setCurrentVoiceB(found.ttsVoiceB);
      if (found.audioFormat) setCurrentFormat(found.audioFormat);
      setPodcastLang(
        detectLanguage(`${found.title ?? ""} ${found.sections.map((s) => s.heading).join(" ")}`)
      );
      markAccessed(found.id);

      // Seed the 3-stage pipeline: Step 1 (HTML) is already complete for a
      // persisted lesson; Step 3 resumes from an existing audio file if any.
      pipeline.seedContent(found.title || "Lesson", buildTtsText(found));
      if (found.audioPath) {
        pipeline.seedAudio({ audiobook: found.audioPath, podcast: found.audioPath });
      }
    }
    else { router.push("/"); }
  }, [lessonId, router]);

  // Load voice availability + unified voice catalog
  useEffect(() => {
    listAvailableVoices().then(setAvailableVoices).catch(() => {});
    checkFfmpeg().then(setFfmpegAvailable).catch(() => {});
    unifiedVoiceCatalog().then(setAllVoices).catch(() => {});
    isTtsAvailable().then(setIsTts).catch(() => setIsTts(false));
  }, []);

  useEffect(() => {
    if (!lesson) return;
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(docHeight > 0 ? Math.min((scrollTop / docHeight) * 100, 100) : 0);
      sectionRefs.current.forEach((ref, i) => {
        if (ref) {
          const rect = ref.getBoundingClientRect();
          if (rect.top <= 150 && rect.bottom >= 100) setActiveSection(i);
        }
      });
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [lesson]);

  const scrollToSection = (index: number) => {
    sectionRefs.current[index]?.scrollIntoView({ behavior: "smooth" });
  };

  const handleRegenerate = () => {
    if (lesson) {
      router.push(`/generate?edit=${lesson.id}`);
    }
  };

  const handleEvaluationComplete = (evalResult: QuizEvaluation) => {
    setEvaluation(evalResult);
    if (lesson) {
      markQuizComplete(lesson.id, evalResult.overallScore);
    }
  };

  const handleAudioReady = (path: string) => {
    setAudioPath(path);
    if (!lesson) return;
    try {
      const stored = localStorage.getItem("study-studio-library");
      if (!stored) return;
      const library: Lesson[] = JSON.parse(stored);
      const idx = library.findIndex((l) => l.id === lesson.id);
      const item = library[idx];
      if (item) {
        library[idx] = { ...item, audioPath: path };
        localStorage.setItem("study-studio-library", JSON.stringify(library));
      }
    } catch {
      // Ignore a corrupt library; the in-memory state is still correct.
    }
  };

  const handleDownloadVoice = async (voiceId: string) => {
    setDownloadingVoice(voiceId);
    try {
      await downloadVoice(voiceId);
      setAvailableVoices((prev) => [...prev, voiceId]);
    } catch (e) {
      console.error("Voice download failed:", e);
    } finally {
      setDownloadingVoice(null);
    }
  };

  const handlePodcastLangChange = (lang: LessonLanguage) => {
    setPodcastLang(lang);
    const voices = unifiedVoicesForLanguage(allVoices, lang);
    if (voices.length === 0) return;
    if (!voices.some((v) => v.id === currentVoice) && voices[0]) setCurrentVoice(voices[0].id);
    if (!voices.some((v) => v.id === currentVoiceB)) {
      const fallback = voices[1] ?? voices[0];
      if (fallback) setCurrentVoiceB(fallback.id);
    }
  };

  const handleGeneratePodcast = async () => {
    if (!lesson) return;
    setGeneratingPodcast(true);
    setPodcastError("");
    try {
      const result = await generatePodcastOnly({
        topic: lesson.inputMode === "topic" ? lesson.inputText : undefined,
        content: lesson.inputMode === "content" ? lesson.inputText : undefined,
        model: lesson.modelName || undefined,
        difficulty: lesson.difficulty || "intermediate",
        language: podcastLang,
        length: lesson.length || "medium",
        voiceGenderA: currentVoice.includes("female") ? "female" : "male",
        voiceGenderB: currentVoiceB.includes("female") ? "female" : "male",
      });
      const updatedLesson = { ...lesson, podcastScript: result.podcastScript };
      setLesson(updatedLesson);
      const stored = localStorage.getItem("study-studio-library");
      const library: Lesson[] = stored ? JSON.parse(stored) : [];
      const idx = library.findIndex((l) => l.id === lesson.id);
      if (idx >= 0) library[idx] = updatedLesson;
      localStorage.setItem("study-studio-library", JSON.stringify(library));
    } catch (e) {
      setPodcastError(e instanceof Error ? e.message : "Failed to generate podcast");
    } finally {
      setGeneratingPodcast(false);
    }
  };

  // Exit interception: warn before leaving the page when generated audio has
  // not been saved to a user-chosen location yet (browser close/refresh).
  useEffect(() => {
    if (!pipeline.hasUnsavedAudio) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [pipeline.hasUnsavedAudio]);

  if (!lesson || !mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-16">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin h-8 w-8 border-[3px] border-primary border-t-transparent rounded-full" />
          <span className="text-sm text-muted animate-pulse">Loading lesson...</span>
        </div>
      </div>
    );
  }

  // Detect lesson language for voice filtering
  const lessonLang = detectLanguage(
    `${lesson.title ?? ""} ${lesson.sections.map((s) => s.heading).join(" ")}`
  );
  const isRtl = lessonLang === "ar";
  const langVoices = unifiedVoicesForLanguage(allVoices, lessonLang);
  const podcastVoices = unifiedVoicesForLanguage(allVoices, podcastLang);
  const hasPodcast = !!(lesson.podcastScript && lesson.podcastScript.length > 0);
  const diffLabel = lesson.difficulty || "intermediate";
  const diffEmoji = diffLabel === "beginner" ? "🌱" : diffLabel === "expert" ? "🎓" : "📚";

  // Guarded tab switch: if there is unsaved audio, ask before leaving the tab.
  const handleTabChange = (tab: TabId) => {
    if (tab !== activeTab && pipeline.hasUnsavedAudio) {
      pendingActionRef.current = () => setActiveTab(tab);
      setExitPending(true);
      return;
    }
    setActiveTab(tab);
  };

  // Guarded navigation (back to library / edit / create): intercept when audio
  // is unsaved so the user doesn't lose track of a generated-but-unsaved file.
  const guardedNavigate = (fn: () => void) => {
    if (pipeline.hasUnsavedAudio) {
      pendingActionRef.current = fn;
      setExitPending(true);
      return;
    }
    fn();
  };

  // Check if the primary voice for this lesson's language is available.
  // When the unified catalog hasn't loaded yet (langVoices empty), don't show
  // the "voice not downloaded" banner — it would be a false positive.
  const primaryVoice = langVoices[0]?.id || "en_US-lessac-medium";
  const isPrimaryVoiceAvailable = langVoices.length === 0 || availableVoices.includes(primaryVoice);

  return (
    <div className="flex flex-col min-h-screen pt-16" dir={isRtl ? "rtl" : undefined}>
      {/* Tab bar */}
      <LessonTabs activeTab={activeTab} onTabChange={handleTabChange} />

      {/* Main content */}
      <div className="flex-1 overflow-auto">
        {/* Progress bar */}
        <div className="sticky top-[7.5rem] left-0 right-0 h-1 bg-gray-200/50 dark:bg-gray-700/50 z-10">
          <div className="h-full bg-gradient-to-r from-primary to-accent-blue transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
        </div>

        {/* ===== LESSON TAB ===== */}
        {activeTab === "lesson" && (
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
            <Breadcrumbs title={lesson.title} />

            {/* Header */}
            <div ref={(el) => { sectionRefs.current[0] = el; }} className="mb-10 animate-fade-in">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="badge badge-primary">📖 Lesson</span>
                <span className="badge" style={{background: 'var(--sidebar)', border: '1px solid var(--card-border)'}}>
                  {diffEmoji} {diffLabel.charAt(0).toUpperCase() + diffLabel.slice(1)}
                </span>
                <span className="text-xs text-muted">
                  {new Date(lesson.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </div>
              <h1 className="text-4xl font-bold tracking-tight mb-2">{lesson.title}</h1>
            </div>

            {/* "Challenge Yourself" — human-initiated diagnostic quiz sidecar.
                NEVER auto-launches after audio; only appears once a stable stage
                is reached and only starts on this explicit button press. */}
            {pipeline.canStartQuiz && (
              <div className="card mb-6 animate-scale-in border-primary/20">
                <div className="flex items-center gap-3">
                  <span className="text-xl">⚡</span>
                  <div className="flex-1">
                    <h2 className="font-semibold">Challenge Yourself</h2>
                    <p className="text-xs text-muted">
                      3-5 quick diagnostic questions to lock the lesson in for good.
                    </p>
                  </div>
                  <button onClick={pipeline.startQuiz} className="btn btn-primary text-sm">
                    Challenge Yourself
                  </button>
                </div>
              </div>
            )}

            {pipeline.isQuizActive && (
              <DiagnosticQuiz
                lessonTitle={lesson.title}
                topicText={pipeline.state.htmlContent || buildTtsText(lesson)}
                glossary={lesson.glossary}
                language={lessonLang}
                model={lesson.modelName}
                onFinish={pipeline.completeQuiz}
                onExit={pipeline.exitQuiz}
              />
            )}

            {/* Sections */}
            {lesson.sections.map((section, i) => (
              <div
                key={i}
                ref={(el) => { sectionRefs.current[i + 1] = el; }}
                className="card mb-6 scroll-mt-24 animate-slide-up"
                style={{ animationDelay: `${i * 0.05}s` }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary-soft dark:bg-opacity-20 flex items-center justify-center text-primary text-sm font-bold">
                    {i + 1}
                  </span>
                  <h2 className="text-xl font-semibold">{section.heading}</h2>
                </div>
                <div className="text-foreground/85 leading-relaxed whitespace-pre-line text-[15px]">
                  {section.content}
                </div>
              </div>
            ))}

            {/* Glossary */}
            {hasGlossary(lesson) && (
              <div className="card mb-6 animate-scale-in" id="glossary">
                <button
                  onClick={() => setShowGlossary(!showGlossary)}
                  className="flex items-center gap-2 mb-4 w-full text-left"
                >
                  <span className="text-xl">📖</span>
                  <h2 className="text-xl font-semibold">Glossary</h2>
                  <span className="badge badge-green ml-auto text-xs">{lesson.glossary.length} terms</span>
                  <span className="text-muted text-sm">{showGlossary ? "▲" : "▼"}</span>
                </button>
                {showGlossary && (
                  <div className="space-y-4">
                    {lesson.glossary.map((item, i) => (
                      <div key={i} className="border-b border-card-border pb-4 last:border-0 last:pb-0">
                        <dt className="font-semibold text-primary flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                          {item.term}
                        </dt>
                        <dd className="text-sm text-foreground/75 mt-1.5 ml-3.5">{item.definition}</dd>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Quiz */}
            {hasQuiz(lesson) && (
              <div className="card mb-6">
                <button
                  onClick={() => setShowQuiz(!showQuiz)}
                  className="flex items-center gap-2 mb-4 w-full text-left"
                >
                  <span className="text-xl">✍️</span>
                  <h2 className="text-xl font-semibold">Quiz</h2>
                  <span className="badge badge-primary ml-auto text-xs">{lesson.quiz.length} questions</span>
                  <span className="text-muted text-sm">{showQuiz ? "▲" : "▼"}</span>
                </button>
                {showQuiz && (
                  <div className="animate-scale-in">
                    <Quiz
                      questions={lesson.quiz}
                      difficulty={lesson.difficulty || "intermediate"}
                      lessonTitle={lesson.title}
                      model={lesson.modelName}
                      onEvaluationComplete={handleEvaluationComplete}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Evaluation results */}
            {evaluation && (
              <div className="card mb-6 animate-scale-in border-accent-green/20">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-xl">📊</span>
                  <h2 className="text-xl font-semibold">Educational Assessment</h2>
                </div>
                <div className="flex items-center gap-4 mb-4 p-4 rounded-xl bg-gradient-to-br from-primary-soft to-transparent dark:from-primary-soft/20">
                  <div className="text-3xl font-bold bg-gradient-to-r from-primary to-accent-blue bg-clip-text text-transparent">
                    {evaluation.overallScore}%
                  </div>
                  <div>
                    <div className="font-semibold">
                      {evaluation.correctAnswers}/{evaluation.totalQuestions} correct
                    </div>
                    <div className="text-xs text-muted">
                      Rating: {evaluation.rating === "excellent" ? "🌟 Excellent" : evaluation.rating === "good" ? "👍 Good" : evaluation.rating === "fair" ? "📖 Fair" : "🔁 Needs Review"}
                    </div>
                  </div>
                </div>
                <p className="text-sm text-foreground/80 leading-relaxed mb-4 p-3 rounded-lg bg-sidebar">
                  {evaluation.feedback}
                </p>
                {evaluation.perQuestion && (
                  <div className="space-y-3">
                    {evaluation.perQuestion.map((q, i) => (
                      <div key={i} className={`p-3 rounded-xl border ${q.isCorrect ? "border-green-200 dark:border-green-800/30 bg-green-50/50 dark:bg-green-900/5" : "border-amber-200 dark:border-amber-800/30 bg-amber-50/50 dark:bg-amber-900/5"}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span>{q.isCorrect ? "✅" : "❌"}</span>
                          <span className="text-sm font-medium">Question {i + 1}</span>
                        </div>
                        <p className="text-xs text-muted">{q.explanation}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between py-10 mt-4 border-t border-card-border">
              <button onClick={() => guardedNavigate(() => router.push("/library"))} className="btn btn-ghost text-sm">← Learning Journey</button>
              <div className="flex gap-2">
                <button onClick={() => guardedNavigate(handleRegenerate)} className="btn btn-secondary text-sm">🔄 Edit</button>
                <button onClick={() => guardedNavigate(() => router.push("/generate"))} className="btn btn-primary text-sm">Create New →</button>
              </div>
            </div>
          </div>
        )}

        {/* ===== AUDIOBOOK TAB ===== */}
        {activeTab === "audiobook" && (
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
            <Breadcrumbs title={lesson.title} />

            <div className="mb-8 animate-fade-in">
              <div className="flex items-center gap-2 mb-3">
                <span className="badge badge-primary">🎧 Audiobook</span>
                <span className="badge" style={{background: 'var(--sidebar)', border: '1px solid var(--card-border)'}}>
                  {diffEmoji} {diffLabel.charAt(0).toUpperCase() + diffLabel.slice(1)}
                </span>
              </div>
              <h1 className="text-3xl font-bold tracking-tight mb-2">{lesson.title}</h1>
              <p className="text-sm text-muted">Listen to your lesson with text-to-speech</p>
            </div>

            {/* Voice missing banner */}
            {!isPrimaryVoiceAvailable && (
              <div className="mb-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800/30 animate-scale-in">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">⚠️</span>
                  <div className="flex-1">
                    <h3 className="font-semibold text-amber-700 dark:text-amber-400">
                      {lessonLang === "ar" ? "Arabic voice not downloaded" : "Voice not downloaded"}
                    </h3>
                    <p className="text-sm text-amber-600/80 dark:text-amber-500/80 mt-1">
                      {lessonLang === "ar"
                        ? "To generate Arabic audio, you need to download an Arabic voice model first. This is a one-time download."
                        : `To generate audio, you need to download the voice model first.`}
                    </p>
                    <div className="flex gap-2 mt-3">
                      {langVoices.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => handleDownloadVoice(v.id)}
                          disabled={downloadingVoice === v.id || availableVoices.includes(v.id)}
                          className={`btn text-xs ${
                            availableVoices.includes(v.id)
                              ? "btn-ghost opacity-50 cursor-not-allowed"
                              : downloadingVoice === v.id
                                ? "btn-secondary"
                                : "btn-primary"
                          }`}
                        >
                          {availableVoices.includes(v.id)
                            ? `✓ ${v.displayName}`
                            : downloadingVoice === v.id
                              ? `Downloading ${v.displayName}...`
                              : `⬇ ${v.displayName}`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!isTts && (
              <div className="mb-6 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/15 border border-slate-200 dark:border-slate-800/30 animate-scale-in">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">⚪</span>
                  <div className="flex-1">
                    <h3 className="font-semibold text-slate-700 dark:text-slate-400">
                      Text-to-speech unavailable
                    </h3>
                    <p className="text-sm text-slate-600/80 dark:text-slate-500/80 mt-1">
                      Audio generation requires a local TTS engine (Piper) installed with voice models,
                      or a supported browser with speech synthesis. Download a voice model or run the
                      desktop app to enable audio generation.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Voice selector */}
            <div className="card mb-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">🔊</span>
                <h3 className="font-semibold text-sm">Voice Settings</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-muted block mb-1">Voice</label>
                  <select
                    value={currentVoice}
                    onChange={(e) => setCurrentVoice(e.target.value)}
                    className="input-field text-xs"
                  >
                    {langVoices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.displayName} {availableVoices.includes(v.id) ? "✓" : "(download)"}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-muted block mb-1">Format</label>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setCurrentFormat("mp3")}
                      className={`flex-1 p-1.5 rounded-lg border text-[11px] font-medium text-center transition-all ${
                        currentFormat === "mp3"
                          ? "border-primary bg-primary text-white"
                          : ffmpegAvailable
                            ? "border-card-border hover:border-primary/50 bg-card"
                            : "border-card-border bg-card opacity-50 cursor-not-allowed"
                      }`}
                      disabled={!ffmpegAvailable}
                    >
                      MP3
                    </button>
                    <button
                      onClick={() => setCurrentFormat("wav")}
                      className={`flex-1 p-1.5 rounded-lg border text-[11px] font-medium text-center transition-all ${
                        currentFormat === "wav"
                          ? "border-primary bg-primary text-white"
                          : "border-card-border hover:border-primary/50 bg-card"
                      }`}
                    >
                      WAV
                    </button>
                  </div>
                </div>
              </div>
              {!availableVoices.includes(currentVoice) && (
                <button
                  onClick={() => handleDownloadVoice(currentVoice)}
                  disabled={downloadingVoice === currentVoice}
                  className="btn btn-secondary !py-1.5 !px-3 text-xs mt-3"
                >
                  {downloadingVoice === currentVoice ? (
                    <span className="flex items-center gap-1">
                      <span className="animate-spin h-3 w-3 border border-current border-t-transparent rounded-full" />
                      Downloading voice...
                    </span>
                  ) : (
                    "⬇ Download Voice Model"
                  )}
                </button>
              )}
            </div>

            {/* Audio player */}
            <div className="mb-6">
              <AudioPlayer
                sections={lesson.sections}
                title={lesson.title}
                onClose={() => setActiveTab("lesson")}
              />
            </div>

            {/* Download */}
            <AudioFileDownload
              lesson={lesson}
              audioPath={audioPath}
              onAudioReady={handleAudioReady}
              voice={currentVoice}
              onVoiceChange={setCurrentVoice}
              pipeline={pipeline}
              trackType="audiobook"
            />

            {/* Footer */}
            <div className="flex items-center justify-between py-10 mt-4 border-t border-card-border">
              <button onClick={() => handleTabChange("lesson")} className="btn btn-ghost text-sm">← Back to Lesson</button>
              <button onClick={() => guardedNavigate(handleRegenerate)} className="btn btn-secondary text-sm">🔄 Edit</button>
            </div>
          </div>
        )}

        {/* ===== PODCAST TAB ===== */}
        {activeTab === "podcast" && (
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
            <Breadcrumbs title={lesson.title} />

            <div className="mb-8 animate-fade-in">
              <div className="flex items-center gap-2 mb-3">
                <span className="badge badge-primary">🎙️ Podcast</span>
                <span className="badge" style={{background: 'var(--sidebar)', border: '1px solid var(--card-border)'}}>
                  {diffEmoji} {diffLabel.charAt(0).toUpperCase() + diffLabel.slice(1)}
                </span>
              </div>
              <h1 className="text-3xl font-bold tracking-tight mb-2">{lesson.title}</h1>
              <p className="text-sm text-muted">Two-host conversational podcast with dual voices</p>
            </div>

            {!hasPodcast ? (
              /* No podcast yet — show generate button */
              <div className="card p-8 text-center">
                <div className="text-4xl mb-4">🎙️</div>
                <h2 className="text-xl font-semibold mb-2">No podcast yet</h2>
                <p className="text-sm text-muted mb-6 max-w-md mx-auto">
                  Generate a two-host conversational podcast from this lesson. Choose a language and voices for each host below.
                </p>

                {/* Language selector */}
                <div className="mb-6 max-w-sm mx-auto text-left">
                  <label className="text-[11px] text-muted block mb-1">Podcast Language</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["en", "ar"] as LessonLanguage[]).map((lang) => (
                      <button
                        key={lang}
                        onClick={() => handlePodcastLangChange(lang)}
                        className={`p-2.5 rounded-xl border text-center transition-all ${
                          podcastLang === lang
                            ? "border-primary bg-primary-soft dark:bg-primary-soft/20"
                            : "border-card-border hover:border-primary/50 bg-card"
                        }`}
                      >
                        <div className="text-sm font-semibold">
                          {lang === "en" ? "🇬🇧 English" : "🇸🇦 العربية"}
                        </div>
                        <div className="text-[10px] text-muted mt-0.5">
                          {lang === "en" ? "English voices" : "Arabic voices"}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Voice selectors */}
                <div className="card mb-6 max-w-sm mx-auto">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-muted block mb-1">Host A Voice</label>
                      <select
                        value={currentVoice}
                        onChange={(e) => setCurrentVoice(e.target.value)}
                        className="input-field text-xs"
                      >
                        {podcastVoices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.gender === "male" ? "♂" : "♀"} {v.displayName} {availableVoices.includes(v.id) ? "✓" : "(download)"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] text-muted block mb-1">Host B Voice</label>
                      <select
                        value={currentVoiceB}
                        onChange={(e) => setCurrentVoiceB(e.target.value)}
                        className="input-field text-xs"
                      >
                        {podcastVoices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.gender === "male" ? "♂" : "♀"} {v.displayName} {availableVoices.includes(v.id) ? "✓" : "(download)"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    {!availableVoices.includes(currentVoice) && (
                      <button
                        onClick={() => handleDownloadVoice(currentVoice)}
                        disabled={downloadingVoice === currentVoice}
                        className="btn btn-secondary !py-1.5 !px-3 text-xs flex-1"
                      >
                        {downloadingVoice === currentVoice ? "Downloading..." : "⬇ Host A"}
                      </button>
                    )}
                    {!availableVoices.includes(currentVoiceB) && (
                      <button
                        onClick={() => handleDownloadVoice(currentVoiceB)}
                        disabled={downloadingVoice === currentVoiceB}
                        className="btn btn-secondary !py-1.5 !px-3 text-xs flex-1"
                      >
                        {downloadingVoice === currentVoiceB ? "Downloading..." : "⬇ Host B"}
                      </button>
                    )}
                  </div>
                </div>

                {podcastError && (
                  <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/15 border border-red-200 dark:border-red-800/30 text-red-600 dark:text-red-400 text-sm">
                    {podcastError}
                  </div>
                )}

                {!isTts && (
                  <div className="mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/15 border border-slate-200 dark:border-slate-800/30">
                    <div className="flex items-start gap-2">
                      <span className="text-slate-500 mt-0.5">⚪</span>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-400">
                          Text-to-speech unavailable
                        </p>
                        <p className="text-xs text-slate-600/80 dark:text-slate-500/80 mt-0.5">
                          Audio generation requires a local TTS engine (Piper) installed with voice models,
                          or a supported browser with speech synthesis. Download a voice model or run the
                          desktop app to enable audio generation.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleGeneratePodcast}
                  disabled={generatingPodcast || !isTts}
                  className={`btn px-8 ${isTts ? "btn-primary" : "btn-secondary opacity-50 cursor-not-allowed"}`}
                >
                  {generatingPodcast ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                      Generating Podcast...
                    </span>
                  ) : !isTts ? (
                    "🔇 TTS unavailable"
                  ) : (
                    "✨ Generate Podcast"
                  )}
                </button>

                <div className="flex items-center justify-between py-10 mt-4 border-t border-card-border">
                  <button onClick={() => handleTabChange("lesson")} className="btn btn-ghost text-sm">← Back to Lesson</button>
                  <button onClick={() => guardedNavigate(handleRegenerate)} className="btn btn-secondary text-sm">🔄 Edit</button>
                </div>
              </div>
            ) : (
              /* Has podcast — show voice settings + player */
              <>
                {/* Voice selectors */}
                <div className="card mb-6">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">🎙️</span>
                    <h3 className="font-semibold text-sm">Podcast Voice Settings</h3>
                    <span className="badge badge-primary text-[10px] ml-auto">
                      {podcastLang === "en" ? "🇬🇧 English" : "🇸🇦 العربية"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-muted block mb-1">Host A Voice</label>
                      <select
                        value={currentVoice}
                        onChange={(e) => setCurrentVoice(e.target.value)}
                        className="input-field text-xs"
                      >
                        {podcastVoices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.displayName} {availableVoices.includes(v.id) ? "✓" : "(download)"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] text-muted block mb-1">Host B Voice</label>
                      <select
                        value={currentVoiceB}
                        onChange={(e) => setCurrentVoiceB(e.target.value)}
                        className="input-field text-xs"
                      >
                        {podcastVoices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.displayName} {availableVoices.includes(v.id) ? "✓" : "(download)"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    {!availableVoices.includes(currentVoice) && (
                      <button
                        onClick={() => handleDownloadVoice(currentVoice)}
                        disabled={downloadingVoice === currentVoice}
                        className="btn btn-secondary !py-1.5 !px-3 text-xs"
                      >
                        {downloadingVoice === currentVoice ? "Downloading..." : "⬇ Download Host A Voice"}
                      </button>
                    )}
                    {!availableVoices.includes(currentVoiceB) && (
                      <button
                        onClick={() => handleDownloadVoice(currentVoiceB)}
                        disabled={downloadingVoice === currentVoiceB}
                        className="btn btn-secondary !py-1.5 !px-3 text-xs"
                      >
                        {downloadingVoice === currentVoiceB ? "Downloading..." : "⬇ Download Host B Voice"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Podcast player */}
                <div className="mb-6">
                  <PodcastPlayer
                    script={lesson.podcastScript || []}
                    title={lesson.title}
                    onClose={() => setActiveTab("lesson")}
                  />
                </div>

                {/* Download */}
                <AudioFileDownload
                  lesson={{ ...lesson, ttsVoice: currentVoice, ttsVoiceB: currentVoiceB, audioFormat: currentFormat }}
                  audioPath={audioPath}
                  onAudioReady={handleAudioReady}
                  voice={currentVoice}
                  voiceB={currentVoiceB}
                  onVoiceChange={setCurrentVoice}
                  onVoiceBChange={setCurrentVoiceB}
                  pipeline={pipeline}
                  trackType="podcast"
                />

                {/* Footer */}
                <div className="flex items-center justify-between py-10 mt-4 border-t border-card-border">
                  <button onClick={() => handleTabChange("lesson")} className="btn btn-ghost text-sm">← Back to Lesson</button>
                  <button onClick={() => guardedNavigate(handleRegenerate)} className="btn btn-secondary text-sm">🔄 Edit</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Exit interception: generated audio hasn't been saved to a user-chosen
          location yet. Offer to stay, or leave anyway (file stays in app-data). */}
      {exitPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card card-lg max-w-md w-full animate-scale-in">
            <div className="flex items-center gap-3 mb-4">
              <span className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-2xl">⚠️</span>
              <div>
                <h3 className="font-bold text-lg leading-tight">Unsaved audio file</h3>
                <p className="text-xs text-muted">Your generated audio hasn't been saved to a location you chose.</p>
              </div>
            </div>
            <p className="text-sm text-foreground/80 mb-5 leading-relaxed">
              The generated audio file exists in the app data folder, but you haven't
              chosen where to keep it. If you leave now you can still download it next
              time you open this lesson — nothing is lost. Prefer to save it now?
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  pendingActionRef.current = null;
                  setExitPending(false);
                }}
                className="btn btn-ghost text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const fn = pendingActionRef.current;
                  pendingActionRef.current = null;
                  setExitPending(false);
                  // Mark both tracks saved so the guard won't re-trigger this visit.
                  pipeline.seedAudio({
                    audiobook: pipeline.state.tempAudioPaths.audiobook || undefined,
                    podcast: pipeline.state.tempAudioPaths.podcast || undefined,
                  });
                  fn?.();
                }}
                className="btn btn-secondary text-sm"
              >
                Leave Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function hasGlossary(lesson: Lesson): boolean {
  return lesson.glossary.length > 0;
}

function hasQuiz(lesson: Lesson): boolean {
  return lesson.quiz.length > 0;
}
