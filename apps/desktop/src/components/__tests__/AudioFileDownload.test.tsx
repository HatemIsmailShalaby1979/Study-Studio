import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AudioFileDownload from "@/components/AudioFileDownload";
import * as tts from "@/lib/tts";
import type { Lesson } from "@/types";
import type { AudioTrackType, PipelineStage } from "@/lib/topicPipeline";
import { isDownloadDisabled, isListenDisabled } from "@/lib/topicPipeline";

// Characterisation tests for AudioFileDownload — the audio generate/save panel.
//
// This was the largest untested component in the app (81 statements at 0%) and
// was sitting behind a waiver in scripts/check-coverage.mjs. The component is a
// pure function of `pipeline.state` plus a few props, so the suite drives the
// state directly rather than mocking the hook: every branch below is reached by
// setting `stage`, `tempAudioPaths`, `savedLocations` and the track fields, which
// is exactly what the real reducer produces.
//
// I/O is mocked: TTS, the file-URL conversion, and the audio element itself
// (jsdom implements neither playback nor a media pipeline).

jest.mock("@/lib/tts", () => ({
  checkFfmpeg: jest.fn(),
  listAvailableVoices: jest.fn(),
  downloadVoice: jest.fn(),
  unifiedVoiceCatalog: jest.fn(),
  unifiedVoicesForLanguage: jest.fn(),
  audioFileUrl: jest.fn(),
  isTtsAvailable: jest.fn(),
}));

const mockCheckFfmpeg = tts.checkFfmpeg as jest.MockedFunction<typeof tts.checkFfmpeg>;
const mockListAvailableVoices = tts.listAvailableVoices as jest.MockedFunction<
  typeof tts.listAvailableVoices
>;
const mockDownloadVoice = tts.downloadVoice as jest.MockedFunction<typeof tts.downloadVoice>;
const mockCatalog = tts.unifiedVoiceCatalog as jest.MockedFunction<typeof tts.unifiedVoiceCatalog>;
const mockVoicesForLanguage = tts.unifiedVoicesForLanguage as jest.MockedFunction<
  typeof tts.unifiedVoicesForLanguage
>;
const mockAudioFileUrl = tts.audioFileUrl as jest.MockedFunction<typeof tts.audioFileUrl>;
const mockIsTtsAvailable = tts.isTtsAvailable as jest.MockedFunction<typeof tts.isTtsAvailable>;

function voice(id: string, over: Partial<tts.UnifiedVoice> = {}): tts.UnifiedVoice {
  return {
    id,
    displayName: id,
    language: "en",
    gender: "male",
    source: "piper",
    available: false,
    ...over,
  };
}

const ENGLISH_VOICES = [
  voice("en_US-lessac-medium", { displayName: "Lessac" }),
  voice("en_US-amy-medium", { displayName: "Amy", gender: "female" }),
];

/** Mirrors the real catalog filter: a language prefix match. */
function subsetFor(voices: tts.UnifiedVoice[], lang: string) {
  return voices.filter((v) => v.language.startsWith(lang));
}

interface PipelineOverrides {
  stage?: PipelineStage;
  tempAudioPaths?: { audiobook?: string; podcast?: string };
  savedLocations?: { audiobook?: string; podcast?: string };
  activePlayingTrack?: AudioTrackType | null;
  activeDownloadingTrack?: AudioTrackType | null;
  humorousGuidance?: string;
  error?: string | null;
  canGenerateAudio?: boolean;
}

/**
 * Build the shape the component destructures off `pipeline`.
 *
 * The disabled flags come from the REAL predicates in `topicPipeline.ts`, not
 * from local stage lists. They used to be reimplemented here, and that is why
 * this suite could not see the re-entrant-save defect: the mock's
 * `downloadDisabledStages` omitted DOWNLOADING, so the component was handed
 * `isDownloadDisabled: false` for a stage where the real predicate now says
 * true, and every assertion about the Save button was really asserting on the
 * mock. Deriving them keeps the suite honest and cannot drift from the source.
 */
