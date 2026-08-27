# Study Studio

Study Studio is a local AI learning application that turns topics or study material into structured lessons, quizzes, glossaries, and podcasts.

**Study Studio is the learning engine behind the [Helix Prime](#helix-prime--helix-education) platform and [Helix Education](#helix-prime--helix-education).** It remains a **separate, independently versioned repository** that those products consume as their AI-learning core.

## Current status

Study Studio **v0.2.0** is the current development version. The latest published release remains **v0.1.0** for Windows x64 with NSIS, MSI, and portable installers.

The desktop app is **local-first and multi-provider**. Generation runs against any detected runtime:

- **Local:** Ollama (`:11434`), LM Studio (`:1234`), LocalAI, vLLM, LiteLLM, FastChat — any OpenAI-compatible `/v1` server.
- **Online (optional):** OpenAI and OpenRouter, gated behind a stored API key.

Requests from the desktop shell are routed through the Rust backend (`tauri-plugin-http`), so the app works with **any** local server regardless of its CORS policy — no server-side CORS configuration required. Speech is generated locally through Piper TTS.

The repository contains desktop (Tauri) and mobile (Expo) applications in one monorepo.

## What it does

- Generates structured lessons, quizzes, glossaries, and podcasts from a topic or study material.
- Auto-detects local runtimes and lists their models; a provider selector on the Generate page switches between them live.
- Creates audio on demand and exports MP3 or WAV files.
- Provides four real voices, including Arabic (Jordanian).
- Keeps the selected model pinned for the session.
- Supports desktop and mobile applications in one repository.

## Tech stack

- Multi-provider AI runtime: Ollama + any OpenAI-compatible `/v1` server (LM Studio, LocalAI, vLLM, LiteLLM, FastChat), plus OpenAI and OpenRouter for online use
- CORS-free desktop transport via `tauri-plugin-http` (requests served by the Rust backend)
- Piper TTS for local speech generation
- Tauri desktop application
- Expo mobile application
- Windows x64 installers: NSIS, MSI, and portable
- MP3 and WAV audio export

## Helix Prime & Helix Education

Study Studio is developed as its own repository and shipped as its own product.

- **Helix Prime** — the metacognitive learning platform; uses Study Studio as its AI lesson/quiz/podcast generation engine.
- **Helix Education** — the evaluation and telemetry layer; consumes Study Studio's quiz and evaluation event stream (`helixEvents.ts`, matching the Helix Education `state_core` contract).

These products depend on Study Studio. Study Studio does **not** depend on them — it stays standalone so it can be versioned and released independently. Governed by [Constitution 000](constitution.me) and the [Helix Engineering Constitution](docs/HELIX_CONSTITUTION.md).

## Windows release

v0.1.0 installers are available from GitHub Releases:

| Download | Type |
| --- | --- |
| [Setup executable](https://github.com/HatemShelby/study-studio/releases/download/v0.1.0/study-studio_0.1.0_x64-setup.exe) | NSIS installer |
| [MSI package](https://github.com/HatemShelby/study-studio/releases/download/v0.1.0/study-studio_0.1.0_x64_en-US.msi) | Windows Installer |
| [Portable executable](https://github.com/HatemShelby/study-studio/releases/download/v0.1.0/study-studio_0.1.0_x64.exe) | Portable build |

Ollama must be installed and running with at least one chat model pulled. Piper TTS and ffmpeg are optional for audio export; MP3 export requires ffmpeg.

## Development setup

### Desktop

```bash
cd apps/desktop
npm install
npm run tauri:dev
```

Build the Windows application with:

```bash
npm run tauri:build
```

### Mobile

```bash
cd apps/mobile
npm install
npm start
```

## Repository layout

```text
apps/desktop/  Tauri desktop application
apps/mobile/   Expo mobile application
docs/          Project documentation
releases/      Windows release files
```

Study Studio shipped as a real v0.1.0 release and is now developed as v0.2.0. Future changes should preserve its local-first behavior and honest status reporting.

Part of the Helix engineering ecosystem — see [Helix Prime & Helix Education](#helix-prime--helix-education).
