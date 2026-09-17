import type { AIProvider } from "@/lib/ai-runtime/types";
import type { AIRuntime } from "@/lib/ai-runtime/runtime";

// Characterisation tests for the provider config store — the settings layer.
//
// Two things make this worth testing properly:
//
//  1. It is the only thing standing between a user's API key and it vanishing on
//     restart, and it is written to be defensive (never throws, degrades to
//     memory). "Defensive" code is exactly the code whose failure modes nobody
//     notices, so every degradation path is pinned here.
//  2. `cache` is initialised at MODULE LOAD by reading localStorage. A test that
//     just imports the module would share one cache across the whole file and
//     would be unable to test the read path at all, so every test builds a fresh
//     module instance against a storage state it controls.

const STORAGE_KEY = "study-studio-provider-config";

type Store = typeof import("@/lib/ai-runtime/providerStore");

/** A working localStorage, since jest.setup.tsx installs bare jest.fn()s. */
function installStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  const storage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    writable: true,
    configurable: true,
    value: storage,
  });
  return { map, storage };
}

/** Import the store fresh, so its module-level cache is re-read from storage. */
function freshStore(): Store {
  let mod: Store | undefined;
  jest.isolateModules(() => {
    mod = require("@/lib/ai-runtime/providerStore") as Store;
  });
  return mod!;
}

/** A provider stub exposing the optional mutators the store looks for. */
function provider(id: string, opts: { mutators?: boolean } = {}) {
  const withMutators = opts.mutators ?? true;
  return {
    descriptor: { id, name: id, description: "", transport: "http" },
    ...(withMutators
      ? { setApiKey: jest.fn(), setBaseUrl: jest.fn() }
      : {}),
  } as unknown as AIProvider & { setApiKey?: jest.Mock; setBaseUrl?: jest.Mock };
}

beforeEach(() => {
  jest.resetModules();
  installStorage();
});

describe("providerStore — reading", () => {
  it("starts empty when nothing is stored", () => {
    expect(freshStore().getProviderConfig("openai")).toEqual({});
  });

  it("reads a config that was already on disk", () => {
    installStorage({
      [STORAGE_KEY]: JSON.stringify({ openai: { apiKey: "sk-existing", baseUrl: "http://x" } }),
    });

    const store = freshStore();

    expect(store.getProviderConfig("openai")).toEqual({
      apiKey: "sk-existing",
      baseUrl: "http://x",
    });
    expect(store.hasApiKey("openai")).toBe(true);
  });

  it("returns a copy, so callers cannot mutate the cache", () => {
    installStorage({ [STORAGE_KEY]: JSON.stringify({ openai: { apiKey: "sk" } }) });
    const store = freshStore();

    const cfg = store.getProviderConfig("openai");
    cfg.apiKey = "tampered";

    expect(store.getProviderConfig("openai").apiKey).toBe("sk");
  });

  it("copies every entry from getAllProviderConfigs", () => {
    installStorage({
      [STORAGE_KEY]: JSON.stringify({ a: { apiKey: "1" }, b: { baseUrl: "http://b" } }),
    });
    const store = freshStore();

    const all = store.getAllProviderConfigs();
    expect(Object.keys(all).sort()).toEqual(["a", "b"]);

    all.a!.apiKey = "tampered";
    expect(store.getProviderConfig("a").apiKey).toBe("1");
  });

  it("treats an empty key as absent", () => {
    installStorage({ [STORAGE_KEY]: JSON.stringify({ openai: { apiKey: "" } }) });
    expect(freshStore().hasApiKey("openai")).toBe(false);
  });

  it("survives corrupt JSON on disk", () => {
    installStorage({ [STORAGE_KEY]: "{not json" });

    const store = freshStore();

    expect(store.getProviderConfig("openai")).toEqual({});
    expect(store.getAllProviderConfigs()).toEqual({});
  });

  it("ignores a stored value that is not an object", () => {
    installStorage({ [STORAGE_KEY]: '"just a string"' });
    expect(freshStore().getAllProviderConfigs()).toEqual({});
  });

  it("ignores a stored null", () => {
    installStorage({ [STORAGE_KEY]: "null" });
    expect(freshStore().getAllProviderConfigs()).toEqual({});
  });
});

