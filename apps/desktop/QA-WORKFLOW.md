# QA Workflow — design and rationale

**Date:** 2026-09-17
**Scope:** `apps/desktop` — the Next.js 14 / Tauri 2 desktop app.
**Related:** `AUDIT.md` (what was broken), `CONTRIBUTING.md` (how to work here).

Every number below was measured on this machine with the command shown. Where a
claim is a judgement rather than a measurement, it is marked *(inferred)*.

---

## 1. What was actually wrong

The app was not short of quality checks — it had seven of them, and all seven
passed. The problems were about **enforcement, feedback shape, and where the
checks were pointed**, not about their number.

### 1.1 The gates existed, but nothing enforced them

The seven gates lived in one npm script:

```
verify = typecheck && lint:ci && test:ci && check:coverage && check:versions && build:prod && check:tokens
```

That script was invoked by hand, on a developer's machine, and nowhere else. The
repository's only CI workflow was `.github/workflows/deno.yml`:

| Step | Command | What it actually checked |
| --- | --- | --- |
| Linter | `deno lint` | Deno's ruleset over the tree |
| Tests | `deno test -A` | **Nothing — there are no Deno tests in this repo** |

`deno test` matching zero files still exits 0. So a green check on a pull request
meant "deno lint was happy", and said nothing about whether the app typechecked,
whether its 525 tests passed, whether it built, or whether the design tokens
resolved.

**This was the single largest gap: the quality bar was real but unenforced.** A
contributor could merge a change that failed every gate.

### 1.2 `&&` is fail-fast, which multiplies the cost of a broken change

A `&&` chain stops at the first failure. That reads like efficiency and is the
opposite of it. Consider a change that breaks typecheck, lint, and one test:

| Run | Discovers | Wall clock |
| --- | --- | --- |
| 1 | typecheck | ~59 s |
| 2 | lint | ~56 s |
| 3 | test | ~55 s |
| | **total** | **~170 s to learn about three problems** |

Each run reveals exactly one problem, because each run stops at the first one.
Running every gate and reporting every failure collapses that into one run —
the saving is not seconds, it is **whole pipeline cycles**.

### 1.3 Coverage floors were averages, so individual files could hide

`scripts/check-coverage.mjs` enforced per-directory floors, aggregated by summing
covered/total counts. Averages hide outliers. Measured, at the time of writing:

```
  directory               statem  branch  functi   lines
  src/app                  95.00   89.72   84.21   95.96
  src/components           65.86   42.58   52.83   66.80   <- PASSED
  src/hooks                77.55   44.00   77.78   77.37
  src/lib                  66.80   52.06   59.51   67.81
```

`src/components` passed at 65.86% while **`AudioFileDownload.tsx` — 81
statements, ~400 lines, the entire audio generate/save panel — sat at 0%.** The
directory was green and the largest untested component in the app was invisible
in the report.

A second, related hole: `jest.config.js` excluded `src/app/**/*.tsx` from
coverage collection wholesale. That hid `LessonContent.tsx` (917 lines, with its
own suite) and `library/page.tsx` (covered by `library.test.tsx`) from the report
entirely — so the floors could not have caught a regression in either.

### 1.4 Risk was misallocated

Measured with `npm run test:ci`, sorted by statements:

| File | Stmts | Branches | Why it matters |
| --- | --- | --- | --- |
| `components/AudioFileDownload.tsx` | **0** | 0 | the audio save/generate panel |
| `lib/ai-runtime/providers/lmStudio.ts` | 30.8 | 14.1 | **the primary runtime** |
| `lib/ai-runtime/runtime.ts` | 30.5 | 42.1 | the runtime seam |
| `lib/ai-runtime/providers/ollama.ts` | 22.7 | 15.0 | a supported provider |
| `lib/generation/podcast.ts` | 18.6 | 0 | podcast generation |
| `lib/evaluation.ts` | 8.3 | 0 | quiz scoring |

Meanwhile `src/lib/skills/definitions/*` sat at 100% across the board, and
`AIRuntimeProvider` at 100%. The pattern is that the **easy, pure, presentational
code was thoroughly tested and the architectural core — the AI runtime, which
`MEMORY.md` calls the one rule you must not violate — was the least tested part
of the app** *(inferred: this is the natural consequence of pure functions being
cheap to test and I/O seams being expensive, not a deliberate choice)*.

Coverage percentage alone does not capture this. 66.83% overall sounds
acceptable; "the primary runtime is 30% tested" does not.

