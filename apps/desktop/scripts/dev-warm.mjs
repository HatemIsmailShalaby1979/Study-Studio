// Dev-server launcher for `tauri dev`.
//
// `next dev` compiles shared route chunks lazily. The Tauri webview opens the
// window as soon as the dev server responds, so it can request a route chunk
// (e.g. `app/layout.js`) before webpack has emitted it and time out with a
// `ChunkLoadError`. This script starts `next dev` and explicitly requests the
// layout chunk until it compiles, closing that race before the window loads.

import { spawn } from "node:child_process";

const PORT = process.env.PORT || "3000";
const BASE = `http://localhost:${PORT}`;
const WARM_PATH = "/_next/static/chunks/app/layout.js";
const ATTEMPTS = 240; // 240 * 500ms = up to 2 minutes
const RETRY_MS = 500;

const child = spawn("npm run dev", { stdio: "inherit", shell: true });

function waitFor(url, ok) {
  return fetch(url, { redirect: "follow" }).then(
    (res) => res.ok && (ok ? ok(res) : true),
    () => false
  );
}

async function poll(url, ok) {
  for (let i = 0; i < ATTEMPTS; i++) {
    if (await waitFor(url, ok)) return true;
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
  return false;
}

(async () => {
  // The readiness check must not look at `content-length`. `next dev` compresses
  // the chunk and answers with `content-encoding: gzip` + `transfer-encoding:
  // chunked`, so the header is absent — and Node's `fetch` advertises gzip by
  // default, which is exactly how this script asks. `Number(null) > 0` is false,
  // so the predicate could never pass and the warm-up always ran the full two
  // minutes before warning that it had timed out. Measured on 2026-09-30 against
  // both bundlers: 200, `content-encoding: gzip`, `content-length: null` under
  // webpack AND Turbopack. Reading the body keeps the original guarantee — the
  // chunk is compiled and has real content — without depending on a header that
  // compression removes.
  const warmed = await poll(`${BASE}${WARM_PATH}`, async (res) => (await res.text()).length > 0);
  if (warmed) {
    console.log("[dev] layout chunk warm — opening app window");
    await poll(BASE);
  } else {
    console.warn("[dev] warmup timed out; continuing anyway");
  }
})();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
