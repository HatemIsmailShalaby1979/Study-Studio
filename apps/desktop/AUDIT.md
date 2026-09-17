# Study Studio — Ruthless Audit

**Date:** 2026-09-16
**Scope:** `E:\study-studio` — `apps/desktop` (Next.js 14 + Tauri 2), `apps/mobile` (Expo), `src-tauri` (Rust), root tooling and docs.
**Commit audited:** `8e7d61a`

Every finding below is backed by a command that was actually run. Where a claim is
inferred rather than measured, it is marked *(inferred)*.

---

## 0. Verdict

The AI-runtime layer is genuinely well built. The provider abstraction, the
capability model, the JSON-repair layer, and the session model policy are better
than most production code in this category. That is the good news, and it is real.

Everything around it is uneven. The design layer has 60+ utility classes that
compile to nothing. The app's central wiring component has 10% test coverage. The
Rust backend is hardcoded to Ollama, which is the one runtime the user does not
have installed. A second complete project (`deepseek-harness`, 11,262 files) sits
untracked inside the repo.

**Health score: 5.5 / 10.** It runs, tests pass, types are clean. It does not
currently do the thing it is being asked to do (run on LM Studio), and the visual
layer is partly broken in a way that is invisible to anyone who has not compared
the JSX against the compiled CSS.

### Measured baseline

| Check | Command | Baseline | After fixes |
| --- | --- | --- | --- |
| Types | `npx tsc --noEmit` | Pass — 0 errors | **Pass — 0 errors** |
| Tests | `npx jest --ci` | Pass — 189 passed, 1 skipped, 16 suites | **Pass — 880 passed, 0 skipped, 42 suites** |
| Lint | `npx next lint` | Pass with **33 warnings** | **Pass — 0 warnings, 0 errors** |
| Coverage | `npx jest --ci --coverage` | 48.65% stmts / 38.88% branch / 37.76% funcs | **84.07% / 73.06% / 76.85%** |
| Coverage gate | `jest.config.js` + `check-coverage.mjs` | Set to **25%** — 24 points below reality | **55% global, plus per-directory and per-file floors** |
| `AIRuntimeProvider` | `--coverage` | 10.52% stmts / **0% branch** | **100% stmts / 87.06% branch** |
| Build | `npx next build` | Pass | **Pass — 10/10 static pages, `out/` 4 MB → 1.6 MB** |
| Compiled CSS | `node scripts/check-tokens.mjs` | **7 utility classes emit 0 rules** | **Exit 0 — 20 utilities resolved** |
| Version drift | — | 4 manifests, no guard | **`check:versions` — all 4 at 0.2.0** |
| Live runtime | `LMSTUDIO_LIVE=1 npx jest …lmStudio.live` | *did not exist* | **Pass — 8/8 by default; 11/11 with `LMSTUDIO_LIVE_MODEL` set, which adds the real load/unload cycle** |
| Mutation testing | `npm run check:mutations` | *did not exist* | **Pass — 28/28 mutations caught; blocking in CI** |
| Latent defects | `grep -rn "NOTE — latent" src/` | **8 pinned by tests, 0 fixed** | **0 remaining — 7 fixed, 1 reclassified as a limitation** |
| **Tauri release build** | `npm run tauri:build` | *never run — Rust was assumed absent* | **Exit 0 — release profile in 6m 30s; NSIS + MSI installers produced; app launches and stays up** |

> **Correction (2026-09-17): the "Rust is not installed" claim in this audit was wrong.**
> It was inferred from `command -v cargo`. `cargo` is genuinely off PATH — `~/.cargo/bin`
> does not exist — but the toolchains *are* installed under `~/.rustup` (1.96.0, the version
> `src-tauri/rust-toolchain.toml` pins, plus stable), alongside VS 2022 with MSVC 14.44.35207,
> Windows SDK 10.0.26100.0 and WebView2 153.0.4234.32. `npm run tauri:build` therefore
> succeeds and produces both installers. Every statement below that the Rust side "cannot be
> compiled or verified here" is superseded by this row. The only real obstacle was that
> `vcvars64.bat` needs `cmd.exe`, which is blocked in this sandbox, so `INCLUDE`/`LIB`/`PATH`
> have to be assembled by hand from the discovered paths.

> Note on the lint number: the original 33-warning count was itself misleading.
> The config used the **base** `no-unused-vars` rule, which is not TypeScript-aware
> and therefore flagged every parameter in every interface method signature — 23
> false positives in `ai-runtime/types.ts` alone, plus 8 in `topicPipeline.ts`
> (which the audit had wrongly reported as a real "unfilled stub") and 8 in
> `error.ts`. Switching to `@typescript-eslint/no-unused-vars` took the count from
> **81 to 33** and made the remaining warnings real. All 33 are now fixed, and
> `npm run lint:ci` (`--max-warnings 0`) locks the floor at zero.

### Fix status

Implemented and verified in this pass:

| ID | Defect | Status |
| --- | --- | --- |
| P0-1 | 60+ token utilities compile to nothing | **Fixed** — 5 tokens added to `tailwind.config.ts`; 3 `.badge-*` classes added to `globals.css`; regression guard `scripts/check-tokens.mjs` wired to `npm run check:tokens` |
| P0-2 | App cannot run on LM Studio (Rust backend Ollama-only, `/v1` profile blind to unloaded models) | **Fixed (frontend)** — native `LMStudioProvider` with `loadModel`/`unloadModel`/`isModelLoaded`; auto-load on init and on model selection. **Rust command still unwritten, but no longer blocked** — the shell builds and runs (§0), so `start_lm_studio_if_needed` (3.8) is ordinary remaining work rather than something that cannot be attempted |
| P1-2 | `AIRuntimeProvider` 10.5% covered with a dead branch | **Fixed** — dead branch removed; logic extracted to `ai-runtime/routing.ts`; component now at **100% stmts / 87% branch** with 22 tests |
| P1-3 | Zero-coverage modules (`friendlyErrors`, `modelProfiler`, `voiceDiscovery`, `journeys`, …) | **Fixed** — `friendlyErrors` (21 tests), `modelProfiler` (17), `journeys` (23), `voiceDiscovery` (23) and `routing` (33) are covered, `hooks/` is off 0% (plan item 2.4), and every `src/` directory now has an enforced floor. No directory is reported as untracked by `check:coverage`. |
| P1-5 | `ollama.ts` bypasses the CORS-free transport | **Fixed** — both call sites now use `runtimeFetch` |
| P1-6 | `num_ctx` comment contradicts the code | **Fixed** — extracted to named constants with honest comments |
| P1-1 | Declared typeface never loaded; 134 KB of unused fonts | **Fixed** — removed the redundant `babel.config.js` that disabled SWC and blocked `next/font`; Inter + Geist Mono now self-hosted and verified in the export. `GeistVF.woff` left as a brand decision |
| P1-4 | `generation.ts` is a 1,580-line god module | **Partially addressed** — the exported-HTML font defect is fixed, but the module is not yet split (see Phase 5) |
| P2-2 | `npm run analyze` is broken | **Fixed** — `@next/bundle-analyzer` installed, wired in `next.config.mjs`, portable `scripts/analyze.mjs` wrapper |
| P2-3 | `.env.example` documents variables that are not read | **Fixed** — rewritten; documents that a static export drops non-`NEXT_PUBLIC_` vars |
| P2-5 | Production `no-unused-vars` warnings | **Fixed** — all dead variables removed; `topicPipeline.ts` and `error.ts` were false positives |
| P2-6 | Error mapping by substring sniffing at the UI edge | **Fixed** — `generate/page.tsx` now calls the existing `toFriendlyError`; auth is checked before localhost so a 401 is not reported as "server unreachable" |
| P2-4 | Design system has no enforcement | **Fixed** — `check:tokens` + `lint:ci` + `DESIGN.md` |
| — | Per-directory coverage floors were impossible in Jest | **Fixed** — `scripts/check-coverage.mjs` (`npm run check:coverage`) reads `coverage-summary.json` and enforces floors per directory, and *reports* directories with no floor yet so a gap cannot hide. Root cause in §0.1 |
| 3.5 | Probe LM Studio's native API | **Fixed** — the LM Studio probe now tries `/api/v1/models` first and falls back to `/v1/models` |
| 3.7 | Surface load state in the UI | **Fixed** — Settings shows a **Loaded** / **Downloaded** badge per model with Load/Unload actions, a busy state, and the cold-load expectation. The badge is only shown when the provider can actually report state; `undefined` renders nothing rather than a guess |
| 3.9 | Real model profiles so the Patriot Check can fire | **Fixed** — the check was already wired (`generate/page.tsx`); LM Studio now returns real `max_context_length` / `capabilities`, so it fires. A live test asserts `discover()` carries load state, since a regression there would silently remove the Settings badge |
| P2-11 | Documentation drift (Ollama-first docs, wrong audio prerequisites) | **Fixed** — `README.md`, `apps/desktop/README.md` and `docs/OFFLINE_SETUP.md` rewritten LM-Studio-first; `docs/AI_RUNTIME.md` and `DESIGN.md` now linked. `CHANGELOG.md`, `CONTRIBUTING.md` and the orphaned `ARCHITECTURE_AUDIT.md` remain open |
| — | Skills requested by the user | **Done** — 5 skill packs in `src/lib/skills/`, intent-routed, auto-bound at launch |
| — | Podcast path injected no skills | **Fixed** — `podcastChunkSystemPrompt` uses `applyForIntent(..., "podcast")` |
| 4.9 | `src/lib/skills.ts` re-export shim | **Not needed** — the file became a directory, so `@/lib/skills` resolves to `skills/index.ts` and every existing import (including tests) works unchanged |
| 4.12 | Per-skill toggles | **Fixed** — the single-override dropdown became per-skill toggle pills with an Auto/Custom badge and a Reset. First toggle leaves auto; an explicit choice always wins over the launch default |
| 4.13 | Assert injection into both system prompts | **Fixed** — `skillInjection.test.ts` (10 tests) asserts the assembled prompts: lesson carries education + open-lesson + humanizer, podcast carries podcast-ops + humanizer, the two sets genuinely differ, and each is resolved by intent rather than the session binding |
| P1-4 | `generation.ts` is a 1,580-line god module | **Partially addressed** — 1,580 → **1,469 lines**. The dead `getPodcastSystemPrompt` (132 lines, no production caller) was deleted; see the note below. The split into `prompts/`, `chunked.ts`, `retry.ts`, `html.ts` is still Phase 5 |

