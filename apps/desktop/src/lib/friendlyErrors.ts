// Friendly error-message mapper for Study Studio.
//
// Translates raw provider/transport/TTS failures into the spec's exact,
// navigation-safe user-facing strings. This WRAPS the existing structured
// error utilities (`error.ts`, `describeGenerationFailure`) — it does NOT
// replace them. Callers can still get the raw reason; this module gives them
// the friendly version for inline UI.
//
// Design rules (from the global spec):
//   - Never crash, never block navigation, never dead-end.
//   - Offline-first: a missing local server is the common case, not an error.
//   - Every message offers a concrete next step (start a server / add a key /
//     retry / use a different feature).

export type FriendlyErrorKind =
  | "local-server-unreachable"
  | "audio-generation-failed"
  | "api-key-invalid"
  | "no-tts"
  | "network"
  | "generic";

export interface FriendlyError {
  kind: FriendlyErrorKind;
  /** Short, actionable message — safe to render directly in the UI. */
  message: string;
  /** Optional longer hint (shown in a details/expandable area). */
  hint?: string;
}

const MESSAGES: Record<FriendlyErrorKind, FriendlyError> = {
  "local-server-unreachable": {
    kind: "local-server-unreachable",
    message:
      "I couldn't find a local model server. Start Ollama or LM Studio, or use an online API key.",
    hint: "Tip: run `ollama serve` or open LM Studio's local server. You can also add an OpenAI / OpenRouter key in Settings.",
  },
  "audio-generation-failed": {
    kind: "audio-generation-failed",
    message:
      "Audio generation failed. Your text is safe. You can retry after checking your TTS setup.",
    hint: "Make sure a Piper voice is downloaded and ffmpeg is installed. The lesson text itself is not affected.",
  },
  "api-key-invalid": {
    kind: "api-key-invalid",
    message: "This API key didn't work. Please check it and try again.",
  },
  "no-tts": {
    kind: "no-tts",
    message:
      "Audio requires a local TTS engine. HTML, quizzes, and glossary are still available.",
    hint: "Download a Piper voice in Settings, or run the app inside the Tauri shell for local speech synthesis.",
  },
  network: {
    kind: "network",
    message:
      "Network request failed. Check your connection and the provider URL, then retry.",
  },
  generic: {
    kind: "generic",
    message: "Something went wrong. Your work is safe — you can retry.",
  },
};

/**
 * Map a raw error (string, Error, or provider health message) to a friendly,
 * kind-tagged message. Heuristics inspect the message text; when nothing
 * matches, the safe generic fallback is returned. NEVER throws.
 */
export function toFriendlyError(error: unknown): FriendlyError {
  try {
    const raw = pickMessage(error).toLowerCase();

    // Local server unreachable — Ollama / LM Studio down, refused, timeout.
    if (
      /localhost|127\.0\.0\.1|11434|1234|econnrefused|fetch failed|network request failed/.test(
        raw
      ) ||
      /ollama|lm studio|lm-studio/.test(raw)
    ) {
      return MESSAGES["local-server-unreachable"];
    }

    // API key / auth issues.
    if (
      /unauthor|401|403|invalid api key|api key|forbidden|authentication/.test(
        raw
      )
    ) {
      return MESSAGES["api-key-invalid"];
    }

    // TTS / audio-specific failures.
    if (/tts|piper|voice|ffmpeg|synthesize|audio/.test(raw)) {
      if (/not (installed|available|found)|no .*voice|no .*tts/.test(raw)) {
        return MESSAGES["no-tts"];
      }
      return MESSAGES["audio-generation-failed"];
    }

    // Generic network.
    if (/network|timeout|dns|enotfound|econnreset|offline/.test(raw)) {
      return MESSAGES.network;
    }

    return MESSAGES.generic;
  } catch {
    return MESSAGES.generic;
  }
}

/** Convenience: just the friendly message string. */
export function friendlyMessage(error: unknown): string {
  return toFriendlyError(error).message;
}

/** Direct lookup by kind (e.g. when the caller already knows the category). */
export function friendlyErrorByKind(kind: FriendlyErrorKind): FriendlyError {
  return MESSAGES[kind] ?? MESSAGES.generic;
}

function pickMessage(error: unknown): string {
  if (error == null) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  // Provider health / structured objects with a `message` field.
  const maybe = (error as { message?: unknown }).message;
  if (typeof maybe === "string") return maybe;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
