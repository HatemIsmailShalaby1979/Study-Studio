# Study Studio

> **A local AI tutor for lessons, quizzes, glossaries, podcasts, and audio learning.**

Study Studio is a privacy-first learning application that runs with local model runtimes such as Ollama or LM Studio. It turns a topic into structured learning material while keeping the user in control of the local environment.

## What it does

- Structured lessons with explanations
- Quiz questions with feedback
- Glossaries and definitions
- Bilingual podcast scripts
- Local audio exports through TTS
- Desktop and browser-oriented workflows

## Status

**Actively used personal product; local-first development.**

- Desktop workflow is functional
- Audio export works when Piper TTS voice models **and** ffmpeg are both installed
- Mobile experience remains unfinished (see `apps/desktop/AUDIT.md` P0-3)
- A local model runtime is required for generation — LM Studio or Ollama
- No production SaaS or universal learning claim is made

## Run in the browser

    cd apps/desktop
    npm install
    npm run dev

Open http://localhost:3000.

In a browser, local runtime calls go direct over HTTP, so the runtime must allow
CORS. The desktop shell does not have that constraint — it routes through the Rust
backend instead.

## Run as a desktop app

Requires the [Rust](https://www.rust-lang.org/) toolchain.

    cd apps/desktop
    npm install
    npm run tauri:dev      # development
    npm run tauri:build    # installer

## Local model options

- [LM Studio](https://lmstudio.ai) — **recommended.** Open the **Developer** tab and start the server (default port `1234`). You do not need to preload a model: pick one in Study Studio's dropdown and the app loads it into memory for you.
- [Ollama](https://ollama.com) — supported alternative (default port `11434`).
- Any OpenAI-compatible local endpoint.

For audio, install Piper TTS voice models **and** ffmpeg. Both are required — Piper
produces the WAV, ffmpeg does the MP3 encode.

## Documentation

- [AI Runtime](docs/AI_RUNTIME.md) — the provider contract and capability model
- [Architecture](docs/ARCHITECTURE.md)
- [Desktop app](apps/desktop/README.md) — setup, Tauri commands, and testing
- [Design system](apps/desktop/DESIGN.md)
- [Audit and fix plan](apps/desktop/AUDIT.md)

## Why it matters to Helix Codex

Study Studio is the user-facing learning layer in the Helix ecosystem. It explores how knowledge can be generated, practiced, remembered, and improved locally—without making privacy or affordability afterthoughts.

## Related projects

- [Helix Prime](https://github.com/HatemIsmailShalaby1979/Helix-Prime)
- [Helix Education](https://github.com/HatemIsmailShalaby1979/Helix-Education)
- [L&D Command Center](https://github.com/HatemIsmailShalaby1979/L-D-Command-Center)
- [Portfolio](https://github.com/HatemIsmailShalaby1979/HatemIsmailShalaby1979)

## License

MIT