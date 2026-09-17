import { toFriendlyError, friendlyMessage, friendlyErrorByKind } from "@/lib/friendlyErrors";

// This module had zero coverage before. It is the single place that turns a raw
// provider/transport failure into something a user can act on, so getting the
// classification order wrong is a real bug — see the 401-from-localhost case
// below, which the old inline chain in generate/page.tsx got backwards.

describe("toFriendlyError — classification", () => {
  it("reports an auth failure before a local-server failure", () => {
    // The regression that motivated the ordering rule: an auth error arriving
    // from a local port contains "localhost", so a localhost-first check would
    // tell the user to restart a server that is running fine.
    const err = new Error("401 Unauthorized (http://localhost:1234/v1/models)");
    expect(toFriendlyError(err).kind).toBe("api-key-invalid");
  });

  it.each([
    ["401 Unauthorized", "api-key-invalid"],
    ["invalid api key provided", "api-key-invalid"],
    ["403 Forbidden", "api-key-invalid"],
    ["authentication failed", "api-key-invalid"],
  ])("classifies %s as %s", (message, kind) => {
    expect(toFriendlyError(new Error(message)).kind).toBe(kind);
  });

  it.each([
    ["connect ECONNREFUSED 127.0.0.1:11434", "local-server-unreachable"],
    ["fetch failed", "local-server-unreachable"],
    ["LM Studio is not running", "local-server-unreachable"],
    ["could not reach ollama", "local-server-unreachable"],
  ])("classifies %s as %s", (message, kind) => {
    expect(toFriendlyError(new Error(message)).kind).toBe(kind);
  });

  it("distinguishes missing TTS from a failed audio render", () => {
    expect(toFriendlyError(new Error("no piper voice installed")).kind).toBe("no-tts");
    expect(toFriendlyError(new Error("piper synthesis failed")).kind).toBe(
      "audio-generation-failed"
    );
  });

  it.each([
    ["request timed out", "network"],
    ["getaddrinfo ENOTFOUND api.openai.com", "network"],
    ["socket hang up", "generic"],
  ])("classifies %s as %s", (message, kind) => {
    expect(toFriendlyError(new Error(message)).kind).toBe(kind);
  });

  it("accepts a plain string, an Error, and a {message} object alike", () => {
    expect(toFriendlyError("401 unauthorized").kind).toBe("api-key-invalid");
    expect(toFriendlyError(new Error("401 unauthorized")).kind).toBe("api-key-invalid");
    expect(toFriendlyError({ message: "401 unauthorized" }).kind).toBe("api-key-invalid");
  });

  it("never throws and never returns undefined, whatever it is handed", () => {
    const inputs: unknown[] = [
      undefined,
      null,
      0,
      "",
      {},
      [],
      Symbol("x"),
      new Error(""),
      { message: 12345 },
    ];
    for (const input of inputs) {
      const result = toFriendlyError(input);
      expect(result).toBeDefined();
      expect(typeof result.message).toBe("string");
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("falls back to the generic kind for an unrecognised failure", () => {
    expect(toFriendlyError(new Error("something odd happened")).kind).toBe("generic");
  });

  it("always offers an actionable hint on the two recovery-critical kinds", () => {
    // Offline-first: a missing local server is the common case, not an error,
    // so it must tell the user how to start one.
    expect(toFriendlyError(new Error("ECONNREFUSED")).hint).toBeTruthy();
    expect(toFriendlyError(new Error("no piper voice installed")).hint).toBeTruthy();
  });
});

describe("friendlyMessage", () => {
  it("returns the message string only", () => {
    expect(friendlyMessage(new Error("401 unauthorized"))).toBe(
      friendlyErrorByKind("api-key-invalid").message
    );
  });
});

describe("friendlyErrorByKind", () => {
  it("returns the requested kind", () => {
    expect(friendlyErrorByKind("no-tts").kind).toBe("no-tts");
  });

  it("falls back to generic for an unknown kind", () => {
    // Defensive: callers pass values that originated as strings.
    expect(friendlyErrorByKind("not-a-kind" as never).kind).toBe("generic");
  });

  it("covers every kind with a non-empty message", () => {
    const kinds = [
      "local-server-unreachable",
      "audio-generation-failed",
      "api-key-invalid",
      "no-tts",
      "network",
      "generic",
    ] as const;
    for (const kind of kinds) {
      const entry = friendlyErrorByKind(kind);
      expect(entry.kind).toBe(kind);
      expect(entry.message.length).toBeGreaterThan(0);
    }
  });
});
