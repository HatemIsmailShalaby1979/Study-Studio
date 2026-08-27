// Topic Audio Pipeline State Machine
// Strict 3-Stage Incremental Pipeline with Mutual Exclusion Guards
// Governed by BOOT_ROOT.md and 00_CONSTITUTION.md

import type { Lesson } from "@/types";

export type PipelineStage =
  | "IDLE"
  | "TOPIC_GENERATED"    // Step 1: HTML ready
  | "AUDIO_GENERATING"   // Step 2: Processing audiobook/podcast
  | "AUDIO_READY"        // Audio files built in temp workspace
  | "LISTENING"          // Playing audio (Download strictly disabled)
  | "DOWNLOADING"        // File picker active (Listen strictly disabled)
  // "Challenge Yourself" quiz stages (human-initiated only — NEVER auto-launch).
  | "QUIZ_IN_PROGRESS"   // Learner actively answering diagnostic questions
  | "QUIZ_COMPLETED";    // Attempt finished; results shown before returning

export type AudioTrackType = "audiobook" | "podcast";
export type AudioTarget = "audiobook" | "podcast" | "both";

export interface VoiceConfig {
  audiobookVoice?: string;
  audiobookCommand?: string;
  podcastVoice1?: string;
  podcastVoice2?: string;
  podcastCommand?: string;
  format?: "mp3" | "wav";
}

export interface GeneratedAudioPaths {
  audiobook?: string; // Temp workspace local path
  podcast?: string;   // Temp workspace local path
}

export interface SavedLocations {
  audiobook?: string; // User selected target disk path
  podcast?: string;
}

/** Service contract for the 3-stage pipeline. */
export interface PipelineServices {
  fetchHtml: (topic: string, lang: string) => Promise<{ title: string; html: string }>;
  synthesizeAudio: (
    target: AudioTarget,
    lesson: Lesson,
    config: VoiceConfig
  ) => Promise<GeneratedAudioPaths>;
  promptUserFileSave: (defaultFileName: string) => Promise<string | null>;
  exportFile: (sourcePath: string, destPath: string) => Promise<void>;
}

export interface TopicState {
  stage: PipelineStage;
  topicTitle: string | null;
  htmlContent: string | null;
  tempAudioPaths: GeneratedAudioPaths;
  savedLocations: SavedLocations;
  activePlayingTrack: AudioTrackType | null;
  activeDownloadingTrack: AudioTrackType | null;
  humorousGuidance: string;
  error: string | null;
  // Metacognitive tracking
  topicsGeneratedSincePulse: number;
  showMetacognitivePulse: boolean;
  /** Stage to return to when the learner exits the quiz (never LISTENING etc.). */
  quizReturnStage: "AUDIO_READY" | "TOPIC_GENERATED" | null;
}

export type TopicAction =
  | { type: "GENERATE_HTML_SUCCESS"; payload: { title: string; html: string } }
  | { type: "SEED_CONTENT"; payload: { title: string; html: string } }
  | { type: "SEED_AUDIO"; payload: GeneratedAudioPaths }
  | { type: "START_AUDIO_GEN" }
  | { type: "AUDIO_GEN_SUCCESS"; payload: GeneratedAudioPaths }
  | { type: "AUDIO_GEN_FAILURE"; payload: string }
  | { type: "START_LISTENING"; payload: AudioTrackType }
  | { type: "STOP_LISTENING" }
  | { type: "START_DOWNLOADING"; payload: AudioTrackType }
  | { type: "DOWNLOAD_SUCCESS"; payload: { track: AudioTrackType; savedPath: string } }
  | { type: "CANCEL_DOWNLOADING" }
  | { type: "INCREMENT_TOPIC_COUNT" }
  | { type: "SHOW_METACOGNITIVE_PULSE" }
  | { type: "HIDE_METACOGNITIVE_PULSE" }
  | { type: "START_QUIZ" }
  | { type: "COMPLETE_QUIZ" }
  | { type: "EXIT_QUIZ" }
  | { type: "RESET" };

export const initialState: TopicState = {
  stage: "IDLE",
  topicTitle: null,
  htmlContent: null,
  tempAudioPaths: {},
  savedLocations: {},
  activePlayingTrack: null,
  activeDownloadingTrack: null,
  humorousGuidance: "Ready to learn! Input a topic to kick off Step 1.",
  error: null,
  topicsGeneratedSincePulse: 0,
  showMetacognitivePulse: false,
  quizReturnStage: null,
};

