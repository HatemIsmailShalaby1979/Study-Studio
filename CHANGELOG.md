# Changelog

All notable changes to Study Studio are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - Unreleased

### Added
- AI Runtime abstraction with pluggable providers (Ollama default plus OpenAI-compatible lmStudio/OpenRouter profiles).
- **CORS-free desktop transport** (`src/lib/ai-runtime/transport.ts` via `tauri-plugin-http`): provider discovery and generation route through the Rust backend inside the desktop shell, so any local OpenAI-compatible server (LM Studio, LocalAI, vLLM, LiteLLM, FastChat) works with no server-side CORS configuration.
- **Provider selector on the Generate page** — switch between detected providers live; the model list and routing follow the selection.
- Learning Journey dashboard with lesson progress, quiz scores, and study streak.
- Skills, voice discovery, and model profiling scaffolding.
- Ollama bootstrap on app mount with retry and status indicator.
- Cancellation for lesson generation: a Cancel button stops an in-flight request end-to-end via `AbortSignal` (Ollama transport and OpenAI-compatible provider both honor it).
- Visible guidance when the AI runtime is running but has no models available (generate page and navigation bar).
- Confirmation dialog before deleting an individual lesson from the library.
- Dev-server warmup (`scripts/dev-warm.mjs`) that pre-compiles the app `layout` chunk, fixing a `ChunkLoadError` race when `tauri dev` opens the window.

### Changed
- Quiz now renders all questions at once; the single-answer mode that trapped users on question one was removed.
- Quiz evaluation failures are surfaced to the user instead of failing silently.
- Featured lesson content updated to describe the multi-provider runtime honestly (local-first, with optional OpenAI-compatible endpoints).
- Version aligned to 0.2.0 across the desktop `package.json`, `tauri.conf.json`, `Cargo.toml`, and `Cargo.lock`.
- README status sections updated for v0.2.0 development while the v0.1.0 release remains the latest published build.
- Tauri CSP widened to `connect-src http://localhost:* http://127.0.0.1:*` to cover the multi-provider localhost scope.

### Fixed
- Silent failure when no models are available: the runtime now reports `available: false` with a guidance message instead of appearing healthy.
- **LM Studio (and other CORS-restricted local servers) reported "Unavailable" in the desktop shell** — requests are now served by the Rust backend, bypassing the browser CORS check.
- **Switching providers could leave a stale model selection** (e.g. OpenRouter models not appearing); the Generate page now resets the selection to the active provider's recommended model.
- Dead-end single-answer quiz mode could never advance past question one or reach evaluation.
- `AbortSignal` was dropped by the Ollama transport, making in-flight generation non-cancellable.
- Deleting a library lesson could wipe it plus its quiz results and progress without any confirmation.

## [0.1.0] - 2026-08-02

### Added
- Windows x64 release with NSIS, MSI, and portable installers.
- Lesson and podcast generation from a topic or pasted study material, fully local via Ollama.
- Structured lessons with sections, glossary, and quiz; dual-host podcast scripts with TTS playback.
- Piper TTS voice catalog (English US x2, English UK, Arabic Jordanian) with on-demand voice download and MP3/WAV export.
- Session-pinned model selection with smart model detection.
- Quiz & AI Evaluation Engine with personalized feedback.
- HTML export, library persistence, and Tauri desktop shell.
- Mobile (Expo) application scaffold.

[0.2.0]: https://github.com/HatemShelby/study-studio/releases/tag/v0.2.0
[0.1.0]: https://github.com/HatemShelby/study-studio/releases/tag/v0.1.0