describe("providerStore — writing", () => {
  it("writes a key through to storage", () => {
    const store = freshStore();
    const { map } = installStorage();

    store.setProviderConfig("openai", { apiKey: "sk-new" });

    expect(JSON.parse(map.get(STORAGE_KEY)!)).toEqual({ openai: { apiKey: "sk-new" } });
  });

  it("trims surrounding whitespace", () => {
    const store = freshStore();
    store.setProviderConfig("openai", { apiKey: "  sk-padded  ", baseUrl: "  http://x  " });

    expect(store.getProviderConfig("openai")).toEqual({
      apiKey: "sk-padded",
      baseUrl: "http://x",
    });
  });

  it("clears a field when passed an empty string", () => {
    const store = freshStore();
    store.setProviderConfig("openai", { apiKey: "sk", baseUrl: "http://x" });
    store.setProviderConfig("openai", { apiKey: "" });

    expect(store.getProviderConfig("openai")).toEqual({ apiKey: undefined, baseUrl: "http://x" });
    expect(store.hasApiKey("openai")).toBe(false);
  });

  it("leaves untouched fields alone when only one is updated", () => {
    const store = freshStore();
    store.setProviderConfig("openai", { apiKey: "sk", baseUrl: "http://x" });
    store.setProviderConfig("openai", { baseUrl: "http://y" });

    expect(store.getProviderConfig("openai")).toEqual({ apiKey: "sk", baseUrl: "http://y" });
  });

  it("does not treat undefined as a clear", () => {
    // The contract is "only defined fields are written", so an omitted field
    // must be a no-op rather than a wipe.
    const store = freshStore();
    store.setProviderConfig("openai", { apiKey: "sk" });
    store.setProviderConfig("openai", {});

    expect(store.getProviderConfig("openai").apiKey).toBe("sk");
  });

  it("keeps providers independent", () => {
    const store = freshStore();
    store.setProviderConfig("a", { apiKey: "key-a" });
    store.setProviderConfig("b", { apiKey: "key-b" });

    expect(store.getProviderConfig("a").apiKey).toBe("key-a");
    expect(store.getProviderConfig("b").apiKey).toBe("key-b");
  });

  it("ignores an empty provider id", () => {
    const store = freshStore();
    const { map } = installStorage();

    store.setProviderConfig("", { apiKey: "sk" });

    expect(store.getAllProviderConfigs()).toEqual({});
    expect(map.has(STORAGE_KEY)).toBe(false);
  });

  it("removes a provider's config entirely", () => {
    const store = freshStore();
    store.setProviderConfig("a", { apiKey: "1" });
    store.setProviderConfig("b", { apiKey: "2" });

    store.clearProviderConfig("a");

    expect(store.getProviderConfig("a")).toEqual({});
    expect(store.getProviderConfig("b").apiKey).toBe("2");
  });

  it("ignores an empty id when clearing", () => {
    const store = freshStore();
    store.setProviderConfig("a", { apiKey: "1" });

    store.clearProviderConfig("");

    expect(store.getProviderConfig("a").apiKey).toBe("1");
  });

  it("keeps state in memory when storage rejects the write", () => {
    // Quota exceeded / private mode. The session must still be coherent.
    installStorage();
    Object.defineProperty(globalThis.localStorage, "setItem", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("QuotaExceededError");
      },
    });
    const store = freshStore();

    expect(() => store.setProviderConfig("openai", { apiKey: "sk" })).not.toThrow();
    expect(store.getProviderConfig("openai").apiKey).toBe("sk");
  });
});

