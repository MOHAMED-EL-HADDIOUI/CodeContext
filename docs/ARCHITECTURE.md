# CodeContext Architecture

## High-Level System Overview

CodeContext is built on **WXT** targeting **Chrome Manifest V3**, using **React 19**, **TypeScript (strict mode)**, **Tailwind CSS v4**, **Zustand**, **Dexie.js (IndexedDB)**, **MiniSearch**, **Shiki**, **Octokit**, and **Zod**.

```text
Chrome Extension Runtime (MV3)
├── Background Service Worker (entrypoints/background.ts)
│   ├── Durable GitHub and ZIP indexing with per-file checkpoints and recovery
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
    ├── RepositoryBar (GitHub refs, folders, ZIP snapshots, resume, workspaces)
    ├── ChatView (9 modes, staged retrieval, exact context preview, consent, citations)
    ├── ReviewView (PR/commit/compare diffs and verified added-line findings)
    ├── NotebooksView (named investigations, pinned notes/search/context, Markdown)
    ├── ExploreView + CodeViewer (Tree, AST Symbols, References, Graph, Shiki viewer)
    ├── SearchView (MiniSearch lexical + symbol + filename + local vectors)
    ├── DevToolsView (JSON, Regex, Base64, JWT, Markdown, HTTP, Saved Refs)
    └── SettingsView
```

## Core Pipelines

### 1. GitHub Ingestion & Incremental Indexing (`services/github/`, `features/indexing/`)
1. `parseGitHubUrl()` parses repo URLs, tree URLs, blob URLs (with `#Lstart-Lend`), and `owner/repo` slugs.
2. `GitHubClient` resolves the requested branch/tag/commit and pinned commit SHA, then fetches metadata, language breakdown, and recursive Git tree via `@octokit/rest`. Slash-containing refs are resolved against the requested path rather than treated as literal directory prefixes.
3. Source identity preserves the repository ref and optional scope; legacy plain `owner/repo` IDs remain readable. GitHub jobs preserve their original locator for exact branch/scope resume. Folder and ZIP sources have distinct local identities and content-derived revisions.
3. `shouldIndexFile()` filters excluded directories (`node_modules`, `dist`, `build`, `vendor`, `.git`), lockfiles, binaries, minified/generated files, and oversized files.
4. `computeFilePriority()` ranks READMEs, manifests, root configs, and core source files first so cap limits preserve architectural signal.
5. Incremental diffing compares incoming blob SHAs against stored `RepositoryFile.sha` rows in IndexedDB, reusing unchanged files and pruning deleted files without duplicates.
6. Public files are fetched from `raw.githubusercontent.com` at the pinned commit SHA to conserve GitHub REST API rate limits; private repositories fall back to authenticated `git.getBlob`.
7. `indexJobs` record pending and completed paths after each file. GitHub and ZIP jobs run in the MV3 background worker; an interrupted job becomes paused and resumes from its checkpoint. Local snapshots permit offline resume; unavailable folder content is reported rather than silently omitted.
8. `services/ingestion/localSources.ts` supports File System Access folders, file-list fallback, bounded ZIP extraction, traversal rejection, binary rejection, and anchored/glob/negated `.gitignore` rules.

### 2. Change Review & Investigations (`features/review/`, `features/investigations/`)
- PR, commit, and compare targets resolve both base and head revisions and persist their actual changed-file patches.
- AI review comments are retained only when the named path exists and its requested range intersects an actual added line. Citations pin the head commit SHA.
- Coverage limits and related source from another indexed revision are disclosed. The consent preview and generation use the same bounded prompt builder.
- Named investigation sessions contain chat messages, notes, pinned files/search results, and Markdown exports. Workspaces combine ref-specific repositories without sharing citation identifiers across revisions.

### 3. Code Intelligence & Chunking (`core/parsers/`, `core/symbols/`, `core/chunking/`)
- `extractSymbols()` is the deterministic structural fallback for classes, functions, methods, interfaces, types, variables, imports, and headings.
- `workers/sourceParser.worker.ts` performs AST extraction and chunking off the UI thread; worker failure falls back to current-context structural parsing instead of silently skipping the file.
- `chunkSourceFile()` creates symbol-boundary-aware chunks preserving exact `startLine` and `endLine`, with clean overlap splitting for large blocks and line-based fallback for files without symbols.
- `web-tree-sitter` runtime and language grammars are packaged locally under `public/wasm/` for MV3 CSP-compliant WASM parsing. It is never a language server: reference and dependency navigation is explicitly approximate lexical/import analysis.
- Virtualized source lines and explorer rows bound DOM cost for large files and trees.

### 3. Hybrid Local Retrieval (`core/retrieval/`)
- **Lexical**: MiniSearch index with camelCase/snake_case code tokenization and field boosts (`symbolName` 4×, `filePath` 2.5×, `content` 1×) plus exact substring fallback.
- **Symbol & Import Index**: IndexedDB-backed exact/prefix/substring symbol matching.
- **Filename Index**: Path and basename matching.
- **Optional Local Vectors**: Lightweight 128-dimensional character n-gram/identifier projections, or explicitly downloaded Transformers.js neural embeddings (MiniLM 384D or Jina 512D). Models and vector dimensions must match before mixing similarity results. The lightweight vectors are not neural embeddings.
- Multiple repositories use reciprocal-rank fusion, query expansion, token-budget allocation, and globally unique source references. Retrieval stage details and exact outgoing source/history previews are exposed to the user.

### 4. Grounded AI & Citation Verification (`services/ai/`, `features/ai/rag.ts`, `core/citations/`)
- Modular `AIProvider` interface with `OpenAICompatibleAdapter` (OpenAI, NVIDIA NIM, custom/local) and `AnthropicAdapter` (Messages API).
- Retrieved chunks are budgeted to `contextWindow` and wrapped in `<untrusted_code_data>` boundaries.
- `resolveVerifiedCitations()` maps `[Sn]` references and mentioned paths strictly back to real indexed chunks and generates commit-pinned GitHub blob URLs (`commitSha` + `#Lstart-Lend`).

## Data Persistence Boundaries

| Data Category | Storage Layer | Synced? | Notes |
|---|---|---|---|
| Indexed repos, files, symbols, chunks, source snapshots, jobs, notebooks, workspaces, diffs, reviews, saved refs, embeddings | IndexedDB (`CodeContextDB` via Dexie) | No | Local browser profile only; cleared via Settings |
| Non-secret settings (theme, provider type, model ID, limits, consent) | `chrome.storage.local` | No | Schema-validated with Zod |
| API keys & optional GitHub token | `chrome.storage.session` | No | Ephemeral session memory; cleared when browser closes |