// Humorous guidance messages per state
const GUIDANCE_MESSAGES: Record<PipelineStage, string> = {
  IDLE: "Ready to learn! Input a topic to kick off Step 1.",
  TOPIC_GENERATED: "HTML hot off the press! Read through the text while our audio engines stand by.",
  AUDIO_GENERATING: "Translating bits into beats... Grab a coffee! We are teaching low-spec laptops new tricks.",
  AUDIO_READY: "Audio cooked to perfection! Select \"Listen\" or \"Download\" — one active choice at a time.",
  LISTENING: "Download button safely disabled! We want your ears 100% focused on learning, zero multi-tasking distractions!",
  DOWNLOADING: "Asking human permission... File picker opened! Where should we land this knowledge payload?",
  QUIZ_IN_PROGRESS: "Challenge yourself! Three to five quick questions to lock the lesson in for good.",
  QUIZ_COMPLETED: "Quiz complete! Check your accuracy below, then head back to the lesson or audiobook.",
};

export function topicReducer(state: TopicState, action: TopicAction): TopicState {
  switch (action.type) {
    case "GENERATE_HTML_SUCCESS": {
      const newCount = state.topicsGeneratedSincePulse + 1;
      const showPulse = newCount % 5 === 0;
      return {
        ...state,
        stage: "TOPIC_GENERATED",
        topicTitle: action.payload.title,
        htmlContent: action.payload.html,
        humorousGuidance: GUIDANCE_MESSAGES.TOPIC_GENERATED,
        error: null,
        topicsGeneratedSincePulse: newCount,
        showMetacognitivePulse: showPulse,
      };
    }

    // Seed an already-existing lesson (e.g. opened from the library) so Step 1
    // is considered done without re-generating HTML or bumping the pulse.
    case "SEED_CONTENT":
      return {
        ...state,
        stage: "TOPIC_GENERATED",
        topicTitle: action.payload.title,
        htmlContent: action.payload.html,
        tempAudioPaths: {},
        savedLocations: {},
        activePlayingTrack: null,
        activeDownloadingTrack: null,
        humorousGuidance: GUIDANCE_MESSAGES.TOPIC_GENERATED,
        error: null,
      };

    // Seed pre-existing generated audio (e.g. lesson.audioPath already on disk)
    // so the pipeline starts at AUDIO_READY and the user can listen/download it.
    // savedLocations mirrors the seeded paths so hasUnsavedAudio stays false —
    // the file already persists in app-data, so there is nothing to warn about.
    case "SEED_AUDIO":
      return {
        ...state,
        stage: "AUDIO_READY",
        tempAudioPaths: { ...action.payload },
        savedLocations: { ...action.payload },
        activePlayingTrack: null,
        activeDownloadingTrack: null,
        humorousGuidance: GUIDANCE_MESSAGES.AUDIO_READY,
        error: null,
      };

    case "START_AUDIO_GEN":
      return {
        ...state,
        stage: "AUDIO_GENERATING",
        humorousGuidance: GUIDANCE_MESSAGES.AUDIO_GENERATING,
        error: null,
      };

    case "AUDIO_GEN_SUCCESS":
      return {
        ...state,
        stage: "AUDIO_READY",
        tempAudioPaths: { ...state.tempAudioPaths, ...action.payload },
        humorousGuidance: GUIDANCE_MESSAGES.AUDIO_READY,
        error: null,
      };

    case "AUDIO_GEN_FAILURE":
      return {
        ...state,
        stage: "TOPIC_GENERATED",
        humorousGuidance: "Oops! The audio machine sputtered. Don't worry, your HTML is safe. Let's try generating audio again.",
        error: action.payload,
      };

    case "START_LISTENING":
      // State Guard: Cannot start listening if downloading or audio isn't ready
      if (state.stage === "DOWNLOADING" || state.stage !== "AUDIO_READY") return state;
      return {
        ...state,
        stage: "LISTENING",
        activePlayingTrack: action.payload,
        humorousGuidance: GUIDANCE_MESSAGES.LISTENING,
      };

    case "STOP_LISTENING":
      return {
        ...state,
        stage: "AUDIO_READY",
        activePlayingTrack: null,
        humorousGuidance: GUIDANCE_MESSAGES.AUDIO_READY,
      };

    case "START_DOWNLOADING":
      // State Guard: Cannot download while listening
      if (state.stage === "LISTENING" || state.stage !== "AUDIO_READY") return state;
      return {
        ...state,
        stage: "DOWNLOADING",
        activeDownloadingTrack: action.payload,
        humorousGuidance: GUIDANCE_MESSAGES.DOWNLOADING,
      };

    case "DOWNLOAD_SUCCESS":
      return {
        ...state,
        stage: "AUDIO_READY",
        activeDownloadingTrack: null,
        savedLocations: {
          ...state.savedLocations,
          [action.payload.track]: action.payload.savedPath,
        },
        humorousGuidance: `Saved to disk! Recorded location in your library. Feel free to re-listen or download other tracks!`,
      };

    case "CANCEL_DOWNLOADING":
      return {
        ...state,
        stage: "AUDIO_READY",
        activeDownloadingTrack: null,
        humorousGuidance: "Download postponed. Your temporary audio track is still safe in memory.",
      };

    case "INCREMENT_TOPIC_COUNT": {
      const newCount = state.topicsGeneratedSincePulse + 1;
      const showPulse = newCount % 5 === 0;
      return {
        ...state,
        topicsGeneratedSincePulse: newCount,
        showMetacognitivePulse: showPulse,
      };
    }

    case "SHOW_METACOGNITIVE_PULSE":
      return {
        ...state,
        showMetacognitivePulse: true,
      };

    case "HIDE_METACOGNITIVE_PULSE":
      return {
        ...state,
        showMetacognitivePulse: false,
      };

    // ── "Challenge Yourself" quiz (human-initiated; never auto-launched) ──
    case "START_QUIZ": {
      // State Guard: only from a stable stage where a lesson is actually ready.
      if (state.stage !== "AUDIO_READY" && state.stage !== "TOPIC_GENERATED") return state;
      return {
        ...state,
        stage: "QUIZ_IN_PROGRESS",
        quizReturnStage: state.stage,
        humorousGuidance: GUIDANCE_MESSAGES.QUIZ_IN_PROGRESS,
        error: null,
      };
    }

    case "COMPLETE_QUIZ":
      // State Guard: only while a quiz is actually in progress.
      if (state.stage !== "QUIZ_IN_PROGRESS") return state;
      return {
        ...state,
        stage: "QUIZ_COMPLETED",
        humorousGuidance: GUIDANCE_MESSAGES.QUIZ_COMPLETED,
      };

    case "EXIT_QUIZ":
      // State Guard: only from a quiz stage. Returns to where the quiz was
      // entered (AUDIO_READY / TOPIC_GENERATED) without touching audio state.
      if (state.stage !== "QUIZ_IN_PROGRESS" && state.stage !== "QUIZ_COMPLETED") return state;
      return {
        ...state,
        stage: state.quizReturnStage ?? "AUDIO_READY",
        quizReturnStage: null,
        humorousGuidance:
          state.quizReturnStage === "TOPIC_GENERATED"
            ? GUIDANCE_MESSAGES.TOPIC_GENERATED
            : GUIDANCE_MESSAGES.AUDIO_READY,
      };

    case "RESET":
      return initialState;

    default:
      return state;
  }
}

