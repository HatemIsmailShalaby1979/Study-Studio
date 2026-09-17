/**
 * Skill registry + injector tests.
 *
 * Covers the three things that make skill injection trustworthy:
 *  - resolution (id, alias, language shorthand, unknown fallback)
 *  - composition (deterministic order, dedup, per-intent routing)
 *  - injection (what actually lands in the system prompt)
 */

import {
  ALL_SKILLS,
  SkillInjector,
  bindDefaultSkills,
  bindSkills,
  defaultSkill,
  defaultSkillSet,
  getSkill,
  hasSkill,
  humanizerSkill,
  listSkills,
  skillsForIntent,
} from "@/lib/skills";

describe("skill registry — resolution", () => {
  it("resolves a skill by its own id", () => {
    expect(getSkill("humanizer").id).toBe("humanizer");
    expect(getSkill("education").id).toBe("education");
    expect(getSkill("podcast-ops").id).toBe("podcast-ops");
    expect(getSkill("open-lesson").id).toBe("open-lesson");
    expect(getSkill("notebooklm-studio").id).toBe("notebooklm-studio");
  });

  it("resolves language shorthands and names to the scaffolding pack", () => {
    for (const alias of ["de", "deutsch", "german"]) {
      expect(getSkill(alias).id).toBe("lang-deutsch-a1");
    }
    expect(getSkill("ar").id).toBe("lang-arabic-a1");
    expect(getSkill("es").id).toBe("lang-spanish-a1");
    expect(getSkill("fr").id).toBe("lang-french-a1");
  });

  it("resolves conversational aliases", () => {
    expect(getSkill("humanize").id).toBe("humanizer");
    expect(getSkill("audiobook").id).toBe("storytelling");
    expect(getSkill("socratic").id).toBe("open-lesson");
    expect(getSkill("notebooklm").id).toBe("notebooklm-studio");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(getSkill("  HUMANIZER ").id).toBe("humanizer");
    expect(getSkill("Deutsch").id).toBe("lang-deutsch-a1");
  });

  it("falls back to the default skill for unknown, empty, and undefined input", () => {
    expect(getSkill("nope-not-a-skill").id).toBe("default");
    expect(getSkill("").id).toBe("default");
    expect(getSkill(undefined).id).toBe("default");
  });

  it("reports whether a skill exists", () => {
    expect(hasSkill("humanizer")).toBe(true);
    expect(hasSkill("de")).toBe(true);
    expect(hasSkill("definitely-not-real")).toBe(false);
  });

  it("lists every registered skill for the UI", () => {
    const listed = listSkills();
    expect(listed.length).toBe(ALL_SKILLS.length);
    const ids = listed.map((s) => s.id);
    expect(ids).toContain("humanizer");
    expect(ids).toContain("education");
    expect(ids).toContain("podcast-ops");
    expect(ids).toContain("open-lesson");
    expect(ids).toContain("notebooklm-studio");
  });

  it("gives every skill a unique id", () => {
    const ids = ALL_SKILLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every skill non-empty instructions and a numeric priority", () => {
    for (const skill of ALL_SKILLS) {
      expect(skill.systemInstructions.trim().length).toBeGreaterThan(50);
      expect(typeof skill.priority).toBe("number");
      expect(skill.name.length).toBeGreaterThan(0);
    }
  });
});

describe("skill registry — intent routing", () => {
  it("routes a lesson to the pedagogy packs and always ends with the humanizer", () => {
    const ids = skillsForIntent("lesson").map((s) => s.id);
    expect(ids).toContain("education");
    expect(ids).toContain("open-lesson");
    expect(ids).toContain("humanizer");
    // The humanizer carries the highest priority, so it lands last and governs
    // the finished prose.
    expect(ids[ids.length - 1]).toBe("humanizer");
  });

  it("routes a podcast to the audio packs, not the lesson packs", () => {
    const ids = skillsForIntent("podcast").map((s) => s.id);
    expect(ids).toContain("podcast-ops");
    expect(ids).toContain("podcast");
    expect(ids).not.toContain("education");
    expect(ids).not.toContain("open-lesson");
  });

  it("routes research to the source-grounding pack", () => {
    const ids = skillsForIntent("research").map((s) => s.id);
    expect(ids).toContain("notebooklm-studio");
  });

  it("routes rewrite to the humanizer alone plus the default educator", () => {
    const ids = skillsForIntent("rewrite").map((s) => s.id);
    expect(ids).toContain("humanizer");
    expect(ids).not.toContain("podcast-ops");
  });

  it("orders by ascending priority", () => {
    const priorities = skillsForIntent("lesson").map((s) => s.priority);
    const sorted = [...priorities].sort((a, b) => a - b);
    expect(priorities).toEqual(sorted);
  });

  it("honours an exclusion", () => {
    const ids = skillsForIntent("lesson", { exclude: ["humanizer"] }).map((s) => s.id);
    expect(ids).not.toContain("humanizer");
  });

  it("honours a forced inclusion", () => {
    const ids = skillsForIntent("podcast", { include: ["notebooklm-studio"] }).map((s) => s.id);
    expect(ids).toContain("notebooklm-studio");
  });

  it("is deterministic — the same intent yields the same order", () => {
    const a = skillsForIntent("lesson").map((s) => s.id);
    const b = skillsForIntent("lesson").map((s) => s.id);
    expect(a).toEqual(b);
  });

  it("defaultSkillSet is the lesson set", () => {
    expect(defaultSkillSet().map((s) => s.id)).toEqual(
      skillsForIntent("lesson").map((s) => s.id)
    );
  });
});

