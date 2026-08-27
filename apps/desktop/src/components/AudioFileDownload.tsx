"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Lesson } from "@/types";
import type { AudioTrackType } from "@/lib/topicPipeline";
import type { useTopicAudioPipeline } from "@/hooks/useTopicAudioPipeline";
import {
  checkFfmpeg,
  listAvailableVoices,
  downloadVoice,
  unifiedVoiceCatalog,
  unifiedVoicesForLanguage,
  audioFileUrl,
  isTtsAvailable,
  type UnifiedVoice,
} from "@/lib/tts";

interface Props {
  lesson: Lesson;
  audioPath: string | null;
  onAudioReady: (path: string) => void;
  voice?: string;
  voiceB?: string;
  onVoiceChange?: (voice: string) => void;
  onVoiceBChange?: (voice: string) => void;
  /** Shared pipeline instance owned by the lesson page. */
  pipeline: ReturnType<typeof useTopicAudioPipeline>;
  /** Which track this panel governs: "audiobook" or "podcast". */
  trackType: AudioTrackType;
}

export default function AudioFileDownload({
  lesson,
  audioPath,
  onAudioReady,
  voice,
  voiceB,
  onVoiceChange,
  onVoiceBChange,
  pipeline,
  trackType,
}: Props) {
  const {
    state,
    generateAudio,
    playAudio,
    stopAudio,
    downloadTrack,
    seedAudio,
    canGenerateAudio,
  } = pipeline;

  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [format, setFormat] = useState<"mp3" | "wav">(lesson.audioFormat || "mp3");
  const [ffmpegAvailable, setFfmpegAvailable] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<string[]>([]);
  const [downloadingVoice, setDownloadingVoice] = useState(false);
  const [allVoices, setAllVoices] = useState<UnifiedVoice[]>([]);
  const [isTts, setIsTts] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const hasPodcast = trackType === "podcast";

  // Detect lesson language
  const lessonLang = /[\u0600-\u06FF]/.test(
    `${lesson.title ?? ""} ${lesson.sections?.map((s) => s.heading).join(" ") ?? ""}`
  )
    ? "ar"
    : "en";
  const langVoices = unifiedVoicesForLanguage(allVoices, lessonLang);

  const currentVoice = voice || lesson.ttsVoice || langVoices[0]?.id || "en_US-lessac-medium";
  const currentVoiceB =
    voiceB ||
    lesson.ttsVoiceB ||
    (langVoices.find((v) => v.gender === "female") ?? langVoices[1] ?? langVoices[0])?.id ||
    currentVoice;

  const isVoiceAvailable = availableVoices.includes(currentVoice);
  const isVoiceBAvailable = !hasPodcast || availableVoices.includes(currentVoiceB);
  const voicesReady = isVoiceAvailable && isVoiceBAvailable;

  const tempPath = state.tempAudioPaths[trackType];
  const isSaved = Boolean(state.savedLocations[trackType]);
  const isGenerating = state.stage === "AUDIO_GENERATING";
  const isListening = state.stage === "LISTENING" && state.activePlayingTrack === trackType;
  const isDownloading = state.stage === "DOWNLOADING" && state.activeDownloadingTrack === trackType;

  useEffect(() => {
    checkFfmpeg().then(setFfmpegAvailable).catch(() => {});
    listAvailableVoices()
      .then(setAvailableVoices)
      .catch(() => {});
    unifiedVoiceCatalog()
      .then(setAllVoices)
      .catch(() => {});
    isTtsAvailable().then(setIsTts).catch(() => setIsTts(false));
  }, []);

  // Resume a lesson that already has an audio file on disk: seed Step 3 as
  // already done so the pipeline lands in AUDIO_READY, not IDLE/TOPIC_GENERATED.
  useEffect(() => {
    if (!audioPath || state.tempAudioPaths[trackType] || state.stage === "AUDIO_GENERATING") return;
    seedAudio({ [trackType]: audioPath });
  }, [audioPath, trackType, state.stage, state.tempAudioPaths, seedAudio]);

  // Build a playable URL whenever a temp path is available.
  useEffect(() => {
    if (tempPath) {
      audioFileUrl(tempPath)
        .then(setPlayUrl)
        .catch(() => setPlayUrl(null));
    } else {
      setPlayUrl(null);
    }
  }, [tempPath]);

  // Drive the <audio> element from the pipeline state (LISTENING plays, anything
  // else pauses — mutual exclusion with DOWNLOADING is enforced by the state).
  useEffect(() => {
    if (isListening && playUrl) {
      audioRef.current?.play().catch(() => {});
    } else {
      audioRef.current?.pause();
    }
  }, [isListening, playUrl]);

  // Persist a freshly generated temp file to the lesson in the library.
  useEffect(() => {
    if (tempPath && tempPath !== audioPath) {
      onAudioReady(tempPath);
    }
  }, [tempPath, audioPath, onAudioReady]);

  const handleDownloadVoice = useCallback(
    async (targetVoice: string) => {
      setDownloadingVoice(true);
      try {
        await downloadVoice(targetVoice);
        setAvailableVoices((prev) => (prev.includes(targetVoice) ? prev : [...prev, targetVoice]));
      } catch (e) {
        console.error("Voice download failed:", e);
      } finally {
        setDownloadingVoice(false);
      }
    },
    []
  );

  /** Step 2: generate the real audio file via the pipeline. */
  const handleGenerate = () => {
    if (!canGenerateAudio) return;
    generateAudio(trackType, lesson, {
      audiobookVoice: currentVoice,
      podcastVoice1: currentVoice,
      podcastVoice2: currentVoiceB,
      format,
    });
  };

  /** Step 3: governed save — user picks a destination; listening is disabled meanwhile. */
  const handleDownload = async () => {
    const safeName = lesson.title.replace(/[\\/:*?"<>|]/g, "_").trim() || "study-studio";
    await downloadTrack(
      trackType,
      `${safeName}-${hasPodcast ? "podcast" : "audiobook"}.${format}`
    );
  };

  return (
    <div className="card border-blue-200/50 dark:border-blue-800/30 bg-gradient-to-br from-blue-50/70 to-cyan-50/30 dark:from-blue-900/10 dark:to-cyan-900/5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">💾</span>
          <div>
            <h3 className="font-semibold text-sm">
              {hasPodcast ? "Podcast Audio File" : "Audiobook Audio File"}
            </h3>
            <p className="text-[11px] text-muted">
              {hasPodcast ? "Real two-host audio generated locally by Piper TTS" : "Real audio generated locally by Piper TTS"}
            </p>
          </div>
        </div>
        {tempPath && <span className="badge badge-green text-[10px]">File created on disk</span>}
      </div>

      {/* Guided pipeline state message */}
      {state.humorousGuidance && (
        <p className="text-[11px] text-muted mb-3 px-0.5 italic">
          {state.humorousGuidance}
        </p>
      )}

      {/* Voice missing warning */}
      {!voicesReady && (
        <div className="mb-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800/30">
          <div className="flex items-start gap-2">
            <span className="text-amber-500 mt-0.5">⚠️</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                {hasPodcast ? "Voices not downloaded" : "Voice not downloaded"}
              </p>
              <p className="text-xs text-amber-600/80 dark:text-amber-500/80 mt-0.5">
                {hasPodcast
                  ? `"${currentVoice}" and "${currentVoiceB}" must be installed before creating the file.`
                  : `"${currentVoice}" must be installed before creating the file.`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {!isVoiceAvailable && (
              <button
                onClick={() => handleDownloadVoice(currentVoice)}
                disabled={downloadingVoice}
                className="btn btn-secondary !py-1.5 !px-3 text-xs"
              >
                {downloadingVoice ? "Downloading..." : `⬇ ${langVoices.find((v) => v.id === currentVoice)?.displayName || currentVoice}`}
              </button>
            )}
            {hasPodcast && !isVoiceBAvailable && (
              <button
                onClick={() => handleDownloadVoice(currentVoiceB)}
                disabled={downloadingVoice}
                className="btn btn-secondary !py-1.5 !px-3 text-xs"
              >
                {downloadingVoice ? "Downloading..." : `⬇ ${langVoices.find((v) => v.id === currentVoiceB)?.displayName || currentVoiceB}`}
              </button>
            )}
          </div>
        </div>
      )}

      {!isTts && (
        <div className="mb-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/15 border border-slate-200 dark:border-slate-800/30">
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

      {/* Voice & format selectors */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-[11px] text-muted block mb-1">{hasPodcast ? "Host A Voice" : "Voice"}</label>
          <select
            value={currentVoice}
            onChange={(e) => onVoiceChange?.(e.target.value)}
            className="input-field text-xs"
          >
            {langVoices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.displayName} {availableVoices.includes(v.id) ? "✓" : "(not downloaded)"}
              </option>
            ))}
          </select>
        </div>
        {hasPodcast && (
          <div>
            <label className="text-[11px] text-muted block mb-1">Host B Voice</label>
            <select
              value={currentVoiceB}
              onChange={(e) => onVoiceBChange?.(e.target.value)}
              className="input-field text-xs"
            >
              {langVoices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.displayName} {availableVoices.includes(v.id) ? "✓" : "(not downloaded)"}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="text-[11px] text-muted block mb-1">Format</label>
          <div className="flex gap-1">
            <button
              onClick={() => setFormat("mp3")}
              className={`flex-1 p-1.5 rounded-lg border text-[11px] font-medium text-center transition-all ${
                format === "mp3"
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
              onClick={() => setFormat("wav")}
              className={`flex-1 p-1.5 rounded-lg border text-[11px] font-medium text-center transition-all ${
                format === "wav"
                  ? "border-primary bg-primary text-white"
                  : "border-card-border hover:border-primary/50 bg-card"
              }`}
            >
              WAV
            </button>
          </div>
        </div>
      </div>

      {isGenerating && (
        <div className="mb-3 p-4 rounded-xl border border-card-border bg-sidebar/50 flex items-center gap-3 animate-scale-in">
          <span className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
          <span className="text-sm text-muted">
            Generating {hasPodcast ? "podcast" : "audiobook"} audio...
          </span>
        </div>
      )}

      {playUrl && tempPath && (
        <div className={`mb-3 ${isDownloading ? "pointer-events-none opacity-50" : ""}`}>
          <audio
            ref={audioRef}
            controls
            src={playUrl}
            preload="metadata"
            className="w-full"
            onPlay={() => playAudio(trackType)}
            onPause={() => stopAudio()}
            onEnded={() => stopAudio()}
          />
        </div>
      )}

      {tempPath && (
        <p className="text-[11px] text-muted mb-3 break-all">
          <span className="font-medium text-foreground">File:</span> {tempPath}
        </p>
      )}

      {!tempPath && (
        <p className="text-[11px] text-muted mb-3">
          No file is created until you click the button below — listening never generates a file.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!tempPath && (
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !isTts || !voicesReady || !canGenerateAudio}
            className={`btn !py-2 text-sm ${isTts && voicesReady ? "btn-primary" : "btn-secondary opacity-50 cursor-not-allowed"}`}
          >
            {isGenerating ? (
              <span className="flex items-center gap-1.5">
                <span className="animate-spin h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full" />
                Generating...
              </span>
            ) : !isTts ? (
              "🔇 TTS unavailable"
            ) : !voicesReady ? (
              "🔒 Download voice first"
            ) : (
              `⬇ Generate ${format.toUpperCase()} File`
            )}
          </button>
        )}
        {tempPath && (
          <>
            <button
              onClick={isListening ? stopAudio : () => playAudio(trackType)}
              disabled={pipeline.isListenDisabled || isDownloading}
              className="btn btn-primary !py-2 text-sm"
            >
              {isListening ? "⏹ Stop" : `▶ Listen ${format.toUpperCase()}`}
            </button>
            <button
              onClick={handleDownload}
              disabled={pipeline.isDownloadDisabled || isGenerating || isListening}
              className="btn btn-secondary !py-2 text-sm"
            >
              {isDownloading ? "⏳ Choosing location..." : `⬇️ Save ${format.toUpperCase()} File`}
            </button>
          </>
        )}
        {isSaved && <span className="text-xs text-accent-green font-medium">✓ Saved to your chosen location</span>}
      </div>

      {state.error && <p className="text-xs text-red-500 dark:text-red-400 mt-3 leading-relaxed">{state.error}</p>}

      <p className="text-[11px] text-muted mt-3">
        Listening and saving are mutually exclusive: playback pauses while the save
        dialog is open, and saving is disabled while audio is playing. The file is
        only created on disk when you generate it, and stays in the app data folder
        until you save it to your chosen location.
      </p>
    </div>
  );
}
