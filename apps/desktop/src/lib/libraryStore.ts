// The lesson library: IndexedDB-backed, with a versioned localStorage fallback.
//
// Why this exists rather than raw localStorage calls scattered across pages:
//
// 1. **Capacity.** The library holds every generated lesson — full section text,
//    quizzes, glossaries, podcast scripts — tens of KB each. localStorage is
//    capped around 5 MB, so a few dozen lessons used to hit QuotaExceededError
//    and the write was swallowed. IndexedDB has no practical cap.
//
// 2. **One place to change.** Six files used to read and write
//    `study-studio-library` directly. Every one of them now calls this module, so
//    the storage engine is an implementation detail.
//
// 3. **Migration.** Existing installs have a bare JSON array under the old key.
//    `loadLibrary` imports it on first use and marks it done, so nobody loses
//    their library to the upgrade.
//
// The API is async even for the localStorage path, so swapping the engine never
// changes a call site.

import type { Lesson } from "@/types";
import {
  SCHEMA_VERSION,
  onStorageFailure,
  readVersioned,
  reportStorageFailure,
  writeVersioned,
} from "./storage";

const DB_NAME = "study-studio";
const DB_VERSION = 1;
const LESSON_STORE = "lessons";
/** Key holding the order lessons should be listed in (newest first). */
const ORDER_STORE = "meta";
const ORDER_KEY = "library-order";

const LEGACY_KEY = "study-studio-library";
const FALLBACK_KEY = "study-studio-library-v1";
const MIGRATED_KEY = "study-studio-library-migrated";

export { onStorageFailure };

// ─── IndexedDB plumbing ─────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(LESSON_STORE)) {
          db.createObjectStore(LESSON_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(ORDER_STORE)) {
          db.createObjectStore(ORDER_STORE);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      // Private mode, disabled storage, or a hostile environment.
      resolve(null);
    }
  });

  return dbPromise;
}

function tx<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = run(transaction.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

// ─── localStorage fallback ──────────────────────────────────────────────────

/** Treat anything that looks like a lesson as one; drop the rest. */
function isLesson(value: unknown): value is Lesson {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Lesson).id === "string" &&
    typeof (value as Lesson).title === "string"
  );
}

function coerceLibrary(raw: unknown): Lesson[] | null {
  if (!Array.isArray(raw)) return null;
  const lessons = raw.filter(isLesson);
  // An array of junk is corruption; an empty array is a legitimately empty library.
  if (raw.length > 0 && lessons.length === 0) return null;
  return lessons;
}

/** v0 was a bare array with no wrapper; v1 is the same array, versioned. */
function migrateLibrary(raw: unknown): Lesson[] | null {
  return coerceLibrary(raw);
}

function readFallback(): Lesson[] {
  return readVersioned<Lesson[]>(FALLBACK_KEY, migrateLibrary, []);
}

function writeFallback(lessons: Lesson[]): boolean {
  return writeVersioned(FALLBACK_KEY, lessons);
}

