# Study Studio — Architecture Audit
## Runtime-Agnostic AI Platform Transformation

**Date:** 2026-08-06  
**Author:** Helix Engineering Team  
**Status:** Audit Complete — Recommendations Implemented (see follow-up below)

> **Follow-up (2026-08-06):** The remediation proposed in §6 was implemented.
> Study Studio now ships a provider-agnostic AI Runtime (`src/lib/ai-runtime/`)
> with Ollama as the first provider plus an OpenAI-compatible provider, and a
> CORS-free desktop transport (`transport.ts` via `tauri-plugin-http`) so any
> local `/v1` server (LM Studio, LocalAI, vLLM, LiteLLM, FastChat) and the
> online providers (OpenAI, OpenRouter) work from the same code path. See
> [AI_RUNTIME.md](AI_RUNTIME.md) and [ARCHITECTURE.md](ARCHITECTURE.md). The
> diagrams below document the pre-transformation state the audit examined.

---

## Executive Summary

Study Studio is a well-structured AI Learning Platform with excellent prompt engineering, validation, and session management. **However, it is architecturally bound to Ollama.** Every AI operation assumes Ollama's API, model naming conventions, and capability profile. This audit documents the current coupling and provides the foundation for designing a true AI Runtime.

---

## 1. Current Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                        UI LAYER                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │Generate Page│  │ Lesson Page │  │ Quiz Engine │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
└─────────┼────────────────┼────────────────┼────────────────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API LAYER (api.ts)                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ initializeOllama() | fetchModels() | generateLesson()   │   │
│  │ generatePodcastOnly() | evaluateQuiz()                   │   │
│  └────────────────────────┬────────────────────────────────┘   │
└───────────────────────────┼─────────────────────────────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
┌──────────────────┐ ┌──────────────┐ ┌──────────────┐
│  generation.ts   │ │modelProfiler │ │ quizEngine.ts│
│  evaluation.ts   │ │  .ts         │ │              │
└────────┬─────────┘ └──────┬───────┘ └──────┬───────┘
         │                  │                 │
         └──────────────────┼─────────────────┘
                            ▼
              ┌─────────────────────────┐
              │      ollama.ts          │ ◄── SINGLE POINT OF COUPLING
              │  • chat()               │
              │  • generate()           │
              │  • listModels()         │
              │  • checkHealth()        │
              │  • ensureModel()        │
              │  • extractJson/repair   │
              └───────────┬─────────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
    ┌─────────────────┐       ┌─────────────────┐
    │   Tauri IPC     │       │  Direct HTTP    │
    │  (Rust backend) │       │  (Browser)      │
    └────────┬────────┘       └────────┬────────┘
             │                         │
             ▼                         ▼
    ┌─────────────────┐       ┌─────────────────┐
    │  lib.rs         │       │  Ollama HTTP    │
    │  • chat         │       │  /api/chat      │
    │  • generate     │       │  /api/generate  │
    │  • list_models  │       │  /api/tags      │
    │  • model_profile│       │  /api/show      │
    │  • pull_model   │       │  /api/pull      │
    └─────────────────┘       └─────────────────┘
