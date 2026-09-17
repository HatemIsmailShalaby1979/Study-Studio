import { renderHook, act, waitFor } from "@testing-library/react";
import { useTopicAudioPipeline } from "@/hooks/useTopicAudioPipeline";
import * as tts from "@/lib/tts";
import * as tauri from "@/lib/tauri";
import type { Lesson } from "@/types";

// Plan item 2.4: the audio pipeline hook had 0% coverage. These tests focus on
// its state-machine wiring and mutual-exclusion guards; provider/Tauri I/O is
// intentionally not invoked in jsdom.
//
// The one exception is the save-re-entrancy test at the bottom. That guard
// exists to stop a SECOND OS save dialog from opening, and a dialog is only
// ever requested on the desktop — so the test has to be able to pretend it is
// on the desktop, and to count picker calls. `isTauri` defaults to false
// (jsdom's reality, so every other test is unaffected) and the two file-picker
// calls are faked. Everything else runs for real.
//
// The flags are created inside the factories rather than closed over from the
// module body: `jest.mock` is hoisted above the imports, so a `const` declared
// down here would still be in its temporal dead zone when the factory runs.
jest.mock("@/lib/tauri", () => ({
  ...jest.requireActual("@/lib/tauri"),
  isTauri: jest.fn(() => false),
}));
jest.mock("@/lib/tts", () => ({
  ...jest.requireActual("@/lib/tts"),
  pickAudioDestination: jest.fn(),
  exportAudio: jest.fn(),
}));

const mockIsTauri = tauri.isTauri as jest.MockedFunction<typeof tauri.isTauri>;
const mockPickAudioDestination = tts.pickAudioDestination as jest.MockedFunction<
  typeof tts.pickAudioDestination
>;
const mockExportAudio = tts.exportAudio as jest.MockedFunction<typeof tts.exportAudio>;

const lesson = { id: "l1", title: "Water", sections: [] } as unknown as Lesson;

afterEach(() => {
  mockIsTauri.mockReturnValue(false);
});

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

  it("refuses a second save while one is already in progress", async () => {
    // Was a real defect. `downloadTrack` guarded only LISTENING, and
    // `isDownloadDisabled` did not list DOWNLOADING, so with the save dialog
    // open the button stayed enabled and a second click ran
    // `promptUserFileSave` again — a second OS dialog. The reducer had already
    // refused the transition (START_DOWNLOADING only fires from AUDIO_READY),
    // but the side effect ran before the reducer got a say, so the state
    // machine's refusal was invisible.
    //
    // The assertion that matters is the dialog count, not the stage: one save
    // must mean one picker call.
    mockIsTauri.mockReturnValue(true);
    mockPickAudioDestination.mockResolvedValue("C:/chosen.wav");
    mockExportAudio.mockResolvedValue(1);

    const { result } = renderHook(() => useTopicAudioPipeline());
    act(() => result.current.seedAudio({ audiobook: "water.wav" }));

    // Not awaited on purpose: the guard only holds while the stage is
    // DOWNLOADING, and awaiting would let the picker resolve and return the
    // machine to AUDIO_READY before the second call is made. The second call
    // below is therefore made synchronously, inside that window.
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.downloadTrack("audiobook");
    });
    expect(result.current.state.stage).toBe("DOWNLOADING");

    await act(async () => {
      await result.current.downloadTrack("audiobook");
    });

    await waitFor(() => expect(mockPickAudioDestination).toHaveBeenCalledTimes(1));

    // Settle the first save so the test does not leak an update.
    await act(async () => {
      await first;
    });
    expect(result.current.state.savedLocations.audiobook).toBe("C:/chosen.wav");
  });
});
