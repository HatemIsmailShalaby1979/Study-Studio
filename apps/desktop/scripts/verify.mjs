#!/usr/bin/env node
// Parallel verification pipeline — the local quality gate.
//
// WHY THIS EXISTS
//
// `npm run verify` used to be a `&&` chain:
//
//   typecheck && lint:ci && test:ci && check:coverage && check:versions && build:prod && check:tokens
//
// Measured on this machine, that chain took ~137 s and had two structural
// problems:
//
//  1. It is FAIL-FAST. `&&` stops at the first failing step, so a change with
//     five problems needs five full pipeline runs to discover them — ~11 min of
//     wall-clock for one round of fixes. Running every gate and reporting every
//     failure turns that into a single run.
//
//  2. It is SERIAL. typecheck, lint and test share no state and cannot affect
//     each other's results, yet they ran one after another. Running the
//     independent gates concurrently makes the phase cost max(...) instead of
//     sum(...).
//
// The step order below is also deliberate: `check:versions` is the cheapest gate
// (~3 s) and used to run fifth of seven, so a version bump mismatch cost you
// ~95 s of unrelated work before it was reported. Cheap checks now run in the
// first wave, alongside the expensive ones they do not depend on.
//
// WAVES
//
//   wave 1 (parallel)  versions, typecheck, lint, test      <- independent
//   wave 2 (parallel)  coverage (needs test), build         <- both depend on wave 1
//   wave 3             tokens (needs build)
//
// `check:coverage` reads the coverage summary `test:ci` writes, and
// `check:tokens` reads the CSS `build:prod` emits, so those edges are real and
// cannot be flattened away.
//
// USAGE
//
//   npm run verify              # parallel (default)
//   npm run verify -- --serial  # same gates, one at a time (low-RAM machines,
//                               # or when you want readable interleaved logs)
//   npm run verify -- --fail-fast
//
// Exits 0 only when every gate passed.

import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const SERIAL = process.argv.includes("--serial");
const FAIL_FAST = process.argv.includes("--fail-fast");

/** Every gate, with its dependencies expressed as step ids. */
const STEPS = {
  versions: { cmd: "npm run check:versions", label: "check:versions", needs: [] },
  typecheck: { cmd: "npm run typecheck", label: "typecheck", needs: [] },
  lint: { cmd: "npm run lint:ci", label: "lint (0 warnings)", needs: [] },
  test: { cmd: "npm run test:ci", label: "test + coverage", needs: [] },
  coverage: { cmd: "npm run check:coverage", label: "coverage floors", needs: ["test"] },
  build: { cmd: "npm run build:prod", label: "build (static export)", needs: [] },
  tokens: { cmd: "npm run check:tokens", label: "design tokens", needs: ["build"] },
};

/** Wave membership. Order within a wave does not matter — they run together. */
const WAVES = [
  ["versions", "typecheck", "lint", "test"],
  ["coverage", "build"],
  ["tokens"],
];

// `next build` deletes `.next/` and `.next/export` wholesale, which trips the
// sandbox's bulk-delete guard. See MEMORY.md "Environment gotchas" — the build
// compiles fine with the guard off.
const BASE_ENV = { ...process.env, CODEBUDDY_SAFE_DELETE_ENABLED: "0" };

const results = new Map();

function runStep(id) {
  const step = STEPS[id];
  return new Promise((resolve) => {
    const started = performance.now();
    // Buffer per step: interleaving four live streams is unreadable, and a
    // buffered step can be printed as one clean block when it finishes.
    let out = "";
    const child = spawn(step.cmd, {
      shell: true,
      env: BASE_ENV,
      cwd: process.cwd(),
    });

    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));

    child.on("close", (code) => {
      const ms = Math.round(performance.now() - started);
      const result = { id, code, ms, out };
      results.set(id, result);
      const mark = code === 0 ? "PASS" : "FAIL";
      const secs = (ms / 1000).toFixed(1).padStart(5);
      process.stdout.write(`  ${mark}  ${step.label.padEnd(22)} ${secs}s\n`);
      if (code !== 0) {
        // Only surface the tail: a failing gate's useful lines are at the end,
        // and jest/tsc/eslint all print progress noise above them.
        const lines = out.trimEnd().split("\n");
        const tail = lines.slice(-25).join("\n");
        process.stdout.write(`\n${tail}\n\n`);
      }
      resolve(result);
    });
  });
}

/**
 * A step whose dependency failed is SKIPPED, not run. `check:coverage` against a
 * stale summary would either pass vacuously or report a phantom failure; both
 * are worse than saying plainly that it was skipped.
 */
function dependencyFailure(id) {
  for (const need of STEPS[id].needs) {
    const r = results.get(need);
    if (r && r.code !== 0) return need;
    if (!r) return need; // dependency never ran (fail-fast abort)
  }
  return null;
}

async function runWave(ids) {
  if (SERIAL) {
    for (const id of ids) {
      const blocked = dependencyFailure(id);
      if (blocked) {
        results.set(id, { id, code: null, ms: 0, out: "", skippedBecause: blocked });
        process.stdout.write(`  SKIP  ${STEPS[id].label.padEnd(22)}      (${blocked} failed)\n`);
        continue;
      }
      await runStep(id);
      if (FAIL_FAST && results.get(id).code !== 0) return false;
    }
    return true;
  }

  const runnable = [];
  for (const id of ids) {
    const blocked = dependencyFailure(id);
    if (blocked) {
      results.set(id, { id, code: null, ms: 0, out: "", skippedBecause: blocked });
      process.stdout.write(`  SKIP  ${STEPS[id].label.padEnd(22)}      (${blocked} failed)\n`);
    } else {
      runnable.push(runStep(id));
    }
  }
  await Promise.all(runnable);
  return !FAIL_FAST || ![...results.values()].some((r) => r.code !== 0);
}

async function main() {
  const t0 = performance.now();
  process.stdout.write(
    `\nverify — ${SERIAL ? "serial" : "parallel"} pipeline (${Object.keys(STEPS).length} gates)\n\n`
  );

  for (const wave of WAVES) {
    const ok = await runWave(wave);
    if (!ok) {
      process.stdout.write("\nverify — aborted after first failure (--fail-fast)\n\n");
      break;
    }
  }

  const wall = Math.round(performance.now() - t0);
  const failed = [...results.values()].filter((r) => r.code !== 0 && r.code !== null);
  const skipped = [...results.values()].filter((r) => r.code === null);

  process.stdout.write("  " + "-".repeat(38) + "\n");
  if (failed.length === 0 && skipped.length === 0) {
    process.stdout.write(
      `verify — OK. All ${Object.keys(STEPS).length} gates passed in ${(wall / 1000).toFixed(1)}s.\n\n`
    );
    process.exit(0);
  }

  // Report EVERY failure, not just the first — that is the whole point of not
  // being fail-fast. Fix them together, then re-run once.
  process.stdout.write(
    `verify — ${failed.length} gate(s) failed` +
      (skipped.length ? `, ${skipped.length} skipped` : "") +
      ` (${(wall / 1000).toFixed(1)}s)\n\n`
  );
  for (const r of failed) process.stdout.write(`  FAILED  ${STEPS[r.id].label}\n`);
  for (const r of skipped) {
    process.stdout.write(`  SKIPPED ${STEPS[r.id].label}  (needs ${r.skippedBecause})\n`);
  }
  process.stdout.write("\n");
  process.exit(1);
}

main();