function makePipeline(over: PipelineOverrides = {}) {
  const stage = over.stage ?? "TOPIC_GENERATED";
  return {
    state: {
      stage,
      tempAudioPaths: over.tempAudioPaths ?? {},
      savedLocations: over.savedLocations ?? {},
      activePlayingTrack: over.activePlayingTrack ?? null,
      activeDownloadingTrack: over.activeDownloadingTrack ?? null,
      humorousGuidance: over.humorousGuidance ?? "",
      error: over.error ?? null,
    },
    generateAudio: jest.fn(),
    playAudio: jest.fn(),
    stopAudio: jest.fn(),
    downloadTrack: jest.fn().mockResolvedValue(undefined),
    seedAudio: jest.fn(),
    canGenerateAudio: over.canGenerateAudio ?? stage === "TOPIC_GENERATED" || stage === "AUDIO_READY",
    isListenDisabled: isListenDisabled(stage),
    isDownloadDisabled: isDownloadDisabled(stage),
  };
}

function lesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: "l1",
    title: "The Water Cycle",
    type: "lesson",
    createdAt: "2026-03-04T10:00:00.000Z",
    sections: [{ heading: "Evaporation", content: "Water rises." }],
    glossary: [],
    quiz: [],
    ...over,
  };
}

type Pipeline = ReturnType<typeof makePipeline>;

async function renderPanel(
  opts: {
    trackType?: AudioTrackType;
    pipeline?: Pipeline;
    lesson?: Partial<Lesson>;
    audioPath?: string | null;
    voice?: string;
    voiceB?: string;
    onAudioReady?: jest.Mock;
    onVoiceChange?: jest.Mock;
    onVoiceBChange?: jest.Mock;
  } = {}
) {
  const pipeline = opts.pipeline ?? makePipeline();
  const onAudioReady = opts.onAudioReady ?? jest.fn();
  const view = render(
    <AudioFileDownload
      lesson={lesson(opts.lesson)}
      audioPath={opts.audioPath ?? null}
      onAudioReady={onAudioReady}
      voice={opts.voice}
      voiceB={opts.voiceB}
      onVoiceChange={opts.onVoiceChange}
      onVoiceBChange={opts.onVoiceBChange}
      pipeline={pipeline as never}
      trackType={opts.trackType ?? "audiobook"}
    />
  );
  // The availability effect resolves on a microtask; wait it out so assertions
  // about "voices ready" are not racing the catalog load.
  await waitFor(() => expect(mockCatalog).toHaveBeenCalled());
  return { view, pipeline, onAudioReady };
}

