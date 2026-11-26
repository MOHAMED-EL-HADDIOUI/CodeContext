import { Octokit } from '@octokit/rest';
import type { RawChangeSet } from './changes';

export type GitHubErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'FORBIDDEN'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

export class GitHubApiError extends Error {
  readonly code: GitHubErrorCode;
  readonly status?: number;
  readonly rateLimitReset?: number;

  constructor(
    message: string,
    code: GitHubErrorCode,
    status?: number,
    rateLimitReset?: number,
  ) {
    super(message);
    this.name = 'GitHubApiError';
    this.code = code;
    this.status = status;
    this.rateLimitReset = rateLimitReset;
  }
}

export interface GitHubRateLimit {
  remaining?: number;
  limit?: number;
  reset?: number;
}

export interface GitHubRepoMetadata {
  owner: string;
  name: string;
  fullName: string;
  url: string;
  description?: string;
  defaultBranch: string;
  resolvedRef?: string;
  commitSha: string;
  languages: Record<string, number>;
  stars: number;
  isPrivate: boolean;
  rateLimit: GitHubRateLimit;
}

export interface GitHubTreeEntry {
  path: string;
  sha: string;
  size: number;
  type: 'blob' | 'tree';
}

export interface GitHubTreeResult {
  entries: GitHubTreeEntry[];
  truncated: boolean;
  rateLimit: GitHubRateLimit;
}

function extractRateLimit(headers?: Record<string, string | number | undefined>): GitHubRateLimit {
  if (!headers) return {};
  const rem = headers['x-ratelimit-remaining'];
  const lim = headers['x-ratelimit-limit'];
  const res = headers['x-ratelimit-reset'];
  return {
    remaining: rem !== undefined ? Number(rem) : undefined,
    limit: lim !== undefined ? Number(lim) : undefined,
    reset: res !== undefined ? Number(res) * 1000 : undefined,
  };
}

export function mapGitHubError(error: unknown): GitHubApiError {
  if (error instanceof GitHubApiError) return error;

  const errObj = error as {
    status?: number;
    message?: string;
    response?: { headers?: Record<string, string | number | undefined> };
  };
  const status = errObj?.status;
  const rl = extractRateLimit(errObj?.response?.headers);

  if (status === 404) {
    return new GitHubApiError(
      'Repository or resource not found. If this is a private repository, add a fine-grained read-only GitHub token in Settings.',
      'NOT_FOUND',
      404,
      rl.reset,
    );
  }
  if (status === 401) {
    return new GitHubApiError(
      'GitHub authentication failed. Verify your session token in Settings.',
      'UNAUTHORIZED',
      401,
      rl.reset,
    );
  }
  if (status === 429 || (status === 403 && rl.remaining === 0)) {
    const resetTime = rl.reset ? new Date(rl.reset).toLocaleTimeString() : 'shortly';
    return new GitHubApiError(
      `GitHub API rate limit reached. Limit resets around ${resetTime}, or add a GitHub token in Settings for higher limits (5,000 req/hr).`,
      'RATE_LIMITED',
      status,
      rl.reset,
    );
  }
  if (status === 403) {
    return new GitHubApiError(
      'Access forbidden by GitHub API. Check repository permissions or token scopes.',
      'FORBIDDEN',
      403,
      rl.reset,
    );
  }

  const msg = errObj?.message ?? 'Network error communicating with GitHub.';
  if (/fetch|network|failed to fetch|enotfound|econn/i.test(msg)) {
    return new GitHubApiError(
      'Network error connecting to GitHub. Check your internet connection and try again.',
      'NETWORK_ERROR',
    );
  }

  return new GitHubApiError(msg, 'UNKNOWN', status, rl.reset);
}

export interface GitHubClientOptions {
  token?: string;
  fetchImpl?: typeof fetch;
}

export class GitHubClient {
  private readonly octokit: Octokit;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;
  private metadataCache = new Map<string, { data: GitHubRepoMetadata; cachedAt: number }>();

  constructor(options: GitHubClientOptions = {}) {
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.octokit = new Octokit({
      auth: options.token,
      request: {
        fetch: this.fetchImpl,
      },
    });
  }

  async getRepositoryMetadata(
    owner: string,
    repo: string,
    refOverride?: string,
    signal?: AbortSignal,
  ): Promise<GitHubRepoMetadata> {
    const cacheKey = `${owner}/${repo}@${refOverride ?? 'default'}`;
    const cached = this.metadataCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < 60_000) {
      return cached.data;
    }

