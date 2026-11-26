import type { IndexingLimits, IndexingProgress } from '../../types';
import { indexGitHubRepository, indexLocalSource } from '../../features/indexing/indexer';
import { db, type CodeContextDB } from '../storage/db';
import { getGitHubToken } from '../storage/credentials';
import { createLocalSourceId } from '../../core/indexing/sourceIdentity';

async function reportBackgroundError(input: string, repositoryId: string | undefined, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : 'Indexing failed.';
  if (repositoryId) {
    await db.repositories.update(repositoryId, { indexingStatus: 'error', indexingError: message, updatedAt: Date.now() });
    await db.indexJobs.where('repositoryId').equals(repositoryId).modify({ status: 'error', phase: 'error', error: message, updatedAt: Date.now() });
  }
  await broadcastProgress({ repositoryId: repositoryId ?? createLocalSourceId(input), phase: 'error', discoveredFiles: 0, totalToIndex: 0, indexedFiles: 0, skippedFiles: 0, message, error: message });
}

const controllers = new Map<string, AbortController>();

export async function startBackgroundIndexing(urlOrSlug: string, limits: IndexingLimits, resumeJobId?: string): Promise<void> {
  const existing = controllers.get(urlOrSlug);
  if (existing) return;
  const controller = new AbortController();
  controllers.set(urlOrSlug, controller);
  try {
    const result = await indexGitHubRepository({
      urlOrSlug, limits, githubToken: await getGitHubToken(), signal: controller.signal, resumeJobId,
      onProgress: (progress) => void broadcastProgress(progress),
    });
    await broadcastProgress({
      repositoryId: result.repository.id, phase: result.repository.indexingStatus,
      discoveredFiles: result.repository.fileCount, totalToIndex: result.repository.indexedFileCount,
      indexedFiles: result.repository.indexedFileCount, skippedFiles: result.repository.skippedFileCount,
      message: `Indexed ${result.repository.indexedFileCount} files (${result.repository.skippedFileCount} skipped or capped).`,
    });
  } catch (error) {
    if (!controller.signal.aborted) {
      const repositoryId = await db.indexJobs.get(resumeJobId ?? '').then((job) => job?.repositoryId);
      await reportBackgroundError(urlOrSlug, repositoryId, error);
    }
    throw error;
  } finally { controllers.delete(urlOrSlug); }
}

export async function startBackgroundLocalZip(name: string, files: Array<{ path: string; content: string }>, limits: IndexingLimits, database: CodeContextDB = db): Promise<void> {
  const repositoryId = createLocalSourceId(name).replace('local-folder', 'local-zip');
  const existing = controllers.get(repositoryId);
  if (existing) return;
  const controller = new AbortController();
  controllers.set(repositoryId, controller);
  try {
    const result = await indexLocalSource({ name, source: 'local-zip', files, limits, database, signal: controller.signal, onProgress: (progress) => void broadcastProgress(progress) });
    await broadcastProgress({ repositoryId: result.repository.id, phase: result.repository.indexingStatus, discoveredFiles: result.repository.fileCount, totalToIndex: result.repository.indexedFileCount, indexedFiles: result.repository.indexedFileCount, skippedFiles: result.repository.skippedFileCount, message: `Indexed ${result.repository.indexedFileCount} files locally.` });
  } catch (error) { await reportBackgroundError(name, repositoryId, error); throw error; }
  finally { controllers.delete(repositoryId); }
}

export function cancelBackgroundIndexing(repositoryId: string): void {
  for (const controller of controllers.values()) controller.abort();
  void db.indexJobs.where('repositoryId').equals(repositoryId).modify({ status: 'paused', phase: 'cancelled', updatedAt: Date.now() });
  void db.repositories.update(repositoryId, { indexingStatus: 'cancelled', indexingError: 'Indexing paused. Resume to process remaining files.', updatedAt: Date.now() });
  void broadcastProgress({ repositoryId, phase: 'cancelled', discoveredFiles: 0, totalToIndex: 0, indexedFiles: 0, skippedFiles: 0, message: 'Indexing paused. Resume when ready.' });
}

export async function resumeBackgroundIndexing(repositoryId: string, limits: IndexingLimits): Promise<void> {
  const repository = await db.repositories.get(repositoryId);
  if (!repository) throw new Error('The source no longer exists.');
  const job = (await db.indexJobs.where('repositoryId').equals(repositoryId).reverse().sortBy('updatedAt'))[0];
  if ((repository.source ?? 'github') === 'github') {
    await startBackgroundIndexing(job?.input ?? repository.url, limits, job?.id);
    return;
  }
  const snapshots = await db.sourceSnapshots.where('repositoryId').equals(repositoryId).toArray();
  const files = snapshots.filter((snapshot) => snapshot.content !== undefined).map((snapshot) => ({ path: snapshot.path, content: snapshot.content! }));
  if (!files.length) throw new Error('The offline snapshot is no longer available. Import the folder or ZIP again to resume.');
  const result = await indexLocalSource({
    name: repository.name, source: repository.source as 'local-folder' | 'local-zip', files, limits,
    resumeJobId: job?.id, onProgress: (progress) => void broadcastProgress(progress),
  });
  await broadcastProgress({ repositoryId, phase: result.repository.indexingStatus, discoveredFiles: result.repository.fileCount, totalToIndex: result.repository.indexedFileCount, indexedFiles: result.repository.indexedFileCount, skippedFiles: result.repository.skippedFileCount, message: 'Offline indexing resumed.' });
}

async function broadcastProgress(progress: IndexingProgress): Promise<void> {
  try { await chrome.runtime.sendMessage({ type: 'INDEXING_PROGRESS', progress }); } catch {
    // IndexedDB job checkpoints are authoritative while the panel is closed.
  }
}

export async function recoverInterruptedIndexing(): Promise<void> {
  await db.indexJobs.where('status').equals('running').modify({ status: 'paused', phase: 'cancelled', error: 'The extension worker restarted. Resume to process remaining files.', updatedAt: Date.now() });
  const repositories = await db.repositories.where('indexingStatus').equals('indexing').toArray();
  await Promise.all(repositories.map((repository) => db.repositories.update(repository.id, { indexingStatus: 'cancelled', indexingError: 'Resume to finish this source index.' })));
}