/** The voice <select>s have no htmlFor, so address them by index. */
function selects(): HTMLSelectElement[] {
  return screen.getAllByRole("combobox") as HTMLSelectElement[];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckFfmpeg.mockResolvedValue(true);
  mockListAvailableVoices.mockResolvedValue(["en_US-lessac-medium", "en_US-amy-medium"]);
  mockDownloadVoice.mockResolvedValue(undefined);
  mockCatalog.mockResolvedValue(ENGLISH_VOICES);
  mockVoicesForLanguage.mockImplementation(subsetFor);
  mockAudioFileUrl.mockResolvedValue("asset://C:/tmp/track.mp3");
  mockIsTtsAvailable.mockResolvedValue(true);

  // jsdom has no media pipeline: play() rejects with "Not implemented".
  Object.defineProperty(globalThis.HTMLMediaElement.prototype, "play", {
    configurable: true,
    writable: true,
    value: jest.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(globalThis.HTMLMediaElement.prototype, "pause", {
    configurable: true,
    writable: true,
    value: jest.fn(),
  });
});

describe("AudioFileDownload — track identity", () => {
  it("labels the audiobook panel and offers a single voice selector", async () => {
    await renderPanel({ trackType: "audiobook" });

    expect(screen.getByText("Audiobook Audio File")).toBeInTheDocument();
    expect(screen.getByText("Real audio generated locally by Piper TTS")).toBeInTheDocument();
    expect(selects()).toHaveLength(1);
    expect(screen.queryByText("Host B Voice")).not.toBeInTheDocument();
  });

  it("labels the podcast panel and offers both host selectors", async () => {
    await renderPanel({ trackType: "podcast" });

    expect(screen.getByText("Podcast Audio File")).toBeInTheDocument();
    expect(
      screen.getByText("Real two-host audio generated locally by Piper TTS")
    ).toBeInTheDocument();
    expect(selects()).toHaveLength(2);
    expect(screen.getByText("Host A Voice")).toBeInTheDocument();
    expect(screen.getByText("Host B Voice")).toBeInTheDocument();
  });

  it("shows the pipeline's guidance message", async () => {
    await renderPanel({ pipeline: makePipeline({ humorousGuidance: "Ready to learn!" }) });
    expect(screen.getByText("Ready to learn!")).toBeInTheDocument();
  });

  it("surfaces a pipeline error", async () => {
    await renderPanel({ pipeline: makePipeline({ error: "Piper not found" }) });
    expect(screen.getByText("Piper not found")).toBeInTheDocument();
  });
});

describe("AudioFileDownload — voice availability", () => {
  it("warns about a missing voice, naming it", async () => {
    mockListAvailableVoices.mockResolvedValue([]);
    await renderPanel({ trackType: "audiobook" });

    expect(screen.getByText("Voice not downloaded")).toBeInTheDocument();
    expect(
      screen.getByText(/"en_US-lessac-medium" must be installed before creating the file\./)
    ).toBeInTheDocument();
  });

  it("warns about both voices for a podcast", async () => {
    mockListAvailableVoices.mockResolvedValue([]);
    await renderPanel({ trackType: "podcast" });

    expect(screen.getByText("Voices not downloaded")).toBeInTheDocument();
    expect(
      screen.getByText(
        /"en_US-lessac-medium" and "en_US-amy-medium" must be installed before creating the file\./
      )
    ).toBeInTheDocument();
  });

  it("hides the warning once every needed voice is installed", async () => {
    await renderPanel({ trackType: "podcast" });
    expect(screen.queryByText("Voices not downloaded")).not.toBeInTheDocument();
  });

  it("downloads the missing voice and then treats it as available", async () => {
    mockListAvailableVoices.mockResolvedValue([]);
    await renderPanel({ trackType: "audiobook" });

    // The button is labelled with the voice's display name, not its id.
    fireEvent.click(screen.getByRole("button", { name: /Lessac/ }));

    await waitFor(() => expect(mockDownloadVoice).toHaveBeenCalledWith("en_US-lessac-medium"));
    await waitFor(() => expect(screen.queryByText("Voice not downloaded")).not.toBeInTheDocument());
  });

  it("shows a downloading label while the install is in flight", async () => {
    let finish: () => void = () => {};
    mockDownloadVoice.mockReturnValue(new Promise<void>((r) => (finish = r)));
    mockListAvailableVoices.mockResolvedValue([]);

    await renderPanel({ trackType: "audiobook" });
    fireEvent.click(await screen.findByRole("button", { name: /Lessac/ }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Downloading..." })).toBeDisabled());

    finish();
  });

  it("swallows a failed download and re-enables the button", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    mockDownloadVoice.mockRejectedValue(new Error("offline"));
    mockListAvailableVoices.mockResolvedValue([]);

    await renderPanel({ trackType: "audiobook" });
    fireEvent.click(screen.getByRole("button", { name: /Lessac/ }));

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: /Lessac/ })).toBeEnabled());
  });

  it("offers a download for each missing podcast host", async () => {
    mockListAvailableVoices.mockResolvedValue([]);
    await renderPanel({ trackType: "podcast" });

    expect(await screen.findByRole("button", { name: /⬇ Lessac/ })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /⬇ Amy/ })).toBeInTheDocument();
  });
});

describe("AudioFileDownload — TTS availability", () => {
  it("explains when text-to-speech is unavailable and disables generation", async () => {
    mockIsTtsAvailable.mockResolvedValue(false);
    await renderPanel();

    expect(screen.getByText("Text-to-speech unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /TTS unavailable/ })).toBeDisabled();
  });

  it("asks for the voice before offering generation", async () => {
    mockListAvailableVoices.mockResolvedValue([]);
    await renderPanel();

    expect(screen.getByRole("button", { name: /Download voice first/ })).toBeDisabled();
  });
});

describe("AudioFileDownload — format selection", () => {
  it("takes the initial format from the lesson", async () => {
    await renderPanel({ lesson: { audioFormat: "wav" } });
    expect(screen.getByRole("button", { name: /Generate WAV File/ })).toBeInTheDocument();
  });

  it("defaults to MP3 when the lesson has no format", async () => {
    await renderPanel();
    expect(screen.getByRole("button", { name: /Generate MP3 File/ })).toBeInTheDocument();
  });

  it("locks MP3 when ffmpeg is missing", async () => {
    mockCheckFfmpeg.mockResolvedValue(false);
    await renderPanel();

    expect(screen.getByRole("button", { name: "MP3" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "WAV" })).toBeEnabled();
  });

  it("switches to WAV and renames the generate button", async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "WAV" }));

    expect(screen.getByRole("button", { name: /Generate WAV File/ })).toBeInTheDocument();
  });
});

