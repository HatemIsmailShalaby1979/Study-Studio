// Generation error classification and human-readable failure descriptions.
//
// Extracted from `generation.ts` (plan item 5.1) as the first module of the
// split, because `retrySameModel` in `transport.ts` depends on
// `classifyGenerationError`. Keeping this module free of any import from
// `transport.ts` is what makes the dependency graph acyclic — do not add one.
//
// The distinction that matters: `recoverable` errors are content-shaped (bad
// JSON, truncated output, schema mismatch) and are retried against the SAME
// model rather than switching models. That policy is deliberate — see
// `retrySameModel`.

import { ZodError } from "zod";
import type { LessonLanguage } from "./prompts";

/**
 * Classify an error from `tryGenerate`.
 *
 * - `recoverable`: a transient or content-shaped failure — bad JSON,
 *   truncated output, schema validation. These are far more likely to succeed
 *   with a same-model retry than a model switch, so we retry the SAME model
 *   rather than churning the GPU. (There is no cross-model fallback.)
 * - `model-missing`: the runtime reports the model isn't installed. It is
 *   treated as non-recoverable: generation surfaces the error so the user decides.
 * - `fatal`: anything else (network down, server 500). Surface immediately.
 */
export type GenerationErrorKind = "model-missing" | "recoverable" | "fatal";

export function classifyGenerationError(e: unknown): GenerationErrorKind {
  if (e instanceof ZodError) {
    // The model returned output that fails the lesson schema (e.g. a missing
    // `sections` array). Retry the SAME model — never switch models.
    return "recoverable";
  }
  const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
  // Zod serializes issues as `[ { "code": "invalid_type", ..., "message": ... } ]`;
  // match that shape directly so schema failures are retried even if the error
  // was serialized (e.g. across an IPC boundary).
  if (msg.includes('"code": "') && msg.includes('"message":')) {
    return "recoverable";
  }
  if (msg.includes("404") || msg.includes("not found") || msg.includes("model") && msg.includes("error")) {
    return "model-missing";
  }
  if (
    msg.includes("json") ||
    msg.includes("parse") ||
    msg.includes("unexpected token") ||
    msg.includes("validation") ||
    msg.includes("validate") ||
    msg.includes("schema") ||
    msg.includes("chunk validation") ||
    msg.includes("empty section")
  ) {
    return "recoverable";
  }
  // Transient network / transport failures (server busy, model loading, request
  // dropped mid-stream) are almost always worth retrying with the SAME model.
  // Classifying them as fatal would surface an avoidable error to the user.
  if (
    msg.includes("error sending request") ||
    msg.includes("connection") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("socket") ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("reqwest") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("unreachable") ||
    msg.includes("hyper::") ||
    msg.includes("broken pipe") ||
    msg.includes("closed") ||
    msg.includes("tls") ||
    msg.includes("failed to read") ||
    msg.includes("send()")
  ) {
    return "recoverable";
  }
  return "fatal";
}

/**
 * Turn a lesson-schema failure into a concise, human-readable reason, e.g.
 * `the model returned output that doesn't match the required lesson format
 * ("sections" (expected array, got undefined))`.
 */
export function describeSchemaFailure(e: ZodError): string {
  const issues = e.issues ?? [];
  if (issues.length === 0) return e.message;
  const summary = issues
    .map((issue) => {
      const path = issue.path?.length ? issue.path.join(".") : "top-level";
      const expected = (issue as { expected?: string | number }).expected;
      const received = (issue as { received?: string | number }).received;
      return `"${path}" (expected ${expected !== undefined ? expected : "a valid value"}, got ${received !== undefined ? received : "nothing"})`;
    })
    .join("; ");
  return `the model returned output that doesn't match the required lesson format (${summary})`;
}

/**
 * Produce a human-readable reason + guidance for a failed generation attempt,
 * so the user isn't left staring at a raw V8 / zod error string.
 */
export function describeGenerationFailure(error: unknown, language?: LessonLanguage): { reason: string; guidance: string } {
  const languageHint =
    language === "ar"
      ? " The model may have weak Arabic support — try a larger multilingual model (e.g. qwen3:14b, qwen3:30b) or generate in English."
      : "";
  if (error instanceof ZodError) {
    return {
      reason: describeSchemaFailure(error),
      guidance:
        " This usually means the selected model isn't following the structured-format instructions; try an instruction-tuned model (e.g. gemma3, llama3.2, qwen3) or try again." +
        languageHint,
    };
  }
  const msg = error instanceof Error ? error.message : String(error);
  if (
    /\bjson\b/i.test(msg) ||
    /\bunexpected (end|token|identifier)\b/i.test(msg) ||
    /at position \d+/i.test(msg)
  ) {
    return {
      reason: `the model returned malformed or truncated JSON (${msg})`,
      guidance:
        " Small local models frequently break very long structured output; try a shorter Length, a larger model, or retry." +
        languageHint,
    };
  }
  if (
    msg.includes("empty section") ||
    msg.includes("produced no sections") ||
    msg.includes("chunk validation")
  ) {
    return {
      reason: `the model returned empty content for lesson sections${language === "ar" ? " (possibly due to weak Arabic output)" : ""}`,
      guidance:
        " The selected model struggled to produce substantive content." +
        languageHint +
        " You can also retry, as output quality varies between runs.",
    };
  }
  return { reason: msg, guidance: languageHint };
}
