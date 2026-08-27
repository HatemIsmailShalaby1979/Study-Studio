# Study Studio v0.2.0

> **This project is governed by [Constitution 000](../../constitution.me) — our single source of truth.**
> "Identity must precede implementation."
> Every capability below justifies its existence by answering: Why is this necessary?

**Zero-setup offline AI-powered educational content generator.**

Study Studio transforms any topic or study material into structured lessons, podcast scripts, quizzes, and glossaries — entirely offline using local AI models.

Built with Next.js 14 + Tauri v2, it delivers a native desktop experience with no API keys required for local use, no data leaving your machine, and no internet dependence after initial setup. Local AI runs through Ollama, LM Studio, or any OpenAI-compatible `/v1` server; optional online providers (OpenAI, OpenRouter) can be enabled with a stored API key.

Study Studio is the learning engine used by **Helix Prime** and **Helix Education**, but it is developed and versioned as a **separate repository** and standalone product.

---

## Releases

Study Studio **v0.2.0** is the current development version. The latest published release, **v0.1.0**, is available as a Windows x64 installer from the repository releases. Download and run — no build steps required.

| File | Type |
| --- | --- |
| [study-studio_0.1.0_x64-setup.exe](https://github.com/HatemShelby/study-studio/releases/download/v0.1.0/study-studio_0.1.0_x64-setup.exe) | NSIS installer (recommended) |
| [study-studio_0.1.0_x64_en-US.msi](https://github.com/HatemShelby/study-studio/releases/download/v0.1.0/study-studio_0.1.0_x64_en-US.msi) | MSI installer |
| [study-studio_0.1.0_x64.exe](https://github.com/HatemShelby/study-studio/releases/download/v0.1.0/study-studio_0.1.0_x64.exe) | Portable executable |

**Requirement:** [Ollama](https://ollama.com) installed and running (not bundled). See [Prerequisites](#prerequisites) below.

---

## Features

- **100% Offline (local-first)** — All AI runs locally via Ollama, LM Studio, or any OpenAI-compatible `/v1` server. No API keys required.
- **Multi-Provider Runtime** — Auto-detects local runtimes (Ollama `:11434`, LM Studio `:1234`, LocalAI, vLLM, LiteLLM, FastChat) and optional online providers (OpenAI, OpenRouter); a provider selector on the Generate page switches between them live.
- **CORS-Free Desktop Transport** — Requests inside the desktop shell are routed through the Rust backend (`tauri-plugin-http`), so any local server works regardless of its CORS configuration.
- **Unified Generation** — Every lesson produces both a structured lesson and a dual-host podcast from the same material.
- **Podcast Language & Voice Selection** — choose English or Arabic and pick the host voices **before** generating.
- **3-View Navigation** — Lesson, Audiobook, and Podcast tabs per lesson.
- **Voice Catalog** — 4 real Piper voices (English US ×2, English UK, Arabic Jordanian) with on-demand download from HuggingFace.
- **On-Demand Audio Download** — audio files (MP3/WAV) are created only when you click Save; listening never writes files.
- **Library Persistence** — every generated topic is saved to the Library with its generation date.
- **Session-Pinned Model** — the selected Ollama model stays pinned for the whole generation; it never auto-switches mid-way.
- **Smart Model Detection** — Automatically finds and recommends the best available Ollama model.
- **Quiz & AI Evaluation** — Built-in quiz system with intelligent, personalized feedback.
- **HTML Export** — Beautiful, printable HTML format for sharing and archiving.
- **Learning Journey** — Dashboard with lesson progress, quiz scores, and study streak.
- **Native Desktop App** — Windows installer (NSIS/MSI) and portable executable. Ollama is a separate prerequisite.

## Prerequisites

- [Node.js](https://nodejs.org/) v22+
- [Ollama](https://ollama.com) (required, installed separately — not bundled with the desktop app)
- [Rust](https://www.rust-lang.org/) toolchain (for building the Tauri desktop app)
- [ffmpeg](https://ffmpeg.org/) (optional, for MP3 export)
- At least 8GB RAM (16GB recommended for 7B+ models)

## Quick Start

### 1. Install from Release (no build required)

Download the installer for your platform from the [GitHub Releases page](https://github.com/HatemShelby/study-studio/releases/tag/v0.1.0) and run it. The app works out of the box as long as Ollama is installed and running.

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
│   │   └── layout.tsx            # Root layout
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
│   │   │   ├── providers/        # Ollama + OpenAI-compatible providers
│   │   │   └── ...
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
├── docs/
├── marketing/                    # Interactive marketing site
├── releases/                     # Built installers (v0.1.0)
└── package.json
```

## Tauri Commands

| Command | Description |
|---------|-------------|
| `check_health` | Check if Ollama is running |
| `list_models` | List locally available models |
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
npm test           # jest
npm run typecheck  # tsc --noEmit
npm run lint       # next lint
```

## Tech Stack

- **Frontend:** Next.js 14 (React 18), TypeScript, Tailwind CSS
- **Desktop:** Tauri v2 (Rust), Piper TTS, `tauri-plugin-http` (CORS-free transport)
- **AI:** Multi-provider runtime — Ollama (gemma3:12b default, qwen3:8b recommended for Arabic) plus any OpenAI-compatible `/v1` server; online OpenAI / OpenRouter optional
- **Testing:** Jest, React Testing Library
- **Validation:** Zod

## License

MIT License — see [LICENSE](LICENSE)

---

Built for the Helix engineering ecosystem. Study Studio is a standalone repository and the learning engine used by Helix Prime and Helix Education. No AI APIs required for local use.