describe("AudioFileDownload — generation", () => {
  it("asks the pipeline for the audiobook with the selected voice and format", async () => {
    const pipeline = makePipeline();
    await renderPanel({ pipeline, trackType: "audiobook" });

    fireEvent.click(screen.getByRole("button", { name: /Generate MP3 File/ }));

    expect(pipeline.generateAudio).toHaveBeenCalledWith(
      "audiobook",
      expect.objectContaining({ id: "l1" }),
      {
        audiobookVoice: "en_US-lessac-medium",
        podcastVoice1: "en_US-lessac-medium",
        podcastVoice2: "en_US-amy-medium",
        format: "mp3",
      }
    );
  });

  it("passes both host voices for a podcast", async () => {
    const pipeline = makePipeline();
    await renderPanel({
      pipeline,
      trackType: "podcast",
      voice: "en_US-amy-medium",
      voiceB: "en_US-lessac-medium",
    });

    fireEvent.click(screen.getByRole("button", { name: /Generate MP3 File/ }));

    expect(pipeline.generateAudio).toHaveBeenCalledWith("podcast", expect.anything(), {
      audiobookVoice: "en_US-amy-medium",
      podcastVoice1: "en_US-amy-medium",
      podcastVoice2: "en_US-lessac-medium",
      format: "mp3",
    });
  });

  it("does nothing when the pipeline is not ready to generate", async () => {
    const pipeline = makePipeline({ stage: "IDLE", canGenerateAudio: false });
    await renderPanel({ pipeline });

    // Stage IDLE disables the button, so the guard inside the handler is what
    // this pins: it must not fire even if the click reaches it.
    fireEvent.click(screen.getByRole("button", { name: /Generate MP3 File/ }));
    expect(pipeline.generateAudio).not.toHaveBeenCalled();
  });

  it("shows a generating state instead of the button", async () => {
    await renderPanel({ pipeline: makePipeline({ stage: "AUDIO_GENERATING" }) });

    expect(screen.getByText(/Generating audiobook audio/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate MP3 File/ })).not.toBeInTheDocument();
  });

  it("names the podcast track in the generating state", async () => {
    await renderPanel({
      pipeline: makePipeline({ stage: "AUDIO_GENERATING" }),
      trackType: "podcast",
    });

    expect(screen.getByText(/Generating podcast audio/)).toBeInTheDocument();
  });
});

describe("AudioFileDownload — file created", () => {
  it("shows the file path and the on-disk badge", async () => {
    await renderPanel({
      pipeline: makePipeline({ stage: "AUDIO_READY", tempAudioPaths: { audiobook: "C:/tmp/a.mp3" } }),
    });

    expect(screen.getByText("File created on disk")).toBeInTheDocument();
    expect(screen.getByText("C:/tmp/a.mp3")).toBeInTheDocument();
  });

  it("explains that no file exists yet when there is no temp path", async () => {
    await renderPanel();
    expect(screen.getByText(/No file is created until you click/)).toBeInTheDocument();
  });

  it("reports the temp path to the page so it can be persisted", async () => {
    const onAudioReady = jest.fn();
    await renderPanel({
      pipeline: makePipeline({ stage: "AUDIO_READY", tempAudioPaths: { audiobook: "C:/tmp/a.mp3" } }),
      onAudioReady,
    });

    await waitFor(() => expect(onAudioReady).toHaveBeenCalledWith("C:/tmp/a.mp3"));
  });

  it("does not re-report a path that already matches the stored one", async () => {
    const onAudioReady = jest.fn();
    await renderPanel({
      pipeline: makePipeline({ stage: "AUDIO_READY", tempAudioPaths: { audiobook: "C:/tmp/a.mp3" } }),
      audioPath: "C:/tmp/a.mp3",
      onAudioReady,
    });

    expect(await screen.findByText("C:/tmp/a.mp3")).toBeInTheDocument();
    expect(onAudioReady).not.toHaveBeenCalled();
  });
});

