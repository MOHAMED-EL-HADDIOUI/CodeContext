/**
 * WebAssembly Tree-Sitter runtime loader for Chrome Extension Manifest V3.
 *
 * Packages `tree-sitter.wasm` locally under `public/wasm/tree-sitter.wasm`
 * and complies with Manifest V3 CSP `'wasm-unsafe-eval'`.
 * When a language-specific grammar WASM is unavailable, consumers seamlessly
 * fall back to the deterministic structural symbol parser without throwing.
 */

let initPromise: Promise<boolean> | null = null;
let treeSitterReady = false;

export function isTreeSitterAvailable(): boolean {
  return treeSitterReady;
}

export async function initTreeSitterRuntime(): Promise<boolean> {
  if (treeSitterReady) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const mod = await import('web-tree-sitter');
      const ParserClass = mod.Parser ?? (mod as unknown as { default?: typeof mod.Parser }).default;
      if (!ParserClass || typeof ParserClass.init !== 'function') {
        return false;
      }

      const locateFile = (scriptName: string): string => {
        if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
          return chrome.runtime.getURL(`wasm/${scriptName}`);
        }
        return `/wasm/${scriptName}`;
      };

      await ParserClass.init({ locateFile });
      treeSitterReady = true;
      return true;
    } catch {
      treeSitterReady = false;
      return false;
    }
  })();

  return initPromise;
}