### 1.5 Feedback arrived in the wrong order

Of the seven gates, `check:versions` is the cheapest (~1 s) and ran **fifth**.
A version-manifest mismatch therefore cost ~40 s of unrelated typechecking,
linting and testing before it was reported. Cheap gates should fail first.

---

## 2. The target workflow

Four stages, each with a different cost budget and a different job.

| Stage | When | Budget | Gates | Purpose |
| --- | --- | --- | --- | --- |
| **0. Pre-commit** | on commit | ~5 s | lint + typecheck staged files | catch trivia before it enters history |
| **1. Local verify** | before push | ~53 s | all 7, in parallel | the full bar, one command |
| **2. PR CI** | on push / PR | ~40 s | all 7, in 3 parallel jobs | **enforcement** — blocking |
| **3. Nightly** | daily | minutes | live LM Studio integration | what CI cannot reach |

### Stage 0 — `.githooks/pre-commit`

Enabled per clone with `git config core.hooksPath .githooks`. Lints only the
staged TypeScript files (whole-project lint belongs in CI) and then typechecks,
which is whole-project by nature and catches what a file-scoped lint cannot.

It is deliberately **not** the full pipeline: `npm run verify` costs ~53 s and
belongs before a push. It is also bypassable with `--no-verify`, because CI runs
everything regardless and a hook that cannot be bypassed just gets disabled.

### Stage 1 — `npm run verify`

Replaces the `&&` chain with `scripts/verify.mjs`, which runs the gates in
dependency waves and **reports every failure rather than the first**:

```
wave 1 (parallel)  versions, typecheck, lint, test      <- independent
wave 2 (parallel)  coverage (needs test), build         <- depend on wave 1
wave 3             tokens (needs build)
```

The waves are not stylistic. `check:coverage` reads the summary `test:ci` writes,
and `check:tokens` reads the CSS `build:prod` emits — those edges are real and
cannot be flattened. `npm run verify:serial` runs the identical gates one at a
time for low-RAM machines.

### Stage 2 — `.github/workflows/ci.yml`

Three jobs, because GitHub runs them on **separate machines** — genuine
parallelism with no CPU contention:

| Job | Gates |
| --- | --- |
| `static` | typecheck, lint:ci, check:versions |
| `test` | test:ci, check:coverage |
| `build` | build:prod, check:tokens |

`concurrency` cancels superseded runs so a stale result cannot land after a newer
one. Dependencies install with `npm ci` against the committed lockfile, so a
drifted lockfile fails rather than being silently rewritten.

### Stage 3 — nightly

The remaining gap CI cannot close: everything requiring the real runtime. The
repo already has the seam — `LMSTUDIO_LIVE=1 npx jest src/lib/ai-runtime/__tests__/lmStudio.live.test.ts`
is hermetic without the env var. Running it nightly with a real LM Studio
instance is what would raise `lmStudio.ts` from 30% against actual behaviour
rather than mocks.

---

## 3. What changed

| File | Change |
| --- | --- |
| `scripts/verify.mjs` | **new** — parallel, fail-all pipeline runner |
| `package.json` | `verify` → the runner; added `verify:serial` |
| `.github/workflows/ci.yml` | **new** — the 7 gates, enforced on push/PR |
| `.githooks/pre-commit` | **new** — Stage 0: staged-file lint + typecheck |
| `scripts/check-coverage.mjs` | added per-file floors, a zero-coverage rule, and an explicit waiver list |
| `jest.config.js` | narrowed `!src/app/**/*.tsx` to `page.tsx` / `layout.tsx` only |
| `src/app/lesson/__tests__/LessonContent.test.tsx` | 28 → 75 tests (the safety net for the 5.2 split) |
| `src/components/__tests__/AudioFileDownload.test.tsx` | **new** — 56 tests, closing the 0% gap |
| `src/lib/__tests__/evaluation.test.ts` | **new** — 32 tests, 8.33% → 100% statements |
| `src/lib/generation/__tests__/podcast.test.ts` | **new** — 37 tests, 18.64% → 98.3% statements |
| `src/lib/ai-runtime/__tests__/lmStudio.test.ts` | **new** — 51 tests, 30.76% → 85.52% statements |
| `src/lib/ai-runtime/__tests__/providerStore.test.ts` | **new** — 28 tests, 36.53% → 100% statements |
| `src/lib/ai-runtime/__tests__/ollama.test.ts` | **new** — 40 tests, 22.72% → 100% statements |
| `src/lib/ai-runtime/__tests__/providerProbe.test.ts` | **new** — 26 tests, 12.24% → 95.91% statements |
| `src/lib/ai-runtime/__tests__/runtime.test.ts` | **new** — 65 tests, 30.53% → 100% statements |
| `src/components/AudioFileDownload.tsx` | added `data-testid="audio-element"` (test affordance only) |

