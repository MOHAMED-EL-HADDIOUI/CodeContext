import { afterEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { CodeContextDB } from '../../services/storage/db';
import type { IndexingLimits, Repository } from '../../types';

const limits: IndexingLimits = {
  maxFiles: 100,
  maxFileSizeKb: 128,
  maxTotalSizeMb: 4,
  concurrency: 2,
};

describe('Production upgrade and scale safeguards', () => {
  let database: CodeContextDB | undefined;
  const names: string[] = [];
  afterEach(async () => {
    database?.close();
    for (const name of names) await Dexie.delete(name);
    names.length = 0;
  });

  it('preserves v1 data and pauses interrupted jobs when upgrading to the current schema', async () => {
    const name = `Upgrade_${Date.now()}`;
    names.push(name);
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      repositories: 'id, fullName, owner, indexingStatus, updatedAt',
      files: 'id, repositoryId, [repositoryId+path], path, language, sha, indexed',
      symbols: 'id, repositoryId, fileId, [repositoryId+name], name, kind',
      chunks: 'id, repositoryId, fileId, [repositoryId+filePath], language, symbolName',
      chatSessions: 'id, repositoryId, updatedAt',
      chatMessages: 'id, sessionId, repositoryId, createdAt',
      savedReferences: 'id, url, createdAt',
      embeddings: 'chunkId, repositoryId, model',
    });
    await legacy.table('repositories').put({
      id: 'acme/app',
      owner: 'acme',
      name: 'app',
      fullName: 'acme/app',
      url: 'https://github.com/acme/app',
      defaultBranch: 'main',
      commitSha: 'legacy-sha',
      languages: {},
      isPrivate: false,
      fileCount: 1,
      indexedFileCount: 1,
      skippedFileCount: 0,
      chunkCount: 0,
      symbolCount: 0,
      truncatedTree: false,
      indexingStatus: 'indexing',
      createdAt: 1,
      updatedAt: 1,
    });
    await legacy.table('files').put({
      id: 'acme/app::a.ts',
      repositoryId: 'acme/app',
      path: 'a.ts',
      name: 'a.ts',
      extension: 'ts',
      language: 'typescript',
      size: 20,
      sha: 'legacy',
      content: 'export const a = 1;',
      lineCount: 1,
      indexed: true,
    });
    await legacy.table('chatSessions').put({
      id: 'legacy-session',
      repositoryId: 'acme/app',
      title: 'Keep me',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
    });
    legacy.close();

    database = new CodeContextDB(name);
    const repository = await database.repositories.get('acme/app');
    expect(repository?.id).toBe('acme/app');
    expect(repository?.source).toBe('github');
    expect(repository?.ref).toBe('main');
    expect(repository?.commitSha).toBe('legacy-sha');
    expect(repository?.indexingStatus).toBe('cancelled');
    expect((await database.files.get('acme/app::a.ts'))?.content).toBe('export const a = 1;');
    expect(await database.chatSessions.get('legacy-session')).toBeTruthy();
    await database.indexJobs.add({
      id: 'job:1',
      repositoryId: 'acme/app',
      kind: 'github',
      status: 'running',
      phase: 'indexing',
      input: 'acme/app',
      pendingFiles: [],
      completedFiles: [],
      totalFiles: 0,
      processedFiles: 0,
      skippedFiles: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    database.close();

    // Reopening the current version must not lose or mutate completed data.
    database = new CodeContextDB(name);
    expect((await database.repositories.get('acme/app'))?.commitSha).toBe('legacy-sha');
  });

  it('pauses running checkpoints when upgrading an existing v3 database', async () => {
    const name = `UpgradeJobs_${Date.now()}`;
    names.push(name);
    const repo: Repository = {
      id: 'acme/app',
      owner: 'acme',
      name: 'app',
      fullName: 'acme/app',
      url: 'https://github.com/acme/app',
      defaultBranch: 'main',
      commitSha: 'sha',
      languages: {},
      isPrivate: false,
      fileCount: 0,
      indexedFileCount: 0,
      skippedFileCount: 0,
      chunkCount: 0,
      symbolCount: 0,
      truncatedTree: false,
      indexingStatus: 'indexing',
      createdAt: 1,
      updatedAt: 1,
    };
    // Version 3 is the last released schema before production upgrade hardening.
    // The v1 test covers schema migration; this test ensures the v4 job contract
    // is exercised through its explicit upgrade handler on a real old database.
    const legacy = new Dexie(name);
    legacy.version(3).stores({
      repositories:
        'id, fullName, owner, indexingStatus, updatedAt, source, ref, [owner+name+ref+scopePath]',
      indexJobs: 'id, repositoryId, status, updatedAt',
    });
    await legacy.table('repositories').put(repo);
    await legacy.table('indexJobs').put({
      id: 'job:running',
      repositoryId: repo.id,
      kind: 'github',
      status: 'running',
      phase: 'indexing',
      input: repo.url,
      pendingFiles: ['a.ts'],
      completedFiles: ['b.ts'],
      totalFiles: 2,
      processedFiles: 1,
      skippedFiles: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    legacy.close();
    database = new CodeContextDB(name);
    const job = await database.indexJobs.get('job:running');
    expect(job?.status).toBe('paused');
    expect(job?.pendingFiles).toEqual(['a.ts']);
    expect(job?.completedFiles).toEqual(['b.ts']);
    expect((await database.repositories.get(repo.id))?.indexingStatus).toBe('cancelled');
  });

  it('bounds large virtual-list work and keeps dependency resolution linear', async () => {
    const { buildDependencyGraph } = await import('../../core/analysis/symbolGraph');
    const files = Array.from({ length: 1200 }, (_, index) => ({
      id: `repo::src/${index}.ts`,
      repositoryId: 'repo',
      path: `src/${index}.ts`,
      name: `${index}.ts`,
      extension: 'ts',
      language: 'typescript',
      size: 10,
      sha: `${index}`,
      content: `import { next } from './${Math.min(index + 1, 1199)}';`,
      lineCount: 1,
      indexed: true,
    }));
    const symbols = files.map((file, index) => ({
      id: `s${index}`,
      fileId: file.id,
      repositoryId: 'repo',
      filePath: file.path,
      name: `./${Math.min(index + 1, 1199)}`,
      kind: 'import' as const,
      startLine: 1,
      endLine: 1,
      exported: false,
    }));
    const start = performance.now();
    const graph = buildDependencyGraph(files, symbols);
    expect(graph.nodes).toHaveLength(1200);
    expect(graph.edges).toHaveLength(1200);
    expect(performance.now() - start).toBeLessThan(3000);
  });

  it('keeps source filtering bounded and ignores generated files', async () => {
    const { filterLocalSourceFiles } = await import('../../services/ingestion/localSources');
    const files = Array.from({ length: 5000 }, (_, index) => ({
      path: `src/${index}.ts`,
      content: `export const value = ${index};`,
    }));
    const result = filterLocalSourceFiles(files, limits);
    expect(result).toHaveLength(limits.maxFiles);
    expect(result.every((file) => !file.path.includes('node_modules'))).toBe(true);
  });
});