/** Report an IndexedDB write failure through the shared channel. */
function reportWriteFailure(error: unknown): void {
  reportStorageFailure({
    key: DB_NAME,
    reason: "unknown",
    message:
      "Your lesson could NOT be saved to device storage. It is still open — try again, and if this persists, free some space.",
    detail: error instanceof Error ? error.message : String(error),
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Load the library, newest first.
 *
 * On first call after an upgrade this imports the pre-existing
 * `study-studio-library` array, so existing users keep their lessons.
 */
export async function loadLibrary(): Promise<Lesson[]> {
  const db = await openDb();
  if (!db) return readFallback();

  try {
    await migrateLegacyOnce(db);

    const lessons = await tx<Lesson[]>(db, LESSON_STORE, "readonly", (s) => s.getAll());
    const order = await tx<string[]>(db, ORDER_STORE, "readonly", (s) =>
      s.get(ORDER_KEY) as IDBRequest<string[]>
    );

    const byId = new Map(lessons.map((l) => [l.id, l]));
    // Honour the stored order, then append anything the order does not know about
    // rather than dropping it — an orphaned lesson is still the user's work.
    const ordered: Lesson[] = [];
    for (const id of order ?? []) {
      const lesson = byId.get(id);
      if (lesson) {
        ordered.push(lesson);
        byId.delete(id);
      }
    }
    return [...ordered, ...byId.values()];
  } catch (e) {
    // A read failure is not a silent engine switch. Reading the localStorage
    // fallback here would show a stale, possibly empty library and look like
    // data loss, so the failure is reported and the caller gets nothing.
    reportWriteFailure(e);
    return [];
  }
}

/**
 * Replace the whole library. Returns false when the write failed.
 *
 * One engine, chosen by availability. It is tempting to fall back to
 * localStorage when an IndexedDB write fails — that is a trap: the read path
 * prefers IndexedDB, so data written to the fallback is invisible, and the write
 * still reports success. A failure is reported instead.
 */
export async function saveLibrary(lessons: Lesson[]): Promise<boolean> {
  const db = await openDb();
  if (!db) return writeFallback(lessons);

  try {
    await tx(db, LESSON_STORE, "readwrite", (s) => s.clear() as IDBRequest<undefined>);
    for (const lesson of lessons) {
      await tx(db, LESSON_STORE, "readwrite", (s) => s.put(lesson));
    }
    await tx(db, ORDER_STORE, "readwrite", (s) =>
      s.put(
        lessons.map((l) => l.id),
        ORDER_KEY
      ) as IDBRequest<IDBValidKey>
    );
    return true;
  } catch (e) {
    reportWriteFailure(e);
    return false;
  }
}

/** Insert or update one lesson, keeping it at the front. */
export async function upsertLesson(lesson: Lesson): Promise<boolean> {
  const db = await openDb();
  if (!db) {
    const existing = readFallback();
    const next = [lesson, ...existing.filter((l) => l.id !== lesson.id)];
    return writeFallback(next);
  }

  try {
    await tx(db, LESSON_STORE, "readwrite", (s) => s.put(lesson));
    const order =
      (await tx<string[]>(db, ORDER_STORE, "readonly", (s) =>
        s.get(ORDER_KEY) as IDBRequest<string[]>
      )) ?? [];
    const next = [lesson.id, ...order.filter((id) => id !== lesson.id)];
    await tx(db, ORDER_STORE, "readwrite", (s) =>
      s.put(next, ORDER_KEY) as IDBRequest<IDBValidKey>
    );
    return true;
  } catch (e) {
    reportWriteFailure(e);
    return false;
  }
}

/** Remove one lesson. Returns false when the write failed. */
export async function deleteLesson(id: string): Promise<boolean> {
  const db = await openDb();
  if (!db) {
    return writeFallback(readFallback().filter((l) => l.id !== id));
  }

  try {
    await tx(db, LESSON_STORE, "readwrite", (s) => s.delete(id));
    const order =
      (await tx<string[]>(db, ORDER_STORE, "readonly", (s) =>
        s.get(ORDER_KEY) as IDBRequest<string[]>
      )) ?? [];
    await tx(db, ORDER_STORE, "readwrite", (s) =>
      s.put(
        order.filter((x) => x !== id),
        ORDER_KEY
      ) as IDBRequest<IDBValidKey>
    );
    return true;
  } catch (e) {
    reportWriteFailure(e);
    return false;
  }
}

/** Read a single lesson without loading the whole library. */
export async function getLesson(id: string): Promise<Lesson | null> {
  const db = await openDb();
  if (!db) return readFallback().find((l) => l.id === id) ?? null;
  try {
    const lesson = await tx<Lesson | undefined>(db, LESSON_STORE, "readonly", (s) => s.get(id));
    return lesson ?? null;
  } catch {
    return null;
  }
}

// ─── One-time legacy import ─────────────────────────────────────────────────

/**
 * Import the pre-IndexedDB library exactly once.
 *
 * Guarded by a marker key so a user who deliberately empties their library does
 * not have the old contents resurrected on the next launch — the classic bug in
 * a naive "import if the target is empty" migration.
 */
async function migrateLegacyOnce(db: IDBDatabase): Promise<void> {
  if (typeof localStorage === "undefined") return;
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return;
  } catch {
    return;
  }

  const legacy = readVersioned<Lesson[]>(LEGACY_KEY, migrateLibrary, []);
  if (legacy.length > 0) {
    for (const lesson of legacy) {
      await tx(db, LESSON_STORE, "readwrite", (s) => s.put(lesson));
    }
    await tx(db, ORDER_STORE, "readwrite", (s) =>
      s.put(
        legacy.map((l) => l.id),
        ORDER_KEY
      ) as IDBRequest<IDBValidKey>
    );
  }

  try {
    localStorage.setItem(MIGRATED_KEY, String(SCHEMA_VERSION));
  } catch {
    // If the marker cannot be written we may re-import once more; harmless,
    // because `put` is idempotent by id.
  }
}

/**
 * Test seam: close the cached connection and forget it.
 *
 * Closing matters — an open connection blocks `indexedDB.deleteDatabase`, so a
 * suite that only clears the module cache hangs on its next `beforeEach` and
 * also keeps Jest's event loop alive after the run.
 */
export async function resetLibraryStoreForTests(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  if (!pending) return;
  try {
    const db = await pending;
    db?.close();
  } catch {
    // Nothing to close.
  }
}