Stage 0 is opt-in per clone (`git config core.hooksPath .githooks`) — the repo
does not rewrite anyone's git config for them, and the hook is bypassable with
`--no-verify` because CI runs the full pipeline regardless.

The coverage guard now has three layers, weakest to strongest:

1. **Per-directory floors** — catches a whole area rotting.
2. **Per-file floors** (`FILE_FLOORS`) — catches one critical file rotting inside
   a healthy directory. Currently `LessonContent.tsx`.
3. **A zero-coverage rule** — any file ≥ 20 statements with 0 covered statements
   fails, unless it is named in `UNTESTED_FILES` with a written reason.

The waiver list is the interesting part. "We are not testing this" is a decision,
so it is written down, printed on **every run**, and reviewed — rather than being
inferred from a size cutoff and forgotten. It currently holds three entries, one
of which is a tracked gap rather than an intentional omission.

---

## 4. Measured results

### Pipeline wall clock

Warm caches, same machine, same commit:

| Pipeline | Wall clock |
| --- | --- |
| Serial, 7 gates | **59.3 s** |
| Parallel, 7 gates | **52.9 s** |

**~11%, not the 2× that parallelising a 7-step pipeline suggests** — and it is
worth being precise about why, because the naive arithmetic is misleading:

- The pipeline is dominated by `build` (~30 s) and `test` (~18 s), which are
  inherently heavy and partly CPU-bound.
- Under concurrency, each of `typecheck` (2.6 → 3.9 s), `lint` (4.9 → 8.2 s) and
  `test` (18.3 → 20.7 s) got **slower**, because they compete for the same cores.
  Wave 1 costs `max(...)` ≈ 20.7 s instead of the serial sum ≈ 26.8 s.

So the wall-clock win is real but modest. The parallel runner earns its place on
two other things:

- **Fail-all instead of fail-fast** — the N-runs-per-N-problems multiplier from
  §1.2 disappears. This is the larger win and it does not show up in wall clock.
- **Ordering** — cheap gates fail first, so a version mismatch is reported in 1 s
  rather than after 40 s.

CI gets a better deal than local parallelism, because the three jobs land on
three separate runners: wall clock ≈ `max(static, test, build)` ≈ 35–40 s
including installs, with no contention.

### Coverage

| Metric | Before | After |
| --- | --- | --- |
| `LessonContent.tsx` | 68.63 / 58.41 / 39.47 / 72.72 | **95.00 / 89.71 / 84.21 / 95.95** |
| `AudioFileDownload.tsx` | **0 / 0 / 0 / 0** | **95.06 / 95.02 / 79.41 / 97.36** |
| `lib/evaluation.ts` | 8.33 / 0 / 0 / 8.69 | **100 / 76.71 / 100 / 100** |
| `lib/generation/podcast.ts` | 18.64 / 0 / 0 / 18.64 | **98.30 / 87.71 / 100 / 98.30** |
| `ai-runtime/providers/lmStudio.ts` | 30.76 / 14.07 / 38.77 / 32.79 | **85.52 / 79.39 / 85.71 / 88.70** |
| `ai-runtime/runtime.ts` | 30.53 / 42.10 / 35.48 / 30.76 | **100 / 91.44 / 100 / 100** |
| `ai-runtime/providerStore.ts` | 36.53 / 10.52 / 33.33 / 38.09 | **100 / 94.73 / 100 / 100** |
| `ai-runtime/providers/ollama.ts` | 22.72 / 15.15 / 31.81 / 23.33 | **100 / 98.33 / 100 / 100** |
| `ai-runtime/providerProbe.ts` | 12.24 / 0 / 0 / 13.95 | **95.91 / 94.11 / 91.66 / 97.67** |
| `src/components` (directory) | 65.86 / 42.58 / 52.83 / 66.80 | **79.20 / 68.10 / 69.81 / 81.25** |
| `src/lib` (directory) | 64.46 / 51.04 / 56.61 / 65.05 | **83.95 / 73.29 / 76.71 / 85.20** |
| Tests | 450 | **860** |
| Suites | 33 | **42** |
| Gated directories | 3 | **4** (`src/app` was invisible) |
| Per-file floors | 0 | **9** |