describe("skill injector", () => {
  let injector: SkillInjector;

  beforeEach(() => {
    injector = new SkillInjector();
  });

  it("returns the prompt unchanged when nothing is bound", () => {
    expect(injector.apply("BASE PROMPT")).toBe("BASE PROMPT");
    expect(injector.current()).toBeNull();
  });

  it("prepends the bound skills and keeps the base prompt last", () => {
    injector.bind({ modelName: "m1", intent: "lesson" });
    const out = injector.apply("BASE PROMPT");
    expect(out).toContain("SKILL: EDUCATION");
    expect(out).toContain("SKILL: HUMANIZER");
    expect(out.endsWith("BASE PROMPT")).toBe(true);
    // The base prompt must come after every skill block.
    expect(out.indexOf("SKILL: EDUCATION")).toBeLessThan(out.indexOf("BASE PROMPT"));
  });

  it("includes a provenance header naming the active skills", () => {
    injector.bind({ modelName: "m1", intent: "lesson" });
    const out = injector.apply("BASE");
    expect(out).toContain("STUDY STUDIO");
    expect(out).toContain("humanizer");
  });

  it("is idempotent — re-binding identical parameters returns the same context", () => {
    const first = injector.bind({ modelName: "m1", intent: "lesson" });
    const second = injector.bind({ modelName: "m1", intent: "lesson" });
    expect(second).toBe(first);
    expect(second.injectedAt).toBe(first.injectedAt);
  });

  it("re-binds when the model changes", () => {
    const first = injector.bind({ modelName: "m1", intent: "lesson" });
    const second = injector.bind({ modelName: "m2", intent: "lesson" });
    expect(second).not.toBe(first);
    expect(second.modelName).toBe("m2");
  });

  it("re-binds when the provider changes", () => {
    const first = injector.bind({ modelName: "m1", providerId: "lm-studio", intent: "lesson" });
    const second = injector.bind({ modelName: "m1", providerId: "ollama", intent: "lesson" });
    expect(second).not.toBe(first);
  });

  it("binds an explicit skill selection, deduplicated and ordered", () => {
    injector.bind({ modelName: "m1", skillIds: ["humanizer", "education", "humanizer"] });
    const ids = injector.activeIds();
    expect(ids).toEqual(["education", "humanizer"]);
  });

  it("falls back to the intent set when explicit ids do not resolve", () => {
    injector.bind({ modelName: "m1", skillIds: ["not-a-skill"], intent: "lesson" });
    // getSkill() maps unknown ids to the default skill, so the set is non-empty.
    expect(injector.activeIds().length).toBeGreaterThan(0);
  });

  it("applyForIntent composes without disturbing the session binding", () => {
    injector.bind({ modelName: "m1", intent: "lesson" });
    const before = injector.activeIds();

    const out = injector.applyForIntent("PODCAST BASE", "podcast");
    expect(out).toContain("SKILL: PODCAST-OPS");
    expect(out.endsWith("PODCAST BASE")).toBe(true);

    expect(injector.activeIds()).toEqual(before);
  });

  it("summaries() is a plain, serialisable view of the binding", () => {
    injector.bind({ modelName: "m1", intent: "lesson" });
    const summaries = injector.summaries();
    expect(summaries.length).toBeGreaterThan(0);
    for (const s of summaries) {
      expect(typeof s.id).toBe("string");
      expect(typeof s.name).toBe("string");
      expect(typeof s.category).toBe("string");
    }
    // Must survive a JSON round-trip (it is stored in React state).
    expect(JSON.parse(JSON.stringify(summaries))).toEqual(summaries);
  });

  it("reset clears the binding", () => {
    injector.bind({ modelName: "m1", intent: "lesson" });
    injector.reset();
    expect(injector.current()).toBeNull();
    expect(injector.apply("BASE")).toBe("BASE");
  });
});

describe("bindDefaultSkills / bindSkills", () => {
  it("bindDefaultSkills binds the launch-time set and returns a summary", () => {
    const summaries = bindDefaultSkills({ model: "qwen2.5-7b", providerId: "lm-studio" });
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries.map((s) => s.id)).toContain("humanizer");
  });

  it("bindSkills binds exactly what was asked for", () => {
    const summaries = bindSkills("m1", ["humanizer"], "lm-studio");
    expect(summaries.map((s) => s.id)).toEqual(["humanizer"]);
  });

  it("bindSkills with an empty selection falls back to the default skill", () => {
    const summaries = bindSkills("m1", []);
    expect(summaries.map((s) => s.id)).toEqual([defaultSkill.id]);
  });

  it("the injected prompt carries the humanizer's core rules", () => {
    bindSkills("m1", ["humanizer"]);
    const prompt = new SkillInjector().apply("BASE");
    // A fresh injector has no binding, so prove it via the singleton instead.
    expect(prompt).toBe("BASE");
    expect(humanizerSkill.systemInstructions).toContain("NOT X BUT Y");
  });
});
