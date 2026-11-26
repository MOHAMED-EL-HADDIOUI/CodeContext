# Production Validation

## Automated checks

- TypeScript strict typecheck and ESLint.
- 39 unit/integration tests, including real IndexedDB v1→v4 and v3→v4 upgrades.
- 1,200-file dependency graph and 5,000-file bounded ingestion checks.
- Production Chromium workflows: onboarding, ZIP import and `.gitignore`, graph/reference navigation, search pinning, notes and reload persistence, review, tools, settings, popup, and options.
- axe-core critical/serious accessibility checks in dark and light themes.
- Real Tree-sitter WASM worker extraction with exported-symbol assertions.
- Release manifest/CSP/permission/entrypoint checks, safe ZIP contents, local parser and ONNX assets, and SHA-256 manifest.
- `pnpm audit` passes with no known vulnerabilities at the time of validation.

## Explicit live checks

- Public GitHub repository indexing and real commit diff retrieval passed through the production service APIs. No credentials were printed or stored by the test.
- Real Transformers.js model download and 384-dimensional inference passed.
- A cold Chromium restart with network offline and remote models disabled completed cached 384-dimensional inference.
- Browser neural inference uses bundled ONNX JavaScript/WASM assets; no CDN script or runtime is required.

## External account boundaries

No live AI-provider response was tested because no provider endpoint/key or transmission approval is configured. The synthetic-fixture provider test is implemented and requires explicit opt-in. Private GitHub repository testing requires an operator-supplied read-only token. Chrome Web Store submission requires the account owner's dashboard review and action; a verified local package is not store approval.

See [RELEASE.md](RELEASE.md) for exact commands and [CHROMEWEBSTORE.md](../CHROMEWEBSTORE.md) for submission materials.
