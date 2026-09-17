# Study Studio v0.2.0

> **This project is governed by [Constitution 000](../../constitution.me) — our single source of truth.**
> "Identity must precede implementation."
> Every capability below justifies its existence by answering: Why is this necessary?

**Zero-setup offline AI-powered educational content generator.**

Study Studio transforms any topic or study material into structured lessons, podcast scripts, quizzes, and glossaries — entirely offline using local AI models.

Built with Next.js 14 + Tauri v2, it delivers a native desktop experience with no API keys required for local use, no data leaving your machine, and no internet dependence after initial setup. Local AI runs through LM Studio, Ollama, or any OpenAI-compatible `/v1` server; optional online providers (OpenAI, OpenRouter) can be enabled with a stored API key.

Study Studio is the learning engine used by **Helix Prime** and **Helix Education**, but it is developed and versioned as a **separate repository** and standalone product.

---

## Releases

Study Studio **v0.2.0** is the current development version. The latest published release, **v0.1.0**, is available as a Windows x64 installer from the repository releases. Download and run — no build steps required.

| File | Type |
| --- | --- |
| [study-studio_0.1.0_x64-setup.exe](https://github.com/HatemShelby/study-studio/releases/download/v0.1.0/study-studio_0.1.0_x64-setup.exe) | NSIS installer (recommended) |
| [study-studio_0.1.0_x64_en-US.msi](https://github.com/HatemShelby/study-studio/releases/download/v0.1.0/study-studio_0.1.0_x64_en-US.msi) | MSI installer |
| [study-studio_0.1.0_x64.exe](https://github.com/HatemShelby/study-studio/releases/download/v0.1.0/study-studio_0.1.0_x64.exe) | Portable executable |

**Requirement:** a local model runtime. [LM Studio](https://lmstudio.ai) is the recommended one; [Ollama](https://ollama.com) is also supported. Neither is bundled — see [Prerequisites](#prerequisites).

---

## Features

- **100% Offline (local-first)** — All AI runs locally via LM Studio, Ollama, or any OpenAI-compatible `/v1` server. No API keys required.
- **Multi-Provider Runtime** — Auto-detects local runtimes (LM Studio `:1234`, Ollama `:11434`, LocalAI, vLLM, LiteLLM, FastChat) and optional online providers (OpenAI, OpenRouter); a provider selector on the Generate page switches between them live.
- **Models Load Themselves** — Pick a model from the dropdown and Study Studio loads it into memory for you. You do **not** have to open LM Studio and preload it first. See [Local model setup](#local-model-setup).
- **CORS-Free Desktop Transport** — Requests inside the desktop shell are routed through the Rust backend (`tauri-plugin-http`), so any local server works regardless of its CORS configuration.
- **Skill Injection** — Five methodology packs (Humanizer, Education, OpenLesson, Podcast Ops, NotebookLM Studio) are composed into the prompt and bound automatically at launch, so the loaded model writes lessons and podcasts to a defined standard.
- **Unified Generation** — Every lesson produces both a structured lesson and a dual-host podcast from the same material.
- **Podcast Language & Voice Selection** — choose English or Arabic and pick the host voices **before** generating.
- **3-View Navigation** — Lesson, Audiobook, and Podcast tabs per lesson.
- **Voice Catalog** — 4 real Piper voices (English US ×2, English UK, Arabic Jordanian) with on-demand download from HuggingFace.
- **On-Demand Audio Download** — audio files (MP3/WAV) are created only when you click Save; listening never writes files.
- **Library Persistence** — every generated topic is saved to the Library with its generation date.
- **Session-Pinned Model** — the selected model stays pinned for the whole generation; it never auto-switches mid-way.
- **Smart Model Detection** — Automatically finds and recommends the best available model, preferring one that is already resident.
- **Quiz & AI Evaluation** — Built-in quiz system with intelligent, personalized feedback.
- **HTML Export** — Beautiful, printable HTML format for sharing and archiving.
- **Learning Journey** — Dashboard with lesson progress, quiz scores, and study streak.
- **Native Desktop App** — Windows installer (NSIS/MSI) and portable executable. A local model runtime is a separate prerequisite.

## Prerequisites

- [Node.js](https://nodejs.org/) v22+
- A local model runtime (install separately — not bundled):
  - [LM Studio](https://lmstudio.ai) — **recommended.** Open the **Developer** tab and start the server (default port `1234`).
  - [Ollama](https://ollama.com) — supported alternative (default port `11434`).
- [Rust](https://www.rust-lang.org/) toolchain (for building the Tauri desktop app)
- [Piper](https://github.com/rhasspy/piper) TTS voice models **and** [ffmpeg](https://ffmpeg.org/) — both are required for audio export. ffmpeg is not optional if you want MP3 output.
- At least 8GB RAM (16GB recommended for 7B+ models)

## Local model setup

Study Studio does not require you to preload anything in the runtime's own UI.

1. Start the LM Studio server (Developer tab → Start Server). If you prefer the CLI, `lms server start` does the same thing.
2. Launch Study Studio. It detects the server on `:1234` and lists every downloaded model, showing which ones are resident.
3. Choose a model in the dropdown. If it is downloaded but not loaded, Study Studio loads it into memory and shows a progress indicator while it does.

Loading a large model is not instant — a 4 GB model can take a couple of minutes on a cold cache, and the app waits up to ten minutes before giving up. A model you have already loaded in LM Studio is never reloaded or evicted.

If the server is not running, the app tells you which runtime it looked for instead of failing silently.

## Quick Start

### 1. Install from Release (no build required)

Download the installer for your platform from the [GitHub Releases page](https://github.com/HatemShelby/study-studio/releases/tag/v0.1.0) and run it. The app works out of the box as long as LM Studio (or Ollama) is installed and running.

### 2. Build from Source

```bash
cd apps/desktop
npm install
npm run tauri:build
```

### 3. Run in Development Mode

```bash
npm run tauri:dev
```

## Project Structure

```
study-studio/
├── src/                          # Next.js frontend
│   ├── app/                      # App router pages
│   │   ├── generate/             # Lesson generation page
│   │   ├── lesson/               # Lesson view (3 tabs)
│   │   ├── library/              # Saved lessons library
│   │   ├── page.tsx              # Home page
│   │   └── layout.tsx            # Root layout + font loading
│   ├── components/               # React components
│   │   ├── LessonTabs.tsx        # 3-view tab bar (Lesson/Audiobook/Podcast)
│   │   ├── AudioFileDownload.tsx # Voice & format selectors, download
│   │   ├── AudioPlayer.tsx       # Web Speech API player
│   │   ├── PodcastPlayer.tsx     # Dual-host podcast player
│   │   ├── Quiz.tsx              # Quiz component
│   │   └── ThemeProvider.tsx     # Theme provider
│   ├── lib/                      # Utilities
│   │   ├── api.ts                # Single entry point for all AI calls
│   │   ├── ollama.ts             # Ollama API client (IPC + HTTP fallback)
│   │   ├── tauri.ts              # Tauri IPC bridge
│   │   ├── ai-runtime/           # Provider-agnostic AI Runtime
│   │   │   ├── transport.ts      # CORS-free fetch (Tauri IPC / native)
│   │   │   ├── providers/        # ollama.ts, lmStudio.ts, openaiCompatible.ts
│   │   │   └── ...
│   │   ├── skills/               # Prompt skill packs + intent-routed injector
│   │   ├── generation.ts         # Lesson + podcast generation orchestration
│   │   ├── evaluation.ts         # Quiz evaluation
│   │   ├── tts.ts                # Voice catalog, audio generation
│   │   ├── validation.ts         # Zod validation schemas
│   │   └── error.ts              # Error handling
│   └── types.ts                  # TypeScript types
├── src-tauri/                    # Tauri v2 Rust backend
│   ├── src/
│   │   ├── main.rs               # Entry point
│   │   ├── lib.rs                # Tauri commands
│   │   └── tts.rs                # Piper TTS, voice download, ffmpeg
│   ├── Cargo.toml                # Rust dependencies
│   ├── tauri.conf.json           # Tauri configuration
│   └── capabilities/             # Tauri v2 permissions
├── scripts/
│   └── check-tokens.mjs          # Design-token regression guard
├── docs/
├── AUDIT.md                      # Ruthless audit + fix plan
├── DESIGN.md                     # Design system
├── marketing/                    # Interactive marketing site
├── releases/                     # Built installers (v0.1.0)
└── package.json
```

## Tauri Commands

These commands are the **Ollama backend**. LM Studio and the OpenAI-compatible
providers do not use them — they are reached over HTTP through
`tauri-plugin-http`, which is what makes them work regardless of CORS. The Rust
side is still Ollama-specific; see `AUDIT.md` Phase 3.

| Command | Description |
|---------|-------------|
| `check_health` | Check if Ollama is running |
| `list_models` | List locally available Ollama models |
| `pull_model` | Pull/download an Ollama model |
| `generate` | Generate text via Ollama |
| `chat` | Chat completion via Ollama |
| `set_model` | Set active model |
| `get_model` | Get current model name |
| `auto_select_model` | Auto-select best available model |
| `start_ollama_if_needed` | Start Ollama if not running |
| `tts_synthesize` | Text to WAV/MP3 via Piper TTS |
| `tts_synthesize_podcast` | Dual-voice podcast WAV via Piper (per-line per-voice segments → ffmpeg concat) |
| `tts_export_audio` | Copy audio file to user destination |
| `list_tts_voices` | List downloaded voice models |
| `download_tts_voice` | Download voice from HuggingFace |
| `check_ffmpeg` | Detect ffmpeg availability |

## Testing

```bash
npm test              # jest
npm run test:ci       # jest --ci --coverage (enforces the coverage gate)
npm run typecheck     # tsc --noEmit
npm run lint:ci       # next lint --max-warnings 0
npm run check:tokens  # fails if a design-token utility emits no CSS
npm run verify        # all of the above, plus a production build
```

An opt-in integration test exercises the LM Studio provider against a real server:

```bash
LMSTUDIO_LIVE=1 npx jest src/lib/ai-runtime/__tests__/lmStudio.live.test.ts
# add LMSTUDIO_LIVE_MODEL=<model-key> to include the load/unload cycle
```

## Documentation

- [AI Runtime](../../docs/AI_RUNTIME.md) — the provider contract and capability model
- [DESIGN.md](DESIGN.md) — design system, tokens, and known deviations
- [AUDIT.md](AUDIT.md) — codebase audit and fix plan
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — module layout

## Tech Stack

- **Frontend:** Next.js 14 (React 18), TypeScript, Tailwind CSS
- **Desktop:** Tauri v2 (Rust), Piper TTS, `tauri-plugin-http` (CORS-free transport)
- **AI:** Multi-provider runtime — LM Studio (native API, on-demand model loading) and Ollama, plus any OpenAI-compatible `/v1` server; online OpenAI / OpenRouter optional
- **Testing:** Jest, React Testing Library
- **Validation:** Zod

## License

MIT License — see [LICENSE](LICENSE)

---

Built for the Helix engineering ecosystem. Study Studio is a standalone repository and the learning engine used by Helix Prime and Helix Education. No AI APIs required for local use.
