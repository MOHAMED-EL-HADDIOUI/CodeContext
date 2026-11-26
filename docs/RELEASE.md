# Production Release Guide

## Reproducible verification

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium
pnpm run verify
```

The release command always rebuilds the current source. It validates the manifest, required permissions, entrypoints, CSP, icons, bundled parser and local ONNX runtime assets, source-map exclusion, safe ZIP contents, and SHA-256 checksum. `verify:release` loads the **unpacked release copy** in Chromium, repeats browser and accessibility checks, and verifies actual Tree-sitter parsing.

Release artifacts are written to the ignored `release/` directory. The JSON manifest records version, file count, archive name, and SHA-256; the separate checksum file supports independent verification.

## Upgrade safety

`tests/integration/productionReadiness.test.ts` opens real old-version IndexedDB schemas and upgrades them with the current application schema. Existing repositories, source identities, files, chats, and checkpoint paths are preserved. A running index becomes paused rather than falsely complete. Browser-level upgrade verification with a copy of the previous released build remains a required pre-publication step for schema changes.

## Opt-in integration tests

Default tests have no GitHub, Hugging Face, or AI-provider side effects.

```bash
# Public GitHub indexing and optional PR/commit diff retrieval
pnpm run test:live
# Set CC_TEST_GITHUB_PULL_REQUEST=123 or CC_TEST_GITHUB_COMMIT=<sha> for a real diff.

# Optional private GitHub / pull request (fine-grained read-only token)
CC_TEST_GITHUB_REPOSITORY=owner/repo
CC_TEST_GITHUB_PULL_REQUEST=123
CC_TEST_GITHUB_TOKEN=... pnpm run test:live

# Explicit model download and real local inference
CC_TEST_MODEL_DOWNLOAD=1 pnpm run test:live
# Browser-only download and cold offline cache verification (Windows PowerShell):
$env:CC_TEST_MODEL_DOWNLOAD='1'; node tests/e2e/verify-neural-model.mjs

# Explicit synthetic-fixture AI transmission (never use a private repository here)
CC_TEST_ALLOW_AI=1
CC_TEST_AI_MODEL=your-model
CC_TEST_AI_BASE_URL=https://your-provider.example/v1
CC_TEST_AI_API_KEY=... pnpm run test:live
```

Local Windows secrets can be placed in ignored `.env.test.local` and loaded with `pnpm run test:live`; never commit them. Only the AI test transmits the synthetic `auth.ts` fixture, and only with explicit `CC_TEST_ALLOW_AI=1` consent. No test prints tokens.

## CI and publication

`.github/workflows/verify.yml` validates every pull request and main-branch push and uploads a release-candidate artifact after a successful main-branch run. Store listing/permission disclosures are in `CHROMEWEBSTORE.md`; generated screenshots are in `docs/store/`.

Chrome Web Store publication is a human-controlled account operation. The project provides the verified package and materials, but cannot claim store approval or publish without the account owner's dashboard action. Live AI and private-repository verification likewise require credentials supplied by the operator.

## Large-source behavior

The scale suite covers 1,200-file dependency graphs and 5,000-file bounded source filtering. Dependency lookup and symbol grouping use precomputed maps rather than repeated whole-repository scans. File/symbol/source-line panes are virtualized. Source references remain lexical approximations; Tree-sitter AST symbol extraction is not presented as language-server semantic analysis.