    try {
      const repoResp = await this.octokit.repos.get({
        owner,
        repo,
        request: { signal },
      });

      const branch = refOverride || repoResp.data.default_branch || 'main';
      const resolved = await this.resolveRef(owner, repo, branch, signal);
      const [branchResp, langResp] = await Promise.all([
        this.octokit.repos.getCommit({
          owner,
          repo,
          ref: resolved.ref,
          request: { signal },
        }),
        this.octokit.repos
          .listLanguages({ owner, repo, request: { signal } })
          .catch(() => ({ data: {} as Record<string, number>, headers: {} })),
      ]);

      const rateLimit = extractRateLimit(
        branchResp.headers as Record<string, string | number | undefined>,
      );

      const metadata: GitHubRepoMetadata = {
        owner: repoResp.data.owner.login,
        name: repoResp.data.name,
        fullName: repoResp.data.full_name,
        url: repoResp.data.html_url,
        description: repoResp.data.description ?? undefined,
        defaultBranch: repoResp.data.default_branch || 'main',
        resolvedRef: resolved.ref,
        commitSha: branchResp.data.sha,
        languages: langResp.data,
        stars: repoResp.data.stargazers_count ?? 0,
        isPrivate: Boolean(repoResp.data.private),
        rateLimit,
      };

      this.metadataCache.set(cacheKey, { data: metadata, cachedAt: Date.now() });
      return metadata;
    } catch (err) {
      throw mapGitHubError(err);
    }
  }

  async getRepositoryTree(
    owner: string,
    repo: string,
    commitSha: string,
    signal?: AbortSignal,
  ): Promise<GitHubTreeResult> {
    try {
      const resp = await this.octokit.git.getTree({
        owner,
        repo,
        tree_sha: commitSha,
        recursive: '1',
        request: { signal },
      });

      const entries: GitHubTreeEntry[] = [];
      for (const item of resp.data.tree) {
        if (!item.path || !item.sha) continue;
        if (item.type === 'blob' || item.type === 'tree') {
          entries.push({
            path: item.path,
            sha: item.sha,
            size: item.size ?? 0,
            type: item.type,
          });
        }
      }

      return {
        entries,
        truncated: Boolean(resp.data.truncated),
        rateLimit: extractRateLimit(resp.headers as Record<string, string | number | undefined>),
      };
    } catch (err) {
      throw mapGitHubError(err);
    }
  }

  /**
   * Fetches text content for a file.
   * For public repositories, uses raw.githubusercontent.com at the pinned commit SHA
   * to avoid exhausting GitHub REST API rate limits (60 req/hr unauthenticated).
   * For private repositories (or fallback), uses the Git Blob API with Base64 decoding.
   */
  async getPullRequest(owner: string, repo: string, number: number, signal?: AbortSignal) {
    return (await this.octokit.pulls.get({ owner, repo, pull_number: number, request: { signal } })).data;
  }

  async resolvePathRef(owner: string, repo: string, ref: string, subPath: string, signal?: AbortSignal): Promise<string | null> {
    try {
      await this.octokit.repos.getContent({ owner, repo, ref, path: subPath, request: { signal } });
      return ref;
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null;
      throw error;
    }
  }

  async getPullRequestFiles(owner: string, repo: string, number: number, signal?: AbortSignal) {
    const files: RawChangeSet['files'] = [];
    for (let page = 1; page <= 10; page++) {
      const response = await this.octokit.pulls.listFiles({ owner, repo, pull_number: number, per_page: 100, page, request: { signal } });
      files.push(...response.data.map((file) => ({
        filename: file.filename,
        previous_filename: file.previous_filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
        sha: file.sha ?? undefined,
      })));
      if (response.data.length < 100) break;
    }
    return files;
  }

  async getCommit(owner: string, repo: string, ref: string, signal?: AbortSignal) {
    return (await this.octokit.repos.getCommit({ owner, repo, ref, request: { signal } })).data;
  }

  async compareCommits(owner: string, repo: string, base: string, head: string, signal?: AbortSignal) {
    return (await this.octokit.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${base}...${head}`, request: { signal } })).data;
  }

  async resolveRef(owner: string, repo: string, ref: string, signal?: AbortSignal): Promise<{ ref: string; sha: string }> {
    try {
      const response = await this.octokit.git.getRef({ owner, repo, ref: `heads/${ref}`, request: { signal } });
      return { ref, sha: response.data.object.sha };
    } catch (error) {
      // Commit URLs and short SHA references have no heads/<ref> entry.
      const err = error as { status?: number };
      if (err.status !== 404) throw error;
      return { ref, sha: await this.getCommit(owner, repo, ref, signal).then((commit) => commit.sha) };
    }
  }

  async getFileContent(
    owner: string,
    repo: string,
    commitSha: string,
    filePath: string,
    blobSha: string,
    isPrivate: boolean,
    signal?: AbortSignal,
  ): Promise<string> {
    if (!isPrivate && !this.token) {
      const encodedPath = filePath
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/');
      const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(commitSha)}/${encodedPath}`;
      try {
        const res = await this.fetchImpl(rawUrl, { signal });
        if (res.ok) {
          return await res.text();
        }
        if (res.status === 404) {
          throw new GitHubApiError(`File deleted or unavailable: ${filePath}`, 'NOT_FOUND', 404);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        if (err instanceof GitHubApiError) throw err;
        // Fall through to Git Blob API
      }
    }

    try {
      const blobResp = await this.octokit.git.getBlob({
        owner,
        repo,
        file_sha: blobSha,
        request: { signal },
      });

      if (blobResp.data.encoding === 'base64') {
        const clean = blobResp.data.content.replace(/\s+/g, '');
        const binaryStr = atob(clean);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      }

      return blobResp.data.content;
    } catch (err) {
      throw mapGitHubError(err);
    }
  }
}
