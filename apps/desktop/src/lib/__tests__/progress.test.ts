import {
  dayBefore,
  dayKey,
  computeStreak,
  computeStats,
  markAccessed,
  markQuizComplete,
  clearProgress,
  clearAllProgress,
} from "@/lib/progress";

function installStorageMock() {
  let store: Record<string, string> = {};
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
      key: () => null,
      length: 0,
    },
  });
}

installStorageMock();

describe("dayKey / dayBefore", () => {
  it("formats local date as YYYY-MM-DD", () => {
    const dt = new Date(2026, 7, 15);
    expect(dayKey(dt)).toBe("2026-08-15");
  });

  it("returns the previous calendar day", () => {
    expect(dayBefore("2026-08-15")).toBe("2026-08-14");
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
  });
});

describe("computeStreak", () => {
  it("returns 0 for no study days", () => {
    expect(computeStreak([])).toBe(0);
  });

  it("counts consecutive days ending today", () => {
    const today = dayKey();
    const d2 = dayBefore(today);
    const d3 = dayBefore(d2);
    expect(computeStreak([d2, today, d3])).toBe(3);
  });

  it("keeps the streak alive if the last day is yesterday", () => {
    const today = dayKey();
    const yesterday = dayBefore(today);
    const d3 = dayBefore(yesterday);
    expect(computeStreak([yesterday, d3])).toBe(2);
  });

  it("breaks the streak when there is a gap", () => {
    const today = dayKey();
    const gap = dayBefore(dayBefore(today));
    expect(computeStreak([gap, today])).toBe(1);
  });

  it("returns 0 when the most recent study day is not today or yesterday", () => {
    const threeDaysAgo = dayBefore(dayBefore(dayBefore(dayKey())));
    expect(computeStreak([threeDaysAgo])).toBe(0);
  });
});

describe("progress store", () => {
  beforeEach(() => {
    clearAllProgress();
  });

  it("tracks access and upgrades not_started to in_progress", () => {
    markAccessed("lesson-1");
    const map = JSON.parse(localStorage.getItem("study-studio-progress") || "{}");
    expect(map["lesson-1"].status).toBe("in_progress");
    expect(map["lesson-1"].lastAccessed).toBeTruthy();
  });

  it("records quiz completion with a clamped score", () => {
    markQuizComplete("lesson-1", 87.4);
    const map = JSON.parse(localStorage.getItem("study-studio-progress") || "{}");
    expect(map["lesson-1"].status).toBe("completed");
    expect(map["lesson-1"].lastQuizScore).toBe(87);
  });

  it("clears progress for a single lesson", () => {
    markAccessed("lesson-1");
    markAccessed("lesson-2");
    clearProgress("lesson-1");
    const map = JSON.parse(localStorage.getItem("study-studio-progress") || "{}");
    expect(map["lesson-1"]).toBeUndefined();
    expect(map["lesson-2"]).toBeDefined();
  });
});

describe("computeStats", () => {
  beforeEach(() => {
    clearAllProgress();
  });

  it("computes totals, average score and streak from stored progress", () => {
    markQuizComplete("a", 90);
    markQuizComplete("b", 70);
    markAccessed("c");
    const stats = computeStats([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(stats.totalLessons).toBe(3);
    expect(stats.completedLessons).toBe(2);
    expect(stats.inProgressLessons).toBe(1);
    expect(stats.averageQuizScore).toBe(80);
    expect(stats.streakDays).toBe(1);
    expect(stats.lastStudiedDate).toBe(dayKey());
  });

  it("handles an empty library", () => {
    const stats = computeStats([]);
    expect(stats.totalLessons).toBe(0);
    expect(stats.averageQuizScore).toBeNull();
    expect(stats.streakDays).toBe(0);
    expect(stats.lastStudiedDate).toBeNull();
  });
});
