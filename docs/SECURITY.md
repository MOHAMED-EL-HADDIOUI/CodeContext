# Security Architecture & Threat Model

## Core Security Controls

### 1. Least-Privilege Manifest V3 Permissions
CodeContext declares only the minimal permissions required for its features:
- `storage`, `sidePanel`, `tabs`, `activeTab`, `scripting`, `contextMenus`
- Scoped `host_permissions` strictly for GitHub (`https://api.github.com/*`, `https://raw.githubusercontent.com/*`, `https://github.com/*`)
- `optional_host_permissions` (`https://*/*`, `http://localhost/*`, `http://127.0.0.1/*`) requested dynamically on user gesture only for the specific AI provider origin the user configures.
- Never requests `cookies`, `history`, `debugger`, `clipboardRead`, or `webRequest`.

### 2. Credential Handling Policy
- User AI API keys and optional GitHub fine-grained tokens are stored **exclusively in `chrome.storage.session`**.
- Credentials are **never** stored in IndexedDB, `chrome.storage.sync`, `chrome.storage.local`, or application state exports.
- Credentials are **never** exposed to content scripts, logged to console, or transmitted to any third-party backend other than the user-configured endpoint.
- **Important disclosure**: `chrome.storage.session` is cleared when the browser session ends, but it is **not** a hardware-backed encrypted secret vault. Users should use narrowly scoped keys (e.g., fine-grained read-only GitHub PATs) and rotate keys regularly.

### 3. Prompt-Injection Defense
Source repositories, READMEs, code comments, and webpage selections are untrusted inputs that may contain adversarial instructions.
- Every retrieved code chunk and selection is enclosed in `<untrusted_code_data source="...">...</untrusted_code_data>` tags (with closing tag neutralization).
- The system prompt explicitly directs the model to treat enclosed content strictly as passive data and ignore embedded directives.
- The assistant is strictly **read-only**: it cannot execute repository scripts, invoke shell commands, modify files, or authorize network requests.

### 4. XSS & Unsafe Rendering Prevention
- All AI responses, repository READMEs, and Markdown previews pass through `marked` + **DOMPurify** with forbidden tags (`script`, `style`, `iframe`, `object`, `embed`, `form`, `input`, `textarea`) and forbidden inline event attributes (`onerror`, `onload`, `onclick`, etc.).
- External links automatically receive `target="_blank" rel="noopener noreferrer"`.
- No `eval()`, `new Function()`, or remotely hosted executable JavaScript anywhere in the extension.

### 5. Content Security Policy (CSP) & WASM
- `content_security_policy.extension_pages`: `"script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"`.
- `'wasm-unsafe-eval'` permits local WebAssembly compilation (`wasm/tree-sitter.wasm`) without permitting JavaScript `eval()`.

### 6. Message Validation
- Every `chrome.runtime` message is validated against a strict Zod discriminated union (`ExtensionMessageSchema`) and checked for matching `sender.id === chrome.runtime.id`.

## Reporting Security Issues

If you discover a vulnerability, please avoid posting live credentials or exploit payloads publicly and report directly to the project maintainer with reproduction steps.
