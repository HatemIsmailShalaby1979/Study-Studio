import { buildTtsText, voiceRepoBase, voicesForLanguage } from "@/lib/tts";
import { Lesson } from "@/types";

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
