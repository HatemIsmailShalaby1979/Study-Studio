import {
  topicReducer,
  initialState,
  hasUnsavedAudio,
  canGenerateAudio,
  isListenDisabled,
  isDownloadDisabled,
  canStartQuiz,
  isQuizActive,
} from "@/lib/topicPipeline";

describe("topicReducer — SEED_CONTENT", () => {
  it("enters TOPIC_GENERATED without touching the topic pulse counter", () => {
    const before = { ...initialState, topicsGeneratedSincePulse: 3 };
    const after = topicReducer(before, {
      type: "SEED_CONTENT",
      payload: { title: "Existing Lesson", html: "<h1>hello</h1>" },
    });
    expect(after.stage).toBe("TOPIC_GENERATED");
    expect(after.topicTitle).toBe("Existing Lesson");
    expect(after.topicsGeneratedSincePulse).toBe(3);
    expect(after.showMetacognitivePulse).toBe(false);
    expect(after.tempAudioPaths).toEqual({});
  });
});

describe("topicReducer — SEED_AUDIO", () => {
  it("enters AUDIO_READY with the seeded paths and marks them saved", () => {
    const after = topicReducer(initialState, {
      type: "SEED_AUDIO",
      payload: { audiobook: "/tmp/lesson.wav" },
    });
    expect(after.stage).toBe("AUDIO_READY");
    expect(after.tempAudioPaths.audiobook).toBe("/tmp/lesson.wav");
    expect(after.savedLocations.audiobook).toBe("/tmp/lesson.wav");
    // Seeded files already persist in app-data — must NOT count as unsaved.
    expect(hasUnsavedAudio(after)).toBe(false);
  });
});

describe("topicReducer — mutual exclusion guards", () => {
  const audioReady = topicReducer(initialState, {
    type: "SEED_AUDIO",
    payload: { audiobook: "/tmp/a.wav", podcast: "/tmp/p.wav" },
  });

  it("blocks START_LISTENING while DOWNLOADING", () => {
    const downloading = topicReducer(audioReady, { type: "START_DOWNLOADING", payload: "audiobook" });
    const blocked = topicReducer(downloading, { type: "START_LISTENING", payload: "audiobook" });
    expect(blocked.stage).toBe("DOWNLOADING");
    expect(blocked.activePlayingTrack).toBeNull();
  });

  it("blocks START_DOWNLOADING while LISTENING", () => {
    const listening = topicReducer(audioReady, { type: "START_LISTENING", payload: "audiobook" });
    const blocked = topicReducer(listening, { type: "START_DOWNLOADING", payload: "audiobook" });
    expect(blocked.stage).toBe("LISTENING");
    expect(blocked.activeDownloadingTrack).toBeNull();
  });

  it("records the saved location on DOWNLOAD_SUCCESS and clears unsaved state", () => {
    const started = topicReducer(audioReady, { type: "START_DOWNLOADING", payload: "audiobook" });
    const done = topicReducer(started, {
      type: "DOWNLOAD_SUCCESS",
      payload: { track: "audiobook", savedPath: "C:/Users/me/Audio/a.wav" },
    });
    expect(done.stage).toBe("AUDIO_READY");
    expect(done.savedLocations.audiobook).toBe("C:/Users/me/Audio/a.wav");
    expect(hasUnsavedAudio(done)).toBe(false);
  });
});