// UI Helper functions
export function isListenDisabled(stage: PipelineStage): boolean {
  return (
    stage === "DOWNLOADING" ||
    stage === "AUDIO_GENERATING" ||
    stage === "IDLE" ||
    stage === "TOPIC_GENERATED" ||
    stage === "QUIZ_IN_PROGRESS" ||
    stage === "QUIZ_COMPLETED"
  );
}

export function isDownloadDisabled(stage: PipelineStage): boolean {
  return (
    stage === "LISTENING" ||
    stage === "AUDIO_GENERATING" ||
    stage === "IDLE" ||
    stage === "TOPIC_GENERATED" ||
    stage === "QUIZ_IN_PROGRESS" ||
    stage === "QUIZ_COMPLETED"
  );
}

export function canGenerateAudio(stage: PipelineStage): boolean {
  return stage === "TOPIC_GENERATED" || stage === "AUDIO_READY";
}

/** "Challenge Yourself" is only offered from a stable, ready stage. */
export function canStartQuiz(stage: PipelineStage): boolean {
  return stage === "TOPIC_GENERATED" || stage === "AUDIO_READY";
}

export function isQuizActive(stage: PipelineStage): boolean {
  return stage === "QUIZ_IN_PROGRESS" || stage === "QUIZ_COMPLETED";
}

export function hasUnsavedAudio(state: TopicState): boolean {
  return Boolean(
    (state.tempAudioPaths.audiobook && !state.savedLocations.audiobook) ||
      (state.tempAudioPaths.podcast && !state.savedLocations.podcast)
  );
}