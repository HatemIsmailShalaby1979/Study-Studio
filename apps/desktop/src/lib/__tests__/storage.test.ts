import {
  SCHEMA_VERSION,
  estimateStoragePressure,
  onStorageFailure,
  readVersioned,
  removeKey,
  resetStorageFailureListeners,
  writeVersioned,
  type StorageFailure,
} from "@/lib/storage";

// storage.ts exists because every write site used to be
// `try { setItem } catch {}` — so hitting the quota meant data silently did not
// save. These tests pin both halves: the versioning envelope, and the fact that
// a failure is now observable.

let store: Record<string, string>;
/** Set by a test to make the next setItem throw. */
let failNextWrite: Error | null;

beforeEach(() => {
  store = {};
  failNextWrite = null;
  resetStorageFailureListeners();

  Object.defineProperty(window, "localStorage", {
    writable: true,
    configurable: true,
    value: {
      get length() {
        return Object.keys(store).length;
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        if (failNextWrite) {
          const e = failNextWrite;
          failNextWrite = null;
          throw e;
        }
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

function quotaError(): Error {
  const e = new Error("The quota has been exceeded.");
  e.name = "QuotaExceededError";
  return e;
}

describe("writeVersioned / readVersioned", () => {
  it("wraps the payload with the schema version", () => {
    writeVersioned("k", { a: 1 });
    expect(JSON.parse(store["k"]!)).toEqual({ v: SCHEMA_VERSION, data: { a: 1 } });
  });

  it("round-trips a value", () => {
    writeVersioned("k", [1, 2, 3]);
    expect(readVersioned<number[]>("k", (r) => r as number[], [])).toEqual([1, 2, 3]);
  });

  it("returns the fallback for a missing key", () => {
    expect(readVersioned("absent", () => null, ["fallback"])).toEqual(["fallback"]);
  });

  it("treats a legacy unwrapped payload as version 0 and migrates it", () => {
    // This is exactly what pre-existing installs have on disk.
    store["k"] = JSON.stringify([{ id: "old" }]);

    const seen: number[] = [];
    const result = readVersioned<{ id: string }[]>(
      "k",
      (raw, fromVersion) => {
        seen.push(fromVersion);
        return raw as { id: string }[];
      },
      []
    );

    expect(seen).toEqual([0]);
    expect(result).toEqual([{ id: "old" }]);
  });

  it("passes the current version through for an already-versioned payload", () => {
    writeVersioned("k", "value");
    const seen: number[] = [];
    readVersioned<string>(
      "k",
      (raw, fromVersion) => {
        seen.push(fromVersion);
        return raw as string;
      },
      ""
    );
    expect(seen).toEqual([SCHEMA_VERSION]);
  });

  it("uses the fallback when the migration declines the payload", () => {
    store["k"] = JSON.stringify({ v: 0, data: "junk" });
    expect(readVersioned<string>("k", () => null, "fallback")).toBe("fallback");
  });
});

describe("corruption is reported, not swallowed", () => {
  it("reports unparseable JSON and falls back", () => {
    const failures: StorageFailure[] = [];
    onStorageFailure((f) => failures.push(f));
    store["k"] = "{not json";

    expect(readVersioned("k", () => null, ["safe"])).toEqual(["safe"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.reason).toBe("corrupt");
    expect(failures[0]!.key).toBe("k");
  });

  it("reports a migration that throws", () => {
    const failures: StorageFailure[] = [];
    onStorageFailure((f) => failures.push(f));
    store["k"] = JSON.stringify({ v: 0, data: 1 });

    const result = readVersioned<number>(
      "k",
      () => {
        throw new Error("bad migration");
      },
      -1
    );

    expect(result).toBe(-1);
    expect(failures[0]!.reason).toBe("corrupt");
  });

  it("refuses a payload written by a newer build rather than guessing", () => {
    const failures: StorageFailure[] = [];
    onStorageFailure((f) => failures.push(f));
    store["k"] = JSON.stringify({ v: SCHEMA_VERSION + 5, data: "from the future" });

    expect(readVersioned<string>("k", (r) => r as string, "fallback")).toBe("fallback");
    expect(failures[0]!.message).toMatch(/newer version/i);
  });
});

describe("quota failures are visible", () => {
  it("returns false and reports a quota error instead of throwing", () => {
    const failures: StorageFailure[] = [];
    onStorageFailure((f) => failures.push(f));
    failNextWrite = quotaError();

    expect(writeVersioned("k", "x")).toBe(false);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.reason).toBe("quota");
    // The message must tell the user the change did NOT save — the old code's
    // whole problem was that it looked like it had.
    expect(failures[0]!.message).toMatch(/NOT saved/i);
  });

  it("returns true and reports nothing on success", () => {
    const failures: StorageFailure[] = [];
    onStorageFailure((f) => failures.push(f));
    expect(writeVersioned("k", "x")).toBe(true);
    expect(failures).toEqual([]);
  });

  it("reports an unavailable-storage failure", () => {
    const failures: StorageFailure[] = [];
    onStorageFailure((f) => failures.push(f));
    failNextWrite = new Error("SecurityError: storage is disabled");

    expect(writeVersioned("k", "x")).toBe(false);
    expect(failures[0]!.reason).toBe("unavailable");
  });

  it("stops notifying after unsubscribe", () => {
    const failures: StorageFailure[] = [];
    const off = onStorageFailure((f) => failures.push(f));
    off();
    failNextWrite = quotaError();
    writeVersioned("k", "x");
    expect(failures).toEqual([]);
  });

  it("survives a listener that throws", () => {
    onStorageFailure(() => {
      throw new Error("bad listener");
    });
    failNextWrite = quotaError();
    // The failing listener must not break the write path.
    expect(() => writeVersioned("k", "x")).not.toThrow();
  });
});

describe("removeKey", () => {
  it("removes a key", () => {
    writeVersioned("k", 1);
    removeKey("k");
    expect(store["k"]).toBeUndefined();
  });

  it("never throws for a missing key", () => {
    expect(() => removeKey("absent")).not.toThrow();
  });
});

describe("estimateStoragePressure", () => {
  it("returns a fraction between 0 and 1", () => {
    const value = estimateStoragePressure();
    expect(value).not.toBeNull();
    expect(value!).toBeGreaterThanOrEqual(0);
    expect(value!).toBeLessThanOrEqual(1);
  });

  it("grows as data is added", () => {
    const before = estimateStoragePressure()!;
    writeVersioned("big", "x".repeat(100_000));
    expect(estimateStoragePressure()!).toBeGreaterThan(before);
  });
});
