#!/usr/bin/env node
// Targeted mutation testing — does the suite actually detect broken code?
//
// WHY THIS EXISTS
//
// During the QA-workflow work, four separate tests were written that passed
// while proving nothing:
//
//   1. a mid-download guard that passed for the wrong reason until restructured
//   2. an AudioFileDownload helper that collapsed two DIFFERENT disabled-stage
//      lists into one, producing a failure that looked like a product bug
//   3. an evaluation helper that never passed a model, so the code path it was
//      named for was skipped and the AI path ran instead
//   4. three context_length assertions pointed at `loadModel` when the cap is
//      applied in `ensureModel`, so they compared undefined to undefined
//
// Coverage cannot detect any of those. A line can be executed by a test that
// asserts nothing about it. Mutation testing is the only cheap way to ask the
// question that actually matters: if I break this line, does anything fail?
//
// HOW IT WORKS
//
// Each MUTATION below is a small, semantic change to a line whose behaviour the
// suite claims to pin. For each one:
//
//   - apply the mutation to the source file
//   - run only the focused test file(s) that should catch it
//   - the test run MUST fail
//   - restore the file
//
// A mutation that leaves the suite GREEN is a SURVIVOR: the suite does not
// actually pin that behaviour. Survivors are reported as failures, because a
// test that cannot fail is worse than no test — it advertises safety it does
// not provide.
//
// WHY NOT STRYKER
//
// Stryker mutates everything, which needs a full-suite run per mutant and tens
// of minutes. This harness is the opposite trade: ~12 hand-picked mutations on
// the behaviours that were explicitly pinned during the audit, each running one
// focused test file. It finishes in well under a minute and is honest about
// being a sample, not a proof — it answers "are the pinned behaviours really
// pinned?", not "is the suite 100% mutant-complete".
//
// USAGE
//
//   npm run check:mutations
//
// Exits 0 when every mutation is caught, 1 when any survives.
//
// SAFETY
//
// This script WRITES to source files. Every mutation is restored in a `finally`,
// and a SIGINT/SIGTERM handler restores the in-flight file before exiting, so an
// interrupted run cannot leave mutated source on disk. It refuses to start if
// the working tree has uncommitted changes to the files it mutates.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/**
 * Each mutation names the behaviour it should break. `find` must appear exactly
 * once in the file — if it appears zero times the source has drifted and the
 * mutation is STALE, which is also a failure (it means this harness has stopped
 * testing what it claims).
 */
const MUTATIONS = [
  {
    id: "runtime-select-provider-every-to-some",
    file: "src/lib/ai-runtime/runtime.ts",
    why: "selectProvider must require ALL capabilities, not merely one",
    find: "if (p && required.every((c) => supports(p.capabilities(), c))) return p;\n    }\n\n    if (this.config.defaultProviderId) {",
    replace: "if (p && required.some((c) => supports(p.capabilities(), c))) return p;\n    }\n\n    if (this.config.defaultProviderId) {",
    tests: ["src/lib/ai-runtime/__tests__/runtime.test.ts"],
  },
  {
    id: "runtime-ignore-session-incapable-provider",
    file: "src/lib/ai-runtime/runtime.ts",
    why: "a session-pinned provider that cannot serve the request must be skipped",
    find: "      const p = this.providers.get(sessionProviderId);\n      if (p && required.every((c) => supports(p.capabilities(), c))) return p;",
    replace: "      const p = this.providers.get(sessionProviderId);\n      if (p) return p;",
    tests: ["src/lib/ai-runtime/__tests__/runtime.test.ts"],
  },
  {
    id: "evaluation-round-to-floor",
    file: "src/lib/evaluation.ts",
    why: "the local score rounds rather than truncates (1/3 is 33, 2/3 is 67)",
    find: "  const overallScore = total > 0 ? Math.round((correctCount / total) * 100) : 0;\n\n  return {\n    overallScore,",
    replace: "  const overallScore = total > 0 ? Math.floor((correctCount / total) * 100) : 0;\n\n  return {\n    overallScore,",
    tests: ["src/lib/__tests__/evaluation.test.ts"],
  },
  {
    id: "evaluation-excellent-threshold",
    file: "src/lib/evaluation.ts",
    why: "the excellent rating boundary is 80, not 81",
    find: 'rating: overallScore >= 80 ? "excellent" : overallScore >= 60 ? "good" : overallScore >= 40 ? "fair" : "needs_review",\n    feedback: `You scored',
    replace: 'rating: overallScore >= 81 ? "excellent" : overallScore >= 60 ? "good" : overallScore >= 40 ? "fair" : "needs_review",\n    feedback: `You scored',
    tests: ["src/lib/__tests__/evaluation.test.ts"],
  },
  {
    id: "evaluation-drops-incorrect-answer-text",
    file: "src/lib/evaluation.ts",
    why: "an incorrect answer's explanation must name the correct option text",
    find: '        : `Incorrect. The correct answer was "${q.correctAnswerText}". ${q.explanation}`,',
    replace: "        : `Incorrect. ${q.explanation}`,",
    tests: ["src/lib/__tests__/evaluation.test.ts"],
  },
  {
    id: "podcast-chunk-size-uncapped",
    file: "src/lib/generation/podcast.ts",
    why: "each chunk requests at most PODCAST_CHUNK_LINES lines",
    find: "    const count = Math.min(PODCAST_CHUNK_LINES, target - script.length);",
    replace: "    const count = target - script.length;",
    tests: ["src/lib/generation/__tests__/podcast.test.ts"],
  },
  {
    id: "podcast-context-cap-removed",
    file: "src/lib/generation/podcast.ts",
    why: "the exchange target is clamped to 60 so a huge request cannot run away",
    find: "  return Math.max(8, Math.min(60, raw));",
    replace: "  return Math.max(8, raw);",
    tests: ["src/lib/generation/__tests__/podcast.test.ts"],
  },
  {
    id: "lmstudio-context-cap-removed",
    file: "src/lib/ai-runtime/providers/lmStudio.ts",
    why: "the auto-requested context is capped at MAX_AUTO_CONTEXT",
    find: "      return Math.min(max, MAX_AUTO_CONTEXT);",
    replace: "      return max;",
    tests: ["src/lib/ai-runtime/__tests__/lmStudio.test.ts"],
  },
  {
    id: "lmstudio-embedding-filter-removed",
    file: "src/lib/ai-runtime/providers/lmStudio.ts",
    why: "embedding models must not be recommended for generation",
    find: "    const chatCapable = all.filter((m) => !this.isEmbeddingModel(m.id));",
    replace: "    const chatCapable = all;",
    tests: ["src/lib/ai-runtime/__tests__/lmStudio.test.ts"],
  },
  {
    id: "providerstore-skips-trim",
    file: "src/lib/ai-runtime/providerStore.ts",
    why: "stored keys are trimmed before being persisted",
    find: "    next.apiKey = cfg.apiKey ? cfg.apiKey.trim() : undefined;",
    replace: "    next.apiKey = cfg.apiKey ? cfg.apiKey : undefined;",
    tests: ["src/lib/ai-runtime/__tests__/providerStore.test.ts"],
  },
  {
    id: "providerstore-undefined-clears",
    file: "src/lib/ai-runtime/providerStore.ts",
    why: "an omitted field is a no-op, not a wipe",
    find: "  if (cfg.apiKey !== undefined) {",
    replace: "  if (true) {",
    tests: ["src/lib/ai-runtime/__tests__/providerStore.test.ts"],
  },
  {
    id: "ollama-maxtokens-not-mapped",
    file: "src/lib/ai-runtime/providers/ollama.ts",
    why: "maxTokens collapses onto Ollama's num_predict",
    find: "    num_predict: options.maxTokens ?? options.max_tokens,",
    replace: "    num_predict: undefined,",
    tests: ["src/lib/ai-runtime/__tests__/ollama.test.ts"],
  },
  {
    id: "providerprobe-any-url-answers",
    file: "src/lib/ai-runtime/providerProbe.ts",
    why: "a target is up when ANY candidate URL answers",
    find: "      const up = urlResults.some(Boolean);",
    replace: "      const up = urlResults.every(Boolean);",
    tests: ["src/lib/ai-runtime/__tests__/providerProbe.test.ts"],
  },
  {
    id: "lessoncontent-podcast-script-guard",
    file: "src/app/lesson/LessonContent.tsx",
    why: "an undefined podcastScript must not overwrite an existing one",
    find: "      if (result.podcastScript) {\n        void persistence.updatePodcastScript(lesson, result.podcastScript);\n      }",
    replace: "      void persistence.updatePodcastScript(lesson, result.podcastScript);",
    tests: ["src/app/lesson/__tests__/LessonContent.test.tsx"],
  },
  {
    id: "audiofiledownload-reseed-guard",
    file: "src/components/AudioFileDownload.tsx",
    why: "a temp path that already matches the stored path is not re-reported",
    find: "    if (tempPath && tempPath !== audioPath) {",
    replace: "    if (tempPath) {",
    tests: ["src/components/__tests__/AudioFileDownload.test.tsx"],
  },
];

