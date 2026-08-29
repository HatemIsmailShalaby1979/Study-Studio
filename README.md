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
- Audio export works when Piper TTS is configured
- Mobile experience remains unfinished
- Local model runtime is required for generation
- No production SaaS or universal learning claim is made

## Run in the browser

    cd apps/desktop
    npm install
    npm run dev

Open http://localhost:3000.

## Local model options

- Ollama — recommended
- LM Studio
- Any OpenAI-compatible local endpoint

For audio, install Piper TTS and ffmpeg.

## Why it matters to Helix Codex

Study Studio is the user-facing learning layer in the Helix ecosystem. It explores how knowledge can be generated, practiced, remembered, and improved locally—without making privacy or affordability afterthoughts.

## Related projects

- [Helix Prime](https://github.com/HatemIsmailShalaby1979/Helix-Prime)
- [Helix Education](https://github.com/HatemIsmailShalaby1979/Helix-Education)
- [L&D Command Center](https://github.com/HatemIsmailShalaby1979/L-D-Command-Center)
- [Portfolio](https://github.com/HatemIsmailShalaby1979/HatemIsmailShalaby1979)

## License

MIT