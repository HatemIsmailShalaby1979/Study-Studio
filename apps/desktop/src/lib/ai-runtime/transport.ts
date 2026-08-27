// CORS-free `fetch` for the desktop shell.
//
// Inside the Tauri webview the page origin is `tauri://localhost`, so plain
// `fetch()` calls to local AI servers (LM Studio, LocalAI, vLLM, ...) can be
// blocked by those servers' CORS policies — Ollama answers with
// `Access-Control-Allow-Origin`, but LM Studio ships with CORS disabled by
// default. To work with any local runtime regardless of its CORS setup, this
// routes requests through the Rust backend via `tauri-plugin-http` (reqwest),
// which is not subject to browser CORS.
//
// In a plain browser (`next dev` outside Tauri) it falls back to the native
// fetch — same signature, same Response contract — so tests and the web build
// keep working unchanged.

import { isTauri } from "../tauri";

export async function runtimeFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(input, init);
  }
  return fetch(input, init);
}