### Phase 5 — structural cleanup

| # | Item | Status |
| --- | --- | --- |
| 5.3 | `apps/mobile` decision | **Notice added, decision still owed.** `apps/mobile/README.md` now documents exactly what is wrong (no tests, Ollama-only, duplicated logic, and — the fatal one — `localhost` on a phone is the phone). It was **not** deleted or moved, because the root `package.json` references it via `install:mobile` / `typecheck:mobile`, so either action would break those scripts. That is a product decision, not a cleanup task. |
| 5.4 | `deepseek-harness` | **Resolved by ignoring.** 74,200 files with their own `.git/`, `.github/` and `CLAUDE.md`. Added to `.gitignore` with a note that its long-term home (sibling repo or submodule) is a separate decision. Also ignored `.claude/` and `.workbuddy-ai/` (local tooling state). |
| 5.7 | CSP `connect-src` narrowed | **Fixed** — `http://localhost:*` → the seven ports the app actually uses (11434, 1234, 8080, 3980, 8000, 4000, 21002). Verified to match `LOCAL_PROBE_TARGETS` exactly. See the caveat below. |
| 5.9 | Version reconcile + CHANGELOG | **Fixed** — all four manifests were already at 0.2.0 (the audit missed `Cargo.toml`); `check:versions` now guards against drift and is wired into `verify`. `CHANGELOG.md` refreshed, including correcting an entry that claimed the CSP was *widened*. |
| 5.11 | `.nvmrc` + `--max-warnings` in CI | **Fixed** — `.nvmrc` pins Node 22; `lint:ci` runs `--max-warnings 0`. |
| 5.12 | Move the 2.4 MB MP3 out of `public/` | **Fixed — and it was worse than described.** See the note below. `out/` dropped from ~4 MB to **1.6 MB**. |
| 5.6 | API keys behind the OS credential store | **Permanently declined.** This product intentionally supports browser mode and arbitrary OpenAI-compatible providers; a Tauri-only keychain command would make credential semantics differ by shell, add a Rust dependency surface, and cannot protect keys already supplied to a browser runtime. The current trade-off is explicit: provider keys are stored in `localStorage` and must be treated as user-managed secrets. No future plan item remains for this. |
| 5.1 | `generation.ts` split | **Fixed** — split into `src/lib/generation/` with `prompts.ts` (358), `podcast.ts` (250), `lesson.ts` (199), `errors.ts` (147), `transport.ts` (97); the entry barrel is now 156 lines. Pure moves only: the runtime export surface is byte-identical (`detectLanguage`, `generateHTML`, `generateLesson`, `generatePodcastOnly`, `getLessonSystemPrompt`, `podcastChunkSystemPrompt`), so all 58 generation-related tests and every `@/lib/generation` consumer passed unchanged. Extraction order was forced by one real dependency: `retrySameModel` calls `classifyGenerationError`, so `errors.ts` had to come out first and must never import `transport.ts`. `generateHTML` was already in `htmlExport.ts`. |
| 5.2 | `LessonContent.tsx` split | **Open** — still 917 lines in a single `LessonPage` component. Deliberately not attempted in the same pass as 5.1: unlike the generation split there is no test that would catch a regression here, so it needs its own plan and its own tests first. |
| 5.5 | localStorage→IndexedDB | **Fixed** — `libraryStore.ts` puts lessons in IndexedDB, imports the legacy bare array once, preserves order, and has a versioned localStorage fallback. `storage.ts` wraps small payloads with `{v,data}` and reports quota/corruption failures through a persistent UI warning. The Library, Home, Journey, Generate and Lesson pages no longer read/write the library key directly. |
| 2.4 | Hooks/audio players at 0% | **Fixed** — `useMetacognitive` and `useLessonPersistence` both at 100% statements, and the pipeline-hook suite extended to 64%. `src/hooks` moved off its placeholder 0% floor to a real floor of 72/38/72/72 (measured rollup 77.55/44.00/77.78/77.37). Remaining uncovered branch coverage is the pipeline hook's Tauri/provider I/O, which is unreachable in jsdom. |

**5.12 was two problems, not one.** The audit framed it as size ("65% of the payload").
It was also a broken reference: `.gitignore` had a blanket `*.mp3`, so
`public/Study_Studio_Podcast.mp3` was **not in the repository at all** — while the
*tracked* `public/featured-podcast.json` pointed at it via `audioFile`. A tracked file
must never reference an ignored one. Resolved by removing the dead field (verified: no
code reads `audioFile`; the app reads `Lesson.audioPath`) and moving the asset to
`apps/desktop/assets/`, which is gitignored and outside the shipped `public/` tree. The
blanket `*.mp3` ignore is gone, replaced by a directory-scoped one, so the coupling
cannot go invisible again.