const JEST = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "jest.cmd" : "jest");

let inFlight = null;

/** Put the original bytes back. Safe to call repeatedly. */
function restore() {
  if (!inFlight) return;
  writeFileSync(inFlight.path, inFlight.original);
  inFlight = null;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    restore();
    process.stderr.write(`\ncheck:mutations — interrupted; restored ${inFlight?.rel ?? "no files"}\n`);
    process.exit(130);
  });
}

/**
 * Refuse to run over uncommitted changes to the files we are about to rewrite.
 * Restoring from a snapshot would otherwise silently discard the user's edits.
 */
function assertClean(files) {
  const dirty = [];
  for (const rel of files) {
    const out = spawnSync("git", ["status", "--porcelain", "--", rel], {
      cwd: ROOT,
      encoding: "utf8",
    });
    // A brand-new file shows as `??`; that is fine (there is nothing to lose),
    // but a modified tracked file is not.
    const line = (out.stdout ?? "").trim();
    if (line && !line.startsWith("??")) dirty.push(rel);
  }
  if (dirty.length > 0) {
    console.error(
      "check:mutations — refusing to run: these files have uncommitted changes\n" +
        "                  and would be restored from a snapshot mid-run:\n" +
        dirty.map((f) => `                    ${f}`).join("\n") +
        "\n                  Commit or stash them first.\n"
    );
    process.exit(2);
  }
}

function runTests(tests) {
  const res = spawnSync(JEST, ["--ci", "--silent", "--coverage=false", ...tests], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, CODEBUDDY_SAFE_DELETE_ENABLED: "0" },
    timeout: 180_000,
  });
  // `status` is null when the run timed out or was killed — treat as not-caught
  // rather than crashing, and say so.
  return { code: res.status, timedOut: res.status === null };
}

function main() {
  const files = [...new Set(MUTATIONS.map((m) => m.file))];
  assertClean(files);

  console.log(`\ncheck:mutations — ${MUTATIONS.length} targeted mutations\n`);

  const survivors = [];
  const stale = [];
  const errored = [];

  for (const m of MUTATIONS) {
    const path = join(ROOT, m.file);
    const original = readFileSync(path, "utf8");
    const occurrences = original.split(m.find).length - 1;

    if (occurrences !== 1) {
      // 0 = source drifted (harness is lying); >1 = ambiguous target.
      stale.push({ m, occurrences });
      console.log(`  STALE    ${m.id}  (pattern matched ${occurrences}×)`);
      continue;
    }

    inFlight = { path, rel: m.file, original };
    try {
      writeFileSync(path, original.replace(m.find, m.replace));
      const { code, timedOut } = runTests(m.tests);

      if (timedOut) {
        errored.push({ m, reason: "test run timed out" });
        console.log(`  ERROR    ${m.id}  (timed out)`);
      } else if (code === 0) {
        survivors.push(m);
        console.log(`  SURVIVED ${m.id}`);
      } else {
        console.log(`  caught   ${m.id}`);
      }
    } finally {
      restore();
    }
  }

  console.log("\n  " + "-".repeat(60) + "\n");

  if (survivors.length === 0 && stale.length === 0 && errored.length === 0) {
    console.log(
      `check:mutations — OK. All ${MUTATIONS.length} mutations were caught.\n` +
        `                  Every pinned behaviour is genuinely pinned.\n`
    );
    process.exit(0);
  }

  if (survivors.length > 0) {
    console.error(`check:mutations — ${survivors.length} SURVIVOR(S). These changes broke the`);
    console.error(`                  code and the suite still passed:\n`);
    for (const m of survivors) {
      console.error(`  ${m.id}`);
      console.error(`    file: ${m.file}`);
      console.error(`    this mutation should have been caught because ${m.why}`);
      console.error(`    tests that should have failed: ${m.tests.join(", ")}\n`);
    }
  }
  if (stale.length > 0) {
    console.error(`check:mutations — ${stale.length} STALE mutation(s). The source no longer`);
    console.error(`                  matches, so this harness is not testing what it claims:\n`);
    for (const { m, occurrences } of stale) {
      console.error(`  ${m.id}  (pattern matched ${occurrences}× in ${m.file})`);
    }
    console.error("");
  }
  if (errored.length > 0) {
    console.error(`check:mutations — ${errored.length} mutation(s) could not be evaluated:`);
    for (const { m, reason } of errored) console.error(`  ${m.id} — ${reason}`);
    console.error("");
  }

  process.exit(1);
}

main();
