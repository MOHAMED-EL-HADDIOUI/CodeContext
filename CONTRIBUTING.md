# Contributing to CodeContext

Thank you for your interest in contributing to **CodeContext**! Every bug report, feature proposal, documentation polish, and pull request is welcome.

## Development Setup

```bash
git clone https://github.com/MOHAMED-EL-HADDIOUI/CodeContext.git
cd CodeContext
pnpm install
pnpm run dev
```

## Before Opening a Pull Request

Run the full quality pipeline locally:

```bash
pnpm run typecheck   # Strict TypeScript check
pnpm run lint        # ESLint static analysis
pnpm test            # Vitest unit & integration tests
pnpm run build       # Production Chrome MV3 build
pnpm run test:e2e    # Playwright Chromium + axe-core a11y verification
```

## Contribution Guidelines

- Keep PRs focused, well-typed (TypeScript strict mode), and covered by tests.
- Never commit API keys, tokens, `.env` files, or secrets.
- Follow Manifest V3 least-privilege permissions and XSS/prompt-injection boundaries documented in [docs/SECURITY.md](docs/SECURITY.md).
- Maintain WCAG AA accessibility across both Dark and Light themes.