```

---

## 2. Coupling Analysis

### 2.1 Direct Ollama Dependencies by File

| File | Coupling Type | Severity | Lines |
|------|---------------|----------|-------|
| `ollama.ts` | **Core Provider** | Critical | 493 |
| `generation.ts` | Imports `chat`, `ensureModel`, `extractJsonFromResponse`, `repairJson` | Critical | 1553 |
| `modelProfiler.ts` | Imports `OLLAMA_URL`, `isTauri`, `invokeTauri`; hardcodes model patterns | High | 129 |
| `quizEngine.ts` | Imports `chat`, `checkHealth`, `ensureModel`, `extractJsonFromResponse`, `repairJson` | High | 484 |
| `evaluation.ts` | Imports `chat`, `checkHealth`, `ensureModel`, `extractJsonFromResponse`, `repairJson` | High | 200 |
| `api.ts` | Re-exports generation; imports `listModels`, `getRecommendedModel` | High | 142 |
| `lib.rs` (Rust) | **Entire backend is Ollama-specific** | Critical | 750 |

### 2.2 Hardcoded Ollama Assumptions

| Assumption | Location | Impact |
|------------|----------|--------|
| `OLLAMA_URL = "http://localhost:11434"` | `ollama.ts:3`, `lib.rs:8` | Cannot connect to other runtimes |
| Model capability by name prefix (`qwen2.5`, `llama3.1`, etc.) | `modelProfiler.ts:24-32`, `lib.rs:237-247` | Cannot discover capabilities generically |
| Context window minimums (8192/16384) | `modelProfiler.ts:35-37` | Hardcoded for lesson/podcast |
| Health check returns `ollama_available` boolean | `ollama.ts:271`, `lib.rs:84-88` | UI tied to Ollama status |
| `/api/tags`, `/api/chat`, `/api/generate`, `/api/show`, `/api/pull` | `ollama.ts`, `lib.rs` | API endpoints baked in |
| `num_predict` vs `max_tokens` Ollama quirk | `ollama.ts:89-98`, `lib.rs:32-38` | Provider-specific parameter mapping |
| Tauri commands: `chat`, `generate`, `list_models`, `model_profile`, `pull_model`, `set_model`, `get_model`, `auto_select_model`, `start_ollama_if_needed` | `lib.rs` | Backend cannot support other providers |

### 2.3 What IS Already Decoupled (Good Patterns)

| Component | Decoupled From | How |
|-----------|----------------|-----|
| Prompt engineering (`getLessonSystemPrompt`, `getPodcastSystemPrompt`) | Provider | Pure functions in `generation.ts` |
| Structured output schemas (Zod + JSON Schema) | Provider | `validation.ts` — pure TypeScript |
| JSON extraction/repair (`extractJsonFromResponse`, `repairJson`) | Provider | `ollama.ts` but generic logic |
| Retry logic (`retrySameModel`, `classifyGenerationError`) | Provider | `generation.ts` — generic |
| Skill injection (`SkillInjector`, `skillInjector`) | Provider | `skills.ts` — pure TypeScript |
| Session model pinning (`ensureModel` policy) | Provider | `generation.ts`/`ollama.ts` boundary |
| Topic pipeline state machine | Provider | `topicPipeline.ts` — pure TypeScript |
| Helix event telemetry | Provider | `helixEvents.ts` — pure TypeScript |

---

## 3. Capability Gap Analysis

The application currently assumes these capabilities exist (because Ollama provides them):

| Capability | Current Implementation | Runtime-Agnostic Need |
|------------|------------------------|----------------------|
| **Chat Completion** | `ollama.ts:chat()` | Standardized interface |
| **Structured Output (JSON Schema)** | `ollama.ts` `format` param | Capability flag + fallback |
| **Model Listing** | `ollama.ts:listModels()` | Standardized model metadata |
| **Model Metadata (context, tools)** | `modelProfiler.ts` + `lib.rs:model_profile` | Capability discovery |
| **Health Check** | `ollama.ts:checkHealth()` | Standardized health protocol |
| **Model Pull/Install** | `lib.rs:pull_model` | Optional capability |
| **Streaming** | Not used (all `stream: false`) | Future capability |

**Missing Capabilities** (needed for future runtimes):
- Embeddings
- Vision (image input)
- Function/Tool Calling (partially via structured output)
- Speech (TTS/STT) — currently separate Piper TTS in Rust
- Reranking
- Image Generation
- MCP (Model Context Protocol)

---

## 4. Technical Debt Discovered

| Debt Item | Location | Risk | Remediation |
|-----------|----------|------|-------------|
| Singleton `CACHED_MODELS` global state | `ollama.ts:4-6` | Test pollution, race conditions | Move to Provider instance |
| `isTauri()` checks scattered everywhere | `ollama.ts`, `modelProfiler.ts`, `lib.rs` | Runtime detection leakage | Centralize in Runtime |
| Rust backend duplicates TypeScript logic | `lib.rs` mirrors `ollama.ts` | Divergence risk | Single source of truth |
| `skillInjector` singleton | `skills.ts:145` | Test isolation | Dependency injection |
| Hardcoded priority model list | `ollama.ts:254-256`, `lib.rs:144` | Cannot customize per runtime | Capability-based selection |
| Error strings reference "Ollama" directly | `ollama.ts:190, 243, 310` | User-facing provider leak | Normalize errors |
| `validateModelForTask` hardcodes `needsTools = false` | `modelProfiler.ts:97` | Dead code path | Remove or implement |

---

## 5. Migration Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing Tauri desktop app | High | Critical | Incremental migration, feature flags |
| Rust backend rewrite required | High | High | Keep Rust as one Provider implementation |
| JSON Schema structured output differences | Medium | High | Abstract `format` handling to Provider |
| Model naming/ID differences across runtimes | High | Medium | Normalize in Provider adapter |
| Context window handling differences | Medium | Medium | Capability reporting |
| Streaming not currently used | Low | Low | Add when needed |
| TTS (Piper) is separate from LLM | Low | Low | Keep separate; it's not an LLM capability |

---

## 6. Conclusion

**The architecture is sound but provider-locked.** The business logic (prompt engineering, validation, retry, session management) is well-separated and reusable. The coupling is concentrated in:

1. **`ollama.ts`** — The single TypeScript provider implementation
2. **`lib.rs`** — The Rust/Tauri backend that duplicates Ollama logic
3. **`modelProfiler.ts`** — Capability detection hardcoded to Ollama model names

**Recommendation:** Design an AI Runtime with a Provider interface, extract Ollama as the first Provider implementation, and keep all business logic in the Runtime. This satisfies the mandate: "Replacing Ollama with another runtime should require zero application changes."

---

## Next Steps

1. **Design AI Runtime Architecture** — Define Provider, Capability, Model, Engine interfaces
2. **Create Migration Roadmap** — Incremental phases with validation gates
3. **Implement Core Interfaces** — TypeScript-first, Rust as Provider impl
4. **Extract Ollama Provider** — Move `ollama.ts` + `lib.rs` logic into Provider
5. **Wire Runtime into App** — Replace direct `ollama.ts` imports with Runtime
6. **Validate** — All existing features work identically
7. **Add Second Provider** — Prove architecture with LM Studio or OpenAI