import { createHighlighterCore, type HighlighterCore, type LanguageRegistration } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import githubDarkDefault from 'shiki/themes/github-dark-default.mjs';
import githubLightDefault from 'shiki/themes/github-light-default.mjs';
import { getShikiLanguage } from '../../core/parsers/language';

/**
 * Fine-grained Shiki highlighter using the pure-JS RegExp engine and dynamic
 * per-language grammar imports so the extension bundle stays lean and CSP-safe.
 */
const GRAMMAR_LOADERS: Record<string, () => Promise<{ default: LanguageRegistration[] }>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
};

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [githubDarkDefault, githubLightDefault],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

export async function highlightCodeToLines(
  code: string,
  language: string,
  theme: 'dark' | 'light',
): Promise<string[] | null> {
  try {
    const highlighter = await getHighlighter();
    const shikiLang = getShikiLanguage(language);

    if (shikiLang !== 'text' && !loadedLangs.has(shikiLang)) {
      const loader = GRAMMAR_LOADERS[shikiLang];
      if (loader) {
        try {
          const mod = await loader();
          await highlighter.loadLanguage(mod.default);
          loadedLangs.add(shikiLang);
        } catch {
          // Fallback to plain text if grammar fails to load
        }
      }
    }

    const activeLang = loadedLangs.has(shikiLang) ? shikiLang : 'text';
    const shikiTheme = theme === 'light' ? 'github-light-default' : 'github-dark-default';
    const tokens = highlighter.codeToTokensBase(code, {
      lang: activeLang,
      theme: shikiTheme,
    });

    return tokens.map((lineTokens) =>
      lineTokens
        .map((tok) => {
          const escaped = tok.content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          return tok.color ? `<span style="color:${tok.color}">${escaped}</span>` : escaped;
        })
        .join(''),
    );
  } catch {
    return null;
  }
}
