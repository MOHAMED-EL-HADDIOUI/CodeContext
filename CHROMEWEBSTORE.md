# Chrome Web Store Listing — CodeContext

**Last Updated:** 2026-11-24

## Listing Metadata

- **Name:** CodeContext
- **Short Summary (≤132 chars):** Explore GitHub repositories, search symbols locally, and ask AI questions with verifiable commit-pinned source citations.
- **Category:** Developer Tools
- **Language:** English

## Store Description

Understand any GitHub repository without leaving Chrome.

CodeContext opens right inside Chrome's Side Panel to help you explore unfamiliar repositories, navigate functions and classes, search source code locally, and ask grounded AI questions backed by verifiable line citations.

**What you can do with CodeContext:**
- **Explore GitHub repositories in seconds:** Add any public repository by URL or index the GitHub tab you are currently viewing. Browse nested file trees, filter by language, inspect symbols, read READMEs, and inspect project dependencies.
- **Search code locally without an API key:** Find functions, classes, imports, filenames, and exact text snippets instantly inside your browser.
- **Highlight and inspect code:** Open any indexed file with syntax highlighting, line numbers, in-file search, symbol jump, and one-click links to the exact commit on GitHub.
- **Ask AI with verifiable citations:** Connect your own OpenAI-compatible, Anthropic, NVIDIA NIM, or local endpoint. Ask architecture, execution-flow, debugging, or documentation questions and click any citation to jump straight to the matching source lines.
- **Analyze selected code or documentation anywhere:** Right-click selected code or technical docs on any page to explain it simply, find bugs, generate tests, extract API parameters, or save references locally.
- **Built-in offline developer utilities:** Format and validate JSON, test and explain regular expressions, encode/decode Base64, inspect JWT structures locally without transmitting tokens, preview Markdown, and break down HTTP/cURL requests.

## Permissions Justification

| Permission | Justification |
|---|---|
| `storage` | Saves user preferences (theme, indexing limits, provider configuration) locally and stores user-entered API keys ephemerally in session storage. |
| `sidePanel` | Displays the main CodeContext workspace beside GitHub and documentation pages. |
| `tabs` | Reads the active tab's URL when the user clicks "Index Current Tab" or opens the popup on a GitHub repository page. |
| `activeTab` | Grants temporary access to the active page when the user explicitly clicks "Capture" or uses the context menu to analyze selected text. |
| `scripting` | Extracts only the user's current text selection from the active tab when explicitly requested by the user. |
| `contextMenus` | Adds "Ask CodeContext about this selection" and "Analyze documentation passage in CodeContext" to the right-click menu on selected text. |
| Host: `https://api.github.com/*`, `https://raw.githubusercontent.com/*`, `https://github.com/*` | Retrieves repository metadata, file trees, and source files directly from GitHub for repositories the user chooses to index. |
| Optional Host: `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*` | Requested only when the user configures and tests a specific AI provider endpoint (e.g., OpenAI, Anthropic, NVIDIA NIM, or a local model server). |

## Privacy & Data Use Disclosure

- **Does not sell user data** or run telemetry/analytics servers.
- **Local-first storage:** Indexed repositories, search indexes, and chat history are stored locally in IndexedDB and can be deleted at any time.
- **Ephemeral credentials:** Optional AI API keys and GitHub tokens are held in session storage only and cleared when Chrome exits.
- **Explicit user consent:** Source code excerpts are only sent to the user's configured AI endpoint after explicit consent.

## Assets Checklist

- Extension icons: `icons/icon-16.png`, `icons/icon-32.png`, `icons/icon-48.png`, `icons/icon-128.png` (generated and verified).
- Store screenshots needed before submission: 1280×800 screenshots showing Side Panel Chat with Citations, Code Explorer + Shiki Viewer, Local Search, and Settings.

## Version History

- **1.0.0** (2026-11-24): Initial production release.
