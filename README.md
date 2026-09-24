# Study Studio

> **Status: Working, local-first — 46 test suites and 973 tests passing, 85.5% statement / 74.8% branch coverage (snapshot 2026-09-24). Generation requires a local model runtime. Audio export requires Piper voice files plus ffmpeg. No hosted SaaS. No external audit.**

**A component of Helix Codex. A private AI tutor that runs on your machine.**

Type a topic. Get a structured lesson, a dual-host podcast script, a glossary, and a quiz, without sending a word to the cloud. Study Studio is a desktop app for people who want real learning material and would rather not rent an API key to produce it.

It is not Helix Prime. It is a component: the product layer that turns a local model into study material.

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

Snapshot 2026-09-24. Last full run on this machine (Jest, TypeScript, ESLint):

| Check | Result | Snapshot |
| --- | --- | --- |
| Test suites | 46 passed | 2026-09-24 |
| Tests | 973 passed | 2026-09-24 |
| Coverage (statements / branches) | 85.5% / 74.8% | 2026-09-24 |
| Typecheck | Clean | 2026-09-24 |
| Lint (`--max-warnings 0`) | Clean | 2026-09-24 |
| Design-token guard | Clean | 2026-09-24 |
| Version drift guard (4 manifests) | Clean at 0.2.0 | 2026-09-24 |
| Mutation testing | Blocking in CI (28 targeted mutations) | 2026-09-24 |

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

## Honest boundary

Generation needs a local model runtime. Audio export needs Piper voice files plus ffmpeg. On a clean machine with neither, the app will not produce lessons or audio. The mobile client was removed, and a hosted SaaS is not offered.

This is not a production deployment claim. There is no external audit, no certified data isolation, and no signed security review. No revenue has been realised.

---

## Related work

- [Helix Prime](https://github.com/HatemIsmailShalaby1979/Helix-Prime) — the operations core
- [Helix Education](https://github.com/HatemIsmailShalaby1979/Helix-Education) — event-sourced learning engine
- [L&D Command Center](https://github.com/HatemIsmailShalaby1979/L-D-Command-Center) — desktop learning and career workstation
- [Blue Waves](https://github.com/HatemIsmailShalaby1979/Blue-Waves-) — content studio
- [LIVE Support Assistant](https://github.com/HatemIsmailShalaby1979/LIVE-Support-Assistant) — explainable support prototype
- [Full portfolio](https://github.com/HatemIsmailShalaby1979) — the front door

### The 2026 building attempts

- [WFM Forecasting Calculator](https://github.com/HatemIsmailShalaby1979/wfm-forecasting-calculator)
- [RTA Command Center](https://github.com/HatemIsmailShalaby1979/RTA_command_center)
- [CX Sentiment Sentinel](https://github.com/HatemIsmailShalaby1979/cx-sentiment-sentinel)
- [Dynamic Ops Automation Engine](https://github.com/HatemIsmailShalaby1979/Dynamic-Ops-Automation-Engine)

---

## The founder's story

I spent twenty-eight years in operations. The first fourteen were the
foundation: ground operations and real-time traffic management at Hurghada
International Airport, then Air Berlin, where I directed ground operations
through the 2011 regional transition and held SLA compliance under conditions
that had no playbook. Alongside that, international logistics at Shorouk
International Bookshop and hybrid IT operations at Nefertari American School.

The second fourteen were about automation. I built AI-driven automation for
contact centres at ByteDance, Vodafone and Uber: NLP pipelines that turn
unstructured customer language into signal, Erlang C forecasting that turns
volume into staffing, and the reporting layers that made both usable by people
on the floor. The hard part was never the model. It was the handover — who owns
the decision, what evidence supports it, and what happens when the system is
wrong.

In April 2026 I left that career and started building full time — alone, and
teaching myself to write software as I went. The first four tools were published
six weeks later, in May and June 2026. Each one took a single operational problem
and solved it properly. They were not impressive. They were correct.

Those four tools converged into one idea: **Helix Codex**, an accountable AI
operating organization. Not an autonomous agent. An organization with a
constitution, named roles with bounded authority, evidence trails, and a human at
every consequential boundary. Helix Prime is its operations core.

Study Studio is a component of Helix Codex. It is maintained by one person, with no team and
no funding. It has not been externally audited and it has not made revenue. Where
it is unfinished, this document says so.

The engineering culture behind it is written down in [Constitution 000](constitution.me) and the [Helix Constitution](docs/HELIX_CONSTITUTION.md): identity before implementation; every capability answers why it exists; documentation outlives the conversation that produced it.

## Author

**Hatem Ismail Shalaby** — Operations Architect · AI Systems Engineer · Founder

- GitHub: [HatemIsmailShalaby1979](https://github.com/HatemIsmailShalaby1979)
- LinkedIn: [hatem-shalaby-202902127](https://www.linkedin.com/in/hatem-shalaby-202902127/)
- Email: hatemshalaby2025@gmail.com
- Education: BSc Managerial Sciences (Computer Section), Sadat Academy for Management Sciences; Business Analytics Nanodegree, Udacity

Based in Al Obour City, Al-Qalyubia Governorate, Egypt.

## Licence

[MIT](LICENSE)
