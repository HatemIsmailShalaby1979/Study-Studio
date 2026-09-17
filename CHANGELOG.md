# Changelog

All notable changes to Study Studio are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - Unreleased

### Added
- AI Runtime abstraction with pluggable providers. LM Studio is a **native** provider (`src/lib/ai-runtime/providers/lmStudio.ts`) speaking its REST API v1, with v0 and OpenAI-compatible fallbacks for older servers; Ollama and OpenAI/OpenRouter are also registered.
- **On-demand model loading.** Selecting a model in the dropdown loads it into memory — a downloaded-but-unloaded model is made resident automatically, with a progress indicator and a ten-minute ceiling. There is no need to preload it in the LM Studio UI first.
- **Settings shows load state per model** — a *Loaded* / *Downloaded* badge with Load/Unload actions. The badge renders only when the provider can actually report state, rather than guessing.
- **CORS-free desktop transport** (`src/lib/ai-runtime/transport.ts` via `tauri-plugin-http`): provider discovery and generation route through the Rust backend inside the desktop shell, so any local OpenAI-compatible server (LM Studio, LocalAI, vLLM, LiteLLM, FastChat) works with no server-side CORS configuration.
- **Provider selector on the Generate page** — switch between detected providers live; the model list and routing follow the selection.
- **Skill injection.** Five methodology packs (Humanizer, Education, OpenLesson, Podcast Ops, NotebookLM Studio) compose into the system prompt, routed by intent: lessons get education + open-lesson + humanizer, podcasts get podcast-ops + humanizer. Packs are bound automatically at launch and can be toggled individually on the Generate page.
- **Design system** (`DESIGN.md`) and a compiled-CSS token guard (`npm run check:tokens`) that fails the build when a Tailwind colour utility emits no CSS.
- Self-hosted typography via `next/font` (Inter for body, Geist Mono for monospace) — no network fetch at runtime.
- Learning Journey dashboard with lesson progress, quiz scores, and study streak.
- Ollama bootstrap on app mount with retry and status indicator.
- Cancellation for lesson generation: a Cancel button stops an in-flight request end-to-end via `AbortSignal`.
- Visible guidance when the AI runtime is running but has no models available.
- Confirmation dialog before deleting an individual lesson from the library.
- Dev-server warmup (`scripts/dev-warm.mjs`) that pre-compiles the app `layout` chunk, fixing a `ChunkLoadError` race when `tauri dev` opens the window.
- **Regression guards**: `check:tokens` (design tokens), `check:coverage` (per-directory coverage floors), `check:versions` (four-manifest version drift), and `lint:ci` (`--max-warnings 0`).
- **Live integration test** for the LM Studio provider (`LMSTUDIO_LIVE=1`), opt-in and hermetic by default.

### Changed
- **Local runtime priority is now LM Studio first**, with Ollama as the supported alternative. `README.md`, `apps/desktop/README.md`, and `docs/OFFLINE_SETUP.md` were rewritten accordingly — they previously declared Ollama a hard requirement.
- Quiz now renders all questions at once; the single-answer mode that trapped users on question one was removed.
- Quiz evaluation failures are surfaced to the user instead of failing silently.
- Featured lesson content updated to describe the multi-provider runtime honestly (local-first, with optional OpenAI-compatible endpoints).
- Version aligned to 0.2.0 across the root `package.json`, desktop `package.json`, `tauri.conf.json`, and `Cargo.toml`, with a guard to keep them there.
- Provider routing (`computeCanGenerate`, `deriveMode`, `needsApiKey`) extracted from `AIRuntimeProvider` into pure, fully tested functions in `src/lib/ai-runtime/routing.ts`.
- `generation.ts` reduced from 1,580 to 1,469 lines; the dead `getPodcastSystemPrompt` (no production caller) was removed.

