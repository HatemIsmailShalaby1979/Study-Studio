# Study Studio - Desktop Architecture

> **This architecture is governed by [Constitution 000](../constitution.me) — the single source of truth.**
> "Architecture serves as the expression of truth. Quality is the effective realisation of truth."
> Every design decision below answers the questions posed in the Constitution: Why is this necessary? What responsibility do I hold? What assumptions have been introduced?

## Overview

The desktop app is a statically exported Next.js application bundled inside a
Tauri 2 shell. Because the frontend is fully static (no Next.js server), there
are **no `/api` routes at runtime**. All AI operations are provided by the Rust
backend and exposed to the UI through Tauri IPC.

## Runtime modes

| Mode | Shell | Model access |
| --- | --- | --- |
| Desktop app (production) | Tauri webview | Rust commands via `invoke()` (IPC) + `tauri-plugin-http` transport (CORS-free) |
| Browser during `next dev` | Plain browser | Direct HTTP to local runtimes (Ollama `:11434`, LM Studio `:1234`, …) |

The two modes are selected automatically by `src/lib/tauri.ts`:

```ts
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
```

Inside the Tauri shell, HTTP requests to AI servers go through
`src/lib/ai-runtime/transport.ts` (`runtimeFetch`), which routes them via
`tauri-plugin-http` to the Rust backend. This bypasses the webview's CORS check
entirely, so servers that do **not** send `Access-Control-Allow-Origin` (LM
Studio, LocalAI, vLLM, LiteLLM, FastChat) work with no server-side setup. In a
plain browser `runtimeFetch` falls back to native `fetch`.

## Data flow (generation)

```
UI (page.tsx / Quiz.tsx)
  -> src/lib/api.ts            (single client adapter)
  -> src/lib/generation.ts     (orchestration: prompt build, model fallback loop, validation)
  -> src/lib/ai-runtime/       (provider registry, session manager, transport)
       -> transport.ts         (CORS-free fetch via tauri-plugin-http)   [desktop shell]
       -> native fetch(...)                                               [browser fallback]
  -> providers                 (Ollama via IPC | OpenAI-compatible /v1 via HTTP)
  -> Rust: src-tauri/src/lib.rs
```

The UI never calls HTTP endpoints directly. `generateLesson()` and
`evaluateQuiz()` are invoked from the client components; the AI Runtime picks
the provider and the transport layer is mode-aware.

## Module map

| Module | Responsibility |
| --- | --- |
| `src/lib/tauri.ts` | `isTauri()` guard + `invokeTauri()` IPC bridge |
| `src/lib/ai-runtime/` | Provider-agnostic AI Runtime: registry, session manager, provider selection |
| `src/lib/ai-runtime/transport.ts` | `runtimeFetch()` — CORS-free HTTP via `tauri-plugin-http` in the desktop shell, native `fetch` otherwise |
| `src/lib/ai-runtime/providers/` | Ollama + OpenAI-compatible (`/v1` chat-completions) providers, URL probing |
| `src/lib/generation.ts` | Lesson + podcast generation orchestration, prompt builders, unified output |
| `src/lib/evaluation.ts` | Quiz evaluation orchestration + non-AI fallback |
| `src/lib/validation.ts` | Zod schemas for requests/outputs |
| `src/lib/tts.ts` | Voice catalog, audio generation, voice download, ffmpeg detection |
| `src/lib/api.ts` | The single entry point the UI imports |

## Rust backend commands

Defined in `apps/desktop/src-tauri/src/lib.rs` (plus `tauri-plugin-http`, which
serves the frontend's AI HTTP requests through the Rust backend — see Runtime
modes above):

- `list_models` / `auto_select_model`
- `chat` / `generate`
- `check_health`
- `set_model` / `get_model`
- `pull_model`
- `start_ollama_if_needed`
- `tts_synthesize` — text to WAV/MP3 via Piper TTS
- `tts_export_audio` — copy audio file to user-chosen destination
- `list_tts_voices` — list downloaded voice models
- `download_tts_voice` — download a voice from HuggingFace on-demand
- `check_ffmpeg` — detect ffmpeg availability

## Static export & routing

- `next.config.mjs` sets `output: "export"` and `trailingSlash: true`.
- Lesson viewing uses a query-parameter route (`/lesson?id=<uuid>`), not a
  dynamic path segment. A dynamic route (`/lesson/[id]`) cannot be pre-rendered
  by a static export, and client navigation to non-prebuilt dynamic params is
  unreliable in `output: export`. The query route renders from a single static
  file and serves every lesson id.
- Lessons are persisted in `localStorage` under `study-studio-library`.

