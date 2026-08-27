# Study Studio

A local AI learning application that turns topics or study material into structured lessons, quizzes, glossaries, and podcasts. Runs entirely on your machine — no cloud API keys required.

**Study Studio is the learning engine behind the [Helix Prime](https://github.com/HatemIsmailShalaby1979/Helix-Prime) platform and [Helix Education](https://github.com/HatemIsmailShalaby1979/Helix-Education).** It remains a separate, independently versioned repository.

## Quick Start

### Web preview (no Tauri required)

```bash
cd apps/desktop
npm install
npm run dev
```

Opens at **http://localhost:3000** — full UI available in the browser.

### Desktop app (Tauri)

Requires [Rust toolchain](https://rustup.rs) installed:

```bash
cd apps/desktop
npm install
npm run tauri:dev
```

### Prerequisites for AI generation

Study Studio needs a local AI runtime to generate content. Install one:

- [Ollama](https://ollama.com) — recommended, runs on `localhost:11434`
- [LM Studio](https://lmstudio.ai) — runs on `localhost:1234`
- Any OpenAI-compatible `/v1` server

Pull a model if using Ollama:

```bash
ollama pull gemma3:12b
```

### Optional: Audio export

For podcast/lesson audio, install:

- [Piper TTS](https://github.com/rhasspy/piper) — local text-to-speech
- [ffmpeg](https://ffmpeg.org) — required for MP3 export

## What it does

- Generates structured lessons, quizzes, glossaries, and podcasts from a topic
- Auto-detects local AI runtimes and lists available models
- Creates audio on demand and exports MP3 or WAV files
- Provides four real voices, including Arabic (Jordanian)
- Desktop (Tauri + Next.js) and mobile (Expo) in one monorepo

## Tech stack

- Multi-provider AI runtime: Ollama, LM Studio, any OpenAI-compatible server
- CORS-free desktop transport via `tauri-plugin-http`
- Piper TTS for local speech generation
- Next.js 14 frontend
- Tauri desktop application
- Expo mobile application

## Windows installers

v0.1.0 installers are available from [GitHub Releases](https://github.com/HatemIsmailShalaby1979/Study-Studio/releases/tag/v0.1.0):

| Download | Type |
| --- | --- |
| Setup executable | NSIS installer |
| MSI package | Windows Installer |
| Portable executable | No install required |

Requires Ollama running with at least one chat model pulled.

## Repository layout

```text
apps/desktop/  Next.js + Tauri desktop application
apps/mobile/   Expo mobile application
docs/          Project documentation
```

Study Studio shipped as v0.1.0 and is now developed as v0.2.0.

Part of a larger body of work — see [Hatem Shalaby's profile](https://github.com/HatemIsmailShalaby1979) for the full story.
