import {
  loadJourneys,
  saveJourneys,
  getJourney,
  createJourney,
  updateJourney,
  deleteJourney,
  addTopicToJourney,
  removeTopicFromJourney,
  buildJourneyContextPrompt,
  type Journey,
} from "@/lib/journeys";

// journeys.ts had zero coverage despite owning all journey persistence.
// The shared jest.setup stubs localStorage with bare jest.fn()s, which return
// undefined and would make every read look like "no data" — so this suite
// installs a real in-memory store.

const KEY = "study-studio-journeys";
let store: Record<string, string>;

beforeEach(() => {
  store = {};
  Object.defineProperty(window, "localStorage", {
    writable: true,
    configurable: true,
    value: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = String(v);
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        store = {};
      },
    },
  });
});

describe("loadJourneys / saveJourneys", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(loadJourneys()).toEqual([]);
  });

  it("round-trips a journey list", () => {
    const list: Journey[] = [
      { id: "j1", title: "Astronomy", createdAt: "2026-01-01T00:00:00.000Z", topicIds: [] },
    ];
    saveJourneys(list);
    expect(loadJourneys()).toEqual(list);

    // Payloads are versioned so a future shape change can migrate. Assert the
    // envelope exists rather than comparing raw JSON, which would pin the
    // implementation instead of the contract.
    const raw = JSON.parse(store[KEY]!);
    expect(raw).toHaveProperty("v");
    expect(raw.data).toEqual(list);
  });

  it("returns an empty list rather than throwing on corrupt JSON", () => {
    store[KEY] = "{not json";
    expect(loadJourneys()).toEqual([]);
  });

  it("swallows a write failure instead of throwing", () => {
    Object.defineProperty(window, "localStorage", {
      writable: true,
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {},
        clear: () => {},
      },
    });
    // Silently drops, but must not take the caller down with it.
    expect(() => saveJourneys([])).not.toThrow();
  });
});

describe("createJourney", () => {
  it("prepends the new journey so the newest is first", () => {
    const first = createJourney("First");
    const second = createJourney("Second");
    const all = loadJourneys();
    expect(all.map((j) => j.id)).toEqual([second.id, first.id]);
  });

  it("generates a unique id and an ISO timestamp", () => {
    const j = createJourney("Water Cycle");
    expect(j.id).toBeTruthy();
    expect(Number.isNaN(Date.parse(j.createdAt))).toBe(false);
  });

  it("gives two journeys created in the same millisecond distinct ids", () => {
    // Regression guard: the fallback id used to be `j-${Date.now()}`, so two
    // journeys created in the same tick collided — and because deleteJourney
    // filters by id, deleting one deleted both. crypto.randomUUID is absent in
    // this environment, so this exercises the fallback path directly.
    const ids = Array.from({ length: 50 }, (_, i) => createJourney(`J${i}`).id);
    expect(new Set(ids).size).toBe(50);
  });

  it("trims the title and falls back for a blank one", () => {
    expect(createJourney("  Spaced  ").title).toBe("Spaced");
    expect(createJourney("   ").title).toBe("Untitled Journey");
  });

  it("carries optional fields through", () => {
    const j = createJourney("Arabic Track", {
      description: "desc",
      context: "ctx",
      language: "ar",
      topicIds: ["t1"],
    });
    expect(j.description).toBe("desc");
    expect(j.context).toBe("ctx");
    expect(j.language).toBe("ar");
    expect(j.topicIds).toEqual(["t1"]);
  });

  it("defaults topicIds to an empty array", () => {
    expect(createJourney("Plain").topicIds).toEqual([]);
  });
});

