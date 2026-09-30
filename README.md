<div align="center">

# Study Studio

**A private, local-first AI tutor that runs on your machine.**

[![CI](https://github.com/HatemIsmailShalaby1979/Study-Studio/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/HatemIsmailShalaby1979/Study-Studio/actions/workflows/ci.yml)
![Licence](https://img.shields.io/badge/licence-MIT-blue)
![TypeScript](https://img.shields.io/badge/typescript-app-3178c6)

</div>

## One-line identity

Study Studio is a private, local-first AI tutor that turns a topic into a lesson, a
dual-host podcast script, a glossary, and a quiz — without sending a word to the
cloud.

> [!NOTE]
> **Operating principle.** A local model is a tool the user owns, not a service that owns the user. Generation without an internet dependency is the default, not a privacy add-on: the app talks to a model runtime on the same machine, and with neither a model nor ffmpeg installed it simply tells you what is missing rather than reaching for a hosted API.

## What it does today

| Capability | Status |
| --- | --- |
| Structured lessons (sections, glossary, quiz) | Working |
| Dual-host podcast scripts (English / Arabic) | Working |
| Quiz with local scoring and optional AI evaluation | Working |
| Piper TTS → MP3/WAV export | Working when voice models **and** ffmpeg are installed |
| Multi-provider runtime (LM Studio, Ollama, OpenAI-compatible, optional OpenAI / OpenRouter) | Working |
| On-demand model load from the app (no preloading in LM Studio) | Working |
| Learning Journey (progress, streaks, quiz scores) | Working |
| Library in IndexedDB with legacy localStorage migration | Working |
| Desktop installers (NSIS / MSI / portable) | Built for Windows x64 |
| Mobile client | **Removed** — the Expo scaffold was unreachable code |
| Hosted SaaS | **Not offered** and not planned as a requirement |

## How it fits Helix Codex

Study Studio is a **component** — the product layer that turns a local model into
study material. It is an **independent repository with no shared codebase** with Helix
Prime. No data pipeline is wired between it and the core today; it is portfolio-adjacent
and technically independent.

## Architecture

- `apps/desktop` — the whole application, and the only app package: a Next.js client
  (`src/app`, `src/components`, `src/hooks`, `src/lib`) inside a Tauri 2 shell
  (`src-tauri`, Rust). The Windows installer build target. There is no `apps/web` — the
  frontend is not a separate package.
- `apps/desktop/src/lib/ai-runtime/` — provider contract, capability detection, model
  selection (the runtime the coverage gate measures).
- Library — IndexedDB with a localStorage migration path.

## Production status & test coverage

Snapshot 2026-09-30. Re-measured on this machine — Jest with coverage, TypeScript,
ESLint, the version-manifest check, the static export and the design-token guard
(Node 22.22.2 / npm 11.13.0, Windows x64):

| Check | Result | Snapshot |
| --- | --- | --- |
| Test suites | 46 passed / 46 total | 2026-09-30 |
| Tests | 973 passed / 973 total | 2026-09-30 |
| Coverage (statements / branches) | 85.48% / 75.06% | 2026-09-30 |
| Typecheck (`tsc --noEmit`) | Clean | 2026-09-30 |
| Lint (`eslint src --max-warnings 0`) | Clean | 2026-09-30 |
| Version manifests | Clean — 4 manifests agree at 0.2.0 | 2026-09-30 |
| Design-token guard | Clean — 20 token utilities, 1 stylesheet | 2026-09-30 |
| Static export (`next build --webpack`) | Clean — 7 routes, all prerendered | 2026-09-30 |
| Coverage floors (`check:coverage`) | **Not met** — `src/lib/ai-runtime/runtime.ts` lines 94.63% < 95% floor | 2026-09-30 |
| Mutation testing (28 targeted mutations) | Harness present and blocking in CI; 28/28 caught when driven in-process here; the CI job is red | 2026-09-30 |

> [!IMPORTANT]
> **CI is red on `main`.** The newest run for the current head (`dbc370a`, 2026-09-28)
> passes the `typecheck, lint, versions` and `static export and design tokens` jobs, and
> fails two: `tests and coverage floors` (at the `runtime.ts` line floor above) and
> `mutation testing`. The table is a **local re-measurement, not a CI result**; the two are
> reported side by side rather than reconciled. The `runtime.ts` shortfall was already
> recorded as known and unclaimed in the `153e22c` commit message, which also declined to
> lower the floor — this snapshot reproduces it at 94.63% lines. The `mutation testing`
> failure is **not** reproduced locally: all 28 mutations are caught when the harness's own
> table is driven in-process, but the harness itself cannot start here (this environment
> blocks nested process creation), and the CI job log needs repository-admin access. The
> cause is therefore unresolved, not explained.

> [!WARNING]
> Live opt-in suites exist for LM Studio and Ollama (`LMSTUDIO_LIVE=1`, `OLLAMA_LIVE=1`); without those env vars CI stays hermetic. Generation needs a local model runtime. Audio export needs Piper voice files plus ffmpeg. On a clean machine with neither, the app will not produce lessons or audio. The mobile client was removed, and a hosted SaaS is not offered. No external audit, no certified data isolation, no signed security review, no revenue.

## Run it

Verified on a clean clone on 2026-09-30: `git clone` → `npm install` → `npm run dev`
serves the app on http://localhost:3000.

### Browser (fastest)

```bash
cd apps/desktop
npm install
npm run dev
```

Open http://localhost:3000. The app sets `trailingSlash: true`, so routes resolve with a
trailing slash — `/generate/`, `/library/`, `/settings/`; the unslashed form returns a
redirect.

> [!NOTE]
> Next 16 enables Turbopack by default, and Turbopack conflicts with this project's
> `experimental.webpackBuildWorker` (injected by the `@next/bundle-analyzer` wrapper). Every
> Next script therefore passes `--webpack` explicitly — `dev`, `dev:host`, `build` and
> `build:prod`. Without the flag `npm run dev` exits before it serves anything, with
> *"This build is using Turbopack, with a `webpack` config and no `turbopack` config"*.

In a browser, calls to local runtimes go direct over HTTP, so those servers must allow
CORS. The desktop shell routes through Rust and does not have that constraint.

### Desktop (requires the Rust toolchain)

```bash
cd apps/desktop
npm install
npm run tauri:dev      # development
npm run tauri:build    # Windows installer
```

`npm run tauri:dev` starts the dev server through `scripts/dev-warm.mjs`, which shells out
to `npm run dev` — so it inherits the `--webpack` requirement above.

For local models, LM Studio (port `1234`) or Ollama (port `11434`). For audio, install
Piper voice models **and** ffmpeg.

## Related work

See the [profile README](https://github.com/HatemIsmailShalaby1979) for how this project
fits the wider work.

## Author

**Hatem Ismail Shalaby** — Operations Architect · AI Systems Engineer · Founder

- GitHub: [HatemIsmailShalaby1979](https://github.com/HatemIsmailShalaby1979)
- LinkedIn: [hatem-shalaby-202902127](https://www.linkedin.com/in/hatem-shalaby-202902127/)
- Email: hatemshalaby2025@gmail.com
- Education: BSc Managerial Sciences (Computer Section), Sadat Academy for Management Sciences; Business Analytics Nanodegree, Udacity

Based in Al Obour City, Al-Qalyubia Governorate, Egypt.

## Licence

MIT
