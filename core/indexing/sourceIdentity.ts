import type { RepositorySource } from '../../types';

export interface SourceIdentityInput {
  source?: RepositorySource;
  owner: string;
  name: string;
  ref?: string;
  scopePath?: string;
}

export function normalizeScopePath(path?: string): string | undefined {
  const normalized = path?.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
  return normalized || undefined;
}

/** A source revision is part of identity, never silently merged with another branch or folder scope. */
export function createSourceId(input: SourceIdentityInput): string {
  const source = input.source ?? 'github';
  const fullName = `${input.owner}/${input.name}`.toLowerCase().replace(/\.git$/i, '');
  return [source, fullName, input.ref?.toLowerCase() || 'default', normalizeScopePath(input.scopePath) || '']
    .map((part) => encodeURIComponent(part.toLowerCase()))
    .join(':');
}

export function createLocalSourceId(name: string, scopePath?: string): string {
  const safeName = name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 100) || 'local-project';
  return createSourceId({ source: 'local-folder', owner: 'local', name: safeName, scopePath });
}

export function shortSourceLabel(repository: { owner: string; name: string; ref?: string; scopePath?: string }): string {
  return `${repository.owner}/${repository.name}${repository.ref ? `@${repository.ref}` : ''}${repository.scopePath ? `/${repository.scopePath}` : ''}`;
}

/** FNV-1a, used as a fast local-only revision marker. No file content leaves the browser. */
export function computeContentRevision(contents: Iterable<string>): string {
  let hash = 2166136261;
  const sorted = [...contents].sort();
  for (const content of sorted) {
    for (let i = 0; i < content.length; i++) {
      hash ^= content.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `local-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export async function sha256Text(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
