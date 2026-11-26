import type { ParsedGitHubUrl } from './urlParser';
import type { ChangeSet, ChangeSetFile } from '../../types';
import { GitHubClient, mapGitHubError } from './client';

export interface GitHubChangeTarget {
  kind: 'pull-request' | 'commit' | 'comparison';
  owner: string;
  repo: string;
  number?: number;
  sha?: string;
  base?: string;
  head?: string;
}

export function parseGitHubChangeTarget(input: string): GitHubChangeTarget | null {
  try {
    const url = new URL(input.trim());
    if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) return null;
    const [owner, repo, action, first] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (!owner || !repo || !action) return null;
    if (action === 'pull' && first && /^\d+$/.test(first)) {
      return { kind: 'pull-request', owner, repo: repo.replace(/\.git$/, ''), number: Number(first) };
    }
    if (action === 'commit' && first) {
      return { kind: 'commit', owner, repo: repo.replace(/\.git$/, ''), sha: first };
    }
    if (action === 'compare' && first) {
      const [base, head] = first.split('...');
      if (base && head) return { kind: 'comparison', owner, repo: repo.replace(/\.git$/, ''), base, head };
    }
    return null;
  } catch {
    return null;
  }
}

export interface RawChangeSet {
  title: string;
  url: string;
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  files: Array<{
    filename: string;
    previous_filename?: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
    sha?: string | null;
  }>;
}

function normalizeFile(file: RawChangeSet['files'][number]): ChangeSetFile {
  const status: ChangeSetFile['status'] = ['added', 'removed', 'renamed'].includes(file.status)
    ? file.status as ChangeSetFile['status'] : 'modified';
  return {
    path: file.filename,
    previousPath: file.previous_filename,
    status,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch,
    headSha: file.sha ?? undefined,
  };
}

export function createChangeSet(target: GitHubChangeTarget, raw: RawChangeSet): ChangeSet {
  const repositoryId = `${target.owner}/${target.repo}`.toLowerCase();
  const files = raw.files.map(normalizeFile);
  const identity = target.kind === 'pull-request' ? `pr:${target.number}` : `${raw.baseSha}:${raw.headSha}`;
  return {
    id: `change:${repositoryId}:${identity}`,
    repositoryId,
    kind: target.kind,
    title: raw.title,
    url: raw.url,
    baseRef: raw.baseRef,
    headRef: raw.headRef,
    baseSha: raw.baseSha,
    headSha: raw.headSha,
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    createdAt: Date.now(),
  };
}

export async function loadGitHubChangeSet(client: GitHubClient, input: string): Promise<ChangeSet> {
  const target = parseGitHubChangeTarget(input);
  if (!target) throw new Error('Enter a GitHub pull request, commit, or compare URL.');
  try {
    if (target.kind === 'pull-request') {
      const [pr, files] = await Promise.all([
        client.getPullRequest(target.owner, target.repo, target.number!),
        client.getPullRequestFiles(target.owner, target.repo, target.number!),
      ]);
      return createChangeSet(target, {
        title: `#${target.number} · ${pr.title}`,
        url: pr.html_url,
        baseRef: pr.base.ref,
        headRef: pr.head.ref,
        baseSha: pr.base.sha,
        headSha: pr.head.sha,
        files,
      });
    }
    if (target.kind === 'commit') {
      const commit = await client.getCommit(target.owner, target.repo, target.sha!);
      const parent = commit.parents[0];
      return createChangeSet(target, {
        title: commit.commit.message.split('\n')[0] ?? target.sha!,
        url: commit.html_url,
        baseRef: parent?.sha ?? target.sha!,
        headRef: target.sha!,
        baseSha: parent?.sha ?? target.sha!,
        headSha: commit.sha,
        files: commit.files ?? [],
      });
    }
    const comparison = await client.compareCommits(target.owner, target.repo, target.base!, target.head!);
    return createChangeSet(target, {
      title: `${target.base} … ${target.head}`,
      url: comparison.html_url,
      baseRef: target.base!,
      headRef: target.head!,
      baseSha: comparison.merge_base_commit.sha,
      headSha: comparison.commits.at(-1)?.sha ?? target.head!,
      files: comparison.files ?? [],
    });
  } catch (error) {
    throw mapGitHubError(error);
  }
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  text: string;
  changedLines: Array<{ oldLine?: number; newLine?: number; type: 'addition' | 'deletion'; content: string }>;
}

export function parsePatchHunks(patch?: string): DiffHunk[] {
  if (!patch) return [];
  const lines = patch.split('\n');
  const hunks: DiffHunk[] = [];
  let hunk: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;
  for (const line of lines) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header) {
      hunk = {
        oldStart: Number(header[1]), oldLines: Number(header[2] ?? 1),
        newStart: Number(header[3]), newLines: Number(header[4] ?? 1),
        text: line, changedLines: [],
      };
      hunks.push(hunk);
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      hunk.changedLines.push({ newLine: newLine++, type: 'addition', content: line.slice(1) });
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      hunk.changedLines.push({ oldLine: oldLine++, type: 'deletion', content: line.slice(1) });
    } else {
      oldLine++;
      newLine++;
    }
  }
  return hunks;
}

export function isIndexedRepositoryId(repositoryId: string, parsed: ParsedGitHubUrl): boolean {
  return repositoryId === parsed.fullName.toLowerCase() || repositoryId.startsWith(`github:${encodeURIComponent(parsed.fullName.toLowerCase())}:`);
}
