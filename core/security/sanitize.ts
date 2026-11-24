import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Renders untrusted Markdown (AI output, repository READMEs, documentation) into sanitized HTML.
 * Blocks all scripts, inline event handlers, iframes, objects, and javascript: URIs.
 */
export function renderSafeMarkdown(markdown: string): string {
  const rawHtml = marked.parse(markdown, { async: false });
  if (typeof rawHtml !== 'string') return '';

  const sanitized = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  });

  // Enforce rel="noopener noreferrer" and target="_blank" on external links
  return sanitized.replace(
    /<a\s+([^>]*href="https?:\/\/[^"]*"[^>]*)>/gi,
    '<a $1 target="_blank" rel="noopener noreferrer">',
  );
}

/**
 * Prompt-injection defense wrapper:
 * Clearly isolates untrusted repository code / README / webpage text as passive data
 * so malicious instructions embedded inside repositories cannot override system directives.
 */
export function wrapUntrustedDataBlock(label: string, content: string): string {
  const neutralized = content.replace(/<\/untrusted_code_data>/gi, '<\\/untrusted_code_data>');
  return `<untrusted_code_data source="${label.replace(/"/g, "'")}">\n${neutralized}\n</untrusted_code_data>`;
}

export function sanitizeForLogging(text: string): string {
  return text
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, '[REDACTED_KEY]')
    .replace(/(nvapi-[A-Za-z0-9_-]{12,})/g, '[REDACTED_KEY]')
    .replace(/(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, '[REDACTED_GH_TOKEN]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, '$1[REDACTED_TOKEN]');
}