### Fixed
- **60+ design-token utility classes compiled to nothing** — `bg-primary-soft`, `to-accent-blue`, `from-accent-*` and others were absent from `tailwind.config.ts`, so selected cards, accent text, and the title gradient rendered unstyled.
- **The declared typeface was never loaded.** A stray `babel.config.js` silently disabled SWC, which `next/font` requires; the file was also unnecessary because Jest transforms with `ts-jest`. Inter is now self-hosted, and the exported lesson HTML no longer names a font it cannot load.
- **`health()` reported an empty recommended model** for LM Studio while listing five models.
- **An embedding-only model could be recommended for generation** — the catalogue mixes `type: "embedding"` with `type: "llm"`.
- **The model-load timeout was 8% from failing**: loading a 4.23 GB model measured 165.9 s against a 180 s budget. Raised to 600 s.
- **`createJourney` could generate colliding ids** when `crypto.randomUUID` was unavailable (`j-<timestamp>` has millisecond resolution), so deleting one journey deleted both.
- **Silent failure when no models are available**: the runtime now reports `available: false` with a guidance message instead of appearing healthy.
- **LM Studio (and other CORS-restricted local servers) reported "Unavailable" in the desktop shell** — requests are now served by the Rust backend, bypassing the browser CORS check.
- **Switching providers could leave a stale model selection**; the Generate page now resets to the active provider's recommended model.
- **Error classification by substring matching at the UI edge** mis-reported failures — a validation error mentioning "voice" was shown as an audio failure. One classifier, in `friendlyErrors.ts`, now handles it, and auth is checked before localhost so a 401 is not reported as "server unreachable".
- **`ollama.ts` bypassed the CORS-free transport**, using raw `fetch` for two calls.
- **The `num_ctx` comment contradicted the code** (documented 8192, coded 24576).
- Dead-end single-answer quiz mode could never advance past question one or reach evaluation.
- `AbortSignal` was dropped by the Ollama transport, making in-flight generation non-cancellable.
- Deleting a library lesson could wipe it plus its quiz results and progress without any confirmation.
- A tracked file referenced an ignored one: `featured-podcast.json` pointed at `Study_Studio_Podcast.mp3` while `*.mp3` was gitignored, so the featured podcast shipped a dangling reference.
- Nine production lint warnings, and 23 false-positive `no-unused-vars` errors caused by using the non-TypeScript-aware ESLint rule.

### Removed
- **The `apps/mobile` Expo scaffold.** It was unreachable code — no tests, hardcoded to Ollama, and it duplicated lesson/audio/storage logic that had already diverged from the desktop app. The structural flaw is that a phone resolves `localhost` to the phone, so the Ollama-only design could never work on the device it was written for. The root `install:mobile` and `typecheck:mobile` scripts were removed with it.

### Security
- **Tauri CSP `connect-src` narrowed from `http://localhost:*` to the seven ports the app actually uses** (11434, 1234, 8080, 3980, 8000, 4000, 21002). The previous wildcard permitted every loopback port, so a compromised dependency could scan local services freely. Caveat: inside the desktop shell the effective gate is the capability file rather than CSP, because `runtimeFetch` routes requests through the Rust backend.
- Documented that API keys are persisted to `localStorage` in plaintext. Moving them behind the OS credential store is **permanently declined** (`AUDIT.md` 5.6): the product intentionally supports browser mode and arbitrary OpenAI-compatible providers, so a Tauri-only keychain command would make credential semantics differ by shell and still could not protect keys already handed to a browser runtime. Provider keys are treated as user-managed secrets.


## [0.1.0] - 2026-08-02

### Added
- Windows x64 release with NSIS, MSI, and portable installers.
- Lesson and podcast generation from a topic or pasted study material, fully local via Ollama.
- Structured lessons with sections, glossary, and quiz; dual-host podcast scripts with TTS playback.
- Piper TTS voice catalog (English US x2, English UK, Arabic Jordanian) with on-demand voice download and MP3/WAV export.
- Session-pinned model selection with smart model detection.
- Quiz & AI Evaluation Engine with personalized feedback.
- HTML export, library persistence, and Tauri desktop shell.
- Desktop-first release; the Expo mobile scaffold was retained but never shipped as a supported client. It was finally removed in 0.2.0.

[0.2.0]: https://github.com/HatemShelby/study-studio/releases/tag/v0.2.0
[0.1.0]: https://github.com/HatemShelby/study-studio/releases/tag/v0.1.0
