import "fake-indexeddb/auto";
import { renderHook, act } from "@testing-library/react";
import { useLessonPersistence } from "@/hooks/useLessonPersistence";
import { getLesson, resetLibraryStoreForTests, upsertLesson } from "@/lib/libraryStore";
import { resetStorageFailureListeners } from "@/lib/storage";
import type { Lesson, PodcastLine } from "@/types";

// Plan item 2.4: src/hooks was sitting at an explicit 0% coverage floor. This
// hook is the persistence boundary LessonContent uses for its two mutable
// fields, and the bug it guards against is subtle: an update that spreads a
// *stale* lesson and writes it back would silently drop whatever changed in
// between. So these tests assert against the store, not against a mock, using
// fake-indexeddb to exercise the real primary path.

let store: Record<string, string>;

beforeEach(async () => {
  resetStorageFailureListeners();
  await resetLibraryStoreForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("study-studio");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });

  // jest.setup.tsx stubs localStorage with bare jest.fn()s, which makes
  // libraryStore's fallback path untestable. Restore a working map.
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

function lesson(id: string, over: Partial<Lesson> = {}): Lesson {
  return {
    id,
    title: `Lesson ${id}`,
    sections: [{ heading: "Intro", content: "Body" }],
    glossary: [],
    quiz: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    type: "lesson",
    ...over,
  };
}

describe("useLessonPersistence", () => {
  it("loads a lesson that was stored", async () => {
    await upsertLesson(lesson("a1", { title: "Water Cycle" }));

    const { result } = renderHook(() => useLessonPersistence());
    const loaded = await act(async () => result.current.load("a1"));

    expect(loaded?.title).toBe("Water Cycle");
    expect(loaded?.sections).toHaveLength(1);
  });

  it("resolves null for an unknown id instead of throwing", async () => {
    const { result } = renderHook(() => useLessonPersistence());
    const loaded = await act(async () => result.current.load("nope"));

    expect(loaded).toBeNull();
  });

  it("persists a new audioPath without disturbing other fields", async () => {
    await upsertLesson(lesson("b2", { title: "Photosynthesis" }));

    const { result } = renderHook(() => useLessonPersistence());
    const current = (await getLesson("b2"))!;

    await act(async () => {
      await result.current.updateAudioPath(current, "C:/audio/photosynthesis.wav");
    });

    const stored = (await getLesson("b2"))!;
    expect(stored.audioPath).toBe("C:/audio/photosynthesis.wav");
    // The spread must carry the rest of the lesson through untouched.
    expect(stored.title).toBe("Photosynthesis");
    expect(stored.sections).toHaveLength(1);
  });

  it("persists a podcast script and keeps type/podcastScript consistent", async () => {
    await upsertLesson(lesson("c3", { type: "podcast" }));

    const script: PodcastLine[] = [
      { speaker: "Host A", text: "Welcome in." },
      { speaker: "Host B", text: "Glad to be here." },
    ];

    const { result } = renderHook(() => useLessonPersistence());
    const current = (await getLesson("c3"))!;

    await act(async () => {
      await result.current.updatePodcastScript(current, script);
    });

    const stored = (await getLesson("c3"))!;
    expect(stored.podcastScript).toEqual(script);
    expect(stored.type).toBe("podcast");
  });

  it("overwrites a previously saved audioPath rather than appending", async () => {
    await upsertLesson(lesson("d4", { audioPath: "old.wav" }));

    const { result } = renderHook(() => useLessonPersistence());
    const current = (await getLesson("d4"))!;

    await act(async () => {
      await result.current.updateAudioPath(current, "new.wav");
    });

    const stored = (await getLesson("d4"))!;
    expect(stored.audioPath).toBe("new.wav");
  });

  it("returns a stable object so consumers are not re-rendered every pass", () => {
    const { result, rerender } = renderHook(() => useLessonPersistence());
    const first = result.current;

    rerender();
    expect(result.current).toBe(first);
    expect(result.current.load).toBe(first.load);
  });
});
