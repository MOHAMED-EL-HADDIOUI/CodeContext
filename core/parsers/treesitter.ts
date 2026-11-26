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

export function getParserResourceUrl(path: string): string | null {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) return chrome.runtime.getURL(path);
  if (globalThis.location?.protocol === 'chrome-extension:') return new URL(`/${path}`, globalThis.location.origin).toString();
  return null;
}

export async function initTreeSitterRuntime(): Promise<boolean> {
  if (treeSitterReady) return true;
  if (!getParserResourceUrl('wasm/tree-sitter.wasm')) return false;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const mod = await import('web-tree-sitter');
      const ParserClass = mod.Parser ?? (mod as unknown as { default?: typeof mod.Parser }).default;
      if (!ParserClass || typeof ParserClass.init !== 'function') {
        return false;
      }

      const locateFile = (scriptName: string): string => getParserResourceUrl(`wasm/${scriptName}`) ?? scriptName;

      await ParserClass.init({ locateFile });
      treeSitterReady = true;
      return true;
    } catch (error) {
      console.warn('Tree-sitter WASM initialization failed:', error instanceof Error ? error.message : error);
      // A transient blocked download can be retried on the next file.
      initPromise = null;
      treeSitterReady = false;
      return false;
    }
  })();

  return initPromise;
}