describe("getJourney / updateJourney / deleteJourney", () => {
  it("finds a journey by id, or returns null", () => {
    const j = createJourney("Findable");
    expect(getJourney(j.id)?.title).toBe("Findable");
    expect(getJourney("does-not-exist")).toBeNull();
  });

  it("applies a patch and returns the updated record", () => {
    const j = createJourney("Original");
    const updated = updateJourney(j.id, { title: "Renamed", context: "new ctx" });
    expect(updated?.title).toBe("Renamed");
    expect(updated?.context).toBe("new ctx");
    expect(getJourney(j.id)?.title).toBe("Renamed");
  });

  it("preserves fields the patch does not mention", () => {
    const j = createJourney("Keep", { description: "keep me" });
    const updated = updateJourney(j.id, { title: "Changed" });
    expect(updated?.description).toBe("keep me");
  });

  it("returns null when updating an unknown id", () => {
    expect(updateJourney("nope", { title: "x" })).toBeNull();
  });

  it("deletes only the targeted journey", () => {
    const a = createJourney("A");
    const b = createJourney("B");
    deleteJourney(a.id);
    expect(loadJourneys().map((j) => j.id)).toEqual([b.id]);
  });

  it("is a no-op when deleting an unknown id", () => {
    const a = createJourney("A");
    deleteJourney("nope");
    expect(loadJourneys().map((j) => j.id)).toEqual([a.id]);
  });
});

describe("addTopicToJourney / removeTopicFromJourney", () => {
  it("appends a topic and reports success", () => {
    const j = createJourney("Track");
    expect(addTopicToJourney(j.id, "t1")).toBe(true);
    expect(addTopicToJourney(j.id, "t2")).toBe(true);
    expect(getJourney(j.id)?.topicIds).toEqual(["t1", "t2"]);
  });

  it("does not add the same topic twice", () => {
    const j = createJourney("Track");
    addTopicToJourney(j.id, "t1");
    addTopicToJourney(j.id, "t1");
    expect(getJourney(j.id)?.topicIds).toEqual(["t1"]);
  });

  it("reports failure for an unknown journey", () => {
    expect(addTopicToJourney("nope", "t1")).toBe(false);
  });

  it("removes a topic, leaving the others", () => {
    const j = createJourney("Track");
    addTopicToJourney(j.id, "t1");
    addTopicToJourney(j.id, "t2");
    removeTopicFromJourney(j.id, "t1");
    expect(getJourney(j.id)?.topicIds).toEqual(["t2"]);
  });

  it("is a no-op when removing from an unknown journey", () => {
    expect(() => removeTopicFromJourney("nope", "t1")).not.toThrow();
  });

  it("is a no-op when removing a topic that is not present", () => {
    const j = createJourney("Track");
    addTopicToJourney(j.id, "t1");
    removeTopicFromJourney(j.id, "absent");
    expect(getJourney(j.id)?.topicIds).toEqual(["t1"]);
  });
});

describe("buildJourneyContextPrompt", () => {
  const journey: Journey = {
    id: "j1",
    title: "Astrophysics",
    description: "From stars to black holes",
    createdAt: "2026-01-01T00:00:00.000Z",
    topicIds: [],
    context: "explicit context",
  };

  it("lists the covered topics and asks the model to build on them", () => {
    const prompt = buildJourneyContextPrompt(journey, [
      { id: "t1", title: "Star Formation" },
      { id: "t2", title: "Stellar Lifecycle" },
    ]);
    expect(prompt).toContain("Astrophysics");
    expect(prompt).toContain("From stars to black holes");
    expect(prompt).toContain("- Star Formation");
    expect(prompt).toContain("- Stellar Lifecycle");
    expect(prompt).toMatch(/avoid repeating/i);
  });

  it("omits the description line when there is no description", () => {
    const { description, ...noDesc } = journey;
    void description;
    const prompt = buildJourneyContextPrompt(noDesc as Journey, [{ id: "t1", title: "X" }]);
    expect(prompt).not.toContain("Description:");
  });

  it("falls back to the explicit context when no topics are covered yet", () => {
    expect(buildJourneyContextPrompt(journey, [])).toBe("explicit context");
  });

  it("falls back to the journey title when there is no explicit context", () => {
    const { context, ...noCtx } = journey;
    void context;
    expect(buildJourneyContextPrompt(noCtx as Journey, [])).toBe("Journey: Astrophysics");
  });
});
