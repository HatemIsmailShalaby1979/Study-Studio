"use client";

import { useEffect, useState } from "react";
import { onStorageFailure, type StorageFailure } from "@/lib/storage";

/**
 * Surfaces storage failures in the UI.
 *
 * This is the half of the fix that makes the other half matter. Writes used to
 * be `try { … } catch {}`, so when the quota was hit a lesson appeared to save
 * and did not — the user found out later, if ever. Reporting the failure is only
 * useful if someone is listening, and this is the listener.
 *
 * Deliberately not a toast: a failed save is not transient, and it must not
 * disappear on a timer. It stays until dismissed.
 */
export function StorageWarning() {
  const [failure, setFailure] = useState<StorageFailure | null>(null);

  useEffect(() => {
    // Ignore read-only noise on mount; only real write failures are actionable.
    const off = onStorageFailure((f) => {
      setFailure((prev) => prev ?? f);
    });
    return off;
  }, []);

  if (!failure) return null;

  const isQuota = failure.reason === "quota";

  return (
    <div
      role="alert"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-lg w-[calc(100%-2rem)] card !p-3 border border-accent-red/40 shadow-lg"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className="text-lg leading-none mt-0.5">
          ⚠️
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground mb-0.5">
            {isQuota ? "Device storage is full" : "Could not save to device storage"}
          </p>
          <p className="text-[11px] text-muted">{failure.message}</p>
          {isQuota && (
            <p className="text-[11px] text-muted mt-1">
              Deleting a lesson you no longer need in the Library frees the most space.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setFailure(null)}
          className="text-[11px] text-muted hover:text-foreground shrink-0"
          aria-label="Dismiss storage warning"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
