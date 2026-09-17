import "fake-indexeddb/auto";
import {
  deleteLesson,
  getLesson,
  loadLibrary,
  resetLibraryStoreForTests,
  saveLibrary,
  upsertLesson,
} from "@/lib/libraryStore";
import { onStorageFailure, resetStorageFailureListeners, type StorageFailure } from "@/lib/storage";
import type { Lesson } from "@/types";

// The library is the app's actual user data, and it just moved storage engines.
// fake-indexeddb means these tests exercise the real IndexedDB path rather than
// only the localStorage fallback — testing the fallback alone would leave the
// primary path unverified, which is the mistake this audit kept finding.

let store: Record<string, string>;
/** Failures reported through the shared channel during a test. */
let failures: StorageFailure[];

beforeEach(async () => {
  resetStorageFailureListeners();
  failures = [];
  onStorageFailure((f) => failures.push(f));
  await resetLibraryStoreForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("study-studio");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });

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
  return { id, title: `Lesson ${id}`, ...over } as Lesson;
}

describe("loadLibrary / saveLibrary", () => {
  it("returns an empty library on a fresh install", async () => {
    expect(await loadLibrary()).toEqual([]);
  });

  it("round-trips a library", async () => {
    expect(await saveLibrary([lesson("a"), lesson("b")])).toBe(true);
    expect((await loadLibrary()).map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("preserves the order it was given", async () => {
    await saveLibrary([lesson("z"), lesson("a"), lesson("m")]);
    expect((await loadLibrary()).map((l) => l.id)).toEqual(["z", "a", "m"]);
  });

  it("replaces rather than appends", async () => {
    await saveLibrary([lesson("a"), lesson("b")]);
    await saveLibrary([lesson("c")]);
    expect((await loadLibrary()).map((l) => l.id)).toEqual(["c"]);
  });

  it("handles an empty library", async () => {
    await saveLibrary([lesson("a")]);
    await saveLibrary([]);
    expect(await loadLibrary()).toEqual([]);
  });
});

describe("upsertLesson", () => {
  it("inserts a new lesson at the front", async () => {
    await upsertLesson(lesson("first"));
    await upsertLesson(lesson("second"));
    expect((await loadLibrary()).map((l) => l.id)).toEqual(["second", "first"]);
  });

  it("updates in place without duplicating", async () => {
    await upsertLesson(lesson("a", { title: "Original" }));
    await upsertLesson(lesson("b"));
    await upsertLesson(lesson("a", { title: "Updated" }));

    const library = await loadLibrary();
    expect(library).toHaveLength(2);
    // Moved to the front, and updated.
    expect(library.map((l) => l.id)).toEqual(["a", "b"]);
    expect(library.find((l) => l.id === "a")?.title).toBe("Updated");
  });

  it("preserves a rich lesson payload intact", async () => {
    const rich = lesson("rich", {
      sections: [{ heading: "H", content: "C" }],
      glossary: [{ term: "T", definition: "D" }],
      quiz: [{ question: "Q", options: ["a", "b", "c", "d"], correctIndex: 0, explanation: "E" }],
    } as Partial<Lesson>);
    await upsertLesson(rich);
    expect(await getLesson("rich")).toEqual(rich);
  });
});

describe("deleteLesson / getLesson", () => {
  it("deletes one lesson and leaves the rest", async () => {
    await saveLibrary([lesson("a"), lesson("b"), lesson("c")]);
    expect(await deleteLesson("b")).toBe(true);
    expect((await loadLibrary()).map((l) => l.id)).toEqual(["a", "c"]);
  });

  it("is a no-op for an unknown id", async () => {
    await saveLibrary([lesson("a")]);
    expect(await deleteLesson("nope")).toBe(true);
    expect((await loadLibrary()).map((l) => l.id)).toEqual(["a"]);
  });

  it("gets a single lesson by id", async () => {
    await saveLibrary([lesson("a"), lesson("b")]);
    expect((await getLesson("b"))?.id).toBe("b");
    expect(await getLesson("missing")).toBeNull();
  });
});

describe("legacy localStorage migration", () => {
  it("imports a pre-existing unversioned library on first load", async () => {
    // Exactly the shape an existing install has: a bare JSON array.
    store["study-studio-library"] = JSON.stringify([lesson("old-1"), lesson("old-2")]);

    expect((await loadLibrary()).map((l) => l.id)).toEqual(["old-1", "old-2"]);
  });

  it("does not resurrect a library the user has since emptied", async () => {
    store["study-studio-library"] = JSON.stringify([lesson("old-1")]);
    await loadLibrary(); // performs the import and writes the marker

    await saveLibrary([]); // user clears their library
    await resetLibraryStoreForTests();

    // The naive "import if the target is empty" migration would bring old-1 back.
    expect(await loadLibrary()).toEqual([]);
  });

  it("ignores a corrupt legacy payload", async () => {
    store["study-studio-library"] = "{not json";
    expect(await loadLibrary()).toEqual([]);
  });

  it("drops legacy entries that are not lessons", async () => {
    store["study-studio-library"] = JSON.stringify([lesson("good"), { junk: true }, null]);
    expect((await loadLibrary()).map((l) => l.id)).toEqual(["good"]);
  });
});

describe("localStorage fallback when IndexedDB is unavailable", () => {
  it("still saves and loads", async () => {
    const realIndexedDB = globalThis.indexedDB;
    // Simulate a webview with IndexedDB disabled (private mode, policy).
    Object.defineProperty(globalThis, "indexedDB", {
      writable: true,
      configurable: true,
      value: undefined,
    });
    await resetLibraryStoreForTests();

    try {
      expect(await saveLibrary([lesson("fallback-1")])).toBe(true);
      expect((await loadLibrary()).map((l) => l.id)).toEqual(["fallback-1"]);
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        writable: true,
        configurable: true,
        value: realIndexedDB,
      });
      await resetLibraryStoreForTests();
    }
  });
});
