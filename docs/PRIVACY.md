# Privacy Policy

**Last Updated:** 2026-11-24

CodeContext is designed as a local-first Chrome extension. We do not operate a telemetry server, analytics backend, or proxy service.

## What Data CodeContext Accesses

1. **GitHub Repositories You Explicitly Add**:
   - When you enter a GitHub URL or click **Index Current Tab**, CodeContext fetches repository metadata, file trees, and source files directly from GitHub (`api.github.com` and `raw.githubusercontent.com`) and stores the local index in your browser's IndexedDB.
2. **Webpage Selections You Explicitly Trigger**:
   - CodeContext never silently scrapes browsing history or unrelated tabs.
   - Selected text is captured **only** when you explicitly invoke the context menu (`Ask CodeContext about this selection`), click **Capture** in Chat, or select code inside the local Code Viewer.
3. **Configuration & Session Credentials**:
   - Non-sensitive settings (theme, provider URL, model ID, indexing limits) are stored in `chrome.storage.local`.
   - Optional AI API keys and GitHub tokens are stored only in `chrome.storage.session` and cleared when the browser closes.

## Third-Party Data Transmission

- **Without an AI Provider**: Zero data leaves your browser other than direct GitHub fetches for repositories you request to index.
- **With an AI Provider Configured**: Before your first AI query, CodeContext displays an explicit consent prompt. Once approved, only your question, recent chat turns, and the top retrieved code snippets or attached selection are sent directly from your browser to the AI API endpoint you configured (e.g., OpenAI, Anthropic, NVIDIA NIM, or your own localhost server).
- CodeContext never transmits JWTs inspected in Developer Utilities, local search queries, or browsing history to any remote service.

## User Control & Data Deletion

You have full control over all local data at any time from **Settings → Local Data & Cache**:
- Delete individual indexed repositories and their associated files, symbols, chunks, embeddings, and chat history.
- Export your repository metadata, chat history, and saved references as JSON (excluding credentials).
- Click **Clear all local data** to wipe IndexedDB, settings, and session credentials completely.
