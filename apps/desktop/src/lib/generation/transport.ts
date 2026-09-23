// Transport primitives shared by both generation paths.
//
// Extracted from `generation.ts` (plan item 5.1). Two layers live here:
//
//   Layer 1 — `chatForJson`: a single structured-output request, constrained by
//   a JSON Schema via the runtime's `format` option.
//   Layer 2 — a JSON repair pass for servers that ignore `format`.
//
// `retrySameModel` wraps a whole attempt with the same-model retry policy.
// Note the direction of the dependency: this module imports
// `classifyGenerationError` from `./errors`, and `./errors` imports nothing
// from here. That is what keeps the cycle out.

import { aiRuntime, extractJsonFromResponse, repairJson } from "../ai-runtime";
import type { AIMessage } from "../ai-runtime";
import { classifyGenerationError } from "./errors";

/** Same-model retry budget for recoverable (transient/JSON) failures. */
const MAX_SAME_MODEL_RETRIES = 3;

/** Base delay (ms) for exponential backoff between same-model retries. */
const RETRY_BACKOFF_MS = 1000;

/** Backoff delay for a given retry attempt (attempt is 1-based). */
export function retryBackoffDelay(attempt: number): number {
  // Overridable via env (used by tests to avoid sleeping).
  const configured = Number(process.env["STUDIO_STUDIO_RETRY_BACKOFF_MS"]);
  const base = Number.isFinite(configured) && configured >= 0 ? configured : RETRY_BACKOFF_MS;
  return base * attempt;
}

/**
 * Single structured-output request (Layer 1): ask the model for JSON constrained
 * by a JSON Schema via the runtime's `format` option. Falls back to the JSON
 * repair pass (Layer 2) for servers that ignore `format`.
 *
 * `reasoningEffort: "none"` is requested on every call, and this is the ONE
 * place it is requested — every structured generation in the app (lesson
 * one-shot, lesson chunks, podcast title, podcast chunks, glossary + quiz,
 * evaluation, diagnostics) funnels through here.
 *
 * The reason is not speed, although it is ~6x faster. It is that a reasoning
 * model's thinking tokens come out of the SAME `maxTokens` budget as its
 * answer, and these are small, tightly-budgeted requests — a 512-token title,
 * a 6-line dialogue chunk. Left to think, such a model spends the whole budget
 * reasoning and returns an EMPTY answer, which then fails JSON parsing and
 * reads as a formatting fault. Measured live against `qwen/qwen3.5-9b` at the
 * real 512-token title budget: 512/512 tokens on reasoning, zero characters of
 * answer, `finish_reason: "length"`. With this directive: valid JSON, zero
 * reasoning tokens.
 *
 * Providers that cannot express it ignore it, and the runtime never assumes it
 * was honoured — a model whose runtime mandates reasoning still reports the
 * starvation accurately (see `ReasoningBudgetExhaustedError`) rather than
 * pretending the request succeeded.
 */
export async function chatForJson(
  modelId: string,
  messages: AIMessage[],
  schema: unknown,
  numPredict: number,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const numCtx = numPredict > 16384 ? 65536 : numPredict > 8192 ? 32768 : 24576;
  const rawContent = await aiRuntime.chat(
    messages,
    {
      maxTokens: numPredict,
      numContext: numCtx,
      temperature: 0.7,
      format: schema,
      reasoningEffort: "none",
      signal,
    },
    modelId
  );
  const jsonStr = extractJsonFromResponse(rawContent);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    parsed = JSON.parse(repairJson(jsonStr));
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON parse validation failed: expected an object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Run `fn` (a single generation attempt) retrying the SAME model on
 * recoverable failures. Recoverable failures are content-shaped (bad JSON,
 * truncated output, schema mismatch) and are far more likely to succeed with
 * a same-model retry than a switch. Fatal/model-missing errors throw at once.
 */
export async function retrySameModel<T>(
  modelId: string,
  fn: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (e) {
      if (signal?.aborted) throw e;
      const kind = classifyGenerationError(e);
      if (kind === "recoverable" && attempt < MAX_SAME_MODEL_RETRIES) {
        attempt += 1;
        console.warn(
          `[generation] Model ${modelId} returned recoverable error (attempt ${attempt}/${MAX_SAME_MODEL_RETRIES}); retrying same model.`,
          e instanceof Error ? e.message : e
        );
        // Back off before retrying so a busy server / freshly loading model has
        // time to settle. Recoverable content errors (bad JSON) also benefit
        // from a short pause to avoid hammering the server.
        await new Promise((resolve) => setTimeout(resolve, retryBackoffDelay(attempt)));
        continue;
      }
      throw e;
    }
  }
}
