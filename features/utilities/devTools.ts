/**
 * Local-only Developer Utilities.
 * All processing runs strictly inside the extension without transmitting inputs anywhere.
 */

export interface JsonResult {
  ok: boolean;
  formatted?: string;
  minified?: string;
  error?: string;
  stats?: { keys: number; depth: number; bytes: number };
}

function measureJson(value: unknown, depth = 1): { keys: number; depth: number } {
  if (value === null || typeof value !== 'object') {
    return { keys: 0, depth };
  }
  if (Array.isArray(value)) {
    let keys = 0;
    let maxD = depth;
    for (const item of value) {
      const m = measureJson(item, depth + 1);
      keys += m.keys;
      maxD = Math.max(maxD, m.depth);
    }
    return { keys, depth: maxD };
  }
  const entries = Object.entries(value as Record<string, unknown>);
  let keys = entries.length;
  let maxD = depth;
  for (const [, v] of entries) {
    const m = measureJson(v, depth + 1);
    keys += m.keys;
    maxD = Math.max(maxD, m.depth);
  }
  return { keys, depth: maxD };
}

export function formatAndValidateJson(input: string, indent = 2): JsonResult {
  if (!input.trim()) {
    return { ok: false, error: 'Enter JSON to format or validate.' };
  }
  try {
    const parsed: unknown = JSON.parse(input);
    const formatted = JSON.stringify(parsed, null, indent);
    const minified = JSON.stringify(parsed);
    const metrics = measureJson(parsed);
    return {
      ok: true,
      formatted,
      minified,
      stats: { ...metrics, bytes: new TextEncoder().encode(input).length },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid JSON syntax.',
    };
  }
}

export function encodeBase64Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function decodeBase64Utf8(input: string): { ok: boolean; output?: string; error?: string } {
  try {
    const normalized = input.trim().replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { ok: true, output: new TextDecoder('utf-8', { fatal: false }).decode(bytes) };
  } catch {
    return { ok: false, error: 'Invalid Base64 string.' };
  }
}

export interface JwtInspectionResult {
  ok: boolean;
  header?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  signaturePresent?: boolean;
  isExpired?: boolean;
  expiresAt?: string;
  issuedAt?: string;
  error?: string;
}

/**
 * Inspects a JWT structure 100% locally without transmitting the token anywhere
 * and without claiming cryptographic signature verification.
 */
export function inspectJwtLocally(token: string): JwtInspectionResult {
  const cleaned = token.trim().replace(/^Bearer\s+/i, '');
  const parts = cleaned.split('.');
  if (parts.length !== 3) {
    return { ok: false, error: 'JWT must have 3 dot-separated segments (header.payload.signature).' };
  }
  const hDec = decodeBase64Utf8(parts[0]!);
  const pDec = decodeBase64Utf8(parts[1]!);
  if (!hDec.ok || !pDec.ok || !hDec.output || !pDec.output) {
    return { ok: false, error: 'Unable to Base64URL-decode JWT header or payload.' };
  }
  try {
    const header = JSON.parse(hDec.output) as Record<string, unknown>;
    const payload = JSON.parse(pDec.output) as Record<string, unknown>;
    const exp = typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
    const iat = typeof payload.iat === 'number' ? payload.iat * 1000 : undefined;
    return {
      ok: true,
      header,
      payload,
      signaturePresent: Boolean(parts[2] && parts[2].length > 0),
      isExpired: exp !== undefined ? Date.now() > exp : undefined,
      expiresAt: exp !== undefined ? new Date(exp).toISOString() : undefined,
      issuedAt: iat !== undefined ? new Date(iat).toISOString() : undefined,
    };
  } catch {
    return { ok: false, error: 'JWT header or payload is not valid JSON.' };
  }
}

export interface RegexExplanationResult {
  valid: boolean;
  error?: string;
  tokens: Array<{ part: string; meaning: string }>;
  matches: string[];
}