**5.7 caveat — the meaningful narrowing is elsewhere.** The webview's `connect-src` does
not actually gate provider traffic: inside the desktop shell, `runtimeFetch` routes
through `tauri-plugin-http`, so the request is made by Rust and gated by the
**capability file** (`src-tauri/capabilities/default.json`), not by CSP. Narrowing CSP
therefore reduces what a compromised *dependency* could reach from the webview — real,
but narrower than it looks. The capability file still allows `http://localhost:*` and is
where the remaining exposure lives. It was left alone deliberately: no UI exposes a
custom base URL today, but `providerStore` persists one, so tightening it would break a
hand-configured port. That verification was deferred on the belief that no Rust toolchain
was available here — it is available (§0), so tightening the capability file is now a
testable change rather than a blind one.

**5.5 implementation note — no silent engine switching.** IndexedDB is the primary
library store. If IndexedDB is unavailable, the versioned localStorage fallback is used
from the start. If an IndexedDB read/write fails *after* the database has opened, the
operation reports a storage failure rather than writing to a fallback that future reads
would never consult. That is intentional: claiming success while placing the lesson in
an invisible engine is another form of data loss.

**5.5 migration note — the old library is imported once.** `loadLibrary()` reads the
legacy bare array from `study-studio-library`, puts it into IndexedDB, then writes a
migration marker. It does not use "if the target is empty" as the marker, because that
would resurrect a library the user deliberately cleared.

| — | `friendlyErrors.ts` had zero coverage | **Fixed** — 21 tests added; they immediately caught that `"request timed out"` fell through to `generic` because the pattern only matched `timeout` |

### 0.1 Why per-directory coverage floors are not in `jest.config.js`

Worth recording because the symptom is actively misleading. Adding
`'src/lib/**'` and `'src/components/**'` alongside `global` made Jest report:

```
Jest: "global" coverage threshold for statements (55%) not met: 0%
```

while the true global figure was 57.66%. That reads like a Jest bug. It is not —
it is documented behaviour visible in `@jest/reporters/CoverageReporter.js`:

```js
if (pathOrGlobMatches.length > 0) {
  return files.concat(pathOrGlobMatches);   // file belongs to its glob group
}
// Neither a glob or a path? Toss it in global if there's a global threshold:
if (thresholdGroups.indexOf(THRESHOLD_GROUP_TYPES.GLOBAL) > -1) { ... }
```

**`global` is not "all files" — it is a fallback bucket for files matching no other
key.** With those two globs defined, the only file left over was a single
0%-covered hooks file, so `global` was computed over one file and reported 0%.

A second trap: the glob form is applied **per file**, so a single 0%-covered file
fails the build (`"...LessonTabs.tsx" coverage threshold ... not met: 0%`).

**Resolution:** Jest keeps the single overall gate; `scripts/check-coverage.mjs`
adds the layered one. It reads `coverage-summary.json`, aggregates
covered/total counts per directory (summing counts, not averaging percentages —
averaging would weight a 1-line file the same as a 900-line one), enforces an
explicit floor per directory, and prints directories that have **no** floor yet so
a gap cannot hide.

One detail worth knowing when reading its output: **the floors are rollups** (a
directory plus everything beneath it), which is deliberately stricter than Jest's
text table. That table prints one row per directory containing only the files
*directly* in it, so `lib` reads 68.33 there while the true rollup is 64.46 — the
difference being the subdirectories. Enforcing the rollup means an untested
subdirectory cannot hide behind a well-covered parent.

### Found by running against a real LM Studio server

These were not visible from reading the code. They were surfaced by the opt-in live
integration test (`LMSTUDIO_LIVE=1`, see below) pointed at a real instance with 5
downloaded models and 0 loaded.

| Defect | Evidence | Status |
| --- | --- | --- |
| `health()` always returned `recommendedModel: ""` | Live assertion: `modelsCount` was 5, `recommendedModel` was `""` | **Fixed** — `health()` now reuses the recommendation policy |
| An **embedding** model could be recommended for generation | The live catalogue contains `text-embedding-nomic-embed-text-v1.5` (`type: "embedding"`) | **Fixed** — recommendation paths filter `type === "embedding"`, with the full list still returned by `listModels()` |
| Load timeout was **8% away from failing** | Loading `ibm/granite-4-h-tiny` (4.23 GB, cold cache) took **165.9 s** against a 180 s budget | **Fixed** — raised to 600 s; a 9 GB model at the observed ~25 MB/s would have timed out mid-load and been reported as a failure |
| Auto-context could request a **64k** KV cache | `preferredContext` used `DEFAULT_LOAD_CONTEXT * 4`; the models here report up to 1 048 576 max context | **Fixed** — explicit `MAX_AUTO_CONTEXT = 32_768` cap |
| `jest.setup.tsx` assumed a DOM | Any `@jest-environment node` suite died with `ReferenceError: window is not defined` | **Fixed** — browser patches guarded |
| The audit's `/v1/models` claim was wrong | Live server returned all 5 models from `/v1/models` | **Corrected** in §5 |

**New regression test:** `src/lib/ai-runtime/__tests__/lmStudio.live.test.ts` — opt-in
via `LMSTUDIO_LIVE=1`, and `LMSTUDIO_LIVE_MODEL=<key>` to include the real load/unload
cycle. It is hermetic without the env var, so CI is unaffected. Verified result:

```
√ ensureModel() loads a downloaded-but-unloaded model — the core requirement (165916 ms)
√ is idempotent — loading an already-resident model is a no-op (49 ms)
√ unloads, and reports the model as unloaded afterwards (2872 ms)
```

**Still open:** `start_lm_studio_if_needed` on the Rust side. `lms.exe` **is** present
(`~/.lmstudio/bin/lms.exe`) and exposes `lms server start|stop|status`, but the command was not written because **Rust was believed absent here** — that belief
was wrong (§0), since the shell builds and runs. This is now ordinary remaining work
rather than something that could not be attempted. Spec: mirror `start_ollama_if_needed` —
probe `:1234` first, shell out to `lms server start`, poll `/api/v1/models` until it
answers, and surface a message naming the LM Studio Developer tab as the manual
fallback. Note that `lms server status` reported "not running" while `:1234` was
serving, so probe the port rather than trusting that subcommand.

### Found while writing the Phase 2 tests

| Defect | Evidence | Status |
| --- | --- | --- |
| **`createJourney` could generate colliding ids** | The fallback id was `` `j-${Date.now()}` ``. `crypto.randomUUID` is only present in a secure context, so on plain HTTP (or an older webview) two journeys created in the same millisecond got the **same id** — and `deleteJourney` filters by id, so deleting one deleted both. The test that created two journeys and deleted one lost both. | **Fixed** — fallback is now `j-<timestamp>-<random>`; a regression guard asserts 50 rapid creations yield 50 distinct ids |
| **`jest.setup.tsx` stubs were not overridable** | `Object.defineProperty` defaults to `configurable: false`, so any suite needing different `localStorage` / `speechSynthesis` behaviour died with `Cannot redefine property` before running a test. This is why `journeys.ts` and `voiceDiscovery.ts` had no tests. | **Fixed** — `configurable: true` on all three stubs |

Also worth recording: **per-directory coverage floors are not usable in this Jest
version.** Adding any path-scoped key alongside `global` makes Jest report the global
as **0%** and fail it regardless of real coverage; the glob form (`src/lib/**`) is
additionally applied per-file, so one 0%-covered file fails the build. Both were
tried and reverted. The global gate is now at 55% (from 25%), which is a real
improvement, but it cannot detect a well-covered module masking a poorly-covered one.

### Found while completing Phase 4

**`getPodcastSystemPrompt` had no production caller.** It was exported, had two
passing tests, and was never called — `generatePodcastOnly` uses
`podcastTitleSystemPrompt` + `podcastChunkSystemPrompt` instead. The tests gave it
the appearance of being load-bearing, which is the dangerous part: there were two
similarly-named podcast prompts with near-identical content, and a maintainer
editing the wrong one would have changed nothing at runtime while watching the
tests stay green.