describe("providerStore — applying config to providers", () => {
  it("applies the key and base URL to the matching provider", () => {
    const store = freshStore();
    store.setProviderConfig("openai", { apiKey: "sk", baseUrl: "http://custom" });

    const p = provider("openai");
    store.applyConfig(p);

    expect(p.setApiKey).toHaveBeenCalledWith("sk");
    expect(p.setBaseUrl).toHaveBeenCalledWith("http://custom");
  });

  it("does nothing for a provider with no stored config", () => {
    const store = freshStore();
    const p = provider("openai");

    store.applyConfig(p);

    expect(p.setApiKey).not.toHaveBeenCalled();
    expect(p.setBaseUrl).not.toHaveBeenCalled();
  });

  it("only applies fields that are set", () => {
    const store = freshStore();
    store.setProviderConfig("openai", { apiKey: "sk" });

    const p = provider("openai");
    store.applyConfig(p);

    expect(p.setApiKey).toHaveBeenCalledWith("sk");
    expect(p.setBaseUrl).not.toHaveBeenCalled();
  });

  it("is a no-op for a provider without mutators", () => {
    // Ollama needs no key and takes no base-URL override.
    const store = freshStore();
    store.setProviderConfig("ollama", { apiKey: "ignored", baseUrl: "http://ignored" });

    const p = provider("ollama", { mutators: false });
    expect(() => store.applyConfig(p)).not.toThrow();
  });

  it("does not block startup when a mutator throws", () => {
    const store = freshStore();
    store.setProviderConfig("openai", { apiKey: "sk" });

    const p = provider("openai");
    (p.setApiKey as jest.Mock).mockImplementation(() => {
      throw new Error("provider exploded");
    });

    expect(() => store.applyConfig(p)).not.toThrow();
  });

  it("applies every stored config across a runtime", () => {
    const store = freshStore();
    store.setProviderConfig("a", { apiKey: "key-a" });
    store.setProviderConfig("b", { baseUrl: "http://b" });

    const a = provider("a");
    const b = provider("b");
    const runtime = { providers: { all: () => [a, b] } } as unknown as AIRuntime;

    store.applyStoredConfigs(runtime);

    expect(a.setApiKey).toHaveBeenCalledWith("key-a");
    expect(b.setBaseUrl).toHaveBeenCalledWith("http://b");
  });

  it("does not let one failing provider stop the others", () => {
    const store = freshStore();
    store.setProviderConfig("a", { apiKey: "key-a" });
    store.setProviderConfig("b", { apiKey: "key-b" });

    const a = provider("a");
    (a.setApiKey as jest.Mock).mockImplementation(() => {
      throw new Error("a exploded");
    });
    const b = provider("b");
    const runtime = { providers: { all: () => [a, b] } } as unknown as AIRuntime;

    store.applyStoredConfigs(runtime);

    expect(b.setApiKey).toHaveBeenCalledWith("key-b");
  });
});

describe("providerStore — no storage available", () => {
  it("degrades to in-memory state when localStorage is missing", () => {
    // SSR and some privacy modes have no localStorage at all.
    Object.defineProperty(globalThis, "localStorage", {
      writable: true,
      configurable: true,
      value: undefined,
    });

    const store = freshStore();

    expect(() => store.setProviderConfig("openai", { apiKey: "sk" })).not.toThrow();
    expect(store.getProviderConfig("openai").apiKey).toBe("sk");
  });

  it("starts empty when localStorage is missing", () => {
    Object.defineProperty(globalThis, "localStorage", {
      writable: true,
      configurable: true,
      value: undefined,
    });

    expect(freshStore().getAllProviderConfigs()).toEqual({});
  });

  it("survives a localStorage that throws on read", () => {
    installStorage();
    Object.defineProperty(globalThis.localStorage, "getItem", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("SecurityError");
      },
    });

    expect(freshStore().getAllProviderConfigs()).toEqual({});
  });
});