export function explainAndTestRegex(
  pattern: string,
  flags: string,
  testText: string,
): RegexExplanationResult {
  if (!pattern) {
    return { valid: true, tokens: [], matches: [] };
  }
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Invalid regular expression.',
      tokens: [],
      matches: [],
    };
  }

  const rules: Array<[RegExp, string]> = [
    [/^\^/, 'Matches start of string (or line with m flag)'],
    [/^\$/, 'Matches end of string (or line with m flag)'],
    [/^\\d/, 'Matches any digit (0-9)'],
    [/^\\D/, 'Matches any non-digit character'],
    [/^\\w/, 'Matches any word character (letter, digit, _)'],
    [/^\\W/, 'Matches any non-word character'],
    [/^\\s/, 'Matches any whitespace character'],
    [/^\\S/, 'Matches any non-whitespace character'],
    [/^\\b/, 'Matches a word boundary'],
    [/^\(\?:/, 'Starts a non-capturing group'],
    [/^\(\?=/, 'Starts a positive lookahead assertion'],
    [/^\(\?!/, 'Starts a negative lookahead assertion'],
    [/^\(\?<([A-Za-z_]\w*)>/, 'Starts a named capturing group'],
    [/^\[[^\]]+\]/, 'Character class matching any listed character'],
    [/^\{\d+,?\d*\}/, 'Quantifier specifying exact or ranged repetition count'],
    [/^\+/, 'Quantifier: one or more times'],
    [/^\*/, 'Quantifier: zero or more times'],
    [/^\?/, 'Quantifier: optional (zero or one) or lazy modifier'],
    [/^\|/, 'Alternation (OR) between expressions'],
    [/^\./, 'Matches any character except newline'],
  ];

  const tokens: Array<{ part: string; meaning: string }> = [];
  let rest = pattern;
  let guard = 0;
  while (rest.length > 0 && guard < 80) {
    guard++;
    let matched = false;
    for (const [rx, meaning] of rules) {
      const m = rest.match(rx);
      if (m) {
        tokens.push({ part: m[0], meaning });
        rest = rest.slice(m[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (rest.startsWith('\\') && rest.length >= 2) {
        tokens.push({ part: rest.slice(0, 2), meaning: `Escaped literal "${rest[1]}"` });
        rest = rest.slice(2);
      } else if (rest[0] === '(' || rest[0] === ')') {
        tokens.push({
          part: rest[0],
          meaning: rest[0] === '(' ? 'Starts capturing group' : 'Ends group',
        });
        rest = rest.slice(1);
      } else {
        const lit = rest.match(/^[^^$\\()[\]{}+*?|.]+/)?.[0] ?? rest[0]!;
        tokens.push({ part: lit, meaning: `Literal text "${lit}"` });
        rest = rest.slice(lit.length);
      }
    }
  }

  const matches: string[] = [];
  if (testText) {
    if (regex.global) {
      let m: RegExpExecArray | null;
      let count = 0;
      while ((m = regex.exec(testText)) !== null && count < 50) {
        matches.push(m[0]);
        if (m[0].length === 0) regex.lastIndex++;
        count++;
      }
    } else {
      const m = regex.exec(testText);
      if (m) matches.push(m[0]);
    }
  }

  return { valid: true, tokens, matches };
}

export interface HttpInspectionResult {
  ok: boolean;
  method?: string;
  url?: string;
  headers: Array<{ name: string; value: string }>;
  body?: string;
  summary?: string;
  error?: string;
}

export function explainHttpRequest(raw: string): HttpInspectionResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, headers: [], error: 'Paste a curl command or raw HTTP request.' };
  }

  // Handle curl command
  if (/^curl\s+/i.test(trimmed)) {
    const methodMatch = trimmed.match(/(?:-X|--request)\s+['"]?([A-Z]+)['"]?/i);
    const urlMatch = trimmed.match(/https?:\/\/[^\s'"]+/i);
    const headerRegex = /(?:-H|--header)\s+['"]([^'"]+)['"]/gi;
    const headers: Array<{ name: string; value: string }> = [];
    let hm: RegExpExecArray | null;
    while ((hm = headerRegex.exec(trimmed)) !== null) {
      const rawH = hm[1] ?? '';
      const idx = rawH.indexOf(':');
      if (idx > 0) {
        headers.push({
          name: rawH.slice(0, idx).trim(),
          value: rawH.slice(idx + 1).trim(),
        });
      }
    }
    const dataMatch = trimmed.match(/(?:-d|--data|--data-raw)\s+['"]([\s\S]*?)['"]/);
    const method = (methodMatch?.[1] ?? (dataMatch ? 'POST' : 'GET')).toUpperCase();
    const url = urlMatch?.[0] ?? '(unspecified URL)';

    return {
      ok: true,
      method,
      url,
      headers,
      body: dataMatch?.[1],
      summary: `${method} request to ${url} with ${headers.length} header(s)${dataMatch ? ' and a request body' : ''}.`,
    };
  }

  // Handle raw HTTP request
  const lines = trimmed.split(/\r?\n/);
  const firstLine = lines[0]?.trim() ?? '';
  const reqMatch = firstLine.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)/i);
  if (!reqMatch) {
    return {
      ok: false,
      headers: [],
      error: 'Unrecognized format. Start with a curl command or an HTTP request line (e.g., GET /api/v1/users HTTP/1.1).',
    };
  }
  const method = reqMatch[1]!.toUpperCase();
  const path = reqMatch[2]!;
  const headers: Array<{ name: string; value: string }> = [];
  let bodyStart = -1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      bodyStart = i + 1;
      break;
    }
    const idx = line.indexOf(':');
    if (idx > 0) {
      headers.push({ name: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() });
    }
  }
  const host = headers.find((h) => h.name.toLowerCase() === 'host')?.value;
  const fullUrl = host && path.startsWith('/') ? `https://${host}${path}` : path;
  const body = bodyStart >= 0 ? lines.slice(bodyStart).join('\n').trim() : undefined;

  return {
    ok: true,
    method,
    url: fullUrl,
    headers,
    body: body || undefined,
    summary: `${method} request targeting ${fullUrl} with ${headers.length} header(s)${body ? ' and a payload body' : ''}.`,
  };
}
