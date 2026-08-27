// Topic Audio Pipeline React Hook
// Enforces strict 3-stage pipeline with mutual exclusion
// Uses Tauri IPC for audio generation and file operations

"use client";

import { useReducer, useCallback, useRef } from "react";
import {
  topicReducer,
  initialState,
  canGenerateAudio,
  canStartQuiz,
  hasUnsavedAudio,
  isDownloadDisabled,
  isListenDisabled,
  isQuizActive,
  type PipelineServices,
  type AudioTarget,
  type AudioTrackType,
  type VoiceConfig,
} from "../lib/topicPipeline";
import { isTauri } from "../lib/tauri";
import type { Lesson } from "@/types";
import { buildTtsText } from "../lib/tts";

// Service implementations for the pipeline
const pipelineServices: PipelineServices = {
  // Step 1: Generate HTML content via Ollama
  fetchHtml: async (topic: string, language: string): Promise<{ title: string; html: string }> => {
    const { generateLesson } = await import("../lib/generation");
    const result = await generateLesson({
      topic: topic.trim(),
      language: language as "en" | "ar",
      length: "medium",
      difficulty: "intermediate",
    });
    return {
      title: result.title || topic,
      html: result.htmlContent || "",
    };
  },

  // Step 2: Synthesize audio (audiobook, podcast, or both) from a real lesson
  // using Piper TTS. Returns the temp-workspace path(s) of the generated files.
  synthesizeAudio: async (target: AudioTarget, lesson: Lesson, config: VoiceConfig): Promise<{ audiobook?: string; podcast?: string }> => {
    if (!isTauri()) {
      throw new Error("Audio generation only available in desktop app");
    }

    const { generateAudio, generatePodcastAudio } = await import("../lib/tts");
    const format = config.format || "wav";
    const results: { audiobook?: string; podcast?: string } = {};

    if (target === "audiobook" || target === "both") {
      const info = await generateAudio(lesson, config.audiobookVoice, format);
      results.audiobook = info.path;
    }

    if (target === "podcast" || target === "both") {
      if (!lesson.podcastScript || lesson.podcastScript.length === 0) {
        throw new Error("Podcast generation requires a podcast script. Generate the script first.");
      }
      const info = await generatePodcastAudio(
        lesson,
        config.podcastVoice1 || "",
        config.podcastVoice2 || "",
        format
      );
      results.podcast = info.path;
    }

    return results;
  },

  // Step 3: Prompt user for file save location
  promptUserFileSave: async (defaultFileName: string): Promise<string | null> => {
    if (!isTauri()) return null;
    const { pickAudioDestination } = await import("../lib/tts");
    return pickAudioDestination(defaultFileName);
  },

  // Step 3: Copy the temp file to the user's chosen destination
  exportFile: async (sourcePath: string, destPath: string): Promise<void> => {
    const { exportAudio } = await import("../lib/tts");
    await exportAudio(sourcePath, destPath);
  },
};

