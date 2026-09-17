import { buildTtsText, voiceGenderFor, voiceRepoBase, voicesForLanguage } from "@/lib/tts";
import type { UnifiedVoice } from "@/lib/tts";
import { Lesson } from "@/types";

const uvoice = (id: string, over: Partial<UnifiedVoice> = {}): UnifiedVoice => ({
  id,
  displayName: id,
  language: "en",
  gender: "male",
  source: "piper-seed",
  available: true,
  ...over,
});

describe("voiceRepoBase", () => {
  it("maps voice ids to nested piper repo paths", () => {
    expect(voiceRepoBase("ar_JO-kareem-medium")).toBe("ar/ar_JO/kareem/medium");
    expect(voiceRepoBase("en_US-lessac-medium")).toBe("en/en_US/lessac/medium");
    expect(voiceRepoBase("en_GB-alba-medium")).toBe("en/en_GB/alba/medium");
    expect(voiceRepoBase("en_US-amy-medium")).toBe("en/en_US/amy/medium");
  });
});

describe("voicesForLanguage", () => {
  it("only lists Arabic voices that actually exist in piper", () => {
    const ar = voicesForLanguage("ar").map((v) => v.id);
    expect(ar).toEqual(["ar_JO-kareem-medium"]);
  });

  it("lists all English voices", () => {
    const en = voicesForLanguage("en").map((v) => v.id);
    expect(en).toEqual([
      "en_US-lessac-medium",
      "en_US-amy-medium",
      "en_GB-alba-medium",
    ]);
  });
});

describe("voiceGenderFor", () => {
  const catalog: UnifiedVoice[] = [
    uvoice("en_US-lessac-medium"),
    uvoice("en_US-amy-medium", { gender: "female" }),
  ];

  it("reads gender from the catalog rather than the voice id", () => {
    // The defect this replaced: `id.includes("female")` is false for every real
    // Piper id, so `en_US-amy-medium` — a female voice — reported "male", and
    // so did every other voice, making the podcast prompt name two men.
    expect(voiceGenderFor(catalog, "en_US-amy-medium")).toBe("female");
    expect(voiceGenderFor(catalog, "en_US-lessac-medium")).toBe("male");
  });

  it("uses the catalog for an id the name heuristic cannot read", () => {
    // The assertion that actually distinguishes the two sources. Every seed
    // voice is named after a person the heuristic recognises — amy, lessac,
    // kareem — so on the seed catalog alone a pure name heuristic agrees with
    // the catalog and the suite cannot tell them apart. Mutation testing found
    // exactly that: replacing the catalog lookup with "never matches" survived.
    // This id carries no gender word, so only the catalog can answer.
    const opaque = [uvoice("en_US-alpha-medium", { gender: "female" })];
    expect(voiceGenderFor(opaque, "en_US-alpha-medium")).toBe("female");
    // ...and with no catalog entry the heuristic alone says "male", which is
    // what makes the line above a real assertion rather than a coincidence.
    expect(voiceGenderFor([], "en_US-alpha-medium")).toBe("male");
  });

  it("falls back to the name heuristic for ids the catalog does not know", () => {
    expect(voiceGenderFor(catalog, "ws:Samantha")).toBe("female");
    expect(voiceGenderFor(catalog, "ws:Daniel")).toBe("male");
  });

  it("reports male when neither the catalog nor the name knows", () => {
    // Preserves the previous default for genuinely unidentifiable voices.
    expect(voiceGenderFor(catalog, "custom-voice-01")).toBe("male");
    expect(voiceGenderFor([], "zzz")).toBe("male");
  });

  it("does not let an 'unknown' catalog entry shadow the name heuristic", () => {
    const withUnknown = [uvoice("ws:Samantha", { gender: "unknown" })];
    expect(voiceGenderFor(withUnknown, "ws:Samantha")).toBe("female");
  });
});

describe("buildTtsText", () => {
  it("joins podcast lines with speaker labels", () => {
    const lesson: Lesson = {
      id: "1",
      title: "Test Podcast",
      sections: [],
      glossary: [],
      quiz: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      type: "podcast",
      podcastScript: [
        { speaker: "Host A", text: "Welcome." },
        { speaker: "Host B", text: "Hello there." },
      ],
    };
    expect(buildTtsText(lesson)).toBe("Host A: Welcome.\nHost B: Hello there.");
  });

  it("falls back to lesson sections for lessons", () => {
    const lesson: Lesson = {
      id: "2",
      title: "Water Cycle",
      sections: [
        { heading: "Evaporation", content: "Water turns to vapor." },
        { heading: "Condensation", content: "Vapor forms clouds." },
      ],
      glossary: [],
      quiz: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      type: "lesson",
    };
    expect(buildTtsText(lesson)).toBe(
      "Evaporation.\nWater turns to vapor.\n\nCondensation.\nVapor forms clouds."
    );
  });

  it("handles a podcast with an empty script by using sections", () => {
    const lesson: Lesson = {
      id: "3",
      title: "Empty Script",
      sections: [{ heading: "Intro", content: "Content here." }],
      glossary: [],
      quiz: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      type: "podcast",
      podcastScript: [],
    };
    expect(buildTtsText(lesson)).toBe("Intro.\nContent here.");
  });

  it("uses the podcast script even when the lesson type is 'lesson'", () => {
    const lesson: Lesson = {
      id: "4",
      title: "INTJ Lesson",
      sections: [{ heading: "Overview", content: "Lesson body that must NOT be read." }],
      glossary: [],
      quiz: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      type: "lesson",
      podcastScript: [
        { speaker: "Host A", text: "مرحبا بكم." },
        { speaker: "Host B", text: "أهلا بك." },
      ],
    };
    expect(buildTtsText(lesson)).toBe("Host A: مرحبا بكم.\nHost B: أهلا بك.");
  });
});
