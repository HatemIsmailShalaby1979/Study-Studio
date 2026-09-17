import { render, screen, fireEvent } from "@testing-library/react";
import AudioPlayer from "@/components/AudioPlayer";
import PodcastPlayer from "@/components/PodcastPlayer";

function installSpeech() {
  const synth = {
    speak: jest.fn(),
    cancel: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    getVoices: jest.fn(() => [
      { name: "English Male", lang: "en-US" },
      { name: "English Female", lang: "en-US" },
    ]),
    onvoiceschanged: null,
  } as unknown as SpeechSynthesis;
  Object.defineProperty(globalThis, "speechSynthesis", { configurable: true, writable: true, value: synth });
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
    configurable: true,
    writable: true,
    value: function (text: string) {
      return { text, rate: 1, pitch: 1, voice: null, onend: null };
    },
  });
  return synth;
}

const sections = [{ heading: "Intro", content: "Water matters." }, { heading: "Depth", content: "Cycles." }];
const script = [{ speaker: "Host A" as const, text: "Welcome." }, { speaker: "Host B" as const, text: "Let us begin." }];

beforeEach(() => {
  jest.clearAllMocks();
});

describe("AudioPlayer", () => {
  it("renders controls and loads voices", () => {
    installSpeech();
    render(<AudioPlayer sections={sections} title="Water" onClose={jest.fn()} />);
    expect(screen.getByText("Audio Playback")).toBeInTheDocument();
    expect(screen.getByText("Intro")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "English Male" })).toBeInTheDocument();
  });

  it("plays, pauses, resumes, skips, stops, and closes", () => {
    const synth = installSpeech();
    const onClose = jest.fn();
    render(<AudioPlayer sections={sections} title="Water" onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    expect(synth.speak).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /pause/i }));
    expect(synth.pause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /resume/i }));
    expect(synth.resume).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("Next"));
    fireEvent.click(screen.getByTitle("Stop"));
    expect(synth.cancel).toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === "✕")!);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("PodcastPlayer", () => {
  it("renders both host selectors and controls", () => {
    installSpeech();
    render(<PodcastPlayer script={script} title="Water podcast" onClose={jest.fn()} />);
    expect(screen.getByText("Podcast Player")).toBeInTheDocument();
    expect(screen.getByText("Host A Voice")).toBeInTheDocument();
    expect(screen.getByText("Host B Voice")).toBeInTheDocument();
  });

  it("can start, pause, stop and close", () => {
    const synth = installSpeech();
    const onClose = jest.fn();
    render(<PodcastPlayer script={script} title="Water podcast" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    expect(synth.speak).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /pause/i }));
    expect(synth.pause).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("Stop"));
    expect(synth.cancel).toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === "✕")!);
    expect(onClose).toHaveBeenCalled();
  });
});
