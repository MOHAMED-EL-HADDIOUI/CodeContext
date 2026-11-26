# Privacy Policy

**Last Updated:** 2026-11-24

CodeContext is designed as a local-first Chrome extension. We do not operate a telemetry server, analytics backend, or proxy service.

## What Data CodeContext Accesses

1. **GitHub Repositories You Explicitly Add**:
   - When you enter a GitHub URL or click **Index Current Tab**, CodeContext fetches repository metadata, file trees, and source files directly from GitHub (`api.github.com` and `raw.githubusercontent.com`) and stores the local index in your browser's IndexedDB.
2. **Webpage Selections You Explicitly Trigger**:
   - CodeContext never silently scrapes browsing history or unrelated tabs.
   - Selected text is captured **only** when you explicitly invoke the context menu (`Ask CodeContext about this selection`), click **Capture** in Chat, or select code inside the local Code Viewer.
3. **Local Folders and ZIP Archives You Explicitly Choose**:
   - Selected local source is parsed locally and stored in IndexedDB for offline exploration and resumable indexing. `.gitignore` is honored; repository code is never executed. Corrupt, oversized, binary, or path-traversal archive entries are rejected or skipped.
   - Local folders and ZIPs do not require GitHub credentials. Local-source citations never invent a GitHub URL.
4. **Configuration & Session Credentials**:
   - Non-sensitive settings (theme, provider URL, model ID, indexing limits) are stored in `chrome.storage.local`.
   - Optional AI API keys and GitHub tokens are stored only in `chrome.storage.session` and cleared when the browser closes.

## Third-Party Data Transmission

- **Without an AI Provider**: No source is sent to an AI endpoint. Explicit GitHub indexing and optional model downloads are the only repository/model network operations.
- **With an AI Provider Configured**: Before the first AI chat or review, CodeContext shows an explicit consent prompt with the selected endpoint, estimated size, included sources, and an expandable exact payload. Once approved, only the question/review prompt, recent chat turns where applicable, selected code, and budgeted retrieved excerpts are sent directly to that AI endpoint. Disabling the persisted consent setting restores the gate for subsequent requests.
- CodeContext never transmits JWTs inspected in Developer Utilities, standalone local search queries, or browsing history to any remote service.
- **Optional neural embeddings** are downloaded only after an explicit action and Hugging Face origin permission. Model files may be cached by Transformers.js for later offline inference. Questions and repository code are processed locally and are not sent to Hugging Face; enabling an AI provider remains a separate consent decision.
- Notebook and review exports are user-initiated local downloads and can contain source excerpts, conversations, or private repository locations. Inspect them before sharing.

## User Control & Data Deletion

You have full control over all local data at any time from **Settings → Local Data & Cache**:
- Delete individual indexed repositories and their associated files, symbols, chunks, embeddings, and chat history.
- Export your repository metadata, chat history, and saved references as JSON (excluding credentials).
- Click **Clear all local data** to wipe IndexedDB, settings, and session credentials completely.
