# Offline Setup Guide

> **This guide is governed by [Constitution 000](../../../constitution.me) — the single source of truth.**
> "Never rely on borrowed conviction; earn genuine conviction through deep understanding."
> Offline operation is not a convenience — it is the architectural expression of the principle that trust is built through transparent and honest reasoning. When the AI runs on your machine, there is nothing hidden.

This guide covers setting up Study Studio for 100% offline operation on a machine with no internet access.

Two local runtimes are supported. **LM Studio is recommended**; Ollama works too. Pick one — you do not need both.

## Prerequisites (Offline)

- Node.js v18.17+ (installer downloaded separately)
- Rust toolchain (for the Tauri desktop build)
- A local model runtime (installer downloaded separately):
  - **LM Studio** — recommended
  - **Ollama** — alternative
- For audio export: **Piper** voice models **and** **ffmpeg**. Both are required —
  Piper produces the WAV, ffmpeg does the MP3 encode. Generation, quizzes, and
  glossaries work without them.

## Option A — LM Studio (recommended)

### 1. Install LM Studio

Download the installer from a machine with internet: [lmstudio.ai](https://lmstudio.ai).
Transfer it via USB and install.

The `lms` CLI ships alongside it (`~/.lmstudio/bin/lms`), which is useful for
starting the server without opening the GUI.

### 2. Download Models (Online)

In LM Studio's **Discover** tab, search for and download the models you want. A good
starting point is a 7–8B instruction model with a Q4 quantisation.

Models are stored at:

- **Windows:** `C:\Users\<user>\.lmstudio\models`
- **macOS/Linux:** `~/.lmstudio/models/`

Copy that directory to the offline machine. Models are grouped by publisher
(e.g. `lmstudio-community/`), so keep the structure intact.

### 3. Run

Start the LM Studio server — either open the app and use **Developer → Start Server**,
or from a terminal:

```bash
lms server start          # default port 1234
```

Then launch Study Studio. It detects the server, lists every downloaded model, and
loads whichever one you select. **You do not need to preload the model in LM Studio
first** — the app loads it into memory on demand and shows a progress indicator while
it does. A model you have already loaded is never reloaded or evicted.

Loading a large model is not instant: a 4 GB model can take a couple of minutes on a
cold cache. The app waits up to ten minutes before reporting a failure.

## Option B — Ollama

### 1. Install Ollama

Download the installer from a machine with internet:

- **Windows:** [ollama.com/download](https://ollama.com/download) (OllamaSetup.exe)
- **macOS:** `brew install ollama` or download from ollama.com
- **Linux:** `curl -fsSL https://ollama.com/install.sh | sh`

Transfer the installer via USB and install.

### 2. Pull Models (Online)

On a machine with internet:

```bash
ollama pull qwen3:8b
ollama pull llama3.2:3b
```

Models are stored at:

- **Windows:** `C:\Users\<user>\.ollama\models`
- **macOS/Linux:** `~/.ollama/models/`

Copy the `.ollama/models` directory to the offline machine.

### 3. Run

```bash
ollama serve        # default port 11434
```

## Build and Launch

### Install Node.js + Rust

Transfer and install Node.js and Rust from offline installers.

### Clone and Setup

```bash
git clone https://github.com/HatemShelby/study-studio.git
cd study-studio/apps/desktop
npm install
npm run tauri:build
```

> `npm install` needs network access. Run it on a connected machine and copy
> `node_modules/` across, or vendor a local registry mirror.

## Verifying Offline Operation

1. Disconnect the machine from all networks.
2. Start your runtime: `lms server start` (LM Studio) or `ollama serve` (Ollama).
3. Start Study Studio: `npm run tauri:dev`.
4. Generate a lesson — it should complete with no network access.
5. Open developer tools → Network tab and confirm no external requests are made.

Note that fonts are self-hosted at build time (`next/font`), so typography does not
depend on a CDN.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No local server found | Confirm the runtime is listening: `curl http://localhost:1234/api/v1/models` (LM Studio) or `curl http://localhost:11434/api/tags` (Ollama). |
| Model list is empty | LM Studio: check the Developer tab shows the server as running. Ollama: run `ollama list` to confirm models exist. |
| Model won't load / times out | It may simply be large — a 4 GB model can take minutes cold. Try a smaller quantisation. |
| "No model-load API" error | LM Studio is older than 0.4.0. Update it, or enable Just-In-Time model loading in its settings. |
| Out of memory | Use a smaller model or a lower quantisation. The app requests at most a 32k context; a larger window set in LM Studio itself will use more memory. |
| Slow generation | Enable GPU acceleration in your runtime's settings. |
| Audio export produces no MP3 | Piper **and** ffmpeg are both required. Verify with `piper --help` and `ffmpeg -version`. |
| Tauri build fails | Ensure Rust is up to date: `rustup update`. |
| `next/font` build error | A stray `babel.config.js` or `.babelrc` disables SWC, which `next/font` requires. Remove it. |
