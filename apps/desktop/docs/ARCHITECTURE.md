# Architecture

> **This architecture is governed by [Constitution 000](../../../constitution.me) — the single source of truth.**
> "Architecture serves as the expression of truth."
> Every design decision below answers: Why is this necessary? What responsibility does this component hold? What assumptions has it introduced?

## Overview

Study Studio is a zero-setup offline educational content generator. It uses a local Ollama instance to run AI models entirely on the user's machine.

```
┌──────────────────────────────────────────────────────────┐
│                   Desktop App (Tauri)                    │
│  ┌────────────────────────────────────────────────────┐  │
│  │              Next.js Frontend                      │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │  │
│  │  │  Lesson   │ │  Podcast │ │    Library       │   │  │
│  │  │  View     │ │  Player  │ │    (localStorage) │   │  │
│  │  └─────┬─────┘ └────┬─────┘ └──────────────────┘   │  │
│  └────────┼─────────────┼──────────────────────────────┘  │
│           │             │                                  │
│  ┌────────▼─────────────▼──────────────────────────────┐  │
│  │              API Routes (/api/*)                    │  │
│  │  /api/generate  /api/evaluate  /api/models         │  │
│  └───────────────────────────┬─────────────────────────┘  │
│                              │                             │
│  ┌──────────────────────────▼──────────────────────────┐  │
│  │           Tauri IPC Bridge (Rust)                   │  │
│  │  check_health  list_models  generate  chat          │  │
│  └───────────────────────────┬─────────────────────────┘  │
└──────────────────────────────┼─────────────────────────────┘
                               │ localhost:11434
┌──────────────────────────────▼──────────────────────────────┐
│                   Ollama Engine                             │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐    │
│  │ deepseek-   │  │  llama3.2   │  │  Other Models     │    │
│  │ coder:6.7b   │  │   :3b       │  │  (pulled on demand)│   │
│  └─────────────┘  └─────────────┘  └──────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **User Input** → Frontend form collects topic/content + options
2. **API Request** → POST to `/api/generate` or `/api/evaluate`
3. **Ollama Call** → API route sends chat completion request to `localhost:11434`
4. **Model Inference** → Ollama runs the selected model locally (GPU if available)
5. **Response Parsing** → API route extracts JSON from model output
6. **Validation** → Zod schemas validate the response structure
7. **Storage** → Lessons saved to browser localStorage
8. **Display** → Rendered in lesson/podcast view components

## Offline Operation

- **No external API calls** — all requests go to `localhost:11434`
- **First-time setup**: User must pull model(s) via `ollama pull`
- **Desktop app**: Tauri sidecar manages Ollama process lifecycle
- **Fallback chain**: If primary model fails, tries fallback models automatically

## Tauri v2 Integration

The Rust backend provides:
- **Sidecar management**: Spawn/monitor `ollama serve` process
- **IPC commands**: `check_health`, `list_models`, `pull_model`, `generate`, `chat`
- **File system access**: For export/import functionality
- **Native dialogs**: Open/save file pickers

## Model Selection

Models are tried in order:
1. User's preferred model (if specified)
2. `qwen3:8b` (primary)
3. `codellama:7b` (fallback)
4. `llama3.2:3b` (lightweight fallback)
5. `qwen2.5:7b` (backup)
6. `mistral:7b` (backup)
