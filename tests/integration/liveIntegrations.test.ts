/* eslint-disable no-console -- Explicit live-check summaries contain no secrets. */
import { describe, expect, it } from 'vitest';
import { GitHubClient } from '../../services/github/client';
import { indexGitHubRepository } from '../../features/indexing/indexer';
import { loadGitHubChangeSet } from '../../services/github/changes';
import { CodeContextDB } from '../../services/storage/db';
import 'fake-indexeddb/auto';
import type { AIConfiguration } from '../../types';

const enabled = process.env.CC_TEST_LIVE === '1';
const repository = process.env.CC_TEST_GITHUB_REPOSITORY || 'MOHAMED-EL-HADDIOUI/CodeContext';
const pullRequest = process.env.CC_TEST_GITHUB_PULL_REQUEST
  ? Number(process.env.CC_TEST_GITHUB_PULL_REQUEST)
  : undefined;
const commit = process.env.CC_TEST_GITHUB_COMMIT;

describe.skipIf(!enabled)('Opt-in live GitHub integration', () => {
  it('indexes a public ref and reads an optional real change diff without logging credentials', async () => {
    const database = new CodeContextDB(`LiveGitHub_${Date.now()}`);
    try {
      const client = new GitHubClient({ token: process.env.CC_TEST_GITHUB_TOKEN });
      const result = await indexGitHubRepository({
        urlOrSlug: `https://github.com/${repository}/tree/main`,
        githubClient: client,
        database,
        limits: { maxFiles: 3, maxFileSizeKb: 128, maxTotalSizeMb: 2, concurrency: 2 },
      });
      expect(result.repository.ref).toBe('main');
      expect(result.repository.commitSha).toMatch(/^[a-f0-9]{40}$/);
      expect(result.repository.indexedFileCount).toBeGreaterThan(0);
      if (commit || pullRequest) {
        const changeSet = await loadGitHubChangeSet(
          client,
          commit
            ? `https://github.com/${repository}/commit/${commit}`
            : `https://github.com/${repository}/pull/${pullRequest}`,
        );
        expect(changeSet.baseSha).toMatch(/^[a-f0-9]{40}$/);
        expect(changeSet.headSha).toMatch(/^[a-f0-9]{40}$/);
        expect(changeSet.files.length).toBeGreaterThan(0);
        expect(changeSet.files.some((file) => file.patch)).toBe(true);
      }
      console.log(
        `Live GitHub verification: ${result.repository.fullName}@${result.repository.ref}, ${result.repository.indexedFileCount} indexed files${pullRequest ? `, PR #${pullRequest} diff verified` : ''}${commit ? `, commit ${commit} diff verified` : ''}.`,
      );
    } finally {
      await database.delete();
    }
  }, 120000);
});

describe.skipIf(!enabled || process.env.CC_TEST_ALLOW_AI !== '1' || !process.env.CC_TEST_AI_MODEL)(
  'Opt-in live AI provider transmission',
  () => {
    it('prepares synthetic evidence and verifies an actual provider response without repository content', async () => {
      const { runAssistantQuery } = await import('../../features/ai/rag');
      const { indexLocalSource } = await import('../../features/indexing/indexer');
      const database = new CodeContextDB(`LiveAI_${Date.now()}`);
      try {
        const indexed = await indexLocalSource({
          name: 'synthetic-public-fixture',
          source: 'local-folder',
          database,
          limits: { maxFiles: 1, maxFileSizeKb: 10, maxTotalSizeMb: 1, concurrency: 1 },
          files: [
            {
              path: 'auth.ts',
              content: 'export function validateCredentials(token) { return token.length > 8; }',
            },
          ],
        });
        const aiConfig: AIConfiguration = {
          provider: 'custom',
          model: process.env.CC_TEST_AI_MODEL!,
          baseUrl: process.env.CC_TEST_AI_BASE_URL,
          temperature: 0,
          maxTokens: 150,
          contextWindow: 4096,
          enableLocalEmbeddings: false,
          neuralEmbeddingsEnabled: false,
          embeddingModelId: 'Xenova/all-MiniLM-L6-v2',
          consentGiven: true,
        };
        const result = await runAssistantQuery({
          question: 'What does validateCredentials check? Cite the supplied source.',
          mode: 'ask_codebase',
          repository: indexed.repository,
          history: [],
          aiConfig,
          apiKey: process.env.CC_TEST_AI_API_KEY,
          database,
        });
        expect(result.content.trim().length).toBeGreaterThan(0);
        expect(result.preview.endpoint).toBe(process.env.CC_TEST_AI_BASE_URL);
        expect(result.preview.sources).toHaveLength(1);
        console.log(
          'Live AI verification: explicitly approved synthetic fixture transmitted and response received.',
        );
      } finally {
        await database.delete();
      }
    }, 120000);
  },
);

// This suite deliberately has no default network behavior. A model download or
// AI request is a separate user decision, never a side effect of pnpm test.
describe.skipIf(!enabled || process.env.CC_TEST_MODEL_DOWNLOAD !== '1')(
  'Opt-in local neural model download',
  () => {
    it('downloads once, infers locally, and restores from cache with remote access disabled', async () => {
      const {
        initializeNeuralEmbeddings,
        getConfiguredEmbeddingProvider,
        getNeuralEmbeddingProvider,
      } = await import('../../core/retrieval/neuralEmbeddings');
      const database = new CodeContextDB(`LiveModel_${Date.now()}`);
      try {
        await initializeNeuralEmbeddings('Xenova/all-MiniLM-L6-v2', database);
        const provider = getConfiguredEmbeddingProvider();
        expect(provider?.ready).toBe(true);
        const vector = await provider!.embed('function that validates credentials');
        expect(vector).toHaveLength(384);
        expect(vector.every(Number.isFinite)).toBe(true);
        const cached = await getNeuralEmbeddingProvider(
          'Xenova/all-MiniLM-L6-v2',
          undefined,
          false,
        );
        expect((await cached.embed('validate a token')).every(Number.isFinite)).toBe(true);
        console.log(
          'Live model verification: explicit download, 384D local inference, and cache-only reuse passed.',
        );
      } finally {
        await database.delete();
      }
    }, 240000);
  },
);
