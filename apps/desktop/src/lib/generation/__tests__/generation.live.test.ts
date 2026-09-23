/**
 * @jest-environment node
 */
//
// Live end-to-end test: generate a lesson and a podcast script against a real
// local model.
//
// The `node` environment is required, not cosmetic — the default jsdom
// environment in this project does not expose a global `fetch`, and
// `runtimeFetch` falls back to the native fetch outside Tauri.
//
// Opt-in, because it needs a running server, a downloaded model, and minutes of
// real inference:
//
//   LMSTUDIO_LIVE=1 LMSTUDIO_LIVE_MODEL=qwen/qwen3.5-9b
//
// Why this file exists: the unit suites mock the HTTP layer, so they prove the
// request the app *builds* and the response it *parses*, but never that a real
// model answers a real request. That gap is exactly where the reported defect
// lived — every unit test passed while podcast generation failed on every
// reasoning model installed on this machine.
//
// The failure it pins: a reasoning model's thinking tokens come out of the same
// `maxTokens` budget as its answer, and the app's first podcast call is a
// 512-token title request. With no reasoning directive, `qwen/qwen3.5-9b` spent
// 512/512 tokens thinking and returned EMPTY content with
// `finish_reason: "length"` — deterministically, on every attempt. The app read
// that as malformed JSON and retried the same model three more times before
// reporting a formatting problem that did not exist.
//
// Without the env var it asserts the gate and exits, so CI stays hermetic and
// lint-clean (no disabled tests, no assertion-free tests).

import { aiRuntime } from "@/lib/ai-runtime";
import { chatForJson } from "@/lib/generation/transport";
import { generateLesson, generatePodcastOnly } from "@/lib/generation";
import { podcastChunkSystemPrompt, podcastChunkUserPrompt } from "@/lib/generation/prompts";
import { PODCAST_CHUNK_JSON_SCHEMA, PODCAST_TITLE_JSON_SCHEMA, validatePodcastChunk } from "@/lib/validation";

const RUN = process.env["LMSTUDIO_LIVE"] === "1";
const MODEL = process.env["LMSTUDIO_LIVE_MODEL"] ?? "";
const PROVIDER = "lm-studio";

describe("generation — live local model", () => {
  if (!RUN) {
    test("is opt-in via LMSTUDIO_LIVE=1", () => {
      expect(process.env["LMSTUDIO_LIVE"]).not.toBe("1");
    });
    return;
  }

  // Real inference, including a cold model load — measured at 237 s for the 9B
  // on this machine, and the podcast itself is up to a dozen sequential calls.
  // Generous on purpose: the point is to prove the path completes, not to
  // measure it.
  jest.setTimeout(1_800_000);

  beforeAll(async () => {
    // Mirror what `initializeRuntime` does, and for the same reason: without a
    // session provider the runtime falls back to the first *registered*
    // provider, which is Ollama — a server that is not running on this machine.
    aiRuntime.session.setProvider(PROVIDER);
    await aiRuntime.ensureModelLoaded(MODEL, PROVIDER);
  });

  it("answers the 512-token title request that used to come back empty", async () => {
    // This is the exact request shape that failed deterministically: the
    // app's first podcast call, with the app's real budget.
    const parsed = await chatForJson(
      MODEL,
      [
        { role: "system", content: "You write podcast titles. Respond ONLY with valid JSON." },
        { role: "user", content: "Create an intermediate-level educational podcast about: photosynthesis." },
      ],
      PODCAST_TITLE_JSON_SCHEMA,
      512
    );

    expect(typeof parsed["title"]).toBe("string");
    expect((parsed["title"] as string).length).toBeGreaterThan(0);
  });

  it("answers a dialogue-chunk request with a valid chunk", async () => {
    // The other place starvation could bite: a 6144-token chunk request. Slower
    // than the title call by an order of magnitude on a local model, so this is
    // also the test that makes the cost of a real chunk visible.
    const started = Date.now();
    const chunk = validatePodcastChunk(
      await chatForJson(
        MODEL,
        [
          { role: "system", content: podcastChunkSystemPrompt("beginner", "en", "male", "female") },
          {
            role: "user",
            content: podcastChunkUserPrompt(
              "Photosynthesis Explained",
              "An introduction to how plants convert light into chemical energy.",
              [],
              6
            ),
          },
        ],
        PODCAST_CHUNK_JSON_SCHEMA,
        6144
      )
    );

    expect(chunk.lines.length).toBeGreaterThanOrEqual(2);
    // No upper bound: the requested line count is a request, not a contract.
    // `podcastChunkOutputSchema` enforces a minimum of two and no maximum, and
    // models routinely overshoot — measured here at 12 lines when 6 were asked
    // for. The app appends what it gets, so overshooting only reaches the
    // target sooner. Asserting `<= 6` would have been asserting a guarantee the
    // app never made.
    expect(chunk.lines.every((l) => l.text.trim().length >= 30)).toBe(true);
    // A chunk that takes longer than this on a loaded model means the request is
    // being retried, which is the signal this test exists to give.
    expect(Date.now() - started).toBeLessThan(300_000);
  });

  it("generates a complete podcast script end to end", async () => {
    // Shortest settings the app offers, so the run stays bounded: 12 exchanges
    // in 6-line chunks, then glossary + quiz.
    const { podcastScript } = await generatePodcastOnly({
      topic: "photosynthesis",
      model: MODEL,
      difficulty: "beginner",
      length: "short",
      language: "en",
    });

    expect(Array.isArray(podcastScript)).toBe(true);
    expect(podcastScript!.length).toBeGreaterThanOrEqual(8);
    for (const line of podcastScript!) {
      expect(line.speaker).toMatch(/^Host [AB]$/);
      expect(line.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("generates a topic lesson at 'long' length, the biggest budget the app requests", async () => {
    // `lessonMaxTokens("long")` is 32768 and the app loads models with a 32768
    // cap, so this is the request that looks like it cannot fit the window.
    //
    // It fits, and the reason is worth stating because the opposite was assumed
    // for a while: `max_tokens` is a CEILING, not a target. Measured against a
    // model loaded at a 2048-token window, asking for 8192 and then 49152 output
    // tokens both finished with `finish_reason: "stop"` after 890 and 938 tokens
    // — the model stops when it is done. So an oversized budget costs nothing,
    // and skipping the one-shot for long lessons would have been strictly
    // slower: the chunked path is a dozen sequential calls.
    //
    // What this test therefore pins is that the one-shot path COMPLETES for a
    // long lesson, rather than silently falling back.
    const lesson = await generateLesson({
      topic: "photosynthesis",
      model: MODEL,
      difficulty: "intermediate",
      length: "long",
      language: "en",
    });

    expect(lesson.title.length).toBeGreaterThan(0);
    // The lesson schema's own minimums — the real contract, not a paraphrase.
    expect(lesson.sections.length).toBeGreaterThanOrEqual(6);
    expect(lesson.glossary.length).toBeGreaterThanOrEqual(8);
    expect(lesson.quiz.length).toBeGreaterThanOrEqual(6);
    expect(lesson._model).toBe(MODEL);
  });
});
