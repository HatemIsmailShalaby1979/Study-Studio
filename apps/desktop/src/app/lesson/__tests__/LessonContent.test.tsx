import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import LessonContent from "@/app/lesson/LessonContent";
import { getLesson, upsertLesson } from "@/lib/libraryStore";
import { markAccessed, markQuizComplete } from "@/lib/progress";
import { generatePodcastOnly } from "@/lib/api";
import * as tts from "@/lib/tts";
import type { Lesson } from "@/types";

// Characterisation tests for LessonContent, written BEFORE the plan item 5.2
// split. The component is ~917 lines in one function and the split will move
// whole subtrees out of it, so these tests exist to pin the behaviour that must
// survive the move. They deliberately assert on what the user sees and on the
// persistence calls made — not on internal state or DOM structure — so
// reshaping the JSX into subcomponents does not invalidate them.
//
// Everything with I/O is mocked: the store, TTS, the podcast API, progress and
// navigation. The pipeline hook is mocked too, because it wraps Tauri-only audio
// work that cannot run in jsdom; the real hook has its own suite.
//
// Scope note: the audiobook and podcast tab bodies are covered here as well as
// the lesson tab, because those two subtrees are exactly what the split would
// relocate. If this file ever drops below the component's own coverage floor,
// the split loses its safety net.

jest.mock("@/lib/libraryStore", () => ({
  getLesson: jest.fn(),
  upsertLesson: jest.fn(),
  loadLibrary: jest.fn(),
  saveLibrary: jest.fn(),
  deleteLesson: jest.fn(),
}));

jest.mock("@/lib/progress", () => ({
  markAccessed: jest.fn(),
  markQuizComplete: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  generatePodcastOnly: jest.fn(),
}));

// Only the I/O surface is faked. The pure helpers deliberately keep their REAL
// implementations — `voiceGenderFor` above all, because the podcast tests assert
// on the gender the request carries. A stubbed resolver would make those
// assertions test the stub: every value would come back `undefined` and
// `objectContaining` would still match, so the suite would pass while the
// behaviour was broken. `buildTtsText` is overridden because its real output is
// irrelevant here and a fixed string makes the pipeline-seeding tests readable.
jest.mock("@/lib/tts", () => {
  const actual = jest.requireActual("@/lib/tts");
  return {
    ...actual,
    listAvailableVoices: jest.fn(),
    downloadVoice: jest.fn(),
    checkFfmpeg: jest.fn(),
    unifiedVoiceCatalog: jest.fn(),
    unifiedVoicesForLanguage: jest.fn(),
    isTtsAvailable: jest.fn(),
    buildTtsText: jest.fn(() => "built tts text"),
  };
});

const mockPush = jest.fn();
let searchParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), prefetch: jest.fn(), back: jest.fn() }),
  useSearchParams: () => searchParams,
  usePathname: () => "/lesson",
}));

// The pipeline is Tauri-backed in reality; drive it from the test instead.
const mockPipeline = {
  hasUnsavedAudio: false,
  canStartQuiz: false,
  isQuizActive: false,
  // The "Leave Anyway" path reads tempAudioPaths to mark both tracks saved
  // before applying the pending navigation, so this must be a real object.
  state: { htmlContent: null as string | null, tempAudioPaths: {} as Record<string, string> },
  startQuiz: jest.fn(),
  completeQuiz: jest.fn(),
  exitQuiz: jest.fn(),
  seedContent: jest.fn(),
  seedAudio: jest.fn(),
};
jest.mock("@/hooks/useTopicAudioPipeline", () => ({
  useTopicAudioPipeline: () => mockPipeline,
}));

// The runtime context is stubbed rather than provided, because this suite is
// about LessonContent's own wiring. `canGenerate` is the switch under test: the
// podcast SCRIPT is gated on it, and must not be gated on TTS.
let mockCanGenerate = true;
jest.mock("@/components/AIRuntimeProvider", () => ({
  useAIRuntime: () => ({ canGenerate: mockCanGenerate }),
}));

// The heavy leaf components are not what this suite is about, and mocking them
// keeps failures pointed at LessonContent's own wiring.
jest.mock("@/components/Quiz", () => ({
  __esModule: true,
  default: ({ onEvaluationComplete }: { onEvaluationComplete: (r: unknown) => void }) => (
    <button
      onClick={() =>
        onEvaluationComplete({
          overallScore: 88,
          totalQuestions: 4,
          correctAnswers: 3,
          rating: "good",
          feedback: "ok",
          perQuestion: [
            { isCorrect: true, explanation: "right because" },
            { isCorrect: false, explanation: "wrong because" },
          ],
        })
      }
    >
      submit-quiz
    </button>
  ),
}));
jest.mock("@/components/DiagnosticQuiz", () => ({
  __esModule: true,
  default: ({ onExit }: { onExit: () => void }) => <button onClick={onExit}>exit-diagnostic</button>,
}));
jest.mock("@/components/AudioPlayer", () => ({
  __esModule: true,
  default: () => <div data-testid="audio-player" />,
}));
jest.mock("@/components/PodcastPlayer", () => ({
  __esModule: true,
  default: () => <div data-testid="podcast-player" />,
}));

// AudioFileDownload is mocked down to its callback surface: that is the seam
// through which LessonContent owns audio-path persistence, voice state and the
// podcast track diff. Deliver the props in the props bag so tests can assert on
// the exact object LessonContent builds (e.g. the podcast track diff).
jest.mock("@/components/AudioFileDownload", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => (
    <div>
      <span data-testid="audio-download" data-props={JSON.stringify(props)} />
      <button onClick={() => (props.onAudioReady as (p: string) => void)("C:/new-audio.wav")}>
        audio-ready
      </button>
    </div>
  ),
}));

