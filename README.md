# Study Studio

**A private AI tutor that runs on your machine. Built solo, self-learning, while switching careers — part of the Helix Codex family of honest, local-first tools.**

Type a topic. Get a structured lesson, a dual-host podcast script, a glossary, and a quiz — without sending a word to the cloud. Study Studio is a desktop app for people who want real learning material and would rather not rent an API key to produce it.

---

## Why this exists

I built Study Studio because the alternatives forced a false choice: pay per token for a hosted tutor, or paste prompts into a chat window and hope the output is usable. Neither is a study tool. Both leak your material somewhere, and neither cares whether the lesson is coherent ten minutes later.

Local models changed the math. A laptop with 16 GB of RAM can run a mid-size instruction model well enough to draft lessons, quizzes, and dialogue. What was missing was the product layer — validation, structure, voice, library, audio — so the model’s answer becomes something you can actually learn from.

That product layer is Study Studio. The model stays on your machine. So does the lesson.

---

## What it does today

| Capability | Status |
| --- | --- |
| Structured lessons (sections, glossary, quiz) | Working |
| Dual-host podcast scripts (English / Arabic) | Working |
| Quiz with local scoring and optional AI evaluation | Working |
| Piper TTS → MP3/WAV export | Working when voice models **and** ffmpeg are installed |
| Multi-provider runtime (LM Studio, Ollama, OpenAI-compatible, optional OpenAI / OpenRouter) | Working |
| On-demand model load from the app (no preloading in LM Studio) | Working |
| Learning Journey (progress, streaks, quiz scores) | Working |
| Library in IndexedDB with legacy localStorage migration | Working |
| Desktop installers (NSIS / MSI / portable) | Built for Windows x64 |
| Mobile client | **Removed** — the Expo scaffold was unreachable code; a phone’s `localhost` is the phone |
| Hosted SaaS | **Not offered** — and not planned as a requirement |

**Honest boundary:** generation needs a local model runtime. Audio export needs Piper voice files plus ffmpeg. There is no “it just works with zero setup” claim, because that would be false on a clean machine.

---

## Run it

### Browser (fastest)

```bash
cd apps/desktop
npm install
npm run dev
```

Open http://localhost:3000. In a browser, calls to local runtimes go direct over HTTP, so those servers must allow CORS. The desktop shell does not have that constraint — it routes through Rust.

### Desktop

Requires the [Rust](https://www.rust-lang.org/) toolchain.

```bash
cd apps/desktop
npm install
npm run tauri:dev      # development
npm run tauri:build    # Windows installer
```

### Local models

- **[LM Studio](https://lmstudio.ai) — recommended.** Start the server from the Developer tab (port `1234`). Pick a model in Study Studio; the app loads it into memory for you.
- **[Ollama](https://ollama.com)** — solid alternative (port `11434`). Hybrid thinking models are handled: structured requests explicitly disable thinking so a 512-token title call is not burned on internal reasoning.
- Any OpenAI-compatible `/v1` endpoint (LocalAI, vLLM, LiteLLM, FastChat).

For audio: install Piper voice models **and** ffmpeg. Piper writes the WAV; ffmpeg encodes the MP3. Both are required for MP3.

---

## Quality, measured

Last full run on this machine (Jest, TypeScript, ESLint):

| Check | Result |
| --- | --- |
| Test suites | **46 passed** |
| Tests | **973 passed** |
| Coverage (statements / branches) | **85.5% / 74.8%** |
| Typecheck | Clean |
| Lint (`--max-warnings 0`) | Clean |
| Design-token guard | Clean |
| Version drift guard (4 manifests) | Clean at 0.2.0 |
| Mutation testing | Blocking in CI (28 targeted mutations) |

Live opt-in suites exist for LM Studio and Ollama (`LMSTUDIO_LIVE=1`, `OLLAMA_LIVE=1`). Without those env vars CI stays hermetic.

Details: [`apps/desktop/QA-WORKFLOW.md`](apps/desktop/QA-WORKFLOW.md), [`apps/desktop/AUDIT.md`](apps/desktop/AUDIT.md).

---

## Documentation

| Document | What it is for |
| --- | --- |
| [AI Runtime](docs/AI_RUNTIME.md) | Provider contract, capabilities, how selection works |
| [Architecture](docs/ARCHITECTURE.md) | Runtime modes, module map, data flow |
| [Desktop app](apps/desktop/README.md) | Setup, Tauri commands, testing |
| [Design system](apps/desktop/DESIGN.md) | Tokens, components, known deviations |
| [Audit](apps/desktop/AUDIT.md) | What was broken, what was fixed, what remains |
| [QA workflow](apps/desktop/QA-WORKFLOW.md) | Gates, coverage floors, mutation testing |
| [Offline setup](apps/desktop/docs/OFFLINE_SETUP.md) | Air-gapped install paths |
| [Contribution](apps/desktop/CONTRIBUTING.md) | How to work in this repo |
| [Changelog](CHANGELOG.md) | Release notes |

---

## The founder’s note

Study Studio is built by **Hatem Ismail Shalaby** — operations architect and AI systems engineer — as part of the Helix line of work: [Helix Prime](https://github.com/HatemIsmailShalaby1979/Helix-Prime), [Helix Education](https://github.com/HatemIsmailShalaby1979/Helix-Education), and [L&D Command Center](https://github.com/HatemIsmailShalaby1979/L-D-Command-Center).

It is not a demo repo. It is the learning engine those products would use if they need lessons and podcasts generated offline. That is why the tests are real, the audit is public, and the status section refuses to inflate: a tool that claims more than it does is worse than useless when someone tries to study with it.

The engineering culture is written down in [Constitution 000](constitution.me) and the [Helix Constitution](docs/HELIX_CONSTITUTION.md). Short version: identity before implementation; every capability answers why it exists; documentation outlives the conversation that produced it.

Portfolio: [HatemIsmailShalaby1979](https://github.com/HatemIsmailShalaby1979).

---

## License

[MIT](LICENSE)