**Deleted** (132 lines), along with the two tests that covered it. Those tests were
not simply removed — they were rewritten against `podcastChunkSystemPrompt`, the
live prompt, so the language-parameter coverage they provided is preserved. That
required exporting `podcastChunkSystemPrompt`, matching the convention
`getLessonSystemPrompt` already set.

The general lesson: **a test on dead code is worse than no test**, because it
converts dead code into something that looks verified.

Still open — see the phase plan in §6 and the priority order in §7.

---

## 1. P0 — Blocking defects

### P0-1. Sixty design-token usages compile to nothing

**Severity:** P0 — user-visible breakage across most screens.

`tailwind.config.ts` defines 9 colours. The JSX uses at least 6 more that are never
defined, so Tailwind generates no CSS for them.

Measured against the emitted stylesheet
(`out/_next/static/css/addaf125e8afacad.css`):

| Class | Usages in `src` | Rules in compiled CSS |
| --- | --- | --- |
| `bg-primary-soft` | 29 | **0** |
| `to-accent-blue` | 11 | **0** |
| `from-primary-soft` | 6 | **0** |
| `text-accent-red` | 6 | **0** |
| `text-accent-green` | 3 | **0** |
| `border-accent-green` | 3 | **0** |
| `border-accent-red` | 2 | **0** |
| `badge-secondary` | 2 | **0** (never defined in `globals.css`) |

By contrast `border-card-border` (36 usages) and `bg-card-border` (2) both resolve,
because `card-border` *is* in the config. The split is exactly along the config
boundary.

**What the user actually sees:** every selected difficulty / length / language /
provider card renders with no tint, so selection is signalled only by a 1px border.
The page-title gradient runs from `primary` to *nothing*. Accent-coloured error and
success text renders in the inherited colour. The Settings "No TTS detected" badge
renders with no background at all.

**Why it went unnoticed:** `next lint` does not validate Tailwind class existence.
TypeScript cannot see class strings. Nothing in CI compiles the CSS and greps it.

**Fix:** add the missing keys to `tailwind.config.ts`.

```ts
colors: {
  // ...existing
  "primary-soft": "var(--primary-soft)",
  "accent-green": "var(--accent-green)",
  "accent-red": "var(--accent-red)",
  "accent-blue": "var(--accent-blue)",
  "accent-amber": "var(--accent-amber)",
},
```

Then define `.badge-secondary` in `globals.css`. Then add the regression guard from
§6.1 so this cannot recur.

### P0-2. The app cannot run on the runtime the user has installed

**Severity:** P0 — the stated goal of the project is unreachable.

The README, `.env.example`, and the default provider list all lead with Ollama. The
user has no Ollama. `package.json` even hardcodes the assumption:

```json
"ollama:pull": "ollama pull gemma3:12b && ollama pull llama3.2:3b",
"setup": "npm run ollama:pull && npm run tauri:dev"
```

`npm run setup` fails on this machine at step one.

The Rust backend is Ollama-only. `src-tauri/src/lib.rs` declares
`const OLLAMA_URL: &str = "http://localhost:11434"` and every command talks to it:
`check_health`, `list_models`, `model_profile`, `pull_model`, `generate`, `chat`,
`set_model`, `get_model`, `start_ollama_if_needed`, `get_ollama_status`,
`auto_select_model`. There is no LM Studio path in Rust at all.

Meanwhile the frontend *does* have an LM Studio profile — as a configuration profile
of the generic `OpenAICompatibleProvider` pointing at `http://localhost:1234/v1`. It
works for chat, but it can only see models LM Studio has **already loaded**, and it
cannot load one.

**Result:** the user must open LM Studio, load a model by hand, then open Study
Studio. That is exactly the workflow the requirement says to eliminate.

**Fix:** implement a native LM Studio provider. See §5, phase 3.

### P0-3. `apps/mobile` is dead code

**Severity:** P0 for the repo, P2 for the product.

1,141 lines across 6 files, built on `axios` + `zod`, with its own Ollama-only
service layer (`apps/mobile/src/services/ollama.ts`) that duplicates a subset of the
desktop logic and shares no code with it. The README says "Mobile experience remains
unfinished", and there is no CI job, no test, and no release path for it.

It is not wired to anything. It cannot use the AI runtime. It will drift further with
every desktop change.

**Fix:** decide. Either delete it, or freeze it in a clearly-labelled `experiments/`
directory with a README stating it is unmaintained. Carrying an unfinished app in
`apps/` implies a commitment that does not exist.

---

## 2. P1 — High-severity defects

### P1-1. The declared typeface is never loaded

`globals.css` sets `font-family: 'Inter', system-ui, -apple-system, sans-serif`, and
`generation.ts` emits the same stack into exported lesson HTML. Nothing loads Inter.

Evidence:

```
grep -rn "next/font" src            → 0 matches
grep -c "@font-face" <compiled css> → 0
find out -name "*.woff*"            → 0 files
```

Two Geist fonts (134 KB) sit in `src/app/fonts/` and are never imported by anything.

**Impact:** every user gets `system-ui`. On Windows that is Segoe UI, on macOS SF Pro.
The app has no typographic identity, and the exported HTML renders differently on
every machine.

**Root cause (found while fixing):** the project ships a `babel.config.js` containing
nothing but `presets: ['next/babel']`. Any project-level Babel config **disables SWC**,
and `next/font` requires SWC. Attempting the fix produces:

```
Syntax error: "next/font" requires SWC although Babel is being used due to a custom
babel config being present.
```

So the font could not have been loaded as long as that file existed — which is almost
certainly why it never was. The file was also unnecessary: `jest.config.js` transforms
via **`ts-jest`**, not `babel-jest`, so nothing consumed it. Next.js had been printing
`⚠ It looks like there is a custom Babel configuration that can be removed.` on every
build.

**Fix applied:**
1. Removed `babel.config.js` → SWC restored (builds are faster and the warning is gone).
2. `next/font/google` Inter in `layout.tsx` → `--font-inter`, self-hosted at build time.
3. `next/font/local` for `GeistMonoVF.woff` → `--font-geist-mono`, so `font-mono`
   resolves to Geist instead of silently falling back to Tailwind's default stack.
4. `fontFamily.sans` / `fontFamily.mono` added to `tailwind.config.ts`.
5. `globals.css` uses `var(--font-inter, 'Inter')` — the literal fallback keeps the
   declaration valid if the variable is ever unset (a bare unresolved `var()` invalidates
   the whole `font-family` declaration, dropping the system stack too).

**Verified in the export:** 8 Inter `@font-face` rules + 1 for Geist Mono, all
`font-display: swap`; `<html class="__variable_f367f3 __variable_1235f0">`;
`.font-mono{font-family:var(--font-geist-mono),…}`.

**Second occurrence, also fixed:** `generation.ts` wrote `'Inter'` into the **exported
lesson HTML**. That file is standalone with an inline stylesheet — it can never reach
`--font-inter` or the hashed woff2 paths — so it reproduced the same "declared but never
loaded" defect in a user-facing artifact. It now declares a system stack instead of naming
a font it cannot load. Matching the app exactly would require base64-embedding the font
(~+64 KB per exported lesson).

**Still open:** `GeistVF.woff` (66 KB, the Geist *sans*) remains unused and is now
redundant with Inter. Deleting it or adopting Geist as the body face is a brand decision —
see DESIGN.md §11.

### P1-2. `AIRuntimeProvider` — the app's central wiring — is 10.5% covered

```
AIRuntimeProvider.tsx | 10.52 % Stmts | 0 % Branch | 2.85 % Funcs
Uncovered: lines 80-105, 109-244
```

Lines 80–244 are `computeCanGenerate`, `deriveMode`, `runInit`, `refreshProviders`,
`setActiveProvider`, and the entire render tree. In other words: **every function that
decides whether the app can generate, and which provider it routes to, is untested.**

This is the highest-value test gap in the codebase. `deriveMode` even contains a
provable no-op:

```ts
if (localUp) return ttsAvailable ? "offline" : "offline"; // both branches identical
```

`ttsAvailable` is read and discarded. Either the intent was `"hybrid"` for one branch
or the parameter should be removed. Nothing catches it because nothing tests it.

**Fix:** extract `computeCanGenerate` and `deriveMode` into a pure module
(`src/lib/ai-runtime/routing.ts`), unit-test the truth table, and delete the dead
branch. Then add a React Testing Library test for `runInit` success and failure.

### P1-3. Other zero-coverage modules

| Module | Coverage | Why it matters |
| --- | --- | --- |
| `hooks/useTopicAudioPipeline.ts` | 0% | Drives the entire 3-stage audio pipeline. |
| `hooks/useMetacognitive.ts` | 0% | Drives the pulse overlay. |
| `components/PodcastPlayer.tsx` | 0% | Playback for the flagship audio feature. |
| `components/AudioPlayer.tsx` | 0% | Same. |
| `components/AudioFileDownload.tsx` | 0% | The save-to-disk path. |
| `lib/friendlyErrors.ts` | 0% | Every user-facing error message. |
| `lib/modelProfiler.ts` | 0% | The pre-flight "Patriot Check" gate. |
| `lib/voiceDiscovery.ts` | 0% | Voice catalogue. |
| `lib/journeys.ts` | 0% | Journey containers. |
| `lib/languageScaffold.ts` | 0% | Language scaffolding. |
| `lib/evaluation.ts` | 8.3% | Quiz scoring. |

`jest.config.js` sets `coverageThreshold.global` to 25% with a comment admitting it
was lowered to match reality. The gate no longer protects anything.

**Fix:** raise the threshold to the measured floor (48%) and ratchet it +2 points per
PR. Add per-directory thresholds so `components/` and `hooks/` cannot hide behind
`lib/`.

### P1-4. `generation.ts` is a 1,580-line god module

It owns prompt engineering for two difficulty×language matrices, chunked generation,
batching, retry/backoff, error classification, JSON repair orchestration, HTML
template generation, and token budgeting. It has 30+ module-level functions and a
64 KB prompt-string surface.

Consequences already visible: 33 lint warnings, of which 4 are dead variables inside
`getPodcastSystemPrompt` (`hostAPronoun`, `hostBPronoun`) and 2 more in
`generateLesson` (`voiceGenderA`, `voiceGenderB` are destructured from
`validatedData` and never used).

**Fix:** split along the seams that already exist:

```
lib/generation/prompts/lesson.ts       getLessonSystemPrompt + outline/section prompts
lib/generation/prompts/podcast.ts      getPodcastSystemPrompt + chunk prompts
lib/generation/chunked.ts              generateLessonChunked, generatePodcastChunked
lib/generation/retry.ts                retryBackoffDelay, retrySameModel, classifyGenerationError
lib/generation/html.ts                 generateHTML
lib/generation/index.ts                generateLesson, generatePodcastOnly (orchestration)
```

Pure moves first, no behaviour change. Then delete the dead variables.

### P1-5. Two Ollama transports, one of which bypasses the CORS-free path

`src/lib/ollama.ts` (363 lines) and `src/lib/ai-runtime/providers/ollama.ts` (234
lines) are separate implementations of the same thing. The provider is a thin wrapper
over the transport, which is correct. But the transport uses raw `fetch`:

```ts
// src/lib/ollama.ts:65
const res = await fetch(`${OLLAMA_URL}${path}`, { ... });
```

while the rest of the app routes through `runtimeFetch()` — which exists specifically
to route localhost calls through Tauri's reqwest client and escape webview CORS.

Today this happens to work because Ollama sends `Access-Control-Allow-Origin`. It
works by luck. `transport.ts` documents the problem for exactly this reason:

> LM Studio ships with CORS disabled by default.

**Fix:** replace `fetch` with `runtimeFetch` in `src/lib/ollama.ts` at lines 65 and
203. One-line change, removes an entire class of latent failure.

### P1-6. `num_ctx` comment contradicts the code

```ts
// src/lib/ollama.ts:76-82
/**
 * - `num_ctx: 8192` widens the default ~2048 context window so longer lessons
 *   aren't truncated.
 */
function buildOllamaOptions(opts: OllamaGenerateOptions): Record<string, unknown> {
  const numPredict = opts.num_predict ?? opts.max_tokens ?? 8192;
  return {
    // ...
    num_ctx: opts.num_ctx ?? 24576,   // ← 24576, not 8192
```

The documented default is 8192. The code uses 24576 — 3× larger. On a 3B model that
is a large unnecessary KV-cache allocation, and it is the kind of default that turns
a working laptop into a swapping one. Either the comment or the value is wrong;
someone must decide which.

**Fix:** pick one, state it in both places, and make it configurable.

---

## 3. P2 — Structural and quality defects

### P2-1. `deepseek-harness` — 11,262 files untracked inside the repo

```
git status --short
?? .claude/
?? deepseek-harness/
```

`deepseek-harness/` contains its own `.git/`, `.github/`, `.gitlab-ci.yml`, `AGENTS.md`,
`CLAUDE.md`, and a full TypeScript project. The repo has 194 tracked files; this
directory alone has 11,262.

It is invisible to CI, invisible to `git ls-files`, and it will be destroyed by a
careless `git clean -fdx`.

**Fix:** decide whether it is a sibling project or a vendored dependency. If sibling,
move it out of the repo. If vendored, make it a submodule. Either way add it to
`.gitignore` or track it deliberately — never leave it in limbo.

### P2-2. `npm run analyze` is broken

```json
"analyze": "ANALYZE=true npm run build"
```

`@next/bundle-analyzer` is not in `devDependencies`, and `next.config.mjs` never
reads `process.env.ANALYZE`. The script sets an environment variable that nothing
consumes.

**Fix:** install the package and wire it in `next.config.mjs`, or delete the script.

### P2-3. `.env.example` documents variables that are not read

`.env.example` advertises `OLLAMA_URL`, `OLLAMA_MODEL`, `NEXT_PUBLIC_APP_URL`, and
`NEXT_PUBLIC_OLLAMA_URL`, and claims "No API keys required!".

Actually read: `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `OLLAMA_URL`,
`STUDIO_STUDIO_RETRY_BACKOFF_MS`.

`OLLAMA_MODEL`, `NEXT_PUBLIC_APP_URL`, and `NEXT_PUBLIC_OLLAMA_URL` are read by
nothing. Worse, `OLLAMA_URL` is a *server-side* variable in a statically exported
Next.js app — `process.env` is inlined at build time, so changing `.env` after
`next build` has no effect. The file teaches a mental model that does not hold.

**Fix:** rewrite `.env.example` to list only variables that are read, and state
explicitly that they are inlined at build time. Add `STUDIO_STUDIO_RETRY_BACKOFF_MS`
(the typo — `STUDIO_STUDIO` — should be `STUDY_STUDIO`, but renaming it is a breaking
change for anyone who set it; document it either way).

### P2-4. The design system has no enforcement

Nothing prevents the next contributor from writing `bg-primary-soft` again. There is
no `DESIGN.md` (this audit adds one), no token lint, and no compiled-CSS assertion.

**Fix:** see §6.1.

### P2-5. Nine `no-unused-vars` warnings in shipped code

Not test-only noise — these are in production modules:

```
generation.ts:257   'hostAPronoun' unused
generation.ts:258   'hostBPronoun' unused
generation.ts:1423  'voiceGenderA' unused
generation.ts:1423  'voiceGenderB' unused
helixEvents.ts:102  'r' unused
tts.ts:67           'detectLessonLanguage' unused
tts.ts:223          'curatedAvailable' unused
topicPipeline.ts:42-49  seven unused interface-stub params
```

`topicPipeline.ts` lines 42–49 are a `PipelineServices` interface whose default
implementations take arguments they never read — a stub that was never filled in. The
real implementations live in `useTopicAudioPipeline.ts`.

**Fix:** delete the dead variables. For `topicPipeline.ts`, either make the interface
methods' parameters used or make the defaults throw `not implemented` so the stub
cannot silently ship.

### P2-6. Error-message mapping by string sniffing

```ts
// src/app/generate/page.tsx:271-277
const mapped = friendlyErrorByKind(
  message.includes("401") || message.includes("unauthor") || message.includes("api key") ? "api-key-invalid"
  : message.includes("tts") || message.includes("piper") || message.includes("voice") ? "audio-generation-failed"
  : message.includes("localhost") || message.includes("11434") || message.includes("1234") || ...
```

Classification by substring match against a human-readable message. A lesson about
"voice acting" whose model returns a validation error containing the word "voice"
will be reported to the user as an audio failure.

The codebase already has the right machinery — `error.ts` defines `AppError` with an
`ErrorCode` enum, and `classifyGenerationError` returns a typed kind. The typed
information exists and is then discarded in favour of string matching at the UI edge.

**Fix:** thread `ErrorCode` (or a `FriendlyErrorKind`) through the thrown `AppError`
and map on the code, not the text. Delete the `includes()` chain.

### P2-7. `localStorage` as the only persistence layer, unversioned

Four keys: `study-studio-library`, `study-studio-progress`, `study-studio-theme`,
`study-studio-provider-config`. No schema version, no migration, no size management.

`study-studio-library` holds every generated lesson — full section text, quizzes,
glossaries, and podcast scripts. A comprehensive lesson runs to tens of KB. Browsers
cap `localStorage` at ~5 MB. A user who generates 50 comprehensive lessons hits
`QuotaExceededError`.

The failure is handled — `progress.ts:56` and the library writes are wrapped in
`try/catch` — but it is handled *silently*. The user's lesson appears to save and does
not.

**Fix:** add a `version` field to each payload with a migration function. Move the
library to IndexedDB (which has no practical size limit) and keep `localStorage` for
small preferences. Surface a visible warning when a write fails.

### P2-8. API keys in `localStorage`

`providerStore.ts` persists `apiKey` to `localStorage` in plaintext, with the comment
"Keys are kept client-side only and are never logged."

Inside the Tauri webview, `localStorage` is on-disk, unencrypted, and readable by any
process running as the user. For a *privacy-first local app* whose stated value is
that data never leaves the machine, this is a contradiction worth naming. It is not a
remote vulnerability, but it is weaker than the product's own claim.

**Fix:** move key storage to the Rust side behind a Tauri command, backed by the OS
credential store (`keyring` crate), or at minimum document the trade-off honestly in
`DESIGN.md` and `SECURITY` notes rather than asserting it is safe.

### P2-9. CSP is broad on the `connect-src` side

```json
"csp": "... connect-src http://localhost:* http://127.0.0.1:* https://tauri.localhost ipc: ..."
```

`http://localhost:*` permits **every** port on the loopback interface. A compromised
dependency could scan local services freely. The capability file is tighter
(`http:default` allows `http://localhost:*` too, but `https://api.openai.com` and
`https://openrouter.ai` are enumerated).

**Fix:** enumerate the ports the app actually uses (11434, 1234, 8080, 8000, 4000,
21002, 3980) rather than wildcarding the port. Revisit if user-configurable ports are
needed.

### P2-10. `trailingSlash: true` + `output: "export"` interactions

`next.config.mjs` sets both. Every route emits `index.html` inside a directory
(`out/generate/index.html`). Tauri loads `../out` as `frontendDist`. Navigation works,
but any code that builds a URL by string concatenation rather than via `next/link`
will 404 on the missing trailing slash. Worth an explicit test, and worth documenting
for the lesson-export path.

### P2-11. Documentation drift

| Claim | Reality |
| --- | --- |
| README: "Ollama — recommended" | Ollama is not installed on the target machine. **Fixed** — LM Studio is now the recommended runtime in both `README.md` and `apps/desktop/README.md`. |
| README: "Audio export works when Piper TTS is configured" | Requires Piper **and** ffmpeg; `check_ffmpeg` exists but the requirement is not stated in the README. **Fixed** — both docs now state that both are required. |
| `apps/desktop/README.md`: "Requirement: Ollama installed and running" | Ollama is not required. **Fixed** — rewritten as "a local model runtime (LM Studio recommended)". |
| `apps/desktop/README.md`: Tauri command table implied these are the AI path | All 15 commands are Ollama-specific; LM Studio is reached over HTTP via `tauri-plugin-http`. **Fixed** — the table is now explicitly labelled the Ollama backend. |
| `docs/OFFLINE_SETUP.md` | Entirely Ollama-based, including model paths and troubleshooting. **Fixed** — covers LM Studio (recommended) and Ollama, with verified paths (`~/.lmstudio/models`, `~/.ollama/models`). |
| `docs/ARCHITECTURE_AUDIT.md` (12.8 KB) | Not referenced from README or `docs/ARCHITECTURE.md`. Orphaned. **Still open.** |
| `CHANGELOG.md` | Last entry predates the AI-runtime rewrite. **Still open.** |
| `apps/desktop/CONTRIBUTING.md` | Does not mention the AI-runtime provider contract, the design tokens, or `DESIGN.md`. **Still open.** |
| `.env.example` | See P2-3. **Fixed.** |

`docs/AI_RUNTIME.md` (15.8 KB) is genuinely good and matches the code. It is now linked
from both READMEs, along with `DESIGN.md`, `AUDIT.md`, and `docs/ARCHITECTURE.md`.

---

## 4. P3 — Polish

- **`CHANGELOG.md` is stale.** Version says `0.2.0` in three places (root
  `package.json`, `apps/desktop/package.json`, `tauri.conf.json`). Keep them in sync
  or generate one from the other.
- **33 lint warnings** are tolerated, so new ones are invisible. Fix the 9 production
  warnings, then set `--max-warnings` in CI to lock the floor.
- **`punycode` deprecation warning** on every Jest run (from a transitive dependency).
  Pin or silence it so real warnings stand out.
- **`public/Study_Studio_Podcast.mp3` is 2.4 MB**, 65% of the entire `out/` payload.
  It ships in every build and every installer. Move it out of `public/` or lazy-load
  it.
- **`out/` and `.next/` are on disk** and correctly gitignored, but their presence
  means stale artifacts can be inspected by mistake. Fine as-is; noting for the
  bundle-size baseline.
- **`e2e-podcast-intj.test.ts` is skipped** and lint-flagged
  (`jest/no-disabled-tests`, `jest/expect-expect`). It has no assertions. Either make
  it run behind `E2E_PODCAST=1` with real assertions or delete it.
- **`getModelProfile` returns `null` for most providers**, and `validateModelForTask`
  treats `null` as "suitable". The Patriot Check therefore almost never fires. Either
  make the profile real (LM Studio's `/api/v1/models` reports `max_context_length`,
  `capabilities.vision`, and `capabilities.trained_for_tool_use` — see §5) or delete
  the feature. A gate that never closes is worse than no gate.
- **`lesson/LessonContent.tsx` is 923 lines.** Same treatment as `generation.ts`:
  split by tab (lesson / quiz / podcast / audio).
- **No `.nvmrc` or `.node-version`.** `engines` says `>=18.17.0`; the app is developed
  on Node 22. Add a pin.

### Resolved in this pass

- **33 lint warnings** — fixed. The config used the base `no-unused-vars`, which
  produced 23 false positives in `ai-runtime/types.ts` by flagging interface method
  parameters. Switched to `@typescript-eslint/no-unused-vars` (81 → 33), removed the
  real dead code, and added `npm run lint:ci` = `next lint --max-warnings 0`.
- **`e2e-podcast-intj.test.ts`** — the assertion-free `test.skip` is replaced with a
  real assertion on the `E2E_PODCAST` gate, so the file is green in a normal run and
  still opt-in. No disabled tests remain.
- **`next build` could not run in this environment.** Not a project defect, but it
  will block the user: the sandbox's bulk-delete guard
  (`[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`, threshold 50 files per turn)
  aborts the build at Next.js's own cleanup of `.next/` and `.next/export`. The build
  completes normally outside that guard. Reproduce with
  `CODEBUDDY_SAFE_DELETE_ENABLED=0 npx next build`, or run the build in a plain
  terminal.

---

## 5. Gap analysis — what the requirements need and the code lacks

This is the section that matters most for the immediate goal: **run on LM Studio, load
the selected model automatically, and inject the five skills.**

### Gap 1 — LM Studio native model management

**Exists:** `OpenAICompatibleProvider` with an `lmStudio` profile at
`http://localhost:1234/v1`. It can chat and list models the server has already loaded.

**Missing:** everything needed to load a model.

LM Studio exposes a native REST API that the app does not use. Verified against the
official docs:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/v1/models` | GET | All downloaded **and** loaded models, with `loaded_instances[]`, `max_context_length`, `capabilities` |
| `/api/v1/models/load` | POST | **Load a model into memory** |
| `/api/v1/models/unload` | POST | Unload by `instance_id` |
| `/api/v1/models/download` | POST | Download from the catalogue |
| `/api/v0/models` | GET | Legacy equivalent, `state: "loaded" \| "not-loaded"` |

Load request body (from the docs):

```json
{
  "model": "openai/gpt-oss-20b",
  "context_length": 16384,
  "flash_attention": true,
  "echo_load_config": true
}
```

Response:

```json
{
  "type": "llm",
  "instance_id": "openai/gpt-oss-20b",
  "load_time_seconds": 9.099,
  "status": "loaded",
  "load_config": { "context_length": 16384, "flash_attention": true, "...": "..." }
}
```

Model list entry (note `loaded_instances` — this is the field that tells the app
whether a model needs loading):

```json
{
  "type": "llm",
  "key": "google/gemma-4-26b-a4b",
  "display_name": "Gemma 4 26B A4B",
  "size_bytes": 17990911801,
  "params_string": "26B-A4B",
  "loaded_instances": [{ "id": "google/gemma-4-26b-a4b", "config": { "context_length": 4096 } }],
  "max_context_length": 262144,
  "format": "gguf",
  "capabilities": { "vision": true, "trained_for_tool_use": true }
}
```

**Note the key difference:** `/api/v1/models` reports the **load state** of every
model (`loaded_instances`, empty when the model is downloaded but not resident) and
exposes the endpoints that change it. `/v1/models` reports neither.

> **Correction (verified against a live server, 2026-09-16).** This section originally
> claimed `/v1/models` "lists only what the server will serve", i.e. that a
> downloaded-but-unloaded model is invisible there. That is **wrong**. Against a real
> LM Studio instance with 5 downloaded models and 0 loaded, `/v1/models` returned all
> 5. The `/v1` listing is not blind to unloaded models.
>
> The real justification for the native API is narrower and still decisive: `/v1` has
> **no way to load a model and no way to ask whether one is loaded**. That, not the
> listing, is what forced the user to load models by hand. The provider was built
> against the corrected understanding.

**Also missing:** `loadModel` / `unloadModel` do not exist anywhere in the
`AIProvider` contract (`src/lib/ai-runtime/types.ts`), so no provider can express
them and no caller can request them.

### Gap 2 — Skill injection is a hardcoded six-entry map

`src/lib/skills.ts` is 146 lines with `SKILLS: Record<string, SkillConfig>` holding
`default`, `storytelling`, `podcast`, `deutsch`, `arabic`, `spanish`, `french`.

None of the five requested skills exist. `SkillInjector` supports exactly one active
skill, prepended as a single block:

```ts
apply(systemPrompt: string): string {
  if (!this.context) return systemPrompt;
  return `${this.context.skill.systemInstructions}\n\n${systemPrompt}`;
}
```

There is no concept of *which* skills apply to *which* task, no composition, and no
automatic binding. `skillInjector.bind()` is called from exactly one place —
`generate/page.tsx:176`, inside the click handler. If the user never touches the skill
dropdown, nothing is injected, and the podcast path never injects anything at all.

**Missing:**

1. The five skill packs (humanizer, education, podcast-ops, open-lesson,
   notebooklm-studio).
2. Multi-skill composition with a deterministic order.
3. Intent-based routing — lesson vs podcast vs audio vs research.
4. Automatic binding on launch when a local server is detected.
5. Injection on the podcast path, which currently has none.

### Gap 3 — No launch-time auto-configuration

`AIRuntimeProvider.runInit()` discovers providers and picks an active one. It never
binds a skill, never loads a model, and never reacts to the discovery result. The
"automatically applied once the app launches and detects LM Studio" requirement has no
implementation.

### Gap 4 — `providerProbe` cannot see LM Studio's real state

`LOCAL_PROBE_TARGETS` checks `http://localhost:1234/v1/models` for a 2xx. That
confirms the server is up but says nothing about which models are loaded, so the UI
cannot offer "load this model" — only "this provider answered".

---

## 6. Fix plan

Five phases. Each phase is independently shippable and independently verifiable.

### Phase 1 — Stop the visible bleeding (P0)

| # | Task | Files | Verify |
| --- | --- | --- | --- |
| 1.1 | Add the 5 missing colour tokens to Tailwind | `tailwind.config.ts` | grep emitted CSS for each class → ≥1 rule |
| 1.2 | Define `.badge-secondary` | `src/app/globals.css` | Settings page badge renders |
| 1.3 | Add the compiled-CSS token guard | `scripts/check-tokens.mjs` + `package.json` | Script exits 1 on a missing token |
| 1.4 | Load the real typeface; delete the unused one | `src/app/layout.tsx`, `globals.css`, `src/app/fonts/` | `@font-face` count > 0 in emitted CSS |
| 1.5 | Fix `num_ctx` comment/code mismatch | `src/lib/ollama.ts` | Comment matches value |
| 1.6 | Route the Ollama transport through `runtimeFetch` | `src/lib/ollama.ts:65,203` | Test asserts the Tauri path is used |

**Exit criteria:** `npx next build` then `node scripts/check-tokens.mjs` exits 0, and
a manual pass over Generate + Settings in both themes shows tinted selection states.

### Phase 2 — Make the truth visible (P1 tests)

| # | Task | Files | Verify |
| --- | --- | --- | --- |
| 2.1 | Extract `computeCanGenerate` + `deriveMode` to a pure module; delete the dead branch | `src/lib/ai-runtime/routing.ts` (new) | Unit test covers all 16 combinations |
| 2.2 | Test `runInit` success and failure | `src/components/__tests__/AIRuntimeProvider.test.tsx` | `AIRuntimeProvider` ≥ 60% |
| 2.3 | Test `friendlyErrors`, `modelProfiler`, `journeys`, `voiceDiscovery` | new test files | each ≥ 80% |
| 2.4 | Test the audio hooks and players | `hooks/__tests__/`, `components/__tests__/` | `hooks/` ≥ 50% |
| 2.5 | Raise thresholds and add per-directory floors | `jest.config.js` | Gate at 48% global, 40% `components/`, 50% `lib/` |
| 2.6 | Delete dead variables; fix the 9 production lint warnings | `generation.ts`, `tts.ts`, `helixEvents.ts`, `topicPipeline.ts` | `next lint` → 0 production warnings |
| 2.7 | Replace string-sniffing error mapping with `ErrorCode` | `src/app/generate/page.tsx`, `lib/error.ts` | Test asserts each code maps correctly |

**Exit criteria:** coverage ≥ 55% global, `AIRuntimeProvider` ≥ 60%, lint clean in
production files.

### Phase 3 — LM Studio first-class (P0-2, Gap 1, Gap 4)

This is the phase that delivers the user's primary request.

| # | Task | Files |
| --- | --- | --- |
| 3.1 | Add optional `loadModel?`, `unloadModel?`, `isModelLoaded?` to the `AIProvider` contract; add `loaded` + `contextWindow` + `supportsTools` to `AIModel` | `src/lib/ai-runtime/types.ts` |
| 3.2 | Implement `LMStudioProvider` — native `/api/v1/models` listing, `/api/v1/models/load` + `/api/v1/models/unload` management, `/api/v1/models/{key}` profile, v0 and OpenAI-compatible fallbacks for older servers | `src/lib/ai-runtime/providers/lmStudio.ts` (new) |
| 3.3 | `ensureModel` gains load-on-demand: resolve → check `loaded_instances` → load if absent → poll until loaded → return | `lmStudio.ts` |
| 3.4 | Add `ensureModelLoaded()` to the runtime and call it from the init handshake | `runtime.ts`, `api.ts` |
| 3.5 | Probe LM Studio's native API so the UI knows loaded vs downloaded | `providerProbe.ts` |
| 3.6 | Register the native provider in place of the generic profile | `ai-runtime/index.ts` |
| 3.7 | Surface load state in the UI: "Downloaded" vs "Loaded", with a load action and progress | `app/generate/page.tsx`, `app/settings/page.tsx`, `components/AIRuntimeProvider.tsx` |
| 3.8 | Add a Rust `start_lm_studio_if_needed` command (`lms server start`, best-effort, non-fatal) | `src-tauri/src/lib.rs` |
| 3.9 | Real model profiles from native metadata, so the Patriot Check can actually fire | `lmStudio.ts`, `modelProfiler.ts` |
| 3.10 | Rewrite `.env.example` and the README's runtime section: LM Studio first | `.env.example`, `README.md` |

**Exit criteria:** with LM Studio running and a model downloaded but **not** loaded,
selecting it in Generate loads it automatically, reports progress, and generates a
lesson — with no interaction with the LM Studio GUI.

### Phase 4 — Skill injection (Gap 2, Gap 3)

| # | Task | Files |
| --- | --- | --- |
| 4.1 | Extend `SkillConfig` with `category`, `appliesTo`, `priority`, `source`, `version` | `src/lib/skills/types.ts` (new) |
| 4.2 | Author the humanizer pack from `humanizer-3.0.0/SKILL.md` — the 25 patterns, the four-step workflow, the voice rules | `src/lib/skills/definitions/humanizer.ts` |
| 4.3 | Author the education pack — plan / quiz / flashcard / progress / schedule / review | `src/lib/skills/definitions/education.ts` |
| 4.4 | Author the podcast-ops pack — transcript ingest, content atoms, the scoring formula (novelty × controversy × utility), dedup, calendar | `src/lib/skills/definitions/podcastOps.ts` |
| 4.5 | Author the open-lesson pack — Socratic method, directed-graph plans, reasoning-gap analysis | `src/lib/skills/definitions/openLesson.ts` |
| 4.6 | Author the notebooklm-studio pack — source ingest, the 9 artifact types, the sequential-gate workflow | `src/lib/skills/definitions/notebooklmStudio.ts` |
| 4.7 | Build the registry with intent routing: lesson → education + open-lesson + humanizer; podcast → podcast-ops + humanizer; audio → storytelling + humanizer; research → notebooklm-studio + education | `src/lib/skills/registry.ts` (new) |
| 4.8 | Multi-skill `SkillInjector`: ordered composition, dedup by id, `applyAll(intent)` | `src/lib/skills/injector.ts` (new) |
| 4.9 | Keep `src/lib/skills.ts` as a re-export shim so existing imports and tests keep working | `src/lib/skills.ts` |
| 4.10 | Inject on the podcast path, which currently injects nothing | `src/lib/generation.ts` |
| 4.11 | Auto-bind on launch: when a local provider is detected, bind the default skill set and record it in context | `src/components/AIRuntimeProvider.tsx` |
| 4.12 | UI: show which skills are active for the selected task, with per-skill toggles | `src/app/generate/page.tsx` |
| 4.13 | Tests: registry resolution, composition order, injection into both system prompts | `src/lib/skills/__tests__/` |

**Note on scope.** The five upstream skills are *agent* skills — they ship shell
scripts and call external APIs (openLesson's `www.openlesson.academy`, NotebookLM's
`notebooklm` CLI). A local model inside a Tauri app cannot execute them. What is
injectable is their **methodology**: the instruction blocks, the output contracts, and
the scoring rubrics. That is what this phase implements, and it is what makes the
generated content better. Wiring the actual APIs is a separate integration project and
is explicitly out of scope here — it needs API keys, network access, and a decision
about whether the app should talk to third parties at all, which sits awkwardly with
the local-first promise.

**Exit criteria:** with LM Studio running, launching the app binds the lesson skill
set; generating a lesson injects education + open-lesson + humanizer; generating a
podcast injects podcast-ops + humanizer. Verified by asserting the assembled system
prompt in a test.

### Phase 5 — Structural cleanup (P1-4, P2)

| # | Task |
| --- | --- |
| 5.1 | Split `generation.ts` (1,580 lines) into `prompts/`, `chunked.ts`, `retry.ts`, `html.ts` — pure moves first |
| 5.2 | Split `LessonContent.tsx` (923 lines) by tab |
| 5.3 | Decide `apps/mobile`: delete or move to `experiments/` with an unmaintained notice |
| 5.4 | Resolve `deepseek-harness`: submodule, sibling repo, or gitignore |
| 5.5 | Version and migrate the `localStorage` payloads; move the lesson library to IndexedDB |
| 5.6 | Move API-key storage behind a Tauri command backed by the OS credential store |
| 5.7 | Tighten CSP `connect-src` to the ports actually used |
| 5.8 | Fix or delete `npm run analyze` |
| 5.9 | Reconcile version numbers across the three manifests; refresh `CHANGELOG.md` |
| 5.10 | Link `docs/AI_RUNTIME.md` from the README; retire or fold in `docs/ARCHITECTURE_AUDIT.md` |
| 5.11 | Add `.nvmrc`; set `--max-warnings` in CI |
| 5.12 | Move `public/Study_Studio_Podcast.mp3` (2.4 MB, 65% of the payload) out of `public/` |

### 6.1 The regression guard for P0-1

Add `apps/desktop/scripts/check-tokens.mjs`:

```js
// Fails the build when a Tailwind colour utility used in src/ emits no CSS.
// This is the check that would have caught 60 broken class usages.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const TOKENS = ["primary-soft","primary-hover","card-border","accent-green",
                "accent-red","accent-blue","accent-amber","sidebar-hover"];
const PREFIXES = ["bg","text","border","from","to","via","ring"];

// 1. collect candidates from src/
// 2. read the compiled stylesheet from out/_next/static/css/
// 3. fail with the offending class + the file:line that uses it
```

Wire it as `"check:tokens": "node scripts/check-tokens.mjs"` and run it after
`build:prod` in CI.

---

## 7. Priority order

If only three things get done:

1. **Phase 1.1–1.2** — 10 minutes of work that fixes 60 broken class usages. Highest
   user-visible return per minute in the entire audit.
2. **Phase 3** — makes the app work on the runtime the user actually has, and delivers
   automatic model loading. This is the stated goal.
3. **Phase 2.1–2.2** — the app's provider-routing logic is 10% tested and contains a
   provable dead branch. Everything else depends on it being correct.

Phase 4 is the second stated goal and follows immediately after. Phase 5 is debt
repayment and can proceed in parallel once the tests from phase 2 exist to protect the
refactors.
