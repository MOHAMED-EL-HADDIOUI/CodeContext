# Changelog

## [1.0.0] - 2026-11-24

### Added
- Manifest V3 Chrome extension built with WXT, React 19, TypeScript (strict), and Tailwind CSS v4.
- GitHub repository intelligence supporting repository URLs, subdirectory URLs, file URLs, `owner/repo` shorthand, and one-click active tab indexing.
- Incremental SHA-diffed local codebase indexing into IndexedDB (Dexie) with file filtering, priority ranking, configurable limits, and cancellation.
- Multi-language structural symbol extractor (TypeScript, JavaScript, TSX/JSX, Python, Go, Rust, Java, Kotlin, C#, C++, PHP, Markdown) and symbol-boundary-aware chunking with exact line numbers.
- Local Codebase Explorer with file tree, language filter, symbol browser, sanitized README viewer, dependency explorer, and fine-grained Shiki syntax-highlighted Code Viewer.
- Local hybrid search powered by MiniSearch + symbol matching + filename matching + optional local semantic vector reranking.
- Modular AI provider engine supporting OpenAI-compatible, Anthropic Claude Messages API, NVIDIA NIM, and custom endpoints with SSE streaming, connection testing, and explicit consent gating.
- Verifiable source citations validated against real indexed chunks with commit-pinned GitHub links and inline expandable source excerpts.
- Context menu actions for selected code and documentation passages (`Ask CodeContext about this selection`).
- Local-only Developer Utilities (JSON formatter/validator, Regex explainer/tester, Base64 UTF-8 codec, local JWT inspector, sanitized Markdown preview, HTTP/cURL explainer, and saved references).
- Dark and Light themes, Onboarding screen, Popup, Options page, automated Vitest suite, and Playwright + axe-core E2E verification.