describe("pipeline UI helpers", () => {
  it("flags a freshly generated track as unsaved until saved", () => {
    const generated = topicReducer(initialState, {
      type: "AUDIO_GEN_SUCCESS",
      payload: { podcast: "/tmp/new.wav" },
    });
    expect(generated.stage).toBe("AUDIO_READY");
    expect(hasUnsavedAudio(generated)).toBe(true);
  });

  it("canGenerateAudio is true only at TOPIC_GENERATED / AUDIO_READY", () => {
    expect(canGenerateAudio("IDLE")).toBe(false);
    expect(canGenerateAudio("TOPIC_GENERATED")).toBe(true);
    expect(canGenerateAudio("AUDIO_READY")).toBe(true);
    expect(canGenerateAudio("LISTENING")).toBe(false);
    expect(canGenerateAudio("DOWNLOADING")).toBe(false);
  });

  it("listen and download are mutually exclusive", () => {
    expect(isListenDisabled("DOWNLOADING")).toBe(true);
    expect(isListenDisabled("AUDIO_READY")).toBe(false);
    expect(isDownloadDisabled("LISTENING")).toBe(true);
    expect(isDownloadDisabled("AUDIO_READY")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// "Challenge Yourself" quiz state machine
// ---------------------------------------------------------------------------
describe("quiz state machine — START_QUIZ / COMPLETE_QUIZ / EXIT_QUIZ", () => {
  const audioReady = topicReducer(initialState, {
    type: "SEED_AUDIO",
    payload: { audiobook: "/tmp/a.wav" },
  });

  it("SEED_AUDIO transitions to AUDIO_READY", () => {
    expect(audioReady.stage).toBe("AUDIO_READY");
  });

  it("START_QUIZ is allowed from AUDIO_READY", () => {
    const quiz = topicReducer(audioReady, { type: "START_QUIZ" });
    expect(quiz.stage).toBe("QUIZ_IN_PROGRESS");
    expect(quiz.quizReturnStage).toBe("AUDIO_READY");
  });

  it("START_QUIZ is allowed from TOPIC_GENERATED", () => {
    const topicGen = topicReducer(initialState, {
      type: "SEED_CONTENT",
      payload: { title: "T", html: "<p>Hi</p>" },
    });
    const quiz = topicReducer(topicGen, { type: "START_QUIZ" });
    expect(quiz.stage).toBe("QUIZ_IN_PROGRESS");
    expect(quiz.quizReturnStage).toBe("TOPIC_GENERATED");
  });

  it("START_QUIZ is blocked from IDLE", () => {
    const result = topicReducer(initialState, { type: "START_QUIZ" });
    expect(result.stage).toBe("IDLE");
    expect(result.quizReturnStage).toBeNull();
  });

  it("START_QUIZ is blocked from LISTENING", () => {
    const listening = topicReducer(audioReady, { type: "START_LISTENING", payload: "audiobook" });
    const result = topicReducer(listening, { type: "START_QUIZ" });
    expect(result.stage).toBe("LISTENING");
  });

  it("COMPLETE_QUIZ transitions from QUIZ_IN_PROGRESS to QUIZ_COMPLETED", () => {
    const quiz = topicReducer(audioReady, { type: "START_QUIZ" });
    const completed = topicReducer(quiz, { type: "COMPLETE_QUIZ" });
    expect(completed.stage).toBe("QUIZ_COMPLETED");
    expect(completed.quizReturnStage).toBe("AUDIO_READY");
  });

  it("COMPLETE_QUIZ is blocked when not in QUIZ_IN_PROGRESS", () => {
    const result = topicReducer(audioReady, { type: "COMPLETE_QUIZ" });
    expect(result.stage).toBe("AUDIO_READY");
  });

  it("EXIT_QUIZ returns to AUDIO_READY from QUIZ_IN_PROGRESS", () => {
    const quiz = topicReducer(audioReady, { type: "START_QUIZ" });
    const exited = topicReducer(quiz, { type: "EXIT_QUIZ" });
    expect(exited.stage).toBe("AUDIO_READY");
    expect(exited.quizReturnStage).toBeNull();
  });

  it("EXIT_QUIZ returns to TOPIC_GENERATED from QUIZ_COMPLETED", () => {
    const topicGen = topicReducer(initialState, {
      type: "SEED_CONTENT",
      payload: { title: "T", html: "<p>Hi</p>" },
    });
    const quiz = topicReducer(topicGen, { type: "START_QUIZ" });
    const completed = topicReducer(quiz, { type: "COMPLETE_QUIZ" });
    const exited = topicReducer(completed, { type: "EXIT_QUIZ" });
    expect(exited.stage).toBe("TOPIC_GENERATED");
    expect(exited.quizReturnStage).toBeNull();
  });

  it("EXIT_QUIZ is blocked from non-quiz stages", () => {
    const result = topicReducer(audioReady, { type: "EXIT_QUIZ" });
    expect(result.stage).toBe("AUDIO_READY");
  });

  it("RESET clears quiz state", () => {
    const quiz = topicReducer(audioReady, { type: "START_QUIZ" });
    const reset = topicReducer(quiz, { type: "RESET" });
    expect(reset.stage).toBe("IDLE");
    expect(reset.quizReturnStage).toBeNull();
  });
});

describe("quiz UI helpers", () => {
  it("canStartQuiz only from AUDIO_READY / TOPIC_GENERATED", () => {
    expect(canStartQuiz("AUDIO_READY")).toBe(true);
    expect(canStartQuiz("TOPIC_GENERATED")).toBe(true);
    expect(canStartQuiz("IDLE")).toBe(false);
    expect(canStartQuiz("QUIZ_IN_PROGRESS")).toBe(false);
    expect(canStartQuiz("LISTENING")).toBe(false);
  });

  it("isQuizActive for quiz stages only", () => {
    expect(isQuizActive("QUIZ_IN_PROGRESS")).toBe(true);
    expect(isQuizActive("QUIZ_COMPLETED")).toBe(true);
    expect(isQuizActive("AUDIO_READY")).toBe(false);
    expect(isQuizActive("IDLE")).toBe(false);
  });

  it("listen/download are disabled during quiz stages", () => {
    expect(isListenDisabled("QUIZ_IN_PROGRESS")).toBe(true);
    expect(isListenDisabled("QUIZ_COMPLETED")).toBe(true);
    expect(isDownloadDisabled("QUIZ_IN_PROGRESS")).toBe(true);
    expect(isDownloadDisabled("QUIZ_COMPLETED")).toBe(true);
  });
});
