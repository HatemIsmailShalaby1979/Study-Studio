// Pre-Flight Model Profiler ("Patriot Check")
//
// Before firing heavy prompts, the app queries the selected AI runtime for the
// model's metadata and validates the selected model can handle the requested
// task. Lightweight models that cannot execute tool calls or fit the context
// window are flagged BEFORE generation starts — no wasted compute, no silent
// drift.
//
// Profiling goes through the AI Runtime (`aiRuntime.getModelProfile`), which
// dispatches to the active provider. No provider-specific code lives here.

import { aiRuntime } from "./ai-runtime";
import type { AIModelProfile } from "./ai-runtime";

export type { AIModelProfile as ModelProfile };

export interface ProfileResult {
  suitable: boolean;
  message?: string;
}

/** Minimum context window (tokens) needed for structured lesson generation. */
const MIN_CONTEXT_FOR_LESSON = 8192;
/** Minimum context window needed for chunked generation / long podcasts. */
const MIN_CONTEXT_FOR_LONG = 16384;

/**
 * Query the active AI runtime for the model's metadata. Returns null when the
 * runtime is unreachable or the model is unknown — callers treat that as
 * "assume suitable".
 */
export async function fetchModelProfile(modelName: string): Promise<AIModelProfile | null> {
  return aiRuntime.getModelProfile(modelName);
}

/**
 * Validate a model profile against a task. Returns `{ suitable: false,
 * message }` with a human, lightly-humorous explanation when the model can't
 * do the job — matching the blueprint's "Patriot Check" gatekeeper.
 */
export function validateModelForTask(
  model: AIModelProfile | null,
  task: "lesson" | "podcast" = "lesson"
): ProfileResult {
  if (!model) {
    return { suitable: true };
  }

  const minCtx = task === "podcast" ? MIN_CONTEXT_FOR_LONG : MIN_CONTEXT_FOR_LESSON;
  if (model.contextWindow < minCtx) {
    return {
      suitable: false,
      message: `Careful! ${model.id} only has a ${model.contextWindow}-token context window. We need at least ${minCtx} to build a solid ${task}. Pick a model with a wider window (qwen2.5, llama3.1, gemma3) and we'll fly.`,
    };
  }

  return { suitable: true };
}

/**
 * Convenience wrapper: fetch + validate in one call. Returns the profile when
 * suitable, or a `{ suitable: false, message }` result when not.
 */
export async function profileAndValidate(
  modelName: string,
  task: "lesson" | "podcast" = "lesson"
): Promise<{ profile: AIModelProfile | null; validation: ProfileResult }> {
  const profile = await fetchModelProfile(modelName);
  if (!profile) {
    return { profile: null, validation: { suitable: true } };
  }
  return { profile, validation: validateModelForTask(profile, task) };
}
