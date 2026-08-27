# Study Studio — AI Runtime Design
## Runtime-Agnostic Intelligence Layer

**Date:** 2026-08-06  
**Status:** Design Approved — Phases 1–5 Implemented, second-provider proof complete  
**Governed by:** Constitution 000 (`constitution.me`) and the Helix Engineering
Constitution (`docs/HELIX_CONSTITUTION.md`)

---

## 1. Design Philosophy

Study Studio is an **AI Learning Platform**, not an Ollama application. The
current architecture embeds Ollama as identity: `ollama.ts`, `lib.rs`, the
`OllamaInitProvider`, hardcoded model names, `OLLAMA_URL`, `ollama_available`.
This design inverts that relationship.

> **Identity Before Implementation.** The application asks "what can the selected
> runtime do?", never "are we using Ollama?".

```
┌────────────────────────────────────────────────────────────────────────┐
│                              AI RUNTIME                                │
│                                                                        │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │   Provider   │ │  Capability  │ │    Model     │ │  Session     │  │
│  │   Registry   │ │   Registry   │ │   Registry   │ │   Manager    │  │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘  │
│         └────────────────┼────────────────┼────────────────┘          │
│  ┌──────────────┐ ┌──────▼───────┐ ┌──────▼───────┐ ┌──────────────┐  │
│  │   Health     │ │   Chat       │ │  Structured  │ │  Config      │  │
│  │   Monitor    │ │   Engine     │ │  Output      │ │  Manager     │  │
│  └──────────────┘ └──────┬───────┘ └──────┬───────┘ └──────────────┘  │
│  ┌──────────────┐ ┌──────▼───────┐ ┌──────▼───────┐ ┌──────────────┐  │
│  │  Capability  │ │  Model       │ │  Selection   │ │  Retry /     │  │
│  │  Discovery   │ │  Profiling   │ │  Strategy    │ │  Fallback    │  │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
                            │
           ┌────────────────┼────────────────┐
           ▼                ▼                ▼
   ┌──────────────┐ ┌──────────────────────────────┐
   │ Ollama       │ │ OpenAI-Compatible Provider   │
   │ Provider     │ │ (one class, N config         │
   │ (adapter)    │ │  profiles: LM Studio,        │
   │              │ │  OpenRouter, LocalAI,        │
   │              │ │  LiteLLM, vLLM, FastChat)    │
   └──────┬───────┘ └──────────────┬───────────────┘
          │ (Tauri IPC | HTTP | SDK)
          ▼
   Inference runtime
```

Adding another runtime (Anthropic, Gemini, …) is one new provider class —
the runtime cannot tell providers apart by name.

---

## 2. Core Contracts

### 2.1 Capability Model

The application decides behavior by **capability**, never by provider name.

```ts
export type AICapability =
  | "chat"               // general chat completion
  | "structuredOutput"   // JSON-Schema-constrained generation
  | "streaming"          // token streaming
  | "vision"             // image input
  | "reasoning"          // chain-of-thought / reasoning models
  | "tools"              // tool calling / function execution
  | "functionCalling"    // strict function-calling protocol
  | "embeddings"         // vector embeddings
  | "speech"             // TTS / STT
  | "rag"                // retrieval-augmented generation
  | "mcp"                // Model Context Protocol
  | "imageGeneration";
```

Each provider advertises a static capability report and can refine it at
runtime during discovery (e.g. a provider supports `chat` broadly but a
specific model does not support `tools`).

### 2.2 Provider Contract

A provider owns **only**:

- HTTP/SDK/IPC communication
- Authentication
- Streaming (future)
- Model listing
- Capability reporting
- Health

It owns **none** of the business logic. No prompt templates, no retry policy,
no session state, no JSON repair — those live in the Runtime.

```ts
export interface AIProvider {
  readonly descriptor: AIProviderDescriptor;
  capabilities(): AIProviderCapabilities;
  discover(): Promise<AIProviderStatus>;
  health(): Promise<AIHealth>;
  listModels(forceRefresh?: boolean): Promise<AIModel[]>;
  getRecommendedModel(models?: AIModel[]): Promise<string>;
  ensureModel(preferredModel?: string): Promise<string>;
  getModelProfile(modelId: string): Promise<AIModelProfile | null>;
  chat(messages: AIMessage[], options?: AICompletionOptions, model?: string): Promise<string>;
  generate(prompt: string, system?: string, options?: AICompletionOptions, model?: string): Promise<string>;
  /** Optional capability: streamed token output. */
  streamChat?(messages: AIMessage[], options?: AICompletionOptions, model?: string): AsyncIterable<string>;
  /** Optional capability: vector embeddings. */
  embeddings?(input: string | string[], model?: string): Promise<number[][]>;
  /** Optional lifecycle: start the provider's local server (e.g. ollama serve). */
  startRuntime?(): Promise<void>;
  /** Optional capability: pull/install a model. */
  pullModel?(modelId: string): Promise<void>;
}
```

Providers map their wire protocol onto this neutral contract (e.g.
`max_tokens`→`maxTokens`, `response_format`→`format`, `tool_choice`→`toolChoice`);
those mappings live inside the provider, never in application code.

### 2.3 Adding a Provider

One class + one registration:

```ts
import { AIRuntime, OllamaProvider } from "@/lib/ai-runtime";

const runtime = new AIRuntime();
runtime.registerProvider(new OllamaProvider());
runtime.registerProvider(new OpenAICompatibleProvider(lmStudioProfile));
```

Known OpenAI-compatible runtimes are **configuration profiles** of one provider
class (`openAIProviderProfiles`), not separate providers — the runtime cannot
distinguish LM Studio from OpenRouter. Adding a genuinely new protocol
(Anthropic, Gemini) is one new provider class implementing `AIProvider`.

No UI changes. No switch statements. No duplicated logic. The UI enumerates
`runtime.discoverAll()` and renders whatever is available.

---

## 3. Runtime Responsibilities

| Concern | Owner |
| --- | --- |
| Provider enumeration & selection | ProviderRegistry |
| Capability gating (supportsX) | CapabilityRegistry |
| Model metadata, context windows, tools | ModelRegistry |
| Prompt routing to capable provider | AIRuntime.selectProvider |
| Retry / fallback strategy | Runtime (recoverable vs fatal) |
| Structured-output JSON repair | Runtime (shared, provider-independent) |
| Session model pinning | SessionManager |
| Health caching & freshness | HealthMonitor |
| Immutable request defaults | ConfigurationManager |
| Error normalization | Runtime (AppError mapping) |

---

## 4. Consumer Migration Map

| Today | After |
| --- | --- |
| `ollama.ts: chat()` | `aiRuntime.chat()` |
| `ollama.ts: ensureModel()` | `aiRuntime.ensureModel()` |
| `ollama.ts: listModels()` | `aiRuntime.listModels()` |
| `ollama.ts: checkHealth()` | `aiRuntime.health()` |
| `modelProfiler: OLLAMA_URL + fetch` | `aiRuntime.getModelProfile()` |
| `lib.rs: chat/generate/...` | remains a transport for the Ollama provider |

Business modules (`generation.ts`, `evaluation.ts`, `quizEngine.ts`,
`modelProfiler.ts`, `api.ts`) import the Runtime, never a provider.

---

## 5. What Is Preserved (No Rewrite)

- Prompt engineering (`generation.ts`) — untouched
- Validation (`validation.ts`) — untouched
- JSON repair (`ollama.ts::repairJson`) — moved to runtime, unchanged logic
- Retry policy (`retrySameModel`) — unchanged
- Skill injection (`skills.ts`) — untouched
- Topic pipeline state machine — untouched
- Helix telemetry — untouched
- TTS (Piper) — untouched (separate from LLM runtime)

---

## 6. Migration Phases

### Phase 1 — Define core contracts ✔
`src/lib/ai-runtime/*` added: types, registries (provider/capability/model),
session manager, health monitor, config, runtime class. `aiRuntime` singleton
registers the Ollama provider. Business logic (routing, session pinning, JSON
repair, retries) lives in the runtime; providers only execute capabilities.

### Phase 2 — Extract OllamaProvider ✔
Ollama transport calls moved behind `OllamaProvider`. `ollama.ts` is now purely
the provider's transport (Tauri IPC | HTTP). JSON repair moved to the runtime
(`ai-runtime/jsonRepair.ts`) and re-exported for back-compat. Consumers
(`generation.ts`, `evaluation.ts`, `quizEngine.ts`, `modelProfiler.ts`,
`api.ts`) now import the Runtime, never a provider.

### Phase 3 — Wire UI & profiler through Runtime ✔
`api.ts` (`initializeRuntime`, `fetchModels`) routes through `aiRuntime`
(start/lifecycle, listing, recommended model). Model profiling uses
`aiRuntime.getModelProfile()`. Health is centralized in the runtime's
`HealthMonitor`.

### Phase 4 — Prove with a second provider ✔
`OllamaInitProvider` removed; replaced by `AIRuntimeProvider` (`useAIRuntime`).
`NavBar`, `layout.tsx`, `generate/page.tsx` are provider-agnostic (status pill
now "Ready"/"Offline"). `OpenAICompatibleProvider` added: one provider class
speaking the OpenAI `/v1` protocol with configuration profiles for LM Studio,
OpenRouter, LocalAI, LiteLLM, vLLM, and FastChat. Capabilities are discovered,
not hardcoded (embeddings probed, tools/vision derived from model metadata,
chat/structured-output/streaming from the protocol contract). Registered in the
`aiRuntime` singleton alongside Ollama.

**Proof.** `src/lib/__tests__/openaiCompatible.test.ts` Part 2 runs the *real*
`generateLesson` (unchanged business logic) against the OpenAI-compatible
provider: it delivers the real `LESSON_OUTPUT_JSON_SCHEMA` via
`response_format`, returns a valid lesson, and preserves failure semantics
(missing model → `EXTERNAL_API_ERROR`, no retry, no auto-switch). The proof
statement: **the application successfully changed AI runtimes without changing
application behavior.**

### Phase 5 — CORS-free desktop transport ✔
`lib.rs` adds `tauri-plugin-http` (Cargo + capability scope) and the frontend
gains `src/lib/ai-runtime/transport.ts` (`runtimeFetch`). Inside the Tauri
shell every provider/probe HTTP request is served by the Rust backend (reqwest),
which is **not subject to browser CORS** — so local OpenAI-compatible servers
that ship with CORS disabled (LM Studio, LocalAI, vLLM, LiteLLM, FastChat)
work without any server-side configuration. In a plain browser or in tests
(`isTauri()` false) `runtimeFetch` falls back to the native `fetch`, so the web
build and the test suite are unchanged.

The capability scope (SCM-reviewed URLPattern) allows only `http://localhost:*`,
`http://127.0.0.1:*`, `https://api.openai.com`, and `https://openrouter.ai` —
the exact trust boundary the app needs, verified against the same `urlpattern`
crate the plugin uses at runtime.

**Proof.** With the desktop shell running and LM Studio listening on `:1234`
(the server sends **no** `Access-Control-Allow-Origin` header), `runtimeFetch`
through the plugin returns a real response: probe → `providerStatuses` →
provider card green. The same request via the webview's native `fetch` is
blocked by CORS before the app ever sees the body.

---

## 7. Acceptance Criteria

1. `grep -ri "ollama" src/lib/generation.ts` returns nothing.
2. No UI component names a provider except the selector that lists discovered ones.
3. Adding a provider = one class + one `registerProvider()` call.
4. Every existing test still passes with identical behavior.
5. `modelProfiler` reports capabilities, not model-name prefixes.
6. Business modules contain no provider-protocol terms (`max_tokens`,
   `response_format`, `tool_choice`, …) — those mappings live in providers.

---

## 8. Architecture Self-Review (second-provider proof)

Post-implementation review against the constitution's structural requirements:

**Q1. Does the OpenAI-compatible implementation leak OpenAI semantics into the
application layer?**
No. `openaiCompatible.ts` maps the `/v1` wire protocol (`max_tokens`, `top_p`,
`response_format`, `tool_choice`) onto the runtime's neutral contract
(`maxTokens`, `topP`, `format`, `toolChoice`). Business modules
(`generation.ts`, `evaluation.ts`, `quizEngine.ts`, `modelProfiler.ts`,
`api.ts`) call only `aiRuntime.chat/generate/ensureModel/listModels/…`. The
architectural test proves it: `generateLesson` runs unchanged and the real
`LESSON_OUTPUT_JSON_SCHEMA` + lesson system prompt are delivered verbatim
through `response_format`.

**Q2. Does it assume a specific future provider?**
No. It speaks the `/v1` chat-completions protocol — the de-facto compatibility
standard. Capability decisions are discovered, never hardcoded: `embeddings`
via a live probe of `/v1/embeddings`, `tools`/`vision` from per-model metadata
when present (left unadvertised otherwise). LM Studio, OpenRouter, LocalAI,
LiteLLM, vLLM, and FastChat are configuration profiles of one class; no code
path distinguishes them.

**Q3. Can Anthropic/Gemini be added without business-logic changes?**
Yes. Each is one provider class implementing `AIProvider` (protocol + model
mapping) registered in the composition root. The runtime's `selectProvider`
picks by capability; business modules are untouched. This is exactly the
`OllamaProvider` → `OpenAICompatibleProvider` pattern, proven twice.

**Q4. Are providers transport-only?**
Yes. Providers own only HTTP/IPC communication, authentication, model listing,
capability reporting, health, and protocol mapping. Retry policy, session
pinning, JSON repair, prompt engineering, and error classification live in the
runtime and business layer (see §3).

**Q5. Does the runtime remain the sole owner of orchestration?**
Yes. Provider selection (session → default → capability fallback), capability
gating (`requires`), model resolution (`ensureModel`, no auto-switch), health
caching, and structured-output repair are all in `AIRuntime`. Providers are
injected; `createRuntime` is the composition root. The test builds a fresh
runtime with only the OpenAI-compatible provider and routes both `chat` and
`embeddings` through the capability system with zero application changes.
