# Study Studio

Local AI tutor that turns any topic into lessons, quizzes, glossaries, and podcasts. No cloud. No API keys. Runs on your machine.

## What it actually does

Feed it a topic ? \"photosynthesis,\" \"Spanish subjunctive,\" \"how transformers work\" ? and it generates:
- Structured lessons with sections and explanations
- Quiz questions with explanations
- Glossaries with definitions
- Podcast scripts (two voices, Arabic + English available)
- Audio exports (MP3/WAV) via local TTS

## Run it in your browser (easiest)

`ash
cd apps/desktop
npm install
npm run dev
`

Opens at http://localhost:3000. Full UI, no Rust needed.

## Build the desktop app

Needs [Rust](https://rustup.rs):

`ash
cd apps/desktop
npm install
npm run tauri:dev
`

## You need a local AI runtime

Pick one:
- **Ollama** (recommended) ? ollama pull gemma3:12b runs on localhost:11434
- **LM Studio** ? runs on localhost:1234
- Any OpenAI-compatible /v1 endpoint

For audio: install [Piper TTS](https://github.com/rhasspy/piper) and [ffmpeg](https://ffmpeg.org).

## Why I built this

I wanted a tutor that works offline, respects privacy, and doesn't cost /month. Also wanted to learn Tauri and see if local models are good enough for real learning (they are, mostly).

## Stack

- Next.js 14 frontend
- Tauri for desktop
- Expo for mobile (same monorepo)
- Ollama / LM Studio / any OpenAI-compatible for inference
- Piper TTS for local speech

## Status

**Actively used by me.** Desktop builds work. Mobile needs more love. Audio export works if you set up Piper.

Part of the Helix ecosystem: powers learning in [Helix Prime](https://github.com/HatemIsmailShalaby1979/Helix-Prime) and [Helix Education](https://github.com/HatemIsmailShalaby1979/Helix-Education).

## License

MIT