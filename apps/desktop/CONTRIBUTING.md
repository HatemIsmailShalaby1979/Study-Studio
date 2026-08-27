# Contributing to Study Studio

> **This project is governed by [Constitution 000](../../constitution.me) — our single source of truth.**
> Every contribution must answer the Constitution's questions:
> - **Why is this necessary?** — the capability must justify its existence.
> - **What responsibility do I hold?** — every designation must clarify its role.
> - **What assumptions have been introduced?** — every decision must reveal its assumptions.
>
> "Never rely on borrowed conviction; earn genuine conviction through deep understanding."

## Principles

1. **Truth is paramount.** Do not add code, features, or abstractions you do not understand. If you cannot explain why something is necessary, it does not belong.
2. **Architecture is the expression of truth.** Code structure reflects understanding. If the understanding is unclear, the architecture will be too.
3. **Quality is the effective realisation of truth.** Tests, types, and validation are not overhead — they are the mechanisms by which truth is verified.
4. **Document enduring knowledge.** Every discussion that generates lasting insight must be recorded as an artifact. Memory must outlive the conversation.

## Development Setup

1. **Clone the repo**
2. **Install dependencies**: `npm install`
3. **Install Rust** (if building desktop app):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
4. **Pull AI models**: `npm run ollama:pull`
5. **Start Ollama**: `ollama serve`
6. **Start dev server**: `npm run dev`

## Code Style

- TypeScript strict mode
- ESLint + Prettier
- Follow existing patterns in the codebase
- All new files must include proper TypeScript types

## Pull Request Process

1. Ensure all tests pass: `npm test`
2. Run typecheck: `npm run typecheck`
3. Run lint: `npm run lint`
4. Update documentation if changing APIs
5. Update tests for new features

## Git Commit Format

```
type(scope): description

Examples:
feat(generate): add podcast transcript download
fix(evaluate): handle empty quiz submission
docs(readme): update API documentation
```

## Project Structure

```
src/
  app/          — Next.js app router pages and API routes
  components/   — React components
  lib/          — Utilities (ollama client, validation, errors)
  types.ts      — Shared TypeScript types
src-tauri/      — Tauri v2 Rust backend
docs/           — Documentation
tests/          — Test files
```

## Architecture

- Frontend calls Next.js API routes (`/api/*`)
- API routes call local Ollama instance (`http://localhost:11434`)
- Desktop app (Tauri) manages Ollama as a sidecar process
- No external API dependencies — 100% offline

## Testing

- Unit tests via Jest + React Testing Library
- Run `npm test` before submitting PRs
- Add tests for new components and API routes