describe("AudioFileDownload — resume from a stored path", () => {
  it("seeds the track when the lesson already has audio", async () => {
    const pipeline = makePipeline();
    await renderPanel({ pipeline, audioPath: "C:/existing.mp3" });

    await waitFor(() =>
      expect(pipeline.seedAudio).toHaveBeenCalledWith({ audiobook: "C:/existing.mp3" })
    );
  });

  it("seeds the podcast track under its own key", async () => {
    const pipeline = makePipeline();
    await renderPanel({ pipeline, trackType: "podcast", audioPath: "C:/existing.mp3" });

    await waitFor(() =>
      expect(pipeline.seedAudio).toHaveBeenCalledWith({ podcast: "C:/existing.mp3" })
    );
  });

  it("does not seed when a temp path is already present", async () => {
    const pipeline = makePipeline({
      stage: "AUDIO_READY",
      tempAudioPaths: { audiobook: "C:/tmp/a.mp3" },
    });
    await renderPanel({ pipeline, audioPath: "C:/existing.mp3" });

    expect(await screen.findByText("C:/tmp/a.mp3")).toBeInTheDocument();
    expect(pipeline.seedAudio).not.toHaveBeenCalled();
  });

  it("does not seed while audio is being generated", async () => {
    const pipeline = makePipeline({ stage: "AUDIO_GENERATING" });
    await renderPanel({ pipeline, audioPath: "C:/existing.mp3" });

    expect(await screen.findByText(/Generating audiobook audio/)).toBeInTheDocument();
    expect(pipeline.seedAudio).not.toHaveBeenCalled();
  });

  it("does not seed when there is no stored path", async () => {
    const pipeline = makePipeline();
    await renderPanel({ pipeline, audioPath: null });

    expect(pipeline.seedAudio).not.toHaveBeenCalled();
  });
});

describe("AudioFileDownload — listen and save", () => {
  const readyPipeline = () =>
    makePipeline({ stage: "AUDIO_READY", tempAudioPaths: { audiobook: "C:/tmp/a.mp3" } });

  it("offers listen and save once a file exists", async () => {
    await renderPanel({ pipeline: readyPipeline() });

    expect(screen.getByRole("button", { name: /Listen MP3/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Save MP3 File/ })).toBeEnabled();
  });

  it("starts playback through the pipeline", async () => {
    const pipeline = readyPipeline();
    await renderPanel({ pipeline });

    fireEvent.click(screen.getByRole("button", { name: /Listen MP3/ }));
    expect(pipeline.playAudio).toHaveBeenCalledWith("audiobook");
  });

  it("offers stop instead of listen while playing, and stops through the pipeline", async () => {
    const pipeline = makePipeline({
      stage: "LISTENING",
      tempAudioPaths: { audiobook: "C:/tmp/a.mp3" },
      activePlayingTrack: "audiobook",
    });
    await renderPanel({ pipeline });

    const stop = screen.getByRole("button", { name: /Stop/ });
    fireEvent.click(stop);
    expect(pipeline.stopAudio).toHaveBeenCalled();
  });

  it("disables save while the other track is playing", async () => {
    // The podcast is playing, so the audiobook panel must not offer a save.
    const pipeline = makePipeline({
      stage: "LISTENING",
      tempAudioPaths: { audiobook: "C:/tmp/a.mp3" },
      activePlayingTrack: "podcast",
    });
    await renderPanel({ pipeline, trackType: "audiobook" });

    expect(screen.getByRole("button", { name: /Save MP3 File/ })).toBeDisabled();
  });

  it("disables listen while the save dialog is open", async () => {
    const pipeline = makePipeline({
      stage: "DOWNLOADING",
      tempAudioPaths: { audiobook: "C:/tmp/a.mp3" },
      activeDownloadingTrack: "audiobook",
    });
    await renderPanel({ pipeline });

    expect(screen.getByRole("button", { name: /Listen MP3/ })).toBeDisabled();
  });

  it("names the download after the track and format", async () => {
    const pipeline = readyPipeline();
    await renderPanel({ pipeline, trackType: "audiobook" });

    fireEvent.click(screen.getByRole("button", { name: /Save MP3 File/ }));

    await waitFor(() =>
      expect(pipeline.downloadTrack).toHaveBeenCalledWith(
        "audiobook",
        "The Water Cycle-audiobook.mp3"
      )
    );
  });

  it("uses the podcast suffix on the podcast track", async () => {
    const pipeline = makePipeline({
      stage: "AUDIO_READY",
      tempAudioPaths: { podcast: "C:/tmp/p.mp3" },
    });
    await renderPanel({ pipeline, trackType: "podcast" });

    fireEvent.click(screen.getByRole("button", { name: /Save MP3 File/ }));

    await waitFor(() =>
      expect(pipeline.downloadTrack).toHaveBeenCalledWith("podcast", "The Water Cycle-podcast.mp3")
    );
  });

  it("strips filesystem-hostile characters from the filename", async () => {
    const pipeline = readyPipeline();
    await renderPanel({ pipeline, lesson: { title: 'a/b\\c:d*e?f"g<h>i|j' } });

    fireEvent.click(screen.getByRole("button", { name: /Save MP3 File/ }));

    await waitFor(() =>
      expect(pipeline.downloadTrack).toHaveBeenCalledWith(
        "audiobook",
        "a_b_c_d_e_f_g_h_i_j-audiobook.mp3"
      )
    );
  });

  it("falls back to a default filename when the title is blank", async () => {
    const pipeline = readyPipeline();
    await renderPanel({ pipeline, lesson: { title: "   " } });

    fireEvent.click(screen.getByRole("button", { name: /Save MP3 File/ }));

    await waitFor(() =>
      expect(pipeline.downloadTrack).toHaveBeenCalledWith("audiobook", "study-studio-audiobook.mp3")
    );
  });

  it("treats a title of only separators as underscores, not as blank", async () => {
    // Characterises a real subtlety: the sanitiser maps each hostile character
    // to "_", so "///" becomes "___" — which `trim()` leaves alone, because
    // trim only strips whitespace. The fallback therefore does NOT fire, and
    // the saved file is named "___". Pinned so a future change to the sanitiser
    // has to be deliberate about which of these two behaviours it wants.
    const pipeline = readyPipeline();
    await renderPanel({ pipeline, lesson: { title: "///" } });

    fireEvent.click(screen.getByRole("button", { name: /Save MP3 File/ }));

    await waitFor(() =>
      expect(pipeline.downloadTrack).toHaveBeenCalledWith("audiobook", "___-audiobook.mp3")
    );
  });

  it("shows the save-in-progress label", async () => {
    const pipeline = makePipeline({
      stage: "DOWNLOADING",
      tempAudioPaths: { audiobook: "C:/tmp/a.mp3" },
      activeDownloadingTrack: "audiobook",
    });
    await renderPanel({ pipeline });

    expect(screen.getByRole("button", { name: /Choosing location/ })).toBeInTheDocument();
  });

  it("confirms once the file has been saved", async () => {
    await renderPanel({
      pipeline: makePipeline({
        stage: "AUDIO_READY",
        tempAudioPaths: { audiobook: "C:/tmp/a.mp3" },
        savedLocations: { audiobook: "C:/Users/me/a.mp3" },
      }),
    });

    expect(screen.getByText(/Saved to your chosen location/)).toBeInTheDocument();
  });

  it("does not claim saved when the track was never saved", async () => {
    await renderPanel({ pipeline: readyPipeline() });
    expect(screen.queryByText(/Saved to your chosen location/)).not.toBeInTheDocument();
  });
});

describe("AudioFileDownload — voice selection", () => {
  it("reports an audiobook voice change upward", async () => {
    const onVoiceChange = jest.fn();
    await renderPanel({ onVoiceChange });

    fireEvent.change(selects()[0]!, { target: { value: "en_US-amy-medium" } });
    expect(onVoiceChange).toHaveBeenCalledWith("en_US-amy-medium");
  });

  it("reports host A and host B changes separately", async () => {
    const onVoiceChange = jest.fn();
    const onVoiceBChange = jest.fn();
    await renderPanel({ trackType: "podcast", onVoiceChange, onVoiceBChange });

    fireEvent.change(selects()[0]!, { target: { value: "en_US-amy-medium" } });
    fireEvent.change(selects()[1]!, { target: { value: "en_US-lessac-medium" } });

    expect(onVoiceChange).toHaveBeenCalledWith("en_US-amy-medium");
    expect(onVoiceBChange).toHaveBeenCalledWith("en_US-lessac-medium");
  });

  it("prefers the explicit voice prop over the lesson's stored voice", async () => {
    await renderPanel({ voice: "en_US-amy-medium", lesson: { ttsVoice: "en_US-lessac-medium" } });
    expect(selects()[0]!).toHaveValue("en_US-amy-medium");
  });

  it("falls back to the lesson's stored voice", async () => {
    await renderPanel({ lesson: { ttsVoice: "en_US-amy-medium" } });
    expect(selects()[0]!).toHaveValue("en_US-amy-medium");
  });

  it("picks a female voice for host B when none is chosen", async () => {
    await renderPanel({ trackType: "podcast" });
    expect(selects()[1]!).toHaveValue("en_US-amy-medium");
  });

  it("filters the catalog to the lesson's language", async () => {
    mockCatalog.mockResolvedValue([
      voice("en_US-lessac-medium", { displayName: "Lessac", language: "en" }),
      voice("ar_JO-kareem-medium", { displayName: "Kareem", language: "ar" }),
    ]);
    await renderPanel({ lesson: { title: "دورة الماء" } });

    expect(mockVoicesForLanguage).toHaveBeenCalledWith(expect.anything(), "ar");
    expect(selects()[0]!).toHaveValue("ar_JO-kareem-medium");
  });
});

