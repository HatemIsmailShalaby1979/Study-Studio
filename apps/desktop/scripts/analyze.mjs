#!/usr/bin/env node
// Cross-platform wrapper for the bundle analyzer.
//
// `ANALYZE=true next build` only works when npm runs scripts through a POSIX
// shell. On Windows npm uses cmd.exe, where the inline assignment is a syntax
// error. This wrapper sets the variable and spawns the build instead, so
// `npm run analyze` behaves the same on every platform with no extra
// dependency (cross-env would be another package to audit).
//
// The flag is consumed by next.config.mjs.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// shell: true so Windows resolves the `next` shim from node_modules/.bin.
const child = spawn("next", ["build"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: true,
  env: { ...process.env, ANALYZE: "true" },
});

child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (err) => {
  console.error("analyze — could not start the build:", err.message);
  process.exit(1);
});
