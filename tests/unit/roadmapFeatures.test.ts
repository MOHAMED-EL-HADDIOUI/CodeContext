import { afterEach, describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { createSourceId } from '../../core/indexing/sourceIdentity';
import { compileGitIgnore, filterLocalSourceFiles, isIgnoredByGitIgnore, readZipSource } from '../../services/ingestion/localSources';
import { generateChangeReview } from '../../features/review/changeReview';
import { parsePatchHunks } from '../../services/github/changes';
import { indexLocalSource } from '../../features/indexing/indexer';
import { indexSingleSkippedFile } from '../../features/indexing/sourceIndexer';
import { CodeContextDB } from '../../services/storage/db';
import { createInvestigationSession, saveInvestigation, addInvestigationItem, generateInvestigationMarkdown, createWorkspace } from '../../features/investigations/notebooks';
import { buildRAGPrompt } from '../../features/ai/rag';
import { buildSourceContexts } from '../../core/citations/citations';
import { searchRepository } from '../../core/retrieval/search';
import type { AIProvider } from '../../services/ai/types';
import type { ChangeSet, IndexingLimits, AIConfiguration } from '../../types';

const limits: IndexingLimits = { maxFiles: 100, maxFileSizeKb: 128, maxTotalSizeMb: 4, concurrency: 2 };
const ai: AIConfiguration = { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.1, maxTokens: 2048, contextWindow: 16000, enableLocalEmbeddings: false, neuralEmbeddingsEnabled: false, embeddingModelId: 'Xenova/all-MiniLM-L6-v2', consentGiven: false };

describe('Roadmap source ingestion and recovery', () => {
  let database: CodeContextDB;
  afterEach(async () => { await database?.delete(); });

  it('separates explicit branches and directory scopes without changing legacy IDs', () => {
    expect(createSourceId({ owner: 'Acme', name: 'app', ref: 'feature/Auth', scopePath: 'src/Auth' })).not.toBe(createSourceId({ owner: 'Acme', name: 'app', ref: 'main', scopePath: 'src/Auth' }));
    expect(createSourceId({ owner: 'Acme', name: 'app', ref: 'feature/Auth', scopePath: 'src/Auth' })).toBe(createSourceId({ owner: 'acme', name: 'app', ref: 'FEATURE/auth', scopePath: 'src/auth' }));
  });

  it('honors anchored, glob, directory, and negated .gitignore rules', () => {
    const rules = compileGitIgnore('node_modules/\n*.log\n/dist/\n!keep.log\nsrc/**/generated.ts\n');
    expect(isIgnoredByGitIgnore('node_modules/pkg/index.js', rules)).toBe(true);
    expect(isIgnoredByGitIgnore('trace.log', rules)).toBe(true);
    expect(isIgnoredByGitIgnore('keep.log', rules)).toBe(false);
    expect(isIgnoredByGitIgnore('dist/main.js', rules)).toBe(true);
    expect(isIgnoredByGitIgnore('src/a/generated.ts', rules)).toBe(true);
    const filtered = filterLocalSourceFiles([{ path: '.gitignore', content: 'node_modules/' }, { path: 'src/a.ts', content: 'export const a = 1;' }, { path: 'node_modules/b.ts', content: 'bad' }], limits);
    expect(filtered.map((file) => file.path)).toEqual(['src/a.ts']);
    const nested = filterLocalSourceFiles([{ path: 'src/.gitignore', content: '*.tmp.ts' }, { path: 'src/a.tmp.ts', content: 'bad' }, { path: 'test/a.tmp.ts', content: 'export const keep = true;' }, { path: 'src/a.ts', content: 'export const a = 1;' }], limits);
    expect(nested.map((file) => file.path)).toEqual(['src/a.ts', 'test/a.tmp.ts']);
  });

  it('reads local ZIP archives without path traversal or binary files', () => {
    const zip = zipSync({ 'project/src/a.ts': strToU8('export const a = 1;'), 'project/.gitignore': strToU8('dist/'), 'project/secret.png': new Uint8Array([0, 137, 80, 78, 71]), '../escape.ts': strToU8('bad') });
    expect(readZipSource(zip, 'project.zip').map((file) => file.path)).toEqual(['src/a.ts', '.gitignore']);
  });

  it('persists a resumable local checkpoint and indexes a skipped snapshot on demand', async () => {
    database = new CodeContextDB(`Roadmap_${Date.now()}`);
    const controller = new AbortController();
    controller.abort();
    const paused = await indexLocalSource({ name: 'demo', source: 'local-folder', database, limits, signal: controller.signal, files: [{ path: 'a.ts', content: 'export const a = 1;' }, { path: 'b.ts', content: 'export const b = 2;' }] });
    expect(paused.repository.indexingStatus).toBe('cancelled');
    const job = await database.indexJobs.where('repositoryId').equals(paused.repository.id).first();
    expect(job?.pendingFiles).toHaveLength(2);
    const resumed = await indexLocalSource({ name: 'demo', source: 'local-folder', database, limits, resumeJobId: job?.id, files: [{ path: 'a.ts', content: 'export const a = 1;' }, { path: 'b.ts', content: 'export const b = 2;' }] });
    expect(resumed.repository.indexedFileCount).toBe(2);
    await database.files.update(`${resumed.repository.id}::b.ts`, { indexed: false, content: undefined, skippedReason: 'Previously capped' });
    await indexSingleSkippedFile(resumed.repository, 'b.ts', database);
    expect((await database.files.get(`${resumed.repository.id}::b.ts`))?.indexed).toBe(true);
  });

  it('cancels a background ZIP through its own controller', async () => {
    database = new CodeContextDB(`ZipCancel_${Date.now()}`);
    const { startBackgroundLocalZip, cancelBackgroundIndexing } = await import('../../services/ingestion/backgroundIndexer');
    const id = createSourceId({ source: 'local-zip', owner: 'local', name: 'large-archive' });
    const files = Array.from({ length: 60 }, (_, index) => ({ path: `src/${index}.ts`, content: `export function symbol${index}() { return ${index}; }` }));
    const running = startBackgroundLocalZip('large-archive', files, limits, database);
    cancelBackgroundIndexing(id);
    await expect(running).resolves.toBeUndefined();
    expect((await database.repositories.get(id))?.indexingStatus).toBe('cancelled');
  });

  it('restores only an explicitly downloaded neural model from cache', async () => {
    database = new CodeContextDB(`Neural_${Date.now()}`);
    const { restoreNeuralEmbeddings, getConfiguredEmbeddingProvider } = await import('../../core/retrieval/neuralEmbeddings');
    expect(await restoreNeuralEmbeddings('Xenova/all-MiniLM-L6-v2', database)).toBeNull();
    await database.embeddingModels.put({ id: 'Xenova/all-MiniLM-L6-v2', name: 'MiniLM', sizeMb: 23, status: 'ready', progress: 100, updatedAt: Date.now() });
    await expect(restoreNeuralEmbeddings('Xenova/all-MiniLM-L6-v2', database)).resolves.toBeNull();
    expect(getConfiguredEmbeddingProvider()).toBeNull();
  });
});

describe('Diff reviews, evidence, and notebooks', () => {
  let database: CodeContextDB;
  afterEach(async () => { await database?.delete(); });
  const changeSet: ChangeSet = { id: 'change:acme/app:pr:1', repositoryId: 'acme/app', kind: 'pull-request', title: '#1 · Fix auth', url: 'https://github.com/acme/app/pull/1', baseRef: 'main', headRef: 'fix', baseSha: 'base-sha', headSha: 'head-sha', files: [{ path: 'src/auth.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1,2 +1,2 @@\n-old\n+return await validate();\n same();' }], additions: 1, deletions: 1, createdAt: 1 };

  it('parses line positions and discards hallucinated or unchanged review comments', async () => {
    expect(parsePatchHunks(changeSet.files[0]?.patch)[0]?.changedLines).toContainEqual({ newLine: 1, type: 'addition', content: 'return await validate();' });
    database = new CodeContextDB(`Review_${Date.now()}`);
    const provider: AIProvider = { id: 'mock', name: 'Mock', async *generate() { yield JSON.stringify({ summary: 'Await validation.', comments: [{ filePath: 'src/auth.ts', startLine: 1, endLine: 1, severity: 'critical', title: 'Missing await', body: 'Await the promise.' }, { filePath: 'src/auth.ts', startLine: 2, endLine: 2, severity: 'warning', title: 'Unchanged line', body: 'Invalid.' }, { filePath: 'fake.ts', startLine: 1, endLine: 1, severity: 'warning', title: 'Fake file', body: 'Invalid.' }] }); }, async validateConfiguration() { return { ok: true, message: 'ok' }; } };
    const report = await generateChangeReview({ changeSet, aiConfig: ai, database, providerOverride: provider });
    expect(report.comments).toHaveLength(1);
    expect(report.comments[0]?.citation?.githubUrl).toContain('/blob/head-sha/src/auth.ts#L1');
  });

  it('builds a multi-repository preview with revision-pinned local sources and exports notes', async () => {
    database = new CodeContextDB(`Rag_${Date.now()}`);
    const first = await indexLocalSource({ name: 'one', source: 'local-folder', database, limits, files: [{ path: 'src/auth.ts', content: 'export function validateCredentials() { return true; }' }] });
    const second = await indexLocalSource({ name: 'two', source: 'local-folder', database, limits, files: [{ path: 'src/server.ts', content: 'export function startServer() { return listen(); }' }] });
    const prompt = await buildRAGPrompt({ question: 'How do validateCredentials and startServer relate?', mode: 'trace_flow', repositories: [first.repository, second.repository], history: [], aiConfig: ai, database });
    expect(new Set(prompt.sources.map((source) => source.repositoryId))).toEqual(new Set([first.repository.id, second.repository.id]));
    expect(prompt.systemPrompt).toContain('[S1]');
    expect(prompt.preview.sources.length).toBeGreaterThan(1);
    expect(buildSourceContexts(first.repository, [prompt.sourceContexts[0]!.chunk])[0]?.citation.githubUrl).toBeUndefined();
    const session = createInvestigationSession(first.repository.id, 'Authentication flow');
    await saveInvestigation(session, database);
    await addInvestigationItem({ sessionId: session.id, type: 'note', title: 'Decision', content: 'Use the revision-pinned evidence.' }, database);
    await createWorkspace('Auth services', [first.repository.id, second.repository.id], database);
    const markdown = generateInvestigationMarkdown({ session, repositories: [first.repository, second.repository], messages: [], items: await database.investigationItems.toArray() });
    expect(markdown).toContain('# Authentication flow');
    expect(markdown).toContain('Use the revision-pinned evidence.');
    expect(await database.workspaces.count()).toBe(1);
  });

  it('refreshes same-count search results after chunk content changes', async () => {
    database = new CodeContextDB(`Search_${Date.now()}`);
    const result = await indexLocalSource({ name: 'search', source: 'local-folder', database, limits, files: [{ path: 'a.ts', content: 'export function initialLogic() { return 1; }' }] });
    expect(await searchRepository({ repositoryId: result.repository.id, query: 'initialLogic', database })).not.toHaveLength(0);
    const chunk = await database.chunks.where('repositoryId').equals(result.repository.id).first();
    await database.chunks.update(chunk!.id, { content: 'export function replacementLogic() { return 2; }' });
    expect(await searchRepository({ repositoryId: result.repository.id, query: 'replacementLogic', database })).not.toHaveLength(0);
  });
});
