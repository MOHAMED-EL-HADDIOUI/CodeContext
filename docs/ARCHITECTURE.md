# CodeContext Architecture

## High-Level System Overview

CodeContext is built on **WXT** targeting **Chrome Manifest V3**, using **React 19**, **TypeScript (strict mode)**, **Tailwind CSS v4**, **Zustand**, **Dexie.js (IndexedDB)**, **MiniSearch**, **Shiki**, **Octokit**, and **Zod**.

```text
Chrome Extension Runtime (MV3)
├── Background Service Worker (entrypoints/background.ts)
│   ├── Context Menu registration & selection capture
│   ├── Keyboard shortcut (Alt+Shift+C) → chrome.sidePanel.open()
│   ├── Zod-validated runtime message router
│   └── Ephemeral pending selection in chrome.storage.session
├── Content Script (entrypoints/content.ts)
│   └── Passive GitHub-scoped listener for explicit selection extraction
├── Popup (entrypoints/popup/)
│   └── Active GitHub repo detector + Side Panel launcher + recent repos
├── Options Page (entrypoints/options/)
│   └── Full-page provider, privacy, indexing limit, and cache management
└── Side Panel (entrypoints/sidepanel/) — Main Workspace
    ├── OnboardingView
    ├── RepositoryBar (URL / Tab indexing, incremental sync, progress, cancel)
    ├── ChatView (9 modes, streaming, consent gate, verified citations)
    ├── ExploreView + CodeViewer (Tree, Symbols, README, Deps, Shiki viewer)
    ├── SearchView (MiniSearch lexical + symbol + filename + local vectors)
    ├── DevToolsView (JSON, Regex, Base64, JWT, Markdown, HTTP, Saved Refs)
    └── SettingsView
```

## Core Pipelines

### 1. GitHub Ingestion & Incremental Indexing (`services/github/`, `features/indexing/`)
1. `parseGitHubUrl()` parses repo URLs, tree URLs, blob URLs (with `#Lstart-Lend`), and `owner/repo` slugs.
2. `GitHubClient` fetches repository metadata, default branch commit SHA, language breakdown, and recursive Git tree via `@octokit/rest`.
3. `shouldIndexFile()` filters excluded directories (`node_modules`, `dist`, `build`, `vendor`, `.git`), lockfiles, binaries, minified/generated files, and oversized files.
4. `computeFilePriority()` ranks READMEs, manifests, root configs, and core source files first so cap limits preserve architectural signal.
5. Incremental diffing compares incoming blob SHAs against stored `RepositoryFile.sha` rows in IndexedDB, reusing unchanged files and pruning deleted files without duplicates.
6. Public files are fetched from `raw.githubusercontent.com` at the pinned commit SHA to conserve GitHub REST API rate limits; private repositories fall back to authenticated `git.getBlob`.

### 2. Code Intelligence & Chunking (`core/parsers/`, `core/symbols/`, `core/chunking/`)
- `extractSymbols()` parses classes, functions, methods (with parent class context), interfaces, types, variables, imports, and Markdown headings with exact 1-based line ranges.
- `chunkSourceFile()` creates symbol-boundary-aware chunks preserving exact `startLine` and `endLine`, with clean overlap splitting for large blocks and line-based fallback for files without symbols.
- `web-tree-sitter` runtime (`public/wasm/tree-sitter.wasm`) is packaged locally for MV3 CSP-compliant WASM parsing.

### 3. Hybrid Local Retrieval (`core/retrieval/`)
- **Lexical**: MiniSearch index with camelCase/snake_case code tokenization and field boosts (`symbolName` 4×, `filePath` 2.5×, `content` 1×) plus exact substring fallback.
- **Symbol & Import Index**: IndexedDB-backed exact/prefix/substring symbol matching.
- **Filename Index**: Path and basename matching.
- **Optional Local Vectors**: Lightweight 128-dimensional local character n-gram/identifier projection vectors stored in IndexedDB `embeddings` table for cosine similarity fusion.

### 4. Grounded AI & Citation Verification (`services/ai/`, `features/ai/rag.ts`, `core/citations/`)
- Modular `AIProvider` interface with `OpenAICompatibleAdapter` (OpenAI, NVIDIA NIM, custom/local) and `AnthropicAdapter` (Messages API).
- Retrieved chunks are budgeted to `contextWindow` and wrapped in `<untrusted_code_data>` boundaries.
- `resolveVerifiedCitations()` maps `[Sn]` references and mentioned paths strictly back to real indexed chunks and generates commit-pinned GitHub blob URLs (`commitSha` + `#Lstart-Lend`).

## Data Persistence Boundaries

| Data Category | Storage Layer | Synced? | Notes |
|---|---|---|---|
| Indexed repos, files, symbols, chunks, chat history, saved refs, embeddings | IndexedDB (`CodeContextDB` via Dexie) | No | Local browser profile only; cleared via Settings |
| Non-secret settings (theme, provider type, model ID, limits, consent) | `chrome.storage.local` | No | Schema-validated with Zod |
| API keys & optional GitHub token | `chrome.storage.session` | No | Ephemeral session memory; cleared when browser closes |
