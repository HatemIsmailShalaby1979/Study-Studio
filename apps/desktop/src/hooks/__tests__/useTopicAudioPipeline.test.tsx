import { renderHook, act } from "@testing-library/react";
import { useTopicAudioPipeline } from "@/hooks/useTopicAudioPipeline";
import type { Lesson } from "@/types";

// Plan item 2.4: the audio pipeline hook had 0% coverage. These tests focus on
// its state-machine wiring and mutual-exclusion guards; provider/Tauri I/O is
// intentionally not invoked in jsdom.

const lesson = { id: "l1", title: "Water", sections: [] } as unknown as Lesson;

describe("useTopicAudioPipeline", () => {
  it("seeds an existing lesson and audio into the ready state", () => {
    const { result } = renderHook(() => useTopicAudioPipeline());

    act(() => {
      result.current.seedContent("Water", "<p>content</p>");
      result.current.seedAudio({ audiobook: "C:/water.wav" });
    });

    expect(result.current.state.topicTitle).toBe("Water");
    expect(result.current.state.tempAudioPaths.audiobook).toBe("C:/water.wav");
  });

  it("allows listening when a track is available and stops it", () => {
    const { result } = renderHook(() => useTopicAudioPipeline());
    act(() => result.current.seedAudio({ audiobook: "water.wav" }));

    act(() => result.current.playAudio("audiobook"));
    expect(result.current.state.stage).toBe("LISTENING");
    expect(result.current.state.activePlayingTrack).toBe("audiobook");

    act(() => result.current.stopAudio());
    expect(result.current.state.stage).not.toBe("LISTENING");
  });

  it("refuses to start a browser-only audio generation", async () => {
    const { result } = renderHook(() => useTopicAudioPipeline());
    await act(async () => {
      await result.current.generateAudio("audiobook", lesson, {
        audiobookVoice: "en_US-lessac-medium",
        format: "wav",
      });
    });

    expect(result.current.state.error).toMatch(/desktop app/i);
  });

  it("does not start a quiz before content exists", () => {
    const { result } = renderHook(() => useTopicAudioPipeline());
    act(() => result.current.startQuiz());
    expect(result.current.state.stage).not.toBe("QUIZ_ACTIVE");
  });

  it("enters and exits the quiz after content is seeded", () => {
    const { result } = renderHook(() => useTopicAudioPipeline());
    act(() => result.current.seedContent("Water", "content"));
    act(() => result.current.startQuiz());
    expect(result.current.state.stage).toBe("QUIZ_IN_PROGRESS");

    act(() => result.current.completeQuiz());
    expect(result.current.state.stage).not.toBe("QUIZ_ACTIVE");
  });

  it("resets all pipeline state", () => {
    const { result } = renderHook(() => useTopicAudioPipeline());
    act(() => result.current.seedContent("Water", "content"));
    act(() => result.current.reset());
    expect(result.current.state.topicTitle).toBeNull();
    expect(result.current.state.tempAudioPaths).toEqual({});
  });

  it("exits the quiz from an active state", () => {
    const { result } = renderHook(() => useTopicAudioPipeline());
    act(() => result.current.seedContent("Water", "content"));
    act(() => result.current.startQuiz());
    expect(result.current.isQuizActive).toBe(true);

    act(() => result.current.exitQuiz());
    expect(result.current.isQuizActive).toBe(false);
  });

  it("hides the metacognitive pulse on submit and on dismiss", () => {
    const { result } = renderHook(() => useTopicAudioPipeline());

    act(() => result.current.handleMetacognitivePulse(6, "Audio was slow"));
    expect(result.current.state.showMetacognitivePulse).toBe(false);

    act(() => result.current.dismissMetacognitivePulse());
    expect(result.current.state.showMetacognitivePulse).toBe(false);
  });

  it("treats seeded audio as already saved", () => {
    // SEED_AUDIO sets tempAudioPaths *and* savedLocations, which is the point:
    // audio resumed from the library is on disk already, so it must not be
    // advertised as an unsaved change the user could lose.
    const { result } = renderHook(() => useTopicAudioPipeline());
    expect(result.current.hasUnsavedAudio).toBe(false);

    act(() => result.current.seedAudio({ audiobook: "water.wav" }));
    expect(result.current.state.tempAudioPaths.audiobook).toBe("water.wav");
    expect(result.current.hasUnsavedAudio).toBe(false);
  });

  it("exposes stage-derived disabled flags", () => {
    const { result } = renderHook(() => useTopicAudioPipeline());

    // IDLE: no content, so nothing to listen to, download, or synthesize yet.
    expect(result.current.isListenDisabled).toBe(true);
    expect(result.current.isDownloadDisabled).toBe(true);
    expect(result.current.canGenerateAudio).toBe(false);
    expect(result.current.canStartQuiz).toBe(false);
  });

  it("opens generation and quiz once content exists", () => {
    const { result } = renderHook(() => useTopicAudioPipeline());
    act(() => result.current.seedContent("Water", "content"));

    expect(result.current.state.stage).toBe("TOPIC_GENERATED");
    expect(result.current.canGenerateAudio).toBe(true);
    expect(result.current.canStartQuiz).toBe(true);
    expect(result.current.isListenDisabled).toBe(true);
  });

  it("builds TTS text from a lesson", () => {
    const { result } = renderHook(() => useTopicAudioPipeline());
    const text = result.current.buildLessonText(lesson);
    expect(typeof text).toBe("string");
  });

  it("refuses to listen while a download is in progress", async () => {
    const { result } = renderHook(() => useTopicAudioPipeline());
    act(() => result.current.seedAudio({ audiobook: "water.wav" }));

    // Not awaited on purpose: the guard only applies while the stage is
    // DOWNLOADING, and awaiting would let the fake save-prompt resolve and
    // cancel the download before we can probe it.
    let download: Promise<void> = Promise.resolve();
    act(() => {
      download = result.current.downloadTrack("audiobook");
    });
    expect(result.current.state.stage).toBe("DOWNLOADING");

    act(() => result.current.playAudio("audiobook"));
    expect(result.current.state.stage).not.toBe("LISTENING");

    // Settle the pending work so the test does not leak an update.
    await act(async () => {
      await download;
    });
  });
});
