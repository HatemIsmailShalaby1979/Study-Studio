import { getLessonSystemPrompt, podcastChunkSystemPrompt } from "@/lib/generation";
import { bindDefaultSkills, bindSkills, skillInjector } from "@/lib/skills";

// Plan item 4.13: "generating a lesson injects education + open-lesson +
// humanizer; generating a podcast injects podcast-ops + humanizer. Verified by
// asserting the assembled system prompt in a test."
//
// This asserts the REAL prompts — the ones generateLesson and
// generatePodcastOnly actually send — rather than the injector in isolation
// (which skills.test.ts already covers). The point is that the wiring in
// generation.ts is correct, since that is what a refactor would silently break.

/**
 * Skill ids named in the injector's provenance header.
 *
 * The header is emitted in composition order, so this doubles as an ordering
 * assertion: `<!-- STUDY STUDIO · N skill packs active: a, b, c -->`.
 */
function activeSkillsIn(prompt: string): string[] {
  const match = prompt.match(/skill packs? active: ([^>]*?) -->/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The task text each builder appends after the skill blocks. */
const LESSON_TASK_MARKER = "world-class expert educator";
const PODCAST_TASK_MARKER = "podcast script writer";

beforeEach(() => {
  skillInjector.reset();
});

describe("lesson path — education + open-lesson + humanizer", () => {
  it("carries the bound lesson skill set", () => {
    bindDefaultSkills({ model: "granite", providerId: "lm-studio" });
    const ids = activeSkillsIn(getLessonSystemPrompt("intermediate", "en"));

    expect(ids).toContain("education");
    expect(ids).toContain("open-lesson");
    expect(ids).toContain("humanizer");
  });

  it("does not carry the podcast pack", () => {
    bindDefaultSkills({ model: "granite" });
    expect(activeSkillsIn(getLessonSystemPrompt("intermediate"))).not.toContain("podcast-ops");
  });

  it("places the humanizer last, and the task after every skill block", () => {
    bindDefaultSkills({ model: "granite" });
    const prompt = getLessonSystemPrompt("intermediate");

    const ids = activeSkillsIn(prompt);
    // humanizer has priority 90 and appliesTo: [] so it always lands last.
    expect(ids[ids.length - 1]).toBe("humanizer");

    // The task prompt must come after the header and all skill blocks, or the
    // model reads the task before the methodology it is meant to follow.
    const headerEnd = prompt.indexOf("-->");
    expect(headerEnd).toBeGreaterThan(-1);
    expect(prompt.indexOf(LESSON_TASK_MARKER)).toBeGreaterThan(headerEnd);
  });
});

describe("podcast path — podcast-ops + humanizer", () => {
  it("carries podcast-ops + humanizer even though the bound set is the lesson set", () => {
    // This is the case that matters: a podcast generated from the lesson page
    // must still follow podcast methodology, not lesson methodology.
    bindDefaultSkills({ model: "granite", providerId: "lm-studio" });

    const ids = activeSkillsIn(
      podcastChunkSystemPrompt("intermediate", "en", "male", "female")
    );

    expect(ids).toContain("podcast-ops");
    expect(ids).toContain("humanizer");
  });

  it("does not carry the lesson-only packs", () => {
    bindDefaultSkills({ model: "granite" });

    const ids = activeSkillsIn(
      podcastChunkSystemPrompt("intermediate", "en", "male", "female")
    );

    expect(ids).not.toContain("education");
    expect(ids).not.toContain("open-lesson");
  });

  it("resolves by intent, ignoring an unrelated session binding", () => {
    // Bind something deliberately unrelated; the podcast prompt must not care.
    bindSkills("granite", ["notebooklm-studio"], "lm-studio");

    const ids = activeSkillsIn(
      podcastChunkSystemPrompt("intermediate", "en", "male", "female")
    );

    expect(ids).toContain("podcast-ops");
    expect(ids).not.toContain("notebooklm-studio");
  });

  it("puts the task text after the skill blocks", () => {
    bindDefaultSkills({ model: "granite" });
    const prompt = podcastChunkSystemPrompt("intermediate", "en", "male", "female");
    expect(prompt.indexOf(PODCAST_TASK_MARKER)).toBeGreaterThan(prompt.indexOf("-->"));
  });
});

describe("the two paths are genuinely different", () => {
  it("routes lesson and podcast intents to different skill sets", () => {
    bindDefaultSkills({ model: "granite" });

    const lesson = activeSkillsIn(getLessonSystemPrompt("intermediate"));
    const podcast = activeSkillsIn(
      podcastChunkSystemPrompt("intermediate", "en", "male", "female")
    );

    // Both carry the universal writer.
    expect(lesson).toContain("humanizer");
    expect(podcast).toContain("humanizer");

    // Each carries something the other does not — so this is routing, not a
    // single set applied everywhere.
    expect(lesson).toContain("education");
    expect(podcast).not.toContain("education");
    expect(podcast).toContain("podcast-ops");
    expect(lesson).not.toContain("podcast-ops");
  });
});

describe("no binding", () => {
  it("passes the lesson prompt through with no header", () => {
    const prompt = getLessonSystemPrompt("intermediate");
    expect(activeSkillsIn(prompt)).toEqual([]);
    // The task text is still there — injection is additive, never required.
    expect(prompt).toContain(LESSON_TASK_MARKER);
  });

  it("still applies podcast skills, because that path resolves by intent", () => {
    // The podcast prompt does not depend on a session binding at all.
    const ids = activeSkillsIn(
      podcastChunkSystemPrompt("intermediate", "en", "male", "female")
    );
    expect(ids).toContain("podcast-ops");
  });
});
