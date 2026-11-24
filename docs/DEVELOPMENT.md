# Development Guide

## Prerequisites

- Node.js 20+ (tested on Node 26)
- pnpm 9+ (or npm 10+)
- Google Chrome or Chromium for manual/Playwright extension verification

## Getting Started

```bash
pnpm install
pnpm run dev
```

`pnpm run dev` starts WXT with hot-module reload and opens a temporary Chrome profile with CodeContext loaded.

## Project Structure

- `entrypoints/` — WXT Manifest V3 entrypoints (`background.ts`, `content.ts`, `sidepanel/`, `popup/`, `options/`)
- `components/` — React UI components (`chat/`, `code/`, `common/`, `onboarding/`, `repository/`, `search/`, `settings/`, `tools/`)
- `core/` — Pure code-intelligence logic (`parsers/`, `symbols/`, `chunking/`, `retrieval/`, `citations/`, `security/`, `analysis/`)
- `features/` — Domain workflows (`indexing/`, `ai/`, `utilities/`)
- `services/` — External & platform adapters (`github/`, `ai/`, `storage/`, `browser/`, `code/`)
- `stores/` — Zustand reactive application store (`useAppStore.ts`)
- `types/` — Domain & messaging Zod schemas (`index.ts`, `messages.ts`)
- `tests/` — Vitest unit/integration tests and Playwright browser E2E script
- `scripts/` — Icon generator (`generate-icons.mjs`) and release packager (`build-release.mjs`)
- `.agents/skills/` — Installed open-source development skills (`GoogleChrome/modern-web-guidance`)

## Installed Agent Skills

- `chrome-extensions` — Source: `https://github.com/GoogleChrome/modern-web-guidance` (Apache-2.0)
- `modern-web-guidance` — Source: `https://github.com/GoogleChrome/modern-web-guidance` (Apache-2.0)

## Quality Commands

```bash
pnpm run typecheck     # Strict TypeScript checking
pnpm run lint          # ESLint static analysis
pnpm test              # Vitest unit & integration suite
pnpm run build         # Production Chrome MV3 bundle (.output/chrome-mv3)
pnpm run test:e2e      # Playwright Chromium + axe-core verification
pnpm run release       # Verified release build + ZIP archive in release/
pnpm audit             # Dependency vulnerability audit
```