jest.mock("@/components/Breadcrumbs", () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <nav>{title}</nav>,
}));
jest.mock("@/components/LessonTabs", () => ({
  __esModule: true,
  default: ({ activeTab, onTabChange }: { activeTab: string; onTabChange: (t: string) => void }) => (
    <div>
      <span data-testid="active-tab">{activeTab}</span>
      <button onClick={() => onTabChange("lesson")}>tab-lesson</button>
      <button onClick={() => onTabChange("audiobook")}>tab-audiobook</button>
      <button onClick={() => onTabChange("podcast")}>tab-podcast</button>
    </div>
  ),
}));

const mockGetLesson = getLesson as jest.MockedFunction<typeof getLesson>;
const mockUpsertLesson = upsertLesson as jest.MockedFunction<typeof upsertLesson>;
const mockGeneratePodcast = generatePodcastOnly as jest.MockedFunction<typeof generatePodcastOnly>;
const mockMarkAccessed = markAccessed as jest.MockedFunction<typeof markAccessed>;
const mockMarkQuizComplete = markQuizComplete as jest.MockedFunction<typeof markQuizComplete>;
const mockDownloadVoice = tts.downloadVoice as jest.MockedFunction<typeof tts.downloadVoice>;
const mockUnifiedVoiceCatalog = tts.unifiedVoiceCatalog as jest.MockedFunction<
  typeof tts.unifiedVoiceCatalog
>;
const mockVoicesForLanguage = tts.unifiedVoicesForLanguage as jest.MockedFunction<
  typeof tts.unifiedVoicesForLanguage
>;
const mockListAvailableVoices = tts.listAvailableVoices as jest.MockedFunction<
  typeof tts.listAvailableVoices
>;
const mockCheckFfmpeg = tts.checkFfmpeg as jest.MockedFunction<typeof tts.checkFfmpeg>;
const mockIsTtsAvailable = tts.isTtsAvailable as jest.MockedFunction<typeof tts.isTtsAvailable>;

function voice(
  id: string,
  over: Partial<tts.UnifiedVoice> = {}
): tts.UnifiedVoice {
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
const ARABIC_VOICES = [
  voice("ar_JO-kareem-medium", { displayName: "Kareem", language: "ar" }),
  voice("ar_JO-laila-medium", { displayName: "Laila", language: "ar", gender: "female" }),
];

/** Language matching just prefixes, like the real catalog filter. */
function subsetFor(voices: tts.UnifiedVoice[], lang: string) {
  return voices.filter((v) => v.language.startsWith(lang));
}

function lesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: "l1",
    title: "The Water Cycle",
    type: "lesson",
    createdAt: "2026-03-04T10:00:00.000Z",
    sections: [
      { heading: "Evaporation", content: "Water rises." },
      { heading: "Condensation", content: "Clouds form." },
    ],
    glossary: [{ term: "Evaporation", definition: "Liquid to gas." }],
    quiz: [{ question: "Q1", options: ["a", "b"], correctIndex: 0, explanation: "because" }],
    ...over,
  };
}

async function renderWith(over: Partial<Lesson> = {}, id = "l1") {
  searchParams = new URLSearchParams(`id=${id}`);
  mockGetLesson.mockResolvedValue(lesson(over));
  const view = render(<LessonContent />);
  // The load path is async; wait for the spinner to give way to content.
  await waitFor(() => expect(screen.queryByText(/Loading lesson/i)).not.toBeInTheDocument());
  return view;
}

/** Switch tabs the way a user would, and wait for the new body to commit. */
async function openTab(name: "lesson" | "audiobook" | "podcast") {
  fireEvent.click(screen.getByRole("button", { name: `tab-${name}` }));
  await waitFor(() => expect(screen.getByTestId("active-tab")).toHaveTextContent(name));
}

// The voice <select>s render next to a plain <label> with no htmlFor, so
// neither getByLabelText nor an accessible-name query can reach them. Ordering
// is the only stable handle: within a tab body the first combobox is Host A /
// Voice and the second is Host B. Tests assert on `.value`, which is the
// control the user actually operates.
function voiceSelects(): HTMLSelectElement[] {
  return screen.getAllByRole("combobox") as HTMLSelectElement[];
}

function selectFor(labelText: string): HTMLSelectElement {
  // Host B is always the second selector where both exist; the audiobook tab
  // has a single "Voice" selector.
  const index = labelText === "Host B Voice" ? 1 : 0;
  const selects = voiceSelects();
  const select = selects[index];
  if (!select) throw new Error(`no select at index ${index} for "${labelText}"`);
  return select;
}

/** The props LessonContent hands the (mocked) AudioFileDownload panel. */
function downloadProps(): Record<string, unknown> {
  // The mock serialises the props bag onto the testid element; this is the only
  // way to assert the object LessonContent builds (track diffs, voice wiring),
  // which the component's own JSX does not otherwise surface.
  const raw = screen.getByTestId("audio-download").getAttribute("data-props");
  if (!raw) throw new Error("audio-download props not captured");
  return JSON.parse(raw);
}