describe("AudioFileDownload — audio element", () => {
  it("renders a player once the file URL resolves", async () => {
    await renderPanel({
      pipeline: makePipeline({ stage: "AUDIO_READY", tempAudioPaths: { audiobook: "C:/tmp/a.mp3" } }),
    });

    await waitFor(() => expect(mockAudioFileUrl).toHaveBeenCalledWith("C:/tmp/a.mp3"));
    await waitFor(() =>
      expect(screen.getByTestId("audio-element")).toHaveAttribute(
        "src",
        "asset://C:/tmp/track.mp3"
      )
    );
  });

  it("reports play, pause and end back to the pipeline", async () => {
    const pipeline = makePipeline({
      stage: "AUDIO_READY",
      tempAudioPaths: { audiobook: "C:/tmp/a.mp3" },
    });
    await renderPanel({ pipeline });

    const audio = await screen.findByTestId("audio-element");

    fireEvent.play(audio);
    expect(pipeline.playAudio).toHaveBeenCalledWith("audiobook");

    fireEvent.pause(audio);
    expect(pipeline.stopAudio).toHaveBeenCalled();

    fireEvent.ended(audio);
    expect(pipeline.stopAudio).toHaveBeenCalledTimes(2);
  });

  it("falls back to no player when the URL cannot be built", async () => {
    mockAudioFileUrl.mockRejectedValue(new Error("no asset protocol"));
    await renderPanel({
      pipeline: makePipeline({ stage: "AUDIO_READY", tempAudioPaths: { audiobook: "C:/tmp/a.mp3" } }),
    });

    await waitFor(() => expect(mockAudioFileUrl).toHaveBeenCalled());
    expect(screen.queryByTestId("audio-element")).not.toBeInTheDocument();
  });

  it("renders no player when there is no temp path", async () => {
    await renderPanel();
    expect(screen.queryByTestId("audio-element")).not.toBeInTheDocument();
  });

  it("pauses playback and disables saving while the save dialog is open", async () => {
    // Was a pinned defect. Playback is paused rather than torn down, so the
    // player stays mounted — that part was always right. The Save button, by
    // contrast, stayed enabled because `isDownloadDisabled` listed LISTENING
    // but not DOWNLOADING, so a second click still reached `downloadTrack` and
    // opened a second OS dialog. Both halves are asserted here.
    await renderPanel({
      pipeline: makePipeline({
        stage: "DOWNLOADING",
        tempAudioPaths: { audiobook: "C:/tmp/a.mp3" },
        activeDownloadingTrack: "audiobook",
      }),
    });

    expect(await screen.findByTestId("audio-element")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: /Choosing location/ });
    expect(save).toBeInTheDocument();
    expect(save).toBeDisabled();
  });

  it("does not let a second save start while the first is still open", async () => {
    // The consequence of the fix above: the button no longer accepts the click.
    // The hook-level guard that makes this true even if a click got through is
    // covered in useTopicAudioPipeline.test.tsx.
    const pipeline = makePipeline({
      stage: "DOWNLOADING",
      tempAudioPaths: { audiobook: "C:/tmp/a.mp3" },
      activeDownloadingTrack: "audiobook",
    });
    await renderPanel({ pipeline });

    const save = screen.getByRole("button", { name: /Choosing location/ });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(pipeline.downloadTrack).not.toHaveBeenCalled();
  });
});
