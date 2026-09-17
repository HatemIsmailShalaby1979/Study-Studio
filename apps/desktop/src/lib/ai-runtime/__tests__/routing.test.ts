import {
  computeCanGenerate,
  deriveMode,
  isLocalUp,
  isOnlineUp,
  isOnlineUsable,
  needsApiKey,
  type RoutingDeps,
} from "@/lib/ai-runtime/routing";
import { noCapabilities } from "@/lib/ai-runtime/capabilities";
import type { AIProviderStatus } from "@/lib/ai-runtime/types";

// This suite exists because these decisions had 0% branch coverage and carried a
// dead branch (`ttsAvailable ? "offline" : "offline"`). They gate the Generate
// button, the mode badge, and the "add an API key" prompt, so a wrong answer is
// user-visible. See AUDIT.md P1-2 / P2 plan item 2.1.

const LOCAL = "local-a";
const ONLINE = "online-a";

/** Deps with no I/O — the whole point of the extraction. */
function deps(hasKey: boolean): RoutingDeps {
  return { hasKey: () => hasKey, localIds: [LOCAL], onlineIds: [ONLINE] };
}

function status(providerId: string): AIProviderStatus {
  return {
    providerId,
    available: true,
    models: [],
    recommendedModel: "",
    capabilities: noCapabilities(),
  };
}

/** Build a status list from the two reachability flags. */
function statuses(localUp: boolean, onlineUp: boolean): AIProviderStatus[] {
  const out: AIProviderStatus[] = [];
  if (localUp) out.push(status(LOCAL));
  if (onlineUp) out.push(status(ONLINE));
  return out;
}

describe("isLocalUp / isOnlineUp / isOnlineUsable", () => {
  it("ignores providers that are not available", () => {
    const down: AIProviderStatus[] = [{ ...status(LOCAL), available: false }];
    expect(isLocalUp(down, deps(false))).toBe(false);
    expect(isLocalUp(down, deps(true))).toBe(false);
  });

  it("ignores providers outside the configured id lists", () => {
    const other = [status("some-other-provider")];
    expect(isLocalUp(other, deps(true))).toBe(false);
    expect(isOnlineUp(other, deps(true))).toBe(false);
  });

  it("separates reachability from usability for online providers", () => {
    const up = statuses(false, true);
    // Reachable without a key: isOnlineUp says yes, isOnlineUsable says no.
    expect(isOnlineUp(up, deps(false))).toBe(true);
    expect(isOnlineUsable(up, deps(false))).toBe(false);
    expect(isOnlineUsable(up, deps(true))).toBe(true);
  });

  it("treats a local provider as up regardless of any API key", () => {
    const up = statuses(true, false);
    expect(isLocalUp(up, deps(false))).toBe(true);
    expect(isLocalUp(up, deps(true))).toBe(true);
  });
});

// ─── The 16-combination truth table ─────────────────────────────────────────
//
// Four independent booleans: localUp × onlineUp × hasKey × ttsAvailable.
// `canGenerate` and `mode` are written out explicitly rather than recomputed,
// so the table is an independent statement of intent and not a tautology.

interface Row {
  localUp: boolean;
  onlineUp: boolean;
  hasKey: boolean;
  tts: boolean;
  canGenerate: boolean;
  mode: "offline" | "online" | "hybrid" | "unavailable";
}

const TRUTH_TABLE: Row[] = [
  // No runtime reachable — the key and TTS are both irrelevant.
  { localUp: false, onlineUp: false, hasKey: false, tts: false, canGenerate: false, mode: "unavailable" },
  { localUp: false, onlineUp: false, hasKey: false, tts: true, canGenerate: false, mode: "unavailable" },
  { localUp: false, onlineUp: false, hasKey: true, tts: false, canGenerate: false, mode: "unavailable" },
  { localUp: false, onlineUp: false, hasKey: true, tts: true, canGenerate: false, mode: "unavailable" },

  // Online reachable, no key: NOT usable, so generation stays blocked. The mode
  // still reports connectivity — that asymmetry is deliberate and documented.
  { localUp: false, onlineUp: true, hasKey: false, tts: false, canGenerate: false, mode: "online" },
  { localUp: false, onlineUp: true, hasKey: false, tts: true, canGenerate: false, mode: "hybrid" },

  // Online reachable with a key: usable.
  { localUp: false, onlineUp: true, hasKey: true, tts: false, canGenerate: true, mode: "online" },
  { localUp: false, onlineUp: true, hasKey: true, tts: true, canGenerate: true, mode: "hybrid" },

  // Local only: always offline, and TTS never changes that — local LLM plus
  // local speech is still entirely on-machine.
  { localUp: true, onlineUp: false, hasKey: false, tts: false, canGenerate: true, mode: "offline" },
  { localUp: true, onlineUp: false, hasKey: false, tts: true, canGenerate: true, mode: "offline" },
  { localUp: true, onlineUp: false, hasKey: true, tts: false, canGenerate: true, mode: "offline" },
  { localUp: true, onlineUp: false, hasKey: true, tts: true, canGenerate: true, mode: "offline" },

  // Both reachable: hybrid, regardless of key or TTS.
  { localUp: true, onlineUp: true, hasKey: false, tts: false, canGenerate: true, mode: "hybrid" },
  { localUp: true, onlineUp: true, hasKey: false, tts: true, canGenerate: true, mode: "hybrid" },
  { localUp: true, onlineUp: true, hasKey: true, tts: false, canGenerate: true, mode: "hybrid" },
  { localUp: true, onlineUp: true, hasKey: true, tts: true, canGenerate: true, mode: "hybrid" },
];

