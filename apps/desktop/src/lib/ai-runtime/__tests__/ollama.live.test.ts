/**
 * @jest-environment node
 */
//
// Live end-to-end test against a real Ollama server.
//
// The `node` environment is required, not cosmetic — the default jsdom
// environment in this project does not expose a global `fetch`, and
// `runtimeFetch` falls back to the native fetch outside Tauri.
//
// Opt-in, because it needs a running server and a downloaded model:
//
//   OLLAMA_LIVE=1 OLLAMA_LIVE_MODEL=granite4.2:latest
//
// Why this file exists: the podcast defect was invisible to unit tests — every
// mock returned a non-empty `content`, so the path that fed `""` to
// `JSON.parse` was never exercised against a hybrid thinking model. Measured
// live against `granite4.2:latest`: without top-level `think: false` the
// app's 512-token title request burns 512/512 on reasoning, returns empty
// `content` with `done_reason: "length"`, and the structured-output path
// reports "Unexpected end of JSON input". With `think: false` the same request
// returns valid JSON in ~23 tokens with `done_reason: "stop"`.
//
// Without the env var it asserts the gate and exits, so CI stays hermetic and
// lint-clean (no disabled tests, no assertion-free tests).

import { chat, generate } from "@/lib/ollama";
import { OllamaProvider } from "@/lib/ai-runtime/providers/ollama";
import { chatForJson } from "@/lib/generation/transport";
import { PODCAST_TITLE_JSON_SCHEMA } from "@/lib/validation";

const RUN = process.env["OLLAMA_LIVE"] === "1";
const MODEL = process.env["OLLAMA_LIVE_MODEL"] ?? "granite4.2:latest";

describe("Ollama — live server", () => {
  if (!RUN) {
    test("is opt-in via OLLAMA_LIVE=1", () => {
      expect(process.env["OLLAMA_LIVE"]).not.toBe("1");
    });
    return;
  }

  jest.setTimeout(300_000);

  const provider = new OllamaProvider();

  it("answers a chat request when thinking is disabled", async () => {
    const content = await chat(
      [
        { role: "system", content: "Respond ONLY with valid JSON." },
        { role: "user", content: "Create a podcast title about photosynthesis." },
      ],
      {
        think: false,
        num_predict: 512,
        format: PODCAST_TITLE_JSON_SCHEMA,
      },
      MODEL
    );

    expect(content.trim().length).toBeGreaterThan(0);
    expect(typeof JSON.parse(content)["title"]).toBe("string");
  });

  it("maps reasoningEffort: none onto a successful structured title", async () => {
    // This is the exact path `chatForJson` takes: the provider receives
    // `reasoningEffort: "none"` from the runtime and must translate it into
    // Ollama's top-level `think: false`. If that mapping regresses, the
    // hybrid thinking model starves the 512-token budget again.
    const content = await provider.chat(
      [
        { role: "system", content: "Respond ONLY with valid JSON." },
        { role: "user", content: "Create a podcast title about photosynthesis." },
      ],
      {
        maxTokens: 512,
        temperature: 0.7,
        format: PODCAST_TITLE_JSON_SCHEMA,
        reasoningEffort: "none",
      },
      MODEL
    );

    expect(content.trim().length).toBeGreaterThan(0);
    expect(typeof JSON.parse(content)["title"]).toBe("string");
  });

  it("answers the 512-token title request that used to come back empty", async () => {
    // The full structured-output funnel: runtime → provider → transport →
    // Ollama. This is the request that failed deterministically before the
    // `think` mapping existed.
    const parsed = await chatForJson(
      MODEL,
      [
        { role: "system", content: "Respond ONLY with valid JSON." },
        { role: "user", content: "Create an intermediate-level educational podcast about: photosynthesis." },
      ],
      PODCAST_TITLE_JSON_SCHEMA,
      512
    );

    expect(typeof parsed["title"]).toBe("string");
    expect((parsed["title"] as string).length).toBeGreaterThan(0);
  });

  it("answers a generate request when thinking is disabled", async () => {
    const out = await generate(
      "Respond ONLY with JSON: {\"ok\": true}",
      undefined,
      { think: false, num_predict: 64 },
      MODEL
    );

    expect(out.trim().length).toBeGreaterThan(0);
    expect(JSON.parse(out)).toMatchObject({ ok: true });
  });
});
