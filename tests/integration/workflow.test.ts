import { afterEach, describe, expect, it, vi } from 'vitest';
import { indexLocalEmbeddingsForRepository, computeLocalVector } from '../../core/retrieval/embeddings';
import { invalidateSearchCache, searchRepository } from '../../core/retrieval/search';
import { runAssistantQuery } from '../../features/ai/rag';
import { indexGitHubRepository } from '../../features/indexing/indexer';
import type { AIProvider } from '../../services/ai/types';
import { GitHubClient, type GitHubRepoMetadata, type GitHubTreeResult } from '../../services/github/client';
import { CodeContextDB, deleteRepositoryData } from '../../services/storage/db';
import type { AIConfiguration, IndexingLimits } from '../../types';

const LIMITS: IndexingLimits = {
  maxFiles: 50,
  maxFileSizeKb: 100,
  maxTotalSizeMb: 5,
  concurrency: 3,
};

const AI_CONFIG: AIConfiguration = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  baseUrl: 'https://api.openai.com/v1',
  temperature: 0.2,
  maxTokens: 1024,
  contextWindow: 16000,
  enableLocalEmbeddings: true,
  neuralEmbeddingsEnabled: false,
  embeddingModelId: 'Xenova/all-MiniLM-L6-v2',
  consentGiven: true,
};

describe('End-to-End Indexing, Incremental Sync, Search, RAG & Deletion Workflow', () => {
  let testDb: CodeContextDB;

  afterEach(async () => {
    if (testDb) {
      await testDb.delete();
    }
    invalidateSearchCache();
  });

  it('indexes a repo, performs incremental sync, searches symbols, answers with verified citations, and deletes cleanly', async () => {
    testDb = new CodeContextDB(`CodeContextTest_${Date.now()}`);

    let commitSha = '1111111aaaaaaa';
    let filesMap: Record<string, { sha: string; content: string }> = {
      'README.md': {
        sha: 'sha-readme-1',
        content: '# DemoApp\n\nA fast authentication microservice.',
      },
      'src/services/auth.service.ts': {
        sha: 'sha-auth-1',
        content: [
          'export class AuthService {',
          '  validateCredentials(user: string, pass: string): boolean {',
          '    return user.length > 0 && pass.length >= 8;',
          '  }',
          '}',
        ].join('\n'),
      },
      'src/legacy.ts': {
        sha: 'sha-legacy-1',
        content: 'export function deprecatedHelper() { return null; }',
      },
      'node_modules/ignored/index.js': {
        sha: 'sha-ignored',
        content: 'module.exports = {};',
      },
    };

    const mockClient = {
      getRepositoryMetadata: vi.fn(async (): Promise<GitHubRepoMetadata> => ({
        owner: 'demo',
        name: 'app',
        fullName: 'demo/app',
        url: 'https://github.com/demo/app',
        description: 'Demo authentication service',
        defaultBranch: 'main',
        commitSha,
        languages: { TypeScript: 4200, Markdown: 300 },
        stars: 12,
        isPrivate: false,
        rateLimit: { remaining: 58, limit: 60 },
      })),
      getRepositoryTree: vi.fn(async (): Promise<GitHubTreeResult> => ({
        entries: Object.entries(filesMap).map(([path, info]) => ({
          path,
          sha: info.sha,
          size: info.content.length,
          type: 'blob' as const,
        })),
        truncated: false,
        rateLimit: { remaining: 57, limit: 60 },
      })),
      getFileContent: vi.fn(
        async (_o: string, _r: string, _c: string, filePath: string): Promise<string> => {
          return filesMap[filePath]?.content ?? '';
        },
      ),
    } as unknown as GitHubClient;

    // 1. Initial full index
    const first = await indexGitHubRepository({
      urlOrSlug: 'https://github.com/demo/app',
      limits: LIMITS,
      database: testDb,
      githubClient: mockClient,
    });

    expect(first.repository.indexedFileCount).toBe(3); // node_modules excluded
    expect(first.repository.skippedFileCount).toBe(1);
    expect(first.newlyIndexedFiles).toBe(3);
    expect(first.reusedFiles).toBe(0);

    // 2. Incremental re-index: modify README, remove legacy.ts, keep auth.service.ts unchanged
    commitSha = '2222222bbbbbbb';
    filesMap = {
      'README.md': {
        sha: 'sha-readme-2',
        content: '# DemoApp v2\n\nUpdated architecture overview.',
      },
      'src/services/auth.service.ts': filesMap['src/services/auth.service.ts']!,
    };

    const second = await indexGitHubRepository({
      urlOrSlug: 'https://github.com/demo/app',
      limits: LIMITS,
      database: testDb,
      githubClient: mockClient,
    });

    expect(second.reusedFiles).toBe(1); // auth.service.ts reused without re-fetching!
    expect(second.newlyIndexedFiles).toBe(1); // only README re-fetched
    expect(second.deletedFiles).toBe(2); // legacy.ts + node_modules entry removed
    expect(second.repository.commitSha).toBe('2222222bbbbbbb');

    // 3. Build optional local semantic vectors and run hybrid search
    const embCount = await indexLocalEmbeddingsForRepository('demo/app', testDb);
    expect(embCount).toBeGreaterThan(0);

    const hits = await searchRepository({
      repositoryId: 'demo/app',
      query: 'validateCredentials',
      queryVector: computeLocalVector('validateCredentials'),
      database: testDb,
    });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.filePath).toBe('src/services/auth.service.ts');

    // 4. Ask AI question via RAG and verify real commit-pinned citation
    const mockProvider: AIProvider = {
      id: 'mock',
      name: 'Mock Provider',
      async *generate() {
        yield 'Credentials are validated in `AuthService.validateCredentials` [S1].';
      },
      async validateConfiguration() {
        return { ok: true, message: 'ok' };
      },
    };

    const answer = await runAssistantQuery({
      question: 'Where are credentials validated?',
      mode: 'ask_codebase',
      repository: second.repository,
      history: [],
      aiConfig: AI_CONFIG,
      database: testDb,
      providerOverride: mockProvider,
    });

    expect(answer.content).toContain('validateCredentials');
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.citations[0]?.filePath).toBe('src/services/auth.service.ts');
    expect(answer.citations[0]?.commitSha).toBe('2222222bbbbbbb');
    expect(answer.citations[0]?.githubUrl).toContain(
      'https://github.com/demo/app/blob/2222222bbbbbbb/src/services/auth.service.ts#L',
    );

    // 5. Delete repository data completely
    await deleteRepositoryData('demo/app', testDb);
    expect(await testDb.repositories.count()).toBe(0);
    expect(await testDb.files.count()).toBe(0);
    expect(await testDb.chunks.count()).toBe(0);
    expect(await testDb.symbols.count()).toBe(0);
    expect(await testDb.embeddings.count()).toBe(0);
  });
});