The files were chosen for what they protect, not for how easy they were to test:

- **`AudioFileDownload.tsx`** was the largest untested component and the clearest
  illustration of why directory averages are not enough: `src/components` passed
  at 65.86% with an 81-statement file at zero inside it.
- **`lib/evaluation.ts`** decides a student's score. Its four result paths
  (runtime offline, model unresolvable, AI evaluation, local fallback) are
  exactly the kind of parallel routes that drift apart unnoticed.
- **`lib/generation/podcast.ts`** is the chunking loop, and the entire design
  rests on "every individual call stays small enough to pass strict
  validation" — so its suite uses the *real* validators rather than mocks. A
  suite with stubbed validators could not prove the thing chunking exists for.
- **`ai-runtime/providers/lmStudio.ts`** is the primary runtime. This one
  corrects an earlier claim in this document (§1.4) that it "needs the live
  lane, not unit tests" — that was wrong. Most of what is hard-won there is pure
  logic over response *shapes*: which listing API a server speaks, whether an
  entry is an embedding model, how large a context window to request. Those were
  decisions made by reading LM Studio's docs, and a mock pins them exactly.

---

## 5. Policy

These are the rules that keep the workflow from decaying.

1. **Never lower a floor to make a build pass.** Raise it as coverage grows. If a
   floor is genuinely wrong, change it deliberately and say why in the comment.
2. **`coverageThreshold.global` in `jest.config.js` must stay the only key
   there.** Layered floors belong in `check-coverage.mjs`; the long comment in
   that file explains why Jest's `global` is not "all files".
3. **A waiver is a signed exception, not a shortcut.** Prefer writing the test.
   Every waiver prints on every run, so none can quietly become permanent.
4. **Zero lint warnings, no `eslint-disable` to get there.** Fix the cause, or
   use `src/lib/logger.ts` for intentional output.
5. **A pure refactor changes no test.** If a test needed editing, the refactor
   was not pure — find out what actually changed.

---

## 6. Remaining gaps

Honest list, highest value first.

1. **`deno.yml` is a false green.** `deno test -A` finds no tests and exits 0.
   Either delete it or replace it with the desktop workflow as the required
   check. *Deliberately left in place pending a decision — removing CI config is
   not a call to make unilaterally.*
2. **The AI runtime is now covered at the file level, but only one test is
   integration-shaped.** Every runtime file has a floor — `runtime.ts` 100%,
   `ollama.ts` 100%, `providerStore.ts` 100%, `providerProbe.ts` 95.9%,
   `lmStudio.ts` 85.5% — but each was reached with mocked I/O, so nothing yet
   exercises a real provider end to end. That is what the nightly live lane is
   for, and it is a workflow decision (where it runs, with what runtime
   available) rather than a coding one.
3. **No mutation testing.** Nothing verifies that the 701 tests would actually
   fail if the code were wrong. This is not hypothetical: four separate times
   during this work a test was green while proving nothing — a mid-download
   guard that passed for the wrong reason, two helper functions that collapsed
   distinct stage lists or skipped the path they named, and a set of
   `context_length` assertions pointed at `loadModel` when the cap is applied in
   `ensureModel`, so they asserted `undefined` against `undefined`.
4. **No bundle-size budget.** `npm run analyze` exists but nothing fails on
   regression.
5. **Five latent defects are pinned by tests rather than fixed**, each with a
   `NOTE — latent` comment at the assertion:
   - podcast host gender always resolves to `"male"`, because it is derived with
     `voice.includes("female")` and no real Piper voice id contains that string;
   - the save button stays enabled while the save dialog is open, so it can be
     clicked twice and open two dialogs;
   - `evaluateQuiz`'s AI path discards the model's per-question `explanation`
     even though `EvaluationResult` types it as required, and truncates the
     result to the model's array length;
   - `generatePodcastChunked`'s `maxChunks` bound is **unreachable dead code** —
     the chunk schema requires ≥2 lines and the bound allows exactly enough
     chunks to reach the target at 2 lines each, so it can never fire;
   - `loadModel` silently omits `context_length` when its caller does not supply
     one, which is easy to misread as "the cap was applied".

   These are recorded, not resolved. Fixing any of them means updating its test
   on purpose, which is the point.
