import {
  discoverWebSpeechVoices,
  buildVoiceCatalog,
  sortVoices,
  voicesForLang,
  type DiscoveredVoice,
} from "@/lib/voiceDiscovery";
import { listAvailableVoices, VOICES } from "@/lib/tts";
import { isTauri } from "@/lib/tauri";

// voiceDiscovery.ts had zero coverage. It owns the voice dropdown, including the
// "is this voice actually downloaded?" flag — so a regression here shows up as
// voices that look usable but fail at synthesis time.

jest.mock("@/lib/tts", () => {
  const actual = jest.requireActual("@/lib/tts");
  return { VOICES: actual.VOICES, listAvailableVoices: jest.fn() };
});
jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn() }));

const mockListAvailable = listAvailableVoices as jest.MockedFunction<typeof listAvailableVoices>;
const mockIsTauri = isTauri as jest.MockedFunction<typeof isTauri>;

/** Replace the shared speechSynthesis stub with a controllable one. */
function setWebSpeechVoices(voices: { name: string; lang: string }[] | null) {
  Object.defineProperty(globalThis, "speechSynthesis", {
    writable: true,
    configurable: true,
    value: voices === null ? undefined : { getVoices: () => voices },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsTauri.mockReturnValue(false);
  mockListAvailable.mockResolvedValue([]);
  setWebSpeechVoices([]);
});

describe("discoverWebSpeechVoices", () => {
  it("returns nothing when the API is unavailable", () => {
    setWebSpeechVoices(null);
    expect(discoverWebSpeechVoices()).toEqual([]);
  });

  it("namespaces web-speech ids so they cannot collide with Piper ids", () => {
    setWebSpeechVoices([{ name: "Alex", lang: "en-US" }]);
    const [voice] = discoverWebSpeechVoices();
    expect(voice?.id).toBe("ws:Alex");
    expect(voice?.source).toBe("web-speech");
    expect(voice?.available).toBe(true);
  });

  it("includes the locale in the display name", () => {
    setWebSpeechVoices([{ name: "Alex", lang: "en-US" }]);
    expect(discoverWebSpeechVoices()[0]?.displayName).toBe("Alex (en-US)");
  });

  it.each([
    ["Samantha", "female"],
    ["Microsoft Zira", "female"],
    ["Google UK English Female", "female"],
    ["Daniel", "male"],
    ["Microsoft David", "male"],
    ["Google UK English Male", "male"],
    ["Voice 7", "unknown"],
  ])("infers %s as %s", (name, gender) => {
    setWebSpeechVoices([{ name, lang: "en-US" }]);
    expect(discoverWebSpeechVoices()[0]?.gender).toBe(gender);
  });

  it("survives a throwing speechSynthesis implementation", () => {
    Object.defineProperty(globalThis, "speechSynthesis", {
      writable: true,
      configurable: true,
      value: {
        getVoices: () => {
          throw new Error("engine exploded");
        },
      },
    });
    expect(discoverWebSpeechVoices()).toEqual([]);
  });
});

describe("sortVoices", () => {
  const mk = (lang: string, gender: DiscoveredVoice["gender"], displayName: string): DiscoveredVoice => ({
    id: displayName,
    displayName,
    lang,
    gender,
    style: "x",
    source: "piper",
    available: true,
  });

  it("orders by language, then gender (female first), then name", () => {
    const sorted = sortVoices([
      mk("en", "unknown", "Zed"),
      mk("en", "male", "Bob"),
      mk("en", "female", "Anna"),
      mk("ar", "male", "Kareem"),
    ]);
    expect(sorted.map((v) => v.displayName)).toEqual(["Kareem", "Anna", "Bob", "Zed"]);
  });

  it("does not mutate the input array", () => {
    const input = [mk("en", "male", "B"), mk("en", "female", "A")];
    const snapshot = [...input];
    sortVoices(input);
    expect(input).toEqual(snapshot);
  });

  it("handles an empty list", () => {
    expect(sortVoices([])).toEqual([]);
  });
});

describe("voicesForLang", () => {
  const voices = [
    { id: "a", displayName: "A", lang: "en-US", gender: "male", style: "", source: "piper", available: true },
    { id: "b", displayName: "B", lang: "ar", gender: "male", style: "", source: "piper", available: true },
  ] as DiscoveredVoice[];

  it("matches on the language prefix, case-insensitively", () => {
    expect(voicesForLang(voices, "en").map((v) => v.id)).toEqual(["a"]);
    expect(voicesForLang(voices, "AR").map((v) => v.id)).toEqual(["b"]);
  });

  it("returns nothing for an unmatched language", () => {
    expect(voicesForLang(voices, "de")).toEqual([]);
  });
});

describe("buildVoiceCatalog", () => {
  it("in a browser, offers only web-speech voices and marks Piper ones unavailable", async () => {
    mockIsTauri.mockReturnValue(false);
    setWebSpeechVoices([{ name: "Alex", lang: "en-US" }]);

    const catalog = await buildVoiceCatalog();
    const web = catalog.filter((v) => v.source === "web-speech");
    const piper = catalog.filter((v) => v.source === "piper");

    expect(web).toHaveLength(1);
    expect(piper).toHaveLength(VOICES.length);
    // Nothing is downloaded in a browser, so no Piper voice is offered as usable.
    expect(piper.every((v) => v.available === false)).toBe(true);
    // And the Tauri-only listing was never called.
    expect(mockListAvailable).not.toHaveBeenCalled();
  });

  it("in the desktop shell, marks only downloaded Piper voices available", async () => {
    mockIsTauri.mockReturnValue(true);
    mockListAvailable.mockResolvedValue(["en_US-amy-medium"]);

    const catalog = await buildVoiceCatalog();
    const amy = catalog.find((v) => v.id === "piper:en_US-amy-medium");
    const lessac = catalog.find((v) => v.id === "piper:en_US-lessac-medium");

    expect(amy?.available).toBe(true);
    expect(lessac?.available).toBe(false);
    expect(mockListAvailable).toHaveBeenCalled();
  });

  it("namespaces Piper ids and labels them as HD", async () => {
    mockIsTauri.mockReturnValue(true);
    const catalog = await buildVoiceCatalog();
    const piper = catalog.filter((v) => v.source === "piper");
    expect(piper.every((v) => v.id.startsWith("piper:"))).toBe(true);
    expect(piper.every((v) => v.displayName.includes("Piper HD"))).toBe(true);
  });

  it("maps the Arabic Piper voice to the 'ar' language code", async () => {
    mockIsTauri.mockReturnValue(true);
    const catalog = await buildVoiceCatalog();
    expect(catalog.find((v) => v.id === "piper:ar_JO-kareem-medium")?.lang).toBe("ar");
  });

  it("returns a sorted catalog", async () => {
    mockIsTauri.mockReturnValue(true);
    const catalog = await buildVoiceCatalog();
    const langs = catalog.map((v) => v.lang);
    expect(langs).toEqual([...langs].sort((a, b) => a.localeCompare(b)));
  });

  it("still returns Piper voices when the download listing fails", async () => {
    mockIsTauri.mockReturnValue(true);
    mockListAvailable.mockRejectedValue(new Error("IPC down"));

    const catalog = await buildVoiceCatalog();
    expect(catalog.filter((v) => v.source === "piper")).toHaveLength(VOICES.length);
  });

  it("merges both sources without dropping either", async () => {
    mockIsTauri.mockReturnValue(true);
    mockListAvailable.mockResolvedValue(["en_US-amy-medium"]);
    setWebSpeechVoices([{ name: "Alex", lang: "en-US" }]);

    const catalog = await buildVoiceCatalog();
    expect(catalog.filter((v) => v.source === "web-speech")).toHaveLength(1);
    expect(catalog.filter((v) => v.source === "piper")).toHaveLength(VOICES.length);
  });
});
