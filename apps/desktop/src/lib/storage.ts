// Versioned, observable browser storage.
//
// Two problems this solves, both of which were real:
//
// 1. **Silent data loss.** Every write site was `try { localStorage.setItem(…) }
//    catch {}` — so when the quota was hit, the lesson appeared to save and did
//    not. The user found out later, if ever. Failures are now reported through
//    `onStorageFailure` and can be surfaced in the UI.
//
// 2. **No schema version.** Payloads were bare JSON, so any shape change would
//    have been indistinguishable from corruption. Everything written here is
//    wrapped as `{ v: SCHEMA_VERSION, data }`, and readers declare how to migrate
//    older versions. A payload with no wrapper is treated as version 0 — which is
//    exactly what the pre-existing data is, so existing installs migrate on read
//    instead of losing their library.
//
// This module is deliberately synchronous and localStorage-backed. It is the
// *right* layer for small preferences. For the lesson library — which is the
// thing that actually outgrows the ~5 MB quota — see `libraryStore.ts`, which is
// IndexedDB-backed and falls back to this.

/** Bump when any payload's shape changes, and add a migration for it. */
export const SCHEMA_VERSION = 1;

/** A wrapped payload. `v` is absent on data written before versioning existed. */
interface Envelope<T> {
  v: number;
  data: T;
}

export type StorageFailureReason = "quota" | "unavailable" | "corrupt" | "unknown";

export interface StorageFailure {
  key: string;
  reason: StorageFailureReason;
  /** Human-readable, safe to show in the UI. */
  message: string;
  /** The underlying error message, for logs. */
  detail?: string;
}

type FailureListener = (failure: StorageFailure) => void;

const listeners = new Set<FailureListener>();

/**
 * Subscribe to storage failures. Returns an unsubscribe function.
 *
 * The point is that a failure cannot be lost: a caller that ignores the boolean
 * returned by `writeVersioned` still triggers this.
 */
export function onStorageFailure(listener: FailureListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam — clears subscribers so suites do not leak into each other. */
export function resetStorageFailureListeners(): void {
  listeners.clear();
}

function report(failure: StorageFailure): void {
  for (const listener of listeners) {
    try {
      listener(failure);
    } catch {
      // A broken listener must not break the storage path.
    }
  }
}

/**
 * Report a failure from another storage layer (e.g. the IndexedDB-backed
 * library store) through the same channel, so the UI has one place to listen.
 */
export function reportStorageFailure(failure: StorageFailure): void {
  report(failure);
}

/** Classify a write error. Quota is the one users actually hit. */
function classifyWriteError(e: unknown): { reason: StorageFailureReason; message: string } {
  const name = e instanceof Error ? e.name : "";
  const detail = e instanceof Error ? e.message : String(e);

  if (name === "QuotaExceededError" || /quota/i.test(detail)) {
    return {
      reason: "quota",
      message:
        "Your device storage is full, so this change was NOT saved. Delete a lesson you no longer need, then try again.",
    };
  }
  if (/security|denied|disabled/i.test(detail)) {
    return {
      reason: "unavailable",
      message: "Browser storage is unavailable, so this change was NOT saved.",
    };
  }
  return {
    reason: "unknown",
    message: "This change could NOT be saved.",
  };
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Read a versioned payload.
 *
 * @param key       Storage key.
 * @param migrate   Given the raw parsed value and the version it was written at,
 *                  return the current shape — or `null` if it is unusable.
 * @param fallback  Returned when the key is missing, unreadable, or unusable.
 */
export function readVersioned<T>(
  key: string,
  migrate: (raw: unknown, fromVersion: number) => T | null,
  fallback: T
): T {
  const store = storage();
  if (!store) return fallback;

  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch (e) {
    report({
      key,
      reason: "unavailable",
      message: "Could not read saved data.",
      detail: e instanceof Error ? e.message : String(e),
    });
    return fallback;
  }

  if (raw === null || raw === "") return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // Corrupt rather than absent — say so, do not pretend the user has no data.
    report({
      key,
      reason: "corrupt",
      message: "Saved data was unreadable and has been ignored. New changes will save normally.",
      detail: e instanceof Error ? e.message : String(e),
    });
    return fallback;
  }

  const isEnvelope =
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    typeof (parsed as Envelope<T>).v === "number" &&
    "data" in (parsed as Envelope<T>);

  const fromVersion = isEnvelope ? (parsed as Envelope<T>).v : 0;
  const payload = isEnvelope ? (parsed as Envelope<T>).data : parsed;

  // Newer than this build understands: do not guess, and do not overwrite it.
  if (fromVersion > SCHEMA_VERSION) {
    report({
      key,
      reason: "corrupt",
      message:
        "Saved data was written by a newer version of Study Studio. Update the app to read it.",
      detail: `found v${fromVersion}, this build understands v${SCHEMA_VERSION}`,
    });
    return fallback;
  }

  try {
    return migrate(payload, fromVersion) ?? fallback;
  } catch (e) {
    report({
      key,
      reason: "corrupt",
      message: "Saved data could not be upgraded and has been ignored.",
      detail: e instanceof Error ? e.message : String(e),
    });
    return fallback;
  }
}

/**
 * Write a versioned payload. Returns false when the write failed — and reports
 * the failure either way, so ignoring the return value is still not silent.
 */
export function writeVersioned<T>(key: string, data: T): boolean {
  const store = storage();
  if (!store) {
    report({ key, reason: "unavailable", message: "Browser storage is unavailable." });
    return false;
  }

  const envelope: Envelope<T> = { v: SCHEMA_VERSION, data };
  try {
    store.setItem(key, JSON.stringify(envelope));
    return true;
  } catch (e) {
    const { reason, message } = classifyWriteError(e);
    report({
      key,
      reason,
      message,
      detail: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

/** Remove a key. Never throws. */
export function removeKey(key: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // Removal failing is not worth interrupting the user for.
  }
}

/**
 * Rough estimate of how much of the localStorage quota is used, 0–1.
 *
 * Deliberately approximate: browsers do not expose the quota, so this measures
 * the payload we can see. It exists to warn *before* a write fails, not to be
 * exact. Returns null when it cannot be measured.
 */
export function estimateStoragePressure(): number | null {
  const store = storage();
  if (!store) return null;
  try {
    let chars = 0;
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k) continue;
      chars += k.length + (store.getItem(k)?.length ?? 0);
    }
    // localStorage is commonly capped around 5 MB, counted as UTF-16 code units.
    const ASSUMED_QUOTA_BYTES = 5 * 1024 * 1024;
    const usedBytes = chars * 2;
    return Math.min(usedBytes / ASSUMED_QUOTA_BYTES, 1);
  } catch {
    return null;
  }
}