export function useTopicAudioPipeline() {
  const [state, dispatch] = useReducer(topicReducer, initialState);
  const servicesRef = useRef(pipelineServices);

  // Seed Step 1 for an already-existing lesson (opened from library).
  const seedContent = useCallback((title: string, html: string) => {
    dispatch({ type: "SEED_CONTENT", payload: { title, html } });
  }, []);

  // Seed already-generated audio files so the lesson resumes at AUDIO_READY.
  const seedAudio = useCallback((paths: { audiobook?: string; podcast?: string }) => {
    dispatch({ type: "SEED_AUDIO", payload: paths });
  }, []);

  // Step 1: Generate HTML Only
  const generateTopic = useCallback(async (topic: string, language: string = "English") => {
    try {
      const data = await servicesRef.current.fetchHtml(topic, language);
      dispatch({ type: "GENERATE_HTML_SUCCESS", payload: data });
    } catch (err: any) {
      dispatch({ type: "AUDIO_GEN_FAILURE", payload: err.message || "Failed to generate topic HTML" });
    }
  }, []);

  // Step 2: Audio Synthesis (Audiobook, Podcast, or Both)
  const generateAudio = useCallback(async (target: AudioTarget, lesson: Lesson, config: VoiceConfig) => {
    dispatch({ type: "START_AUDIO_GEN" });

    try {
      const audioPaths = await servicesRef.current.synthesizeAudio(target, lesson, config);
      dispatch({ type: "AUDIO_GEN_SUCCESS", payload: audioPaths });
    } catch (err: any) {
      dispatch({ type: "AUDIO_GEN_FAILURE", payload: err.message || "Audio generation failed." });
    }
  }, []);

  // Step 3 Actions: Mutual Exclusion Enforcers
  const playAudio = useCallback((track: AudioTrackType) => {
    if (state.stage === "DOWNLOADING") {
      console.warn("Cannot listen while file download is in progress.");
      return;
    }
    dispatch({ type: "START_LISTENING", payload: track });
  }, [state.stage]);

  const stopAudio = useCallback(() => {
    dispatch({ type: "STOP_LISTENING" });
  }, []);

  const downloadTrack = useCallback(async (track: AudioTrackType, defaultFileName?: string) => {
    if (state.stage === "LISTENING") {
      console.warn("Mutual Exclusion Guard: Stop playback before saving to disk.");
      return;
    }

    const tempPath = state.tempAudioPaths[track];
    if (!tempPath) return;

    dispatch({ type: "START_DOWNLOADING", payload: track });

    try {
      const defaultName = defaultFileName || `${state.topicTitle || "topic"}_${track}.mp3`;
      const targetPath = await servicesRef.current.promptUserFileSave(defaultName);

      if (targetPath) {
        await servicesRef.current.exportFile(tempPath, targetPath);
        dispatch({ type: "DOWNLOAD_SUCCESS", payload: { track, savedPath: targetPath } });
      } else {
        dispatch({ type: "CANCEL_DOWNLOADING" });
      }
    } catch (err) {
      dispatch({ type: "CANCEL_DOWNLOADING" });
    }
  }, [state.stage, state.tempAudioPaths, state.topicTitle]);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  // "Challenge Yourself" quiz flow (human-initiated; never auto-launched).
  const startQuiz = useCallback(() => {
    dispatch({ type: "START_QUIZ" });
  }, []);

  const completeQuiz = useCallback(() => {
    dispatch({ type: "COMPLETE_QUIZ" });
  }, []);

  const exitQuiz = useCallback(() => {
    dispatch({ type: "EXIT_QUIZ" });
  }, []);

  // Metacognitive pulse handlers
  const handleMetacognitivePulse = useCallback((rating: number, feedback: string) => {
    // In a real implementation, this would send telemetry
    console.log(`[Metacognitive Pulse] Rating: ${rating}/8, Feedback: ${feedback}`);
    dispatch({ type: "HIDE_METACOGNITIVE_PULSE" });
  }, []);

  const dismissMetacognitivePulse = useCallback(() => {
    dispatch({ type: "HIDE_METACOGNITIVE_PULSE" });
  }, []);

  // Computed flags for UI
  const hasUnsavedAudio = Boolean(
    (state.tempAudioPaths.audiobook && !state.savedLocations.audiobook) ||
    (state.tempAudioPaths.podcast && !state.savedLocations.podcast)
  );

  return {
    state,
    // Action Dispatchers
    seedContent,
    seedAudio,
    generateTopic,
    generateAudio,
    playAudio,
    stopAudio,
    downloadTrack,
    startQuiz,
    completeQuiz,
    exitQuiz,
    reset,
    handleMetacognitivePulse,
    dismissMetacognitivePulse,
    // UI Helpers & Flags
    hasUnsavedAudio,
    isListenDisabled: isListenDisabled(state.stage),
    isDownloadDisabled: isDownloadDisabled(state.stage),
    canGenerateAudio: canGenerateAudio(state.stage),
    canStartQuiz: canStartQuiz(state.stage),
    isQuizActive: isQuizActive(state.stage),
    // Convenience accessor for building TTS text from a lesson
    buildLessonText: buildTtsText,
  };
}