describe("routing truth table (all 16 combinations)", () => {
  it("covers every combination exactly once", () => {
    expect(TRUTH_TABLE).toHaveLength(16);
    const keys = TRUTH_TABLE.map((r) => `${r.localUp}${r.onlineUp}${r.hasKey}${r.tts}`);
    expect(new Set(keys).size).toBe(16);
  });

  it.each(TRUTH_TABLE.map((r) => [r.localUp, r.onlineUp, r.hasKey, r.tts, r.canGenerate, r.mode] as const))(
    "localUp=%s onlineUp=%s hasKey=%s tts=%s → canGenerate=%s mode=%s",
    (localUp, onlineUp, hasKey, tts, canGenerate, mode) => {
      const list = statuses(localUp, onlineUp);
      const d = deps(hasKey);
      expect(computeCanGenerate(list, d)).toBe(canGenerate);
      expect(deriveMode(list, tts, d)).toBe(mode);
    }
  );
});

describe("needsApiKey", () => {
  it.each([
    // [localUp, onlineUp, hasKey, initialized, expected]
    [false, false, false, false, false], // still initialising — do not prompt yet
    [false, false, false, true, true], // nothing anywhere: ask for a key
    [false, false, true, true, true], // key stored but nothing reachable: still blocked
    [false, true, false, true, true], // reachable but unusable: ask for a key
    [false, true, true, true, false], // usable: no prompt
    [true, false, false, true, false], // local runtime answers: no prompt
    [true, true, false, true, false], // local answers: no prompt
  ] as const)(
    "localUp=%s onlineUp=%s hasKey=%s initialized=%s → %s",
    (localUp, onlineUp, hasKey, initialized, expected) => {
      const list = statuses(localUp, onlineUp);
      const d = deps(hasKey);
      const canGenerate = computeCanGenerate(list, d);
      expect(needsApiKey(list, { initialized, canGenerate }, d)).toBe(expected);
    }
  );

  it("never prompts while initialisation is still in flight", () => {
    const list = statuses(false, false);
    expect(needsApiKey(list, { initialized: false, canGenerate: false }, deps(false))).toBe(
      false
    );
  });
});

describe("the dead branch is gone", () => {
  it("TTS actually changes the mode for an online-only setup", () => {
    // The old code read `ttsAvailable ? "offline" : "offline"`, so this
    // assertion could never have passed. It is the regression guard for P1-2.
    const onlineOnly = statuses(false, true);
    expect(deriveMode(onlineOnly, false, deps(true))).toBe("online");
    expect(deriveMode(onlineOnly, true, deps(true))).toBe("hybrid");
  });

  it("does not let TTS flip a local setup away from offline", () => {
    const localOnly = statuses(true, false);
    expect(deriveMode(localOnly, false, deps(false))).toBe("offline");
    expect(deriveMode(localOnly, true, deps(false))).toBe("offline");
  });
});

describe("robustness", () => {
  it("handles an empty status list", () => {
    expect(computeCanGenerate([], deps(true))).toBe(false);
    expect(deriveMode([], true, deps(true))).toBe("unavailable");
    expect(isLocalUp([], deps(true))).toBe(false);
    expect(isOnlineUp([], deps(true))).toBe(false);
  });

  it("uses the real provider id lists by default", () => {
    // No deps passed: exercises DEFAULT_ROUTING_DEPS, which is what the app uses.
    expect(isLocalUp([status("lm-studio")])).toBe(true);
    expect(isLocalUp([status("ollama")])).toBe(true);
    expect(isOnlineUp([status("openai")])).toBe(true);
    expect(isLocalUp([status("openai")])).toBe(false);
  });
});
