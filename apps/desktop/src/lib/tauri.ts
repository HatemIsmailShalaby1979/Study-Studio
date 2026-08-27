// Tauri IPC bridge for the Study Studio desktop app.
//
// The Next.js frontend is statically exported (output: "export") and bundled
// inside the Tauri shell, so it has NO server-side API routes at runtime.
// All AI operations go through Tauri's invoke() to the Rust backend commands
// in src-tauri/src/lib.rs (list_models, chat, generate, check_health, ...).
//
// In a plain browser (next dev outside Tauri) isTauri() is false and the
// shared libs fall back to calling the local Ollama HTTP API directly.

/**
 * Detect whether we're running inside the Tauri webview.
 *
 * Tauri v2 injects `window.__TAURI_INTERNALS__` at runtime. We also check
 * the legacy `window.__TAURI__` flag (set when `withGlobalTauri` is enabled)
 * as a secondary signal. Both checks are safe in a plain browser — the
 * properties simply won't exist.
 */
export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "__TAURI_INTERNALS__" in window ||
    "__TAURI__" in window
  );
}

export async function invokeTauri<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
