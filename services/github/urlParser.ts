export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  fullName: string;
  canonicalUrl: string;
  kind: 'repository' | 'tree' | 'blob';
  ref?: string;
  subPath?: string;
  startLine?: number;
  endLine?: number;
}

const RESERVED_OWNERS = new Set([
  'settings',
  'explore',
  'marketplace',
  'notifications',
  'login',
  'logout',
  'signup',
  'join',
  'pricing',
  'features',
  'topics',
  'trending',
  'collections',
  'events',
  'sponsors',
  'new',
  'organizations',
  'orgs',
  'search',
  'issues',
  'pulls',
]);

const VALID_SEGMENT = /^[A-Za-z0-9_.-]+$/;

function parseLineHash(hash: string): { startLine?: number; endLine?: number } {
  const match = hash.match(/^#L(\d+)(?:-L?(\d+))?$/i);
  if (!match || !match[1]) return {};
  const startLine = Number.parseInt(match[1], 10);
  const endLine = match[2] ? Number.parseInt(match[2], 10) : startLine;
  if (!Number.isFinite(startLine) || startLine < 1) return {};
  return {
    startLine,
    endLine: Number.isFinite(endLine) && endLine >= startLine ? endLine : startLine,
  };
}

export function parseGitHubUrl(rawInput: string): ParsedGitHubUrl | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  // Support shorthand "owner/repo"
  if (!trimmed.includes('://') && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    const [owner, rawRepo] = trimmed.split('/');
    if (!owner || !rawRepo || RESERVED_OWNERS.has(owner.toLowerCase())) return null;
    const repo = rawRepo.replace(/\.git$/i, '');
    if (!repo || !VALID_SEGMENT.test(owner) || !VALID_SEGMENT.test(repo)) return null;
    return {
      owner,
      repo,
      fullName: `${owner}/${repo}`,
      canonicalUrl: `https://github.com/${owner}/${repo}`,
      kind: 'repository',
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed.startsWith('github.com/') ? `https://${trimmed}` : trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    return null;
  }

  const segments = url.pathname
    .split('/')
    .map((s) => decodeURIComponent(s))
    .filter(Boolean);

  if (segments.length < 2) return null;

  const owner = segments[0]!;
  const rawRepo = segments[1]!;
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;

  const repo = rawRepo.replace(/\.git$/i, '');
  if (!repo || !VALID_SEGMENT.test(owner) || !VALID_SEGMENT.test(repo)) return null;

  const base: ParsedGitHubUrl = {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    canonicalUrl: `https://github.com/${owner}/${repo}`,
    kind: 'repository',
  };

  if (segments.length >= 4 && (segments[2] === 'tree' || segments[2] === 'blob')) {
    const kind = segments[2];
    const ref = segments[3];
    const subPath = segments.length > 4 ? segments.slice(4).join('/') : undefined;
    const lineInfo = kind === 'blob' ? parseLineHash(url.hash) : {};
    return {
      ...base,
      kind,
      ref,
      subPath,
      ...lineInfo,
    };
  }

  return base;
}

export function buildGitHubBlobUrl(
  owner: string,
  repo: string,
  commitSha: string,
  filePath: string,
  startLine?: number,
  endLine?: number,
): string {
  const encodedPath = filePath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const base = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${encodeURIComponent(commitSha)}/${encodedPath}`;
  if (startLine && startLine > 0) {
    if (endLine && endLine > startLine) {
      return `${base}#L${startLine}-L${endLine}`;
    }
    return `${base}#L${startLine}`;
  }
  return base;
}
