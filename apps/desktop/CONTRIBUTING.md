# Contributing to Study Studio

This project is governed by [Constitution 000](../../constitution.me). Before contributing, read it.

## What we need

- Bug reports with reproduction steps
- Test coverage for new features
- Documentation that corrects stale claims
- Honest assessments of what works and what doesn't

We don't need:
- Features that solve problems nobody has
- Documentation that repeats what the code already says
- Changes without test coverage

## Setup

```bash
cd apps/desktop
npm install
npm run dev
```

Opens at http://localhost:3000.

For the desktop app (Tauri):
```bash
npm run tauri:dev
```

## Code style

- TypeScript strict mode
- ESLint + Prettier
- Follow existing patterns
- All new files must include proper TypeScript types

## Tests

```bash
npm test           # jest
npm run typecheck  # tsc --noEmit
npm run lint       # next lint
```

All tests must pass before a PR.

## Commits

```
type(scope): description

Examples:
feat(generate): add podcast transcript download
fix(evaluate): handle empty quiz submission
docs(readme): update API documentation
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

## Project structure

```
src/
  app/          — Next.js app router pages and API routes
  components/   — React components
  lib/          — Utilities and API clients
types.ts       — TypeScript type definitions
src-tauri/     — Tauri v2 Rust backend
docs/           — Documentation
tests/          — Test files
```

## Security

- Never commit API keys or secrets
- Use environment variables for configuration
- Report security issues privately

## Thank you

Your contributions make this project better. We review every PR carefully.
