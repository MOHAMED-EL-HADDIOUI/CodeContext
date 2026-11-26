import { afterEach, describe, expect, it, vi } from 'vitest';
import { indexGitHubRepository } from '../../features/indexing/indexer';
import { GitHubClient, type GitHubRepoMetadata, type GitHubTreeResult } from '../../services/github/client';
import { CodeContextDB } from '../../services/storage/db';
import { buildChangeReviewPreview, generateChangeReview } from '../../features/review/changeReview';
import type { AIConfiguration, ChangeSet, IndexingLimits } from '../../types';
import type { AIProvider as Provider } from '../../services/ai/types';

const limits: IndexingLimits = { maxFiles: 50, maxFileSizeKb: 128, maxTotalSizeMb: 5, concurrency: 1 };
const config: AIConfiguration = { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.2, maxTokens: 1024, contextWindow: 8192, enableLocalEmbeddings: false, neuralEmbeddingsEnabled: false, embeddingModelId: 'Xenova/all-MiniLM-L6-v2', consentGiven: true };

describe('Ref-safe GitHub indexing', () => {
  let database: CodeContextDB;
  afterEach(async () => { await database?.delete(); });

  it('resolves slash-containing refs and preserves the exact locator for resume', async () => {
    database = new CodeContextDB(`Branch_${Date.now()}`);
    const metadata = vi.fn(async (_owner: string, _repo: string, ref?: string): Promise<GitHubRepoMetadata> => ({
      owner: 'acme', name: 'app', fullName: 'acme/app', url: 'https://github.com/acme/app', defaultBranch: 'main', resolvedRef: ref, commitSha: 'head-sha', languages: { TypeScript: 20 }, stars: 0, isPrivate: false, rateLimit: {},
    }));
    const resolveRef = vi.fn(async (_owner: string, _repo: string, ref: string) => {
      if (ref !== 'feature/auth') throw Object.assign(new Error('Ref not found'), { status: 404 });
      return { ref, sha: 'head-sha' };
    });
    const client = {
      getRepositoryMetadata: metadata,
      resolveRef,
      resolvePathRef: vi.fn(async (_owner: string, _repo: string, ref: string, path: string) => ref === 'feature/auth' && path === 'src/services' ? ref : null),
      getRepositoryTree: vi.fn(async (): Promise<GitHubTreeResult> => ({ entries: [
        { path: 'src/services/auth.ts', sha: 'blob-auth', size: 44, type: 'blob' },
        { path: 'src/ignored.ts', sha: 'blob-ignored', size: 25, type: 'blob' },
      ], truncated: false, rateLimit: {} })),
      getFileContent: vi.fn(async () => 'export function validateCredentials() { return true; }'),
    } as unknown as GitHubClient;
    const result = await indexGitHubRepository({ urlOrSlug: 'https://github.com/acme/app/tree/feature/auth/src/services', limits, database, githubClient: client });
    expect(result.repository.ref).toBe('feature/auth');
    expect(result.repository.scopePath).toBe('src/services');
    expect(result.repository.commitSha).toBe('head-sha');
    expect(result.repository.fileCount).toBe(1);
    expect(await database.files.where('repositoryId').equals(result.repository.id).count()).toBe(1);
    expect((await database.indexJobs.where('repositoryId').equals(result.repository.id).first())?.input).toContain('/tree/feature/auth/src/services');
    const second = await indexGitHubRepository({ urlOrSlug: result.repository.url, limits, database, githubClient: client });
    expect(second.repository.id).toBe(result.repository.id);
    expect(second.reusedFiles).toBe(1);
    expect(resolveRef).toHaveBeenCalledWith('acme', 'app', 'feature/auth', undefined);
  });
});

describe('Review transmission preparation', () => {
  let database: CodeContextDB;
  afterEach(async () => { await database?.delete(); });
  it('previews and transmits the same bounded diff and related revision', async () => {
    database = new CodeContextDB(`Preview_${Date.now()}`);
    await database.repositories.put({ id: 'acme/app', owner: 'acme', name: 'app', fullName: 'acme/app', url: 'https://github.com/acme/app', defaultBranch: 'main', commitSha: 'old-revision', languages: {}, isPrivate: false, fileCount: 1, indexedFileCount: 1, skippedFileCount: 0, chunkCount: 0, symbolCount: 0, truncatedTree: false, indexingStatus: 'ready', createdAt: 1, updatedAt: 1 });
    await database.files.put({ id: 'acme/app::src/auth.ts', repositoryId: 'acme/app', path: 'src/auth.ts', name: 'auth.ts', extension: 'ts', language: 'typescript', size: 21, sha: 'old', content: 'const old = true;', lineCount: 1, indexed: true });
    const changeSet: ChangeSet = { id: 'change:acme/app:pr:2', repositoryId: 'acme/app', kind: 'pull-request', title: '#2 · Review', url: 'https://github.com/acme/app/pull/2', baseRef: 'main', headRef: 'fix', baseSha: 'base', headSha: 'head', files: [{ path: 'src/auth.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+await validate();' }], additions: 1, deletions: 1, createdAt: 1 };
    const preview = await buildChangeReviewPreview(changeSet, config, database);
    expect(preview.includedFiles).toBe(1);
    expect(preview.relatedFiles).toEqual(['src/auth.ts']);
    expect(preview.relatedRevision).toBe('old-revision');
    expect(preview.prompt).toContain('await validate();');
    let transmitted = '';
    const provider: Provider = { id: 'mock', name: 'Mock', async *generate(input) { transmitted = input.messages[0]?.content ?? ''; yield '{"summary":"Reviewed","comments":[]}'; }, async validateConfiguration() { return { ok: true, message: 'ok' }; } };
    const report = await generateChangeReview({ changeSet, aiConfig: config, database, providerOverride: provider });
    expect(transmitted).toBe(preview.prompt);
    expect(report.summary).toContain('not exact head');
  });
});