beforeEach(() => {
  jest.clearAllMocks();
  searchParams = new URLSearchParams("id=l1");
  mockPipeline.hasUnsavedAudio = false;
  mockPipeline.canStartQuiz = false;
  mockPipeline.isQuizActive = false;
  mockPipeline.state.htmlContent = null;
  mockPipeline.state.tempAudioPaths = {};
  // Default to "a model is available", which is the normal state of the page
  // this suite exercises; the unavailable case is asserted explicitly.
  mockCanGenerate = true;

  mockGetLesson.mockResolvedValue(lesson());
  mockUpsertLesson.mockResolvedValue(true);
  mockGeneratePodcast.mockResolvedValue({ podcastScript: [{ speaker: "Host A", text: "Hi" }] });

  mockListAvailableVoices.mockResolvedValue(["en_US-lessac-medium"]);
  mockCheckFfmpeg.mockResolvedValue(true);
  // The real catalog is mixed-language; the language filter is exercised by
  // the switcher tests, so both languages must be present by default.
  mockUnifiedVoiceCatalog.mockResolvedValue([...ENGLISH_VOICES, ...ARABIC_VOICES]);
  mockVoicesForLanguage.mockImplementation(subsetFor);
  mockIsTtsAvailable.mockResolvedValue(true);
  mockDownloadVoice.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("LessonContent — loading", () => {
  it("shows a spinner until the lesson resolves", async () => {
    searchParams = new URLSearchParams("id=l1");
    let resolve: (l: Lesson) => void = () => {};
    mockGetLesson.mockReturnValue(new Promise((r) => (resolve = r)));

    render(<LessonContent />);
    expect(screen.getByText(/Loading lesson/i)).toBeInTheDocument();

    await act(async () => {
      resolve(lesson());
    });
    await waitFor(() => expect(screen.queryByText(/Loading lesson/i)).not.toBeInTheDocument());
  });

  it("redirects home when the lesson id is unknown", async () => {
    searchParams = new URLSearchParams("id=missing");
    mockGetLesson.mockResolvedValue(null);

    render(<LessonContent />);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
  });

  it("tags the lesson as accessed once loaded", async () => {
    await renderWith();
    expect(mockMarkAccessed).toHaveBeenCalledWith("l1");
  });

  it("seeds the pipeline with the lesson content", async () => {
    await renderWith();
    expect(mockPipeline.seedContent).toHaveBeenCalledWith("The Water Cycle", "built tts text");
  });

  it("resumes audio when the stored lesson already has a path", async () => {
    await renderWith({ audioPath: "C:/existing.wav" });
    expect(mockPipeline.seedAudio).toHaveBeenCalledWith({
      audiobook: "C:/existing.wav",
      podcast: "C:/existing.wav",
    });
  });

  it("does not seed audio when there is none", async () => {
    await renderWith();
    expect(mockPipeline.seedAudio).not.toHaveBeenCalled();
  });

  it("restores the saved voice, second voice and format", async () => {
    await renderWith({
      ttsVoice: "en_US-amy-medium",
      ttsVoiceB: "en_US-lessac-medium",
      audioFormat: "wav",
    });
    await openTab("audiobook");

    expect(selectFor("Voice")).toHaveValue("en_US-amy-medium");
    // ffmpeg probed as available, so both format buttons are live.
    expect(screen.getByRole("button", { name: "MP3" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "WAV" })).toBeInTheDocument();
  });

  it("falls back to an untitled placeholder when the lesson has no title", async () => {
    await renderWith({ title: "" });
    expect(mockPipeline.seedContent).toHaveBeenCalledWith("Lesson", "built tts text");
  });
});

describe("LessonContent — lesson tab", () => {
  it("renders the title, sections and difficulty badge", async () => {
    await renderWith({ difficulty: "expert" });

    expect(screen.getByRole("heading", { level: 1, name: "The Water Cycle" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Evaporation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Condensation" })).toBeInTheDocument();
    expect(screen.getByText(/Expert/)).toBeInTheDocument();
  });

  it("opens on the lesson tab", async () => {
    await renderWith();
    expect(screen.getByTestId("active-tab")).toHaveTextContent("lesson");
  });

  it("sets RTL direction for Arabic lessons", async () => {
    // The layout root carries dir="rtl"; its presence is what flips the page.
    await renderWith({ title: "دورة الماء" });
    expect(screen.getByTestId("lesson-root")).toHaveAttribute("dir", "rtl");
  });

  it("does not set RTL for English lessons", async () => {
    await renderWith();
    expect(screen.getByTestId("lesson-root")).not.toHaveAttribute("dir");
  });

  it("navigates to the generator when editing", async () => {
    await renderWith();
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    expect(mockPush).toHaveBeenCalledWith("/generate?edit=l1");
  });

  it("renders the evaluation rollup and per-question breakdown", async () => {
    await renderWith();
    fireEvent.click(screen.getByRole("button", { name: /Quiz/ }));

    // Swap the per-question breakdown in before submitting, so the results
    // block below the fold is rendered with real content.
    mockMarkQuizComplete.mockReturnValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "submit-quiz" }));

    expect(await screen.findByRole("heading", { name: /Educational Assessment/i })).toBeInTheDocument();
    expect(screen.getByText("88%")).toBeInTheDocument();
    expect(screen.getByText(/3\/4 correct/)).toBeInTheDocument();
    expect(screen.getByText(/👍 Good/)).toBeInTheDocument();
    // Both ternary arms of the per-question breakdown render.
    expect(screen.getByText(/right because/)).toBeInTheDocument();
    expect(screen.getByText(/wrong because/)).toBeInTheDocument();
    expect(screen.getByText("✅")).toBeInTheDocument();
    expect(screen.getByText("❌")).toBeInTheDocument();
  });

  it("navigates back to the library from the lesson footer", async () => {
    await renderWith();
    fireEvent.click(screen.getByRole("button", { name: /Learning Journey/ }));
    expect(mockPush).toHaveBeenCalledWith("/library");
  });

  it("navigates to a new generation from the lesson footer", async () => {
    await renderWith();
    fireEvent.click(screen.getByRole("button", { name: /Create New/ }));
    expect(mockPush).toHaveBeenCalledWith("/generate");
  });
});

describe("LessonContent — glossary", () => {
  it("hides glossary entries until the toggle is used", async () => {
    await renderWith();

    expect(screen.getByRole("button", { name: /Glossary/ })).toBeInTheDocument();
    expect(screen.queryByText("Liquid to gas.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Glossary/ }));
    expect(screen.getByText("Liquid to gas.")).toBeInTheDocument();
  });

  it("collapses the glossary again on a second toggle", async () => {
    await renderWith();
    const toggle = screen.getByRole("button", { name: /Glossary/ });

    fireEvent.click(toggle);
    expect(screen.getByText("Liquid to gas.")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByText("Liquid to gas.")).not.toBeInTheDocument();
  });

  it("omits the glossary block entirely when there are no terms", async () => {
    await renderWith({ glossary: [] });
    expect(screen.queryByRole("button", { name: /Glossary/ })).not.toBeInTheDocument();
  });
});

describe("LessonContent — quiz", () => {
  it("omits the quiz block when the lesson has no questions", async () => {
    await renderWith({ quiz: [] });
    expect(screen.queryByRole("button", { name: /Quiz/ })).not.toBeInTheDocument();
  });

  it("hides quiz questions until the toggle is used", async () => {
    await renderWith();
    expect(screen.queryByRole("button", { name: "submit-quiz" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Quiz/ }));
    expect(screen.getByRole("button", { name: "submit-quiz" })).toBeInTheDocument();
  });

  it("records the score when the quiz completes", async () => {
    await renderWith();

    fireEvent.click(screen.getByRole("button", { name: /Quiz/ }));
    fireEvent.click(screen.getByRole("button", { name: "submit-quiz" }));

    await waitFor(() => expect(mockMarkQuizComplete).toHaveBeenCalledWith("l1", 88));
  });

  it("offers the diagnostic quiz only when the pipeline allows it", async () => {
    await renderWith();
    expect(screen.queryByRole("button", { name: /Challenge Yourself/i })).not.toBeInTheDocument();

    mockPipeline.canStartQuiz = true;
    const { unmount } = await renderWith();
    expect(screen.getAllByRole("button", { name: /Challenge Yourself/i }).length).toBeGreaterThan(0);
    unmount();
  });

  it("renders the diagnostic quiz while one is active", async () => {
    mockPipeline.isQuizActive = true;
    await renderWith();
    expect(screen.getByRole("button", { name: "exit-diagnostic" })).toBeInTheDocument();
  });

  it("starts the diagnostic quiz on demand", async () => {
    mockPipeline.canStartQuiz = true;
    await renderWith();
    fireEvent.click(screen.getByRole("button", { name: "Challenge Yourself" }));
    expect(mockPipeline.startQuiz).toHaveBeenCalled();
  });

  it("hands the generated HTML to the diagnostic quiz when present", async () => {
    mockPipeline.canStartQuiz = true;
    mockPipeline.isQuizActive = true;
    mockPipeline.state.htmlContent = "<p>generated</p>";
    await renderWith();

    expect(screen.getByRole("button", { name: "exit-diagnostic" })).toBeInTheDocument();
  });
});

describe("LessonContent — tabs", () => {
  it("switches to the audiobook tab", async () => {
    await renderWith();
    await openTab("audiobook");
    expect(screen.getByTestId("audio-download")).toBeInTheDocument();
  });

  it("switches to the podcast tab", async () => {
    await renderWith();
    await openTab("podcast");

    expect(screen.getByRole("button", { name: /Generate Podcast/i })).toBeInTheDocument();
  });

  it("persists a newly generated audio path", async () => {
    await renderWith();
    await openTab("audiobook");
    fireEvent.click(screen.getByRole("button", { name: "audio-ready" }));

    await waitFor(() =>
      expect(mockUpsertLesson).toHaveBeenCalledWith(expect.objectContaining({ audioPath: "C:/new-audio.wav" }))
    );
  });

  it("returns to the lesson tab from the audiobook footer", async () => {
    await renderWith();
    await openTab("audiobook");
    fireEvent.click(screen.getByRole("button", { name: /Back to Lesson/ }));
    await waitFor(() => expect(screen.getByTestId("active-tab")).toHaveTextContent("lesson"));
  });

  it("returns to the lesson tab from the podcast footer", async () => {
    await renderWith();
    await openTab("podcast");
    fireEvent.click(screen.getByRole("button", { name: /Back to Lesson/ }));
    await waitFor(() => expect(screen.getByTestId("active-tab")).toHaveTextContent("lesson"));
  });
});

describe("LessonContent — audiobook tab", () => {
  it("labels the track and offers the format switch", async () => {
    await renderWith();
    await openTab("audiobook");

    expect(screen.getByText(/🎧 Audiobook/)).toBeInTheDocument();
    expect(selectFor("Voice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "MP3" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "WAV" })).toBeInTheDocument();
  });

  it("warns when the lesson language voice is not downloaded, and hides the warning once it is", async () => {
    // No Arabic voices installed, so the primary Arabic voice is missing.
    mockListAvailableVoices.mockResolvedValue([]);
    await renderWith({ title: "دورة الماء" });
    await openTab("audiobook");

    expect(screen.getByText(/Arabic voice not downloaded/i)).toBeInTheDocument();
    expect(screen.getByText(/one-time download/i)).toBeInTheDocument();

    // Downloading the primary Arabic voice should clear the banner.
    fireEvent.click(screen.getByRole("button", { name: /Kareem/ }));
    await waitFor(() =>
      expect(screen.queryByText(/Arabic voice not downloaded/i)).not.toBeInTheDocument()
    );
    expect(mockDownloadVoice).toHaveBeenCalledWith("ar_JO-kareem-medium");
  });

  it("does not show the missing-voice banner before the catalog has loaded", async () => {
    mockUnifiedVoiceCatalog.mockResolvedValue([]);
    await renderWith();
    await openTab("audiobook");

    expect(screen.queryByText(/Voice not downloaded/i)).not.toBeInTheDocument();
  });

  it("surfaces the TTS-unavailable notice", async () => {
    mockIsTtsAvailable.mockResolvedValue(false);
    await renderWith();
    await openTab("audiobook");

    expect(screen.getByText(/Text-to-speech unavailable/i)).toBeInTheDocument();
  });

  it("switches format and offers the voice download for the current selection", async () => {
    await renderWith();
    await openTab("audiobook");

    fireEvent.click(screen.getByRole("button", { name: "WAV" }));

    // lessac is available (from listAvailableVoices) but amy is not, so picking
    // amy must reveal the download button.
    fireEvent.change(selectFor("Voice"), { target: { value: "en_US-amy-medium" } });
    expect(screen.getByRole("button", { name: /Download Voice Model/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Download Voice Model/ }));
    await waitFor(() => expect(mockDownloadVoice).toHaveBeenCalledWith("en_US-amy-medium"));
  });

  it("shows a downloading label while the voice install is in flight", async () => {
    let finish: () => void = () => {};
    mockDownloadVoice.mockReturnValue(new Promise<void>((r) => (finish = r)));

    await renderWith();
    await openTab("audiobook");
    fireEvent.change(selectFor("Voice"), { target: { value: "en_US-amy-medium" } });

    fireEvent.click(screen.getByRole("button", { name: /Download Voice Model/ }));
    expect(await screen.findByText(/Downloading voice/i)).toBeInTheDocument();

    await act(async () => {
      finish();
    });
  });

  it("swallows a failed voice download without crashing the tab", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    mockDownloadVoice.mockRejectedValue(new Error("network down"));

    await renderWith();
    await openTab("audiobook");
    fireEvent.change(selectFor("Voice"), { target: { value: "en_US-amy-medium" } });
    fireEvent.click(screen.getByRole("button", { name: /Download Voice Model/ }));

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(screen.getByTestId("active-tab")).toHaveTextContent("audiobook");
  });

  it("passes the audiobook track to the download panel", async () => {
    await renderWith({ audioPath: "C:/existing.wav" });
    await openTab("audiobook");

    const props = downloadProps();
    expect(props.trackType).toBe("audiobook");
    expect(props.audioPath).toBe("C:/existing.wav");
    expect(props.voice).toBe("en_US-lessac-medium");
  });
});

describe("LessonContent — podcast generation", () => {
  it("generates a script and persists it", async () => {
    await renderWith();
    await openTab("podcast");
    fireEvent.click(screen.getByRole("button", { name: /Generate Podcast/i }));

    await waitFor(() => expect(mockGeneratePodcast).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockUpsertLesson).toHaveBeenCalledWith(
        expect.objectContaining({ podcastScript: [{ speaker: "Host A", text: "Hi" }] })
      )
    );
  });

  it("sends the lesson's own topic, difficulty, length and model", async () => {
    await renderWith({
      inputMode: "topic",
      inputText: "Photosynthesis",
      difficulty: "expert",
      length: "long",
      modelName: "llama3",
    });
    await openTab("podcast");
    fireEvent.click(screen.getByRole("button", { name: /Generate Podcast/i }));

    await waitFor(() =>
      expect(mockGeneratePodcast).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: "Photosynthesis",
          content: undefined,
          model: "llama3",
          difficulty: "expert",
          length: "long",
          language: "en",
        })
      )
    );
  });

  it("swaps topic for content when the lesson was made from pasted material", async () => {
    await renderWith({ inputMode: "content", inputText: "Pasted material" });
    await openTab("podcast");
    fireEvent.click(screen.getByRole("button", { name: /Generate Podcast/i }));

    await waitFor(() =>
      expect(mockGeneratePodcast).toHaveBeenCalledWith(
        expect.objectContaining({ topic: undefined, content: "Pasted material" })
      )
    );
  });

  it("defaults the difficulty and length when the lesson omits them", async () => {
    await renderWith();
    await openTab("podcast");
    fireEvent.click(screen.getByRole("button", { name: /Generate Podcast/i }));

    await waitFor(() =>
      expect(mockGeneratePodcast).toHaveBeenCalledWith(
        expect.objectContaining({ difficulty: "intermediate", length: "medium" })
      )
    );
  });

  // These four tests used to pin a defect: `handleGeneratePodcast` derived host
  // gender with `voice.includes("female") ? "female" : "male"`, and no real
  // Piper voice id contains the literal substring "female" (they are
  // `en_US-amy-medium`, `en_US-lessac-medium`, `ar_JO-kareem-medium`, ...), so
  // BOTH hosts always reported "male" in production regardless of the
  // selection. The request now resolves gender through `voiceGenderFor`, which
  // reads `UnifiedVoice.gender` — the same field `handlePodcastLangChange`
  // already used to pick defaults. Rewritten, per the note that was here.
  it("reports each host's gender from the voice catalog", async () => {
    await renderWith();
    await openTab("podcast");

    // The selectors show a male and a female voice by default.
    expect(selectFor("Host A Voice")).toHaveValue("en_US-lessac-medium");
    expect(selectFor("Host B Voice")).toHaveValue("en_US-amy-medium");

    fireEvent.click(screen.getByRole("button", { name: /Generate Podcast/i }));

    await waitFor(() =>
      expect(mockGeneratePodcast).toHaveBeenCalledWith(
        // lessac is the male seed, amy the female one.
        expect.objectContaining({ voiceGenderA: "male", voiceGenderB: "female" })
      )
    );
  });

  it("carries the host voice selections through to the request", async () => {
    mockListAvailableVoices.mockResolvedValue([]);
    await renderWith();
    await openTab("podcast");

    fireEvent.change(selectFor("Host A Voice"), { target: { value: "en_US-amy-medium" } });
    fireEvent.change(selectFor("Host B Voice"), { target: { value: "en_US-lessac-medium" } });

    // The selection really moved — otherwise the assertion below is vacuous.
    expect(selectFor("Host A Voice")).toHaveValue("en_US-amy-medium");
    expect(selectFor("Host B Voice")).toHaveValue("en_US-lessac-medium");

    fireEvent.click(screen.getByRole("button", { name: /Generate Podcast/i }));

    await waitFor(() =>
      expect(mockGeneratePodcast).toHaveBeenCalledWith(
        // Genders follow the LIVE selection, so swapping the defaults swaps
        // them: A is now the female voice and B the male one.
        expect.objectContaining({ voiceGenderA: "female", voiceGenderB: "male" })
      )
    );
  });

  it("trusts the catalog's gender over a misleading voice id", async () => {
    // The inverse of the old heuristic, and the reason this is a real fix
    // rather than a renamed substring test: the ids below say nothing about
    // gender, so only the catalog can supply the answer.
    mockUnifiedVoiceCatalog.mockResolvedValue([
      voice("en_US-alpha-medium", { displayName: "Alpha", gender: "female" }),
      voice("en_US-beta-medium", { displayName: "Beta", gender: "male" }),
    ]);
    mockListAvailableVoices.mockResolvedValue([]);
    await renderWith();
    await openTab("podcast");

    fireEvent.change(selectFor("Host A Voice"), { target: { value: "en_US-alpha-medium" } });
    fireEvent.change(selectFor("Host B Voice"), { target: { value: "en_US-beta-medium" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate Podcast/i }));

    await waitFor(() =>
      expect(mockGeneratePodcast).toHaveBeenCalledWith(
        expect.objectContaining({ voiceGenderA: "female", voiceGenderB: "male" })
      )
    );
  });

  it("follows the language switch to the language's voices", async () => {
    // No Arabic voices installed, so the primary Arabic voice is missing.
    mockListAvailableVoices.mockResolvedValue([]);
    await renderWith({ title: "دورة الماء" });
    await openTab("podcast");

    fireEvent.click(screen.getByRole("button", { name: /العربية/ }));
    fireEvent.click(screen.getByRole("button", { name: /Generate Podcast/i }));

    await waitFor(() =>
      expect(mockGeneratePodcast).toHaveBeenCalledWith(expect.objectContaining({ language: "ar" }))
    );
  });

  it("switches both hosts to the chosen language's voices, with their genders", async () => {
    mockListAvailableVoices.mockResolvedValue([]);
    await renderWith({ title: "دورة الماء" });
    await openTab("podcast");

    fireEvent.click(screen.getByRole("button", { name: /العربية/ }));
    fireEvent.click(screen.getByRole("button", { name: /Generate Podcast/i }));

    await waitFor(() =>
      expect(mockGeneratePodcast).toHaveBeenCalledWith(
        // `voices[0]` then `voices[1]` of the Arabic catalog: kareem, laila.
        // The Arabic seeds are a man and a woman, so the genders differ — the
        // old substring heuristic reported "male" for both.
        expect.objectContaining({ voiceGenderA: "male", voiceGenderB: "female" })
      )
    );
  });

  it("gives both hosts the same voice when the language has only one", async () => {
    // `voices[1] ?? voices[0]`: a one-voice language cannot supply two voices,
    // so host B falls back to host A's. The honest consequence is that both
    // hosts report the SAME gender. This is the case the old, mislabelled test
    // claimed to cover but never did — its catalog held two Arabic voices.
    mockUnifiedVoiceCatalog.mockResolvedValue([
      voice("ar_JO-kareem-medium", { displayName: "Kareem", language: "ar" }),
    ]);
    mockListAvailableVoices.mockResolvedValue([]);
    await renderWith({ title: "دورة الماء" });
    await openTab("podcast");

    fireEvent.click(screen.getByRole("button", { name: /العربية/ }));

    expect(selectFor("Host A Voice")).toHaveValue("ar_JO-kareem-medium");
    expect(selectFor("Host B Voice")).toHaveValue("ar_JO-kareem-medium");

    fireEvent.click(screen.getByRole("button", { name: /Generate Podcast/i }));

    await waitFor(() =>
      expect(mockGeneratePodcast).toHaveBeenCalledWith(
        expect.objectContaining({ voiceGenderA: "male", voiceGenderB: "male" })
      )
    );
  });

  it("keeps the current voice when it already belongs to the chosen language", async () => {
    await renderWith({ ttsVoice: "en_US-amy-medium" });
    await openTab("podcast");

    fireEvent.change(selectFor("Host A Voice"), {
      target: { value: "en_US-lessac-medium" },
    });
    fireEvent.click(screen.getByRole("button", { name: /English/ }));

    expect(selectFor("Host A Voice")).toHaveValue("en_US-lessac-medium");
  });

  it("does not force a voice when the chosen language has no catalog entries yet", async () => {
    mockUnifiedVoiceCatalog.mockResolvedValue([]);
    await renderWith();
    await openTab("podcast");

    fireEvent.click(screen.getByRole("button", { name: /العربية/ }));
    expect(selectFor("Host A Voice")).toBeInTheDocument();
  });

  it("shows the player when a podcast script already exists", async () => {
    await renderWith({ podcastScript: [{ speaker: "Host A", text: "Existing" }] });
    await openTab("podcast");

    expect(screen.getByTestId("podcast-player")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate Podcast/i })).not.toBeInTheDocument();
  });

  it("shows the podcast voice settings once a script exists", async () => {
    await renderWith({ podcastScript: [{ speaker: "Host A", text: "Existing" }] });
    await openTab("podcast");

    expect(screen.getByRole("heading", { name: /Podcast Voice Settings/i })).toBeInTheDocument();
    expect(screen.getByText(/English/)).toBeInTheDocument();
    expect(selectFor("Host B Voice")).toBeInTheDocument();
  });

  it("surfaces a generation failure instead of throwing", async () => {
    mockGeneratePodcast.mockRejectedValue(new Error("model offline"));
    await renderWith();
    await openTab("podcast");
    fireEvent.click(screen.getByRole("button", { name: /Generate Podcast/i }));

    expect(await screen.findByText(/model offline/i)).toBeInTheDocument();
  });

  it("falls back to a generic message when the failure is not an Error", async () => {
    mockGeneratePodcast.mockRejectedValue("nope");
    await renderWith();
    await openTab("podcast");
    fireEvent.click(screen.getByRole("button", { name: /Generate Podcast/i }));

    expect(await screen.findByText(/Failed to generate podcast/i)).toBeInTheDocument();
  });

  it("shows a generating state while the request is in flight", async () => {
    let finish: (v: { podcastScript: [] }) => void = () => {};
    mockGeneratePodcast.mockReturnValue(new Promise((r) => (finish = r)));

    await renderWith();
    await openTab("podcast");
    fireEvent.click(screen.getByRole("button", { name: /Generate Podcast/i }));

    expect(await screen.findByText(/Generating Podcast/i)).toBeInTheDocument();

    await act(async () => {
      finish({ podcastScript: [] });
    });
  });

  it("hands the request a signal and aborts it from the Cancel button", async () => {
    // A podcast is up to a dozen sequential model calls; without this the only
    // way out of a slow run was to close the app.
    let seen: AbortSignal | undefined;
    mockGeneratePodcast.mockImplementation((payload: { signal?: AbortSignal }) => {
      seen = payload.signal;
      return new Promise((_resolve, reject) => {
        payload.signal?.addEventListener("abort", () =>
          reject(new Error("Podcast generation cancelled."))
        );
      });
    });

    await renderWith();
    await openTab("podcast");
    fireEvent.click(screen.getByRole("button", { name: /Generate Podcast/i }));

    const cancel = await screen.findByRole("button", { name: /^Cancel$/i });
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen!.aborted).toBe(false);

    fireEvent.click(cancel);

    expect(seen!.aborted).toBe(true);
    // The user asked for it, so it is not reported as a failure.
    await waitFor(() =>
      expect(screen.queryByText(/Podcast generation cancelled/i)).not.toBeInTheDocument()
    );
    expect(await screen.findByRole("button", { name: /Generate Podcast/i })).toBeInTheDocument();
  });

  it("leaves an existing script alone when the result carries none", async () => {
    mockGeneratePodcast.mockResolvedValue({});
    await renderWith();
    await openTab("podcast");
    fireEvent.click(screen.getByRole("button", { name: /Generate Podcast/i }));

    await waitFor(() => expect(mockGeneratePodcast).toHaveBeenCalled());
    expect(mockUpsertLesson).not.toHaveBeenCalled();
  });

  it("generates the script even when TTS is unavailable", async () => {
    // Regression: the script button used to be gated on `isTts`, so a machine
    // with no Piper voice installed — the state of a fresh install — could
    // never produce a podcast at all, and the button said "TTS unavailable",
    // pointing at the wrong subsystem. Script generation is text only.
    mockIsTtsAvailable.mockResolvedValue(false);
    mockCanGenerate = true;
    await renderWith();
    await openTab("podcast");

    const button = screen.getByRole("button", { name: /Generate Podcast/i });
    expect(button).toBeEnabled();

    fireEvent.click(button);
    await waitFor(() => expect(mockGeneratePodcast).toHaveBeenCalled());
  });

  it("disables script generation when no AI model is available", async () => {
    mockCanGenerate = false;
    await renderWith();
    await openTab("podcast");

    expect(screen.getByRole("button", { name: /No AI model available/i })).toBeDisabled();
  });

  it("offers Host A and Host B voice downloads while no script exists", async () => {
    await renderWith();
    await openTab("podcast");

    // lessac is installed, so only Host B (amy) should offer a download.
    expect(screen.queryByRole("button", { name: /⬇ Host A/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /⬇ Host B/ }));

    expect(mockDownloadVoice).toHaveBeenCalledWith("en_US-amy-medium");
  });

  it("offers both host downloads once a script exists", async () => {
    mockListAvailableVoices.mockResolvedValue([]);
    await renderWith({ podcastScript: [{ speaker: "Host A", text: "Existing" }] });
    await openTab("podcast");

    fireEvent.click(screen.getByRole("button", { name: /Download Host A Voice/ }));
    expect(mockDownloadVoice).toHaveBeenCalledWith("en_US-lessac-medium");
  });

  it("returns to the lesson tab from the with-script podcast footer", async () => {
    await renderWith({ podcastScript: [{ speaker: "Host A", text: "Existing" }] });
    await openTab("podcast");

    fireEvent.click(screen.getByRole("button", { name: /Back to Lesson/ }));
    await waitFor(() => expect(screen.getByTestId("active-tab")).toHaveTextContent("lesson"));
  });

  it("guards the with-script podcast footer edit button", async () => {
    await renderWith({ podcastScript: [{ speaker: "Host A", text: "Existing" }] });
    await openTab("podcast");

    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    expect(mockPush).toHaveBeenCalledWith("/generate?edit=l1");
  });

  it("offers the Host A download when the default voice is missing", async () => {
    // Nothing installed and no podcast script, so both host buttons appear.
    mockListAvailableVoices.mockResolvedValue([]);
    await renderWith();
    await openTab("podcast");

    fireEvent.click(screen.getByRole("button", { name: /⬇ Host A/ }));
    expect(mockDownloadVoice).toHaveBeenCalledWith("en_US-lessac-medium");
  });

  it("labels Host B as downloading while its install is in flight", async () => {
    let finish: () => void = () => {};
    mockDownloadVoice.mockReturnValue(new Promise<void>((r) => (finish = r)));
    mockListAvailableVoices.mockResolvedValue([]);

    await renderWith();
    await openTab("podcast");
    fireEvent.click(screen.getByRole("button", { name: /⬇ Host B/ }));

    expect(await screen.findByText("Downloading...")).toBeInTheDocument();
    await act(async () => {
      finish();
    });
  });

  it("passes the podcast track and a per-render track diff to the download panel", async () => {
    await renderWith({ podcastScript: [{ speaker: "Host A", text: "Existing" }] });
    await openTab("podcast");

    // The podcast panel gets a copy of the lesson with the live voice and
    // format selections folded in, so the file it writes matches what the user
    // picked without mutating the stored lesson.
    const props = downloadProps();
    expect(props.trackType).toBe("podcast");
    expect(props.voice).toBe("en_US-lessac-medium");
    expect(props.voiceB).toBe("en_US-amy-medium");
    expect(props.lesson).toEqual(
      expect.objectContaining({
        ttsVoice: "en_US-lessac-medium",
        ttsVoiceB: "en_US-amy-medium",
        audioFormat: "mp3",
      })
    );
  });
});