## Security notes

- Local-first: no API keys are required for local providers (Ollama, LM Studio,
  LocalAI, vLLM, LiteLLM, FastChat); optional online providers (OpenAI,
  OpenRouter) require a stored API key.
- The AI HTTP transport in the desktop shell is scoped by the Tauri capability
  file to `http://localhost:*`, `http://127.0.0.1:*`, `https://api.openai.com`,
  and `https://openrouter.ai` only — requests to anything else are rejected by
  the Rust backend before leaving the app.
- The Tauri CSP allows `ipc:` (Tauri IPC) plus `http://localhost:*` /
  `http://127.0.0.1:*` for the browser fallback during development.

## Local audio-file generation (Piper TTS)

Live playback uses the Web Speech API (`speechSynthesis`), which cannot produce
files. For real downloadable audio the app shells out to the **Piper TTS** CLI
from the Rust backend and writes a genuine WAV or MP3 to disk.

### Voice catalog

Four voices are available, on-demand download from HuggingFace. These are
exactly the voices that exist in the official `rhasspy/piper-voices` repo:

| Voice ID | Language | Accent | Gender |
| --- | --- | --- | --- |
| `en_US-lessac-medium` | English | US | Male |
| `en_US-amy-medium` | English | US | Female |
| `en_GB-alba-medium` | English | UK | Female |
| `ar_JO-kareem-medium` | Arabic | Jordanian | Male |

The Arabic voice family in `rhasspy/piper-voices` currently contains only
`ar_JO-kareem-medium`; there is no female Arabic voice, so Arabic podcasts use
the same voice for both hosts. Files live under *nested* repo paths
(`<lang>/<region>/<name>/<quality>/<voice-id>.onnx`), not flat paths —
see `voice_repo_path()` in `tts.rs`.

Voices are downloaded on-demand via the UI. On-disk presence is checked at
runtime by `list_tts_voices` (both `.onnx` + `.onnx.json` must exist).

### Audio pipeline

- Rust module: `apps/desktop/src-tauri/src/tts.rs` — pure, unit-tested
  `synthesize_to_file()`, `available_voices()`, `download_voice()`,
  `ffmpeg_available()`, and `convert_wav_to_mp3()`.
- Commands:
  - `tts_synthesize` — text to WAV at `<app-data>/audio/<lesson_id>.wav`;
    if `format: "mp3"` is requested and ffmpeg is available, converts to MP3.
  - `tts_export_audio` — copy to a user-chosen path (the "Download").
  - `list_tts_voices` — list which voice models are downloaded.
  - `download_tts_voice` — download a voice from HuggingFace.
  - `check_ffmpeg` — detect if ffmpeg is on the system PATH.
- Voice models (`<voice>.onnx` + `.onnx.json`) live in `<app-data>/tts/`.
  Override with `STUDY_STUDIO_PIPER_BIN` / `STUDY_STUDIO_PIPER_MODEL_DIR` env vars.
- Frontend: `apps/desktop/src/lib/tts.ts` (voice catalog, build text, generate,
  save-dialog pick + export) and `components/AudioFileDownload.tsx` (format
  selector with MP3/WAV toggle).
- Save dialog requires `dialog:allow-save` (capabilities) and the
  `@tauri-apps/plugin-dialog` package.

## 3-view lesson navigation

The lesson page (`LessonContent.tsx`) uses a tab bar with three views:

1. **Lesson** — section cards, glossary, quiz (text content)
2. **Audiobook** — audio player with Web Speech API + Piper download
3. **Podcast** — dual-host podcast player with Host A/B voices

Tabs are defined in `components/LessonTabs.tsx`. Voice and format selectors
appear per-tab. On mobile, tab labels collapse to icons.

## Unified generation

`generateLesson()` always produces **both** a lesson (sections + glossary + quiz)
and a podcast (dual-host dialogue + glossary + quiz) from the same source
material. Podcast generation is best-effort — if it fails, the lesson is still
returned. The generate page has a single "Generate Lesson + Podcast" button.

## Known issues (deferred)

Dependency audit results (2026-08-01). No critical vulnerabilities; remediation
deferred by decision so they are not forgotten:

| App | Severity | Packages | Remediation |
| --- | --- | --- | --- |
| Desktop | 6 high / 1 moderate | `next@14` chain via `glob` / `brace-expansion` / `postcss`; `uuid` | Upgrade Next.js to v15 (major), then re-run `npm audit` |
| Mobile | 10 moderate | Expo toolchain (`expo`, `@expo/*`, `xcode`, `uuid`) | Upgrade Expo SDK in a dedicated pass |
