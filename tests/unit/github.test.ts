import { describe, expect, it, vi } from 'vitest';
import { buildGitHubBlobUrl, parseGitHubUrl } from '../../services/github/urlParser';
import { GitHubClient, mapGitHubError } from '../../services/github/client';

describe('GitHub URL parser', () => {
  it('parses standard repository URLs', () => {
    const res = parseGitHubUrl('https://github.com/facebook/react');
    expect(res).toEqual({
      owner: 'facebook',
      repo: 'react',
      fullName: 'facebook/react',
      canonicalUrl: 'https://github.com/facebook/react',
      kind: 'repository',
    });
  });

  it('parses .git suffix and shorthand owner/repo', () => {
    expect(parseGitHubUrl('https://github.com/wxt-dev/wxt.git')?.fullName).toBe('wxt-dev/wxt');
    expect(parseGitHubUrl('vercel/next.js')?.fullName).toBe('vercel/next.js');
  });

  it('parses subdirectory tree URLs and blob URLs with line ranges', () => {
    const tree = parseGitHubUrl('https://github.com/owner/repo/tree/main/src/services');
    expect(tree?.kind).toBe('tree');
    expect(tree?.ref).toBe('main');
    expect(tree?.subPath).toBe('src/services');

    const blob = parseGitHubUrl('https://github.com/owner/repo/blob/develop/src/auth.ts#L12-L44');
    expect(blob?.kind).toBe('blob');
    expect(blob?.ref).toBe('develop');
    expect(blob?.subPath).toBe('src/auth.ts');
    expect(blob?.startLine).toBe(12);
    expect(blob?.endLine).toBe(44);
  });

  it('rejects invalid URLs, non-GitHub hosts, and reserved paths', () => {
    expect(parseGitHubUrl('')).toBeNull();
    expect(parseGitHubUrl('https://gitlab.com/owner/repo')).toBeNull();
    expect(parseGitHubUrl('https://github.com/settings/tokens')).toBeNull();
    expect(parseGitHubUrl('https://github.com/explore')).toBeNull();
    expect(parseGitHubUrl('not a url')).toBeNull();
  });

  it('builds commit-pinned GitHub blob URLs with line anchors', () => {
    const url = buildGitHubBlobUrl('acme', 'app', 'abc1234', 'src/auth service.ts', 25, 61);
    expect(url).toBe('https://github.com/acme/app/blob/abc1234/src/auth%20service.ts#L25-L61');
  });
});

describe('GitHub API error handling and client', () => {
  it('maps 404, 401, 429 rate limits, and network errors clearly', () => {
    expect(mapGitHubError({ status: 404 }).code).toBe('NOT_FOUND');
    expect(mapGitHubError({ status: 401 }).code).toBe('UNAUTHORIZED');
    expect(
      mapGitHubError({
        status: 403,
        response: { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1900000000' } },
      }).code,
    ).toBe('RATE_LIMITED');
    expect(mapGitHubError({ status: 429 }).code).toBe('RATE_LIMITED');
    expect(mapGitHubError(new TypeError('Failed to fetch')).code).toBe('NETWORK_ERROR');
  });

  it('fetches public file content via raw.githubusercontent.com without exhausting API quota', async () => {
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://raw.githubusercontent.com/')) {
        return new Response('export const x = 42;', { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    const client = new GitHubClient({ fetchImpl: mockFetch as unknown as typeof fetch });
    const content = await client.getFileContent(
      'owner',
      'repo',
      'deadbeef',
      'src/index.ts',
      'blobsha',
      false,
    );
    expect(content).toBe('export const x = 42;');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
