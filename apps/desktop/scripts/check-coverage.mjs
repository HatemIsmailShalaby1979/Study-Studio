#!/usr/bin/env node
// Per-directory coverage floors.
//
// Why this is not in jest.config.js: Jest's `coverageThreshold.global` is not
// "all files". Reading @jest/reporters/CoverageReporter.js, every covered file
// is matched against each non-global key first, and only files matching NONE of
// them land in the global bucket:
//
//     if (pathOrGlobMatches.length > 0) return files.concat(pathOrGlobMatches);
//     if (thresholdGroups.indexOf('global') > -1) { ...global bucket... }
//
// Adding `src/lib/**` + `src/components/**` therefore left `global` holding only
// the leftover files (here: one 0%-covered hooks file) and Jest reported
// "global threshold not met: 0%" while the true global figure was 57.66%.
//
// So: Jest keeps the single overall gate, and this script adds the layered one.
//
// Usage:
//   npm run test:ci          # writes coverage/coverage-summary.json
//   npm run check:coverage   # enforces the floors below
//
// Exits 0 when every tracked directory meets its floor, 1 otherwise.

import { readFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SUMMARY = join(ROOT, "coverage", "coverage-summary.json");

/**
 * Minimum coverage per directory, as percentages.
 *
 * Set a few points below the measured value so ordinary refactoring does not
 * trip them while a real loss of coverage does. Raise them as coverage grows;
 * never lower one to make a build pass.
 *
 * A directory with no entry is reported as UNTRACKED rather than silently
 * ignored — a gap that is invisible is a gap that stays.

 * which is deliberately stricter than Jest's text table. That table prints one
 * row per directory containing only the files *directly* in it, so `lib` there
 * reads 68.33 while the true rollup is 64.46 — the difference being the
 * subdirectories. Enforcing the rollup means an untested subdirectory cannot
 * hide behind a well-covered parent.
 *
 * Measured when written: src/lib 64.46/51.04/56.61/65.05,
 * src/components 42.45/32.33/33.77/43.00.
 *
 * src/hooks sat at a deliberate { 0, 0, 0, 0 } placeholder while it had no
 * tests at all — a floor of zero is not a floor. It now has one: plan item 2.4
 * added `useLessonPersistence` and `useMetacognitive` suites (both 100%
 * statements) and extended the pipeline suite, taking the directory to
 * 77.55/44.00/77.78/77.37 measured. The low branch figure is honest — the
 * pipeline hook's Tauri/provider I/O paths are unreachable in jsdom.
 */
const FLOORS = {
  // Raised as the directory improved: 62/49/54/62 -> 64/51/57/65 (evaluation.ts)
  // -> 67/55/60/68 (generation/podcast.ts) -> 71/60/63/72 (ai-runtime/lmStudio.ts)
  // -> 76/66/69/77 (providerStore + ollama + providerProbe) -> 80/70/73/81
  // (ai-runtime/runtime.ts). Measured 83.95/73.29/76.71/85.20. Every AI-runtime
  // file now has a floor of its own; what remains untested is integration, not
  // unit coverage — see the remaining-gaps list in QA-WORKFLOW.md.
  "src/lib": { statements: 80, branches: 70, functions: 73, lines: 81 },
  // Raised from 40/30/31/40 after AudioFileDownload.tsx got a suite: the
  // directory went 65.86/42.58/52.83/66.80 -> 79.20/68.10/69.81/81.25. Leaving
  // the old floor would have let that component regress back to 0% unnoticed,
  // which is exactly the failure mode the per-file floors exist to prevent.
  "src/components": { statements: 74, branches: 63, functions: 65, lines: 76 },
  "src/hooks": { statements: 72, branches: 38, functions: 72, lines: 72 },
  // src/app was previously excluded wholesale from coverage collection by
  // `!src/app/**/*.tsx` in jest.config.js, which hid `LessonContent.tsx` (917
  // lines with its own suite) from the report entirely. That exclusion is now
  // narrowed to just `page.tsx` / `layout.tsx` shells, so this directory is
  // measured and gated. Measured when added: 95.00/89.72/84.21/95.96 — almost
  // all of it is LessonContent.tsx, whose remaining dark lines are the four
  // ternary arms and the two voice-select onChange handlers.
  "src/app": { statements: 88, branches: 80, functions: 78, lines: 89 },
};

const METRICS = ["statements", "branches", "functions", "lines"];

/**
 * Per-file floors for files whose coverage is load-bearing.
 *
 * Directory floors are AVERAGES, so a large untested file hides inside a
 * directory that still meets its floor. That is not hypothetical here:
 * `AudioFileDownload.tsx` (81 statements, ~400 lines, renders the whole audio
 * save/generate panel) sat at 0% while `src/components` passed its floor on the
 * strength of the other eleven components. The directory was green and the
 * single biggest untested component in the app was invisible.
 *
 * Set these just under the measured value, same as the directory floors.
 */
const FILE_FLOORS = {
  "src/app/lesson/LessonContent.tsx": { statements: 88, branches: 82, functions: 78, lines: 89 },
  "src/components/AudioFileDownload.tsx": { statements: 90, branches: 88, functions: 74, lines: 92 },
  // Quiz grading. A bug here misgrades the student directly, and it was at
  // 8.33% before it had a suite — the four result paths (runtime offline, model
  // unavailable, AI evaluation, local fallback) are exactly the kind of thing
  // that drifts apart silently. Measured: 100/76.71/100/100.
  "src/lib/evaluation.ts": { statements: 95, branches: 70, functions: 95, lines: 95 },
  // The chunked podcast generator — title, dialogue chunks, then glossary and
  // quiz. Was 18.64%; the chunking loop is the part that matters, because the
  // whole design rests on "every call stays small enough to pass strict
  // validation". Measured: 98.3/87.71/100/98.3.
  "src/lib/generation/podcast.ts": { statements: 94, branches: 82, functions: 95, lines: 94 },
  // The PRIMARY runtime, and formerly the least-tested file in the app (30.76%).
  // The earlier note claiming it "needs the live lane, not unit tests" was wrong:
  // most of it is pure logic over response shapes — which listing API a server
  // speaks, whether an entry is an embedding model, how large a context window to
  // request — and that is exactly what a mock can pin. Measured in the full suite:
  // 85.52/79.39/85.71/88.70 (84.16 isolated, since sibling suites cover some paths).
  "src/lib/ai-runtime/providers/lmStudio.ts": { statements: 81, branches: 75, functions: 82, lines: 85 },
  // Settings persistence: the only thing between a user's API key and it
  // vanishing on restart. Written to never throw and to degrade to memory, and
  // defensive code is exactly the code whose failure modes go unnoticed.
  "src/lib/ai-runtime/providerStore.ts": { statements: 95, branches: 88, functions: 95, lines: 95 },
  // The Ollama adapter. A thin translation layer is precisely what needs tests:
  // a silent vocabulary mismatch (maxTokens -> num_predict) is invisible until a
  // request behaves oddly.
  "src/lib/ai-runtime/providers/ollama.ts": { statements: 95, branches: 92, functions: 95, lines: 95 },
  // Provider auto-detection, which runs on app mount before anything is wired
  // up. Its contract is "never throw, never block navigation", so every
  // degradation path is pinned. Was 12.24%.
  "src/lib/ai-runtime/providerProbe.ts": { statements: 90, branches: 88, functions: 85, lines: 92 },
  // The orchestration layer — provider routing, session model policy and
  // capability dispatch. This is the file the architecture rules in MEMORY.md
  // are about ("never branch on provider identity; branch on supports(...)"),
  // so selection and capability filtering are pinned as documented behaviour.
  // Was 30.53%. Measured in the full suite: 100/91.44/100/100.
  "src/lib/ai-runtime/runtime.ts": { statements: 95, branches: 87, functions: 95, lines: 95 },
};

/**
 * Files allowed to have NO coverage at all, each with the reason.
 *
 * This is deliberately an explicit list rather than a size threshold: "we are
 * not testing this" is a decision, so it gets written down and reviewed instead
 * of being inferred from a cutoff. Every entry prints on every run, so a waiver
 * cannot quietly become permanent.
 *
 * Adding an entry is not free — it is the QA equivalent of a signed exception.
 * Prefer writing the test; use this only when the file genuinely cannot be
 * exercised yet, and say why.
 */
const UNTESTED_FILES = {
  "src/components/MetacognitivePulse.tsx":
    "Leaf presentational pulse; its hook (useMetacognitive) is fully tested instead.",
  "src/lib/languageScaffold.ts":
    "Pure string tables with no branching; exercised through generation, which is itself a tracked gap.",
};

/**
 * Any file with at least this many statements must have at least one covered
 * statement. Small modules (a re-export barrel, a one-constant file) are exempt
 * because a single unexecuted line is noise there, not a gap.
 */
const MIN_FILE_STATEMENTS = 20;

/** `src/lib/ai-runtime/routing.ts` -> `src/lib` */
function directoryOf(absPath) {
  const rel = relative(ROOT, absPath).split(sep).join("/");
  const parts = rel.split("/");
  // Only bucket things under src/; anything else (scripts, configs) is ignored.
  if (parts[0] !== "src") return null;
  if (parts.length < 2) return null;
  return `src/${parts[1]}`;
}

function main() {
  if (!existsSync(SUMMARY)) {
    console.error(
      "check:coverage — no coverage/coverage-summary.json found.\n" +
        "Run `npm run test:ci` first (it writes the summary)."
    );
    process.exit(1);
  }

  const summary = JSON.parse(readFileSync(SUMMARY, "utf8"));

  // Aggregate by summing covered/total counts. Averaging the per-file
  // percentages would weight a 1-line file the same as a 900-line one.
  const dirs = new Map();
  for (const [file, data] of Object.entries(summary)) {
    if (file === "total") continue;
    const dir = directoryOf(file);
    if (!dir) continue;
    if (!dirs.has(dir)) {
      dirs.set(
        dir,
        Object.fromEntries(METRICS.map((m) => [m, { covered: 0, total: 0 }]))
      );
    }
    const bucket = dirs.get(dir);
    for (const metric of METRICS) {
      bucket[metric].covered += data[metric]?.covered ?? 0;
      bucket[metric].total += data[metric]?.total ?? 0;
    }
  }

  const pct = (m) => (m.total === 0 ? 100 : (m.covered / m.total) * 100);
  const fmt = (n) => n.toFixed(2).padStart(6);

  const failures = [];
  const untracked = [];

  console.log("\nPer-directory coverage floors\n");
  console.log(
    `  ${"directory".padEnd(22)}${METRICS.map((m) => m.slice(0, 6).padStart(8)).join("")}`
  );
  console.log(`  ${"-".repeat(22 + METRICS.length * 8)}`);

  for (const dir of [...dirs.keys()].sort()) {
    const bucket = dirs.get(dir);
    const floor = FLOORS[dir];
    const cells = METRICS.map((m) => {
      const value = pct(bucket[m]);
      const failed = floor && value < floor[m];
      return (failed ? `!${fmt(value)}` : ` ${fmt(value)}`).padStart(8);
    });
    const mark = floor ? "  " : "  (untracked)";
    console.log(`  ${dir.padEnd(22)}${cells.join("")}${mark}`);

    if (!floor) {
      untracked.push(dir);
      continue;
    }
    for (const metric of METRICS) {
      const value = pct(bucket[metric]);
      if (value < floor[metric]) {
        failures.push(
          `${dir} ${metric}: ${value.toFixed(2)}% < ${floor[metric]}% floor`
        );
      }
    }
  }

  if (untracked.length > 0) {
    console.log(
      `\n  No floor set for: ${untracked.join(", ")}. ` +
        "Add one to FLOORS in scripts/check-coverage.mjs once they have coverage."
    );
  }

  // --- Per-file checks -----------------------------------------------------
  // Directory floors catch a whole area rotting; these catch one file hiding.
  console.log("\nPer-file floors and uncovered-file check\n");

  const fileFailures = [];
  const zeroCovered = [];

  for (const [file, data] of Object.entries(summary)) {
    if (file === "total") continue;
    const rel = relative(ROOT, file).split(sep).join("/");
    const stmts = data.statements;

    const floor = FILE_FLOORS[rel];
    if (floor) {
      const cells = METRICS.map((m) => {
        const value = data[m]?.pct ?? 0;
        return (value < floor[m] ? `!${fmt(value)}` : ` ${fmt(value)}`).padStart(8);
      });
      console.log(`  ${rel.padEnd(46)}${cells.join("")}`);
      for (const metric of METRICS) {
        const value = data[metric]?.pct ?? 0;
        if (value < floor[metric]) {
          fileFailures.push(`${rel} ${metric}: ${value.toFixed(2)}% < ${floor[metric]}% floor`);
        }
      }
    }

    // A file big enough to matter with zero executed statements is a gap, not
    // a rounding error — unless it is explicitly waived above.
    if (
      (stmts?.total ?? 0) >= MIN_FILE_STATEMENTS &&
      (stmts?.covered ?? 0) === 0 &&
      !UNTESTED_FILES[rel]
    ) {
      zeroCovered.push({ rel, total: stmts?.total ?? 0 });
    }
  }

  for (const { rel, total } of zeroCovered) {
    fileFailures.push(`${rel}: 0 of ${total} statements covered`);
  }

  const waived = Object.keys(UNTESTED_FILES).filter((rel) => {
    const key = Object.keys(summary).find((k) => relative(ROOT, k).split(sep).join("/") === rel);
    return key && (summary[key].statements?.covered ?? 0) === 0;
  });
  if (waived.length > 0) {
    console.log("\n  Waived (untested, see UNTESTED_FILES for the reason):");
    for (const rel of waived) console.log(`    ${rel}\n      ${UNTESTED_FILES[rel]}`);
  }
  if (fileFailures.length === 0) {
    console.log("\n  check:coverage — no file-level failures.");
  }

  failures.push(...fileFailures);

  if (failures.length > 0) {
    console.error(`\ncheck:coverage — ${failures.length} floor(s) not met:\n`);
    for (const f of failures) console.error(`  ${f}`);
    console.error("\nRaise coverage, or lower the floor deliberately and say why.");
    process.exit(1);
  }

  console.log(
    `\ncheck:coverage — OK. ${dirs.size - untracked.length} directory floor(s) met` +
      (untracked.length > 0 ? `, ${untracked.length} untracked.` : ".")
  );
  process.exit(0);
}

main();