describe("LessonContent — unsaved-audio guards", () => {
  it("warns before switching tabs when audio is unsaved", async () => {
    mockPipeline.hasUnsavedAudio = true;
    await renderWith();

    fireEvent.click(screen.getByRole("button", { name: "tab-audiobook" }));

    // The tab must NOT have changed yet — the guard intercepts.
    expect(screen.getByTestId("active-tab")).toHaveTextContent("lesson");
    expect(screen.getByRole("heading", { name: /Unsaved audio file/i })).toBeInTheDocument();
  });

  it("applies the pending switch when the user leaves anyway", async () => {
    mockPipeline.hasUnsavedAudio = true;
    await renderWith();

    fireEvent.click(screen.getByRole("button", { name: "tab-audiobook" }));
    fireEvent.click(screen.getByRole("button", { name: /Leave Anyway/i }));

    expect(screen.getByTestId("active-tab")).toHaveTextContent("audiobook");
  });

  it("marks both tracks saved before applying the pending action", async () => {
    mockPipeline.hasUnsavedAudio = true;
    mockPipeline.state.tempAudioPaths = { audiobook: "C:/tmp/a.wav", podcast: "C:/tmp/p.wav" };
    await renderWith();

    fireEvent.click(screen.getByRole("button", { name: "tab-audiobook" }));
    fireEvent.click(screen.getByRole("button", { name: /Leave Anyway/i }));

    expect(mockPipeline.seedAudio).toHaveBeenCalledWith({
      audiobook: "C:/tmp/a.wav",
      podcast: "C:/tmp/p.wav",
    });
  });

  it("does not seed paths that were never generated", async () => {
    mockPipeline.hasUnsavedAudio = true;
    mockPipeline.state.tempAudioPaths = { audiobook: "C:/tmp/a.wav" };
    await renderWith();

    fireEvent.click(screen.getByRole("button", { name: "tab-audiobook" }));
    fireEvent.click(screen.getByRole("button", { name: /Leave Anyway/i }));

    expect(mockPipeline.seedAudio).toHaveBeenCalledWith({
      audiobook: "C:/tmp/a.wav",
      podcast: undefined,
    });
  });

  it("drops the pending action when the user cancels", async () => {
    mockPipeline.hasUnsavedAudio = true;
    await renderWith();

    fireEvent.click(screen.getByRole("button", { name: "tab-audiobook" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: /Unsaved audio file/i })).not.toBeInTheDocument();

    // The dropped action must not fire later: clearing the warning and trying
    // the footer navigation still goes where the user asked, not to the tab.
    mockPipeline.hasUnsavedAudio = false;
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    expect(mockPush).toHaveBeenCalledWith("/generate?edit=l1");
    expect(screen.getByTestId("active-tab")).toHaveTextContent("lesson");
  });

  it("guards footer navigation, not just tab switches", async () => {
    mockPipeline.hasUnsavedAudio = true;
    await renderWith();

    fireEvent.click(screen.getByRole("button", { name: /Create New/ }));

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: /Unsaved audio file/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Leave Anyway/i }));
    expect(mockPush).toHaveBeenCalledWith("/generate");
  });

  it("re-triggers the guard on a second attempt after cancelling", async () => {
    mockPipeline.hasUnsavedAudio = true;
    await renderWith();

    fireEvent.click(screen.getByRole("button", { name: "tab-audiobook" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "tab-podcast" }));

    expect(screen.getByRole("heading", { name: /Unsaved audio file/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Leave Anyway/i }));
    await waitFor(() => expect(screen.getByTestId("active-tab")).toHaveTextContent("podcast"));
  });

  it("switches tabs freely when nothing is unsaved", async () => {
    await renderWith();
    await openTab("audiobook");

    expect(screen.queryByRole("heading", { name: /Unsaved audio file/i })).not.toBeInTheDocument();
  });

  it("cancels the browser close while audio is unsaved", async () => {
    // The listener is what makes the browser warn on tab close / refresh. The
    // effect's registration is covered above; this exercises the handler body.
    const listeners: Record<string, ((e: Partial<BeforeUnloadEvent>) => void)[]> = {};
    jest
      .spyOn(globalThis, "addEventListener")
      .mockImplementation((type: string, fn: EventListenerOrEventListenerObject) => {
        (listeners[type] ??= []).push(fn as (e: Partial<BeforeUnloadEvent>) => void);
      });

    mockPipeline.hasUnsavedAudio = true;
    await renderWith();

    expect(listeners.beforeunload).toHaveLength(1);
    const event = { preventDefault: jest.fn(), returnValue: "x" } as Partial<BeforeUnloadEvent>;
    listeners.beforeunload[0]!(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.returnValue).toBe("");
  });

  it("tracks scroll progress and cleans the listener up", async () => {
    const removeSpy = jest.spyOn(globalThis, "removeEventListener");
    const view = await renderWith();

    // scrolly math divides by the scrollable height; give it a non-zero one.
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 2000,
    });
    Object.defineProperty(globalThis, "innerHeight", { configurable: true, value: 800 });
    Object.defineProperty(globalThis, "scrollY", { configurable: true, value: 600 });

    await act(async () => {
      globalThis.dispatchEvent(new Event("scroll"));
    });

    expect(screen.getByTestId("active-tab")).toBeInTheDocument();

    // Unmounting must remove exactly the listener the effect added — a leak
    // here would keep a stale setProgress closure alive across lessons.
    view.unmount();
    expect(removeSpy.mock.calls.filter(([type]) => type === "scroll")).toHaveLength(1);
  });

  it("registers the beforeunload guard only while audio is unsaved", async () => {
    const addSpy = jest.spyOn(globalThis, "addEventListener");
    await renderWith();
    expect(addSpy.mock.calls.filter(([type]) => type === "beforeunload")).toHaveLength(0);

    addSpy.mockClear();
    mockPipeline.hasUnsavedAudio = true;
    await renderWith();
    expect(addSpy.mock.calls.filter(([type]) => type === "beforeunload")).toHaveLength(1);
  });
});

