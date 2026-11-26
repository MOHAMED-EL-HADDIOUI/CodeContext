import type {
  IndexingLimits,
  IndexingProgress,
  IndexJob,
  Repository,
  RepositoryFile,
  RepositorySource,
} from '../../types';
import { computeFilePriority, isLikelyBinaryContent, shouldIndexFile } from '../../core/parsers/filter';
import { detectLanguageFromPath, getFileExtension } from '../../core/parsers/language';
import { analyzeSourceFile } from '../../core/parsers/workerClient';
import { createSourceId, normalizeScopePath, sha256Text } from '../../core/indexing/sourceIdentity';
import { db, type CodeContextDB } from '../../services/storage/db';

export interface DiscoveredSourceFile {
  path: string;
  sha: string;
  size: number;
  priority: number;
}

export interface SourceManifest {
  repository: Repository;
  files: DiscoveredSourceFile[];
  skipped: RepositoryFile[];
  truncated?: boolean;
  rateLimit?: { remaining?: number; reset?: number };
}

export interface IndexSourceOptions {
  manifest: SourceManifest;
  limits: IndexingLimits;
  signal?: AbortSignal;
  database?: CodeContextDB;
  readFile: (file: DiscoveredSourceFile, signal?: AbortSignal) => Promise<string>;
  onProgress?: (progress: IndexingProgress) => void;
  jobId?: string;
  onlyPaths?: string[];
  forcePaths?: string[];
}

export interface IndexSourceResult {
  repository: Repository;
  reusedFiles: number;
  newlyIndexedFiles: number;
  deletedFiles: number;
}

export function createManifestRepository(input: {
  id?: string;
  source?: RepositorySource;
  owner: string;
  name: string;
  fullName: string;
  url: string;
  ref?: string;
  scopePath?: string;
  indexScope?: Repository['indexScope'];
  commitSha: string;
  existing?: Repository;
  languages?: Record<string, number>;
  indexingInput?: string;
  description?: string;
  defaultBranch?: string;
  stars?: number;
  isPrivate?: boolean;
}): Repository {
  const now = Date.now();
  const existing = input.existing;
  const source = input.source ?? 'github';
  return {
    id: input.id ?? createSourceId(input),
    owner: input.owner,
    name: input.name,
    fullName: input.fullName,
    url: input.url,
    description: input.description ?? existing?.description,
    defaultBranch: input.defaultBranch ?? input.ref ?? existing?.defaultBranch ?? 'main',
    commitSha: input.commitSha,
    languages: input.languages ?? existing?.languages ?? {},
    stars: input.stars ?? existing?.stars,
    isPrivate: input.isPrivate ?? existing?.isPrivate ?? false,
    fileCount: existing?.fileCount ?? 0,
    indexedFileCount: existing?.indexedFileCount ?? 0,
    skippedFileCount: existing?.skippedFileCount ?? 0,
    chunkCount: existing?.chunkCount ?? 0,
    symbolCount: existing?.symbolCount ?? 0,
    readmeContent: existing?.readmeContent,
    readmePath: existing?.readmePath,
    truncatedTree: existing?.truncatedTree ?? false,
    indexingStatus: 'fetching_tree',
    indexedAt: existing?.indexedAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    source,
    ref: input.ref,
    scopePath: normalizeScopePath(input.scopePath),
    indexScope: input.indexScope ?? 'repository',
    localRevision: source === 'github' ? undefined : input.commitSha,
  };
}

function fileStub(repositoryId: string, path: string, size: number, sha: string, reason: string): RepositoryFile {
  return {
    id: `${repositoryId}::${path}`,
    repositoryId,
    path,
    name: path.split('/').pop() ?? path,
    extension: getFileExtension(path),
    language: detectLanguageFromPath(path),
    size,
    sha,
    lineCount: 0,
    indexed: false,
    skippedReason: reason,
  };
}

export function prepareSourceManifest(repository: Repository, entries: Array<{ path: string; sha: string; size: number }>, limits: IndexingLimits, truncated = false): SourceManifest {
  const prefix = repository.scopePath ? `${repository.scopePath}/` : undefined;
  const files = entries.filter((entry) => !prefix || entry.path.startsWith(prefix) || /^readme(\.\w+)?$/i.test(entry.path));
  const eligible: DiscoveredSourceFile[] = [];
  const skipped: RepositoryFile[] = [];
  for (const entry of files) {
    const decision = shouldIndexFile(entry.path, entry.size, limits);
    if (!decision.include) {
      skipped.push(fileStub(repository.id, entry.path, entry.size, entry.sha, decision.reason ?? 'Excluded'));
    } else {
      eligible.push({ ...entry, priority: computeFilePriority(entry.path) });
    }
  }
  eligible.sort((a, b) => b.priority - a.priority || a.path.localeCompare(b.path));
  const selected: DiscoveredSourceFile[] = [];
  let bytes = 0;
  for (const file of eligible) {
    if (selected.length >= limits.maxFiles) {
      skipped.push(fileStub(repository.id, file.path, file.size, file.sha, `Exceeded maxFiles limit (${limits.maxFiles})`));
      continue;
    }
    if (bytes + file.size > limits.maxTotalSizeMb * 1024 * 1024) {
      skipped.push(fileStub(repository.id, file.path, file.size, file.sha, `Exceeded total size limit (${limits.maxTotalSizeMb} MB)`));
      continue;
    }
    bytes += file.size;
    selected.push(file);
  }
  if (repository.indexScope === 'blob' && repository.scopePath) {
    const chosen = selected.filter((file) => file.path === repository.scopePath);
    for (const file of selected) if (file.path !== repository.scopePath && !/^readme(\.\w+)?$/i.test(file.path)) {
      skipped.push(fileStub(repository.id, file.path, file.size, file.sha, 'Outside selected file scope'));
    }
    selected.splice(0, selected.length, ...chosen, ...selected.filter((file) => /^readme(\.\w+)?$/i.test(file.path)));
  }
  return { repository, files: selected, skipped, truncated };
}

export async function indexPreparedSource(options: IndexSourceOptions): Promise<IndexSourceResult> {
  const database = options.database ?? db;
  const { repository, files, skipped } = options.manifest;
  const repoId = repository.id;
  const now = Date.now();
  const existingRepo = await database.repositories.get(repoId);
  let job: IndexJob | undefined = options.jobId ? await database.indexJobs.get(options.jobId) : undefined;
  if (!job) {
    job = {
      id: `job:${repoId}:${now}`,
      repositoryId: repoId,
      kind: repository.source ?? 'github',
      status: 'running',
      phase: 'indexing',
      input: repository.url,
      pendingFiles: files.map((file) => file.path),
      completedFiles: [],
      totalFiles: files.length,
      processedFiles: 0,
      skippedFiles: skipped.length,
      createdAt: now,
      updatedAt: now,
    };
  } else if (!options.onlyPaths) {
    // A service worker may restart between files. Preserve per-file checkpoints,
    // but bind them to the new repository manifest and revision.
    const manifestPaths = new Set(files.map((file) => file.path));
    const completed = new Set(job.completedFiles.filter((path) => manifestPaths.has(path) && existingRepo?.commitSha === repository.commitSha));
    job = { ...job, status: 'running', phase: 'indexing', input: repository.url, pendingFiles: files.filter((file) => !completed.has(file.path)).map((file) => file.path), completedFiles: [...completed], totalFiles: files.length, processedFiles: completed.size, skippedFiles: skipped.length, updatedAt: now };
  }
  await database.indexJobs.put(job);
  const jobId = job.id;
  const pendingSet = new Set(job.pendingFiles);
  const scopeFiles = options.onlyPaths ? files.filter((file) => options.onlyPaths?.includes(file.path)) : files;
  const selected = scopeFiles.filter((file) => options.forcePaths?.includes(file.path) || pendingSet.has(file.path));
  const existingFiles = await database.files.where('repositoryId').equals(repoId).toArray();
  const existingByPath = new Map(existingFiles.map((file) => [file.path, file]));
  const currentPaths = new Set([...files, ...skipped].map((file) => file.path));
  const deleted = options.onlyPaths ? [] : existingFiles.filter((file) => !currentPaths.has(file.path));

  const emit = (phase: IndexingProgress['phase'], indexedFiles: number, skippedFiles: number, message: string, currentFile?: string, error?: string) => {
    const progress: IndexingProgress = {
      repositoryId: repoId, phase, discoveredFiles: files.length + skipped.length,
      totalToIndex: job!.totalFiles, indexedFiles, skippedFiles, currentFile, message, error,
      rateLimitRemaining: options.manifest.rateLimit?.remaining,
      rateLimitReset: options.manifest.rateLimit?.reset,
    };
    options.onProgress?.(progress);
  };
  const updateJob = async (patch: Partial<IndexJob>) => {
    await database.indexJobs.update(jobId, { ...patch, updatedAt: Date.now() });
  };
  await database.repositories.put({
    ...repository, fileCount: files.length + skipped.length, truncatedTree: options.manifest.truncated ?? false,
    indexingStatus: 'indexing', indexingError: undefined, updatedAt: now,
  });
  if (skipped.length && !options.onlyPaths) await database.files.bulkPut(skipped);
  if (deleted.length) {
    await database.transaction('rw', [database.files, database.symbols, database.chunks, database.embeddings], async () => {
      for (const file of deleted) {
        await database.symbols.where('fileId').equals(file.id).delete();
        const chunkIds = await database.chunks.where('fileId').equals(file.id).primaryKeys();
        await database.embeddings.bulkDelete(chunkIds as string[]);
        await database.chunks.where('fileId').equals(file.id).delete();
        await database.files.delete(file.id);
      }
    });
  }
  let indexedCount = existingFiles.filter((file) => file.indexed && currentPaths.has(file.path) && !pendingSet.has(file.path)).length;
  let newlyIndexedFiles = 0;
  let reusedFiles = 0;
  let skippedCount = skipped.length;
  let processedCount = job.processedFiles;
  let readmeContent = repository.readmeContent;
  let readmePath = repository.readmePath;
  const completed = new Set(job.completedFiles);
  const pending = new Set(job.pendingFiles);
  let cursor = 0;
  emit('indexing', indexedCount, skippedCount, selected.length ? `Indexing ${selected.length} remaining files…` : 'Finalizing source index…');

  async function worker(): Promise<void> {
    while (cursor < selected.length) {
      if (options.signal?.aborted) throw new DOMException('Indexing cancelled by user', 'AbortError');
      const file = selected[cursor++]!;
      const previous = existingByPath.get(file.path);
      const fileId = `${repoId}::${file.path}`;
      try {
        if (previous?.indexed && previous.sha === file.sha && previous.content !== undefined) {
          reusedFiles++;
        } else {
          const content = await options.readFile(file, options.signal);
          if (options.signal?.aborted) throw new DOMException('Indexing cancelled by user', 'AbortError');
          if (isLikelyBinaryContent(content)) {
            skippedCount++;
            await database.files.put(fileStub(repoId, file.path, file.size, file.sha, 'Detected binary content'));
          } else {
            const language = detectLanguageFromPath(file.path);
            const analysis = await analyzeSourceFile({ repositoryId: repoId, fileId, filePath: file.path, language, content, useWorker: database === db });
            const symbols = analysis.symbols;
            const chunks = analysis.chunks;
            const record: RepositoryFile = {
              ...fileStub(repoId, file.path, file.size, file.sha, ''),
              language, content, lineCount: content.split(/\r?\n/).length, indexed: true, skippedReason: undefined,
            };
            await database.transaction('rw', [database.files, database.symbols, database.chunks, database.embeddings], async () => {
              const oldChunkIds = await database.chunks.where('fileId').equals(fileId).primaryKeys();
              await database.embeddings.bulkDelete(oldChunkIds as string[]);
              await database.symbols.where('fileId').equals(fileId).delete();
              await database.chunks.where('fileId').equals(fileId).delete();
              await database.files.put(record);
              if (symbols.length) await database.symbols.bulkPut(symbols);
              if (chunks.length) await database.chunks.bulkPut(chunks);
            });
            newlyIndexedFiles++;
          }
        }
        indexedCount++;
        completed.add(file.path);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') { pending.add(file.path); throw error; }
        if (options.signal?.aborted) { pending.add(file.path); throw new DOMException('Indexing cancelled by user', 'AbortError'); }
        skippedCount++;
        await database.files.put(fileStub(repoId, file.path, file.size, file.sha, error instanceof Error ? error.message : 'Failed to read file'));
        completed.add(file.path);
      }
      // Commit the checkpoint only after the file transaction completes.
      pending.delete(file.path);
      processedCount++;
      await updateJob({
        pendingFiles: [...pending], completedFiles: [...completed], processedFiles: processedCount,
        skippedFiles: skippedCount, status: 'running', phase: 'indexing',
      });
      if (/^readme(\.\w+)?$/i.test(file.path)) {
        const saved = await database.files.get(fileId);
        if (saved?.content) { readmeContent = saved.content; readmePath = saved.path; }
      }
      emit('indexing', indexedCount, skippedCount, `Processed ${processedCount} of ${job!.totalFiles} files`, file.path);
      // Allow React and Chrome's service worker event loop to stay responsive.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  try {
    const workers = Math.max(1, Math.min(options.limits.concurrency, selected.length));
    await Promise.all(Array.from({ length: workers }, () => worker()));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      await updateJob({ pendingFiles: [...pending], completedFiles: [...completed], status: 'paused', phase: 'cancelled' });
      await database.repositories.update(repoId, {
        indexingStatus: 'cancelled', indexedFileCount: indexedCount, skippedFileCount: skippedCount,
        indexingError: 'Indexing paused. Resume to process only remaining files.', updatedAt: Date.now(),
      });
      emit('cancelled', indexedCount, skippedCount, 'Indexing paused. Resume when ready.');
      return { repository: (await database.repositories.get(repoId))!, reusedFiles, newlyIndexedFiles, deletedFiles: deleted.length };
    }
    throw error;
  }
  if (!readmeContent) {
    const readme = existingFiles.find((file) => /^readme(\.\w+)?$/i.test(file.path) && file.content);
    if (readme) { readmeContent = readme.content; readmePath = readme.path; }
  }
  const [chunkCount, symbolCount, currentFiles] = await Promise.all([
    database.chunks.where('repositoryId').equals(repoId).count(),
    database.symbols.where('repositoryId').equals(repoId).count(),
    database.files.where('repositoryId').equals(repoId).toArray(),
  ]);
  const finalStatus = options.manifest.truncated || skippedCount > 0 ? 'partial' : 'ready';
  const finalRepository: Repository = {
    ...repository, fileCount: currentFiles.length, indexedFileCount: currentFiles.filter((file) => file.indexed).length,
    skippedFileCount: currentFiles.filter((file) => !file.indexed).length, chunkCount, symbolCount,
    readmeContent, readmePath, truncatedTree: options.manifest.truncated ?? false,
    indexingStatus: finalStatus, indexingError: undefined, indexedAt: Date.now(), updatedAt: Date.now(),
  };
  await database.repositories.put(finalRepository);
  await updateJob({
    pendingFiles: [...pending], completedFiles: [...completed], processedFiles: processedCount,
    skippedFiles: skippedCount, status: 'completed', phase: finalStatus,
  });
  emit(finalStatus, finalRepository.indexedFileCount, finalRepository.skippedFileCount,
    `Indexed ${finalRepository.indexedFileCount} files (${finalRepository.skippedFileCount} skipped or capped).`);
  // Keep local snapshots for offline resume and targeted skipped-file indexing.
  // GitHub snapshots without content only hold immutable tree metadata.
  return { repository: finalRepository, reusedFiles, newlyIndexedFiles, deletedFiles: deleted.length };
}

export async function indexSingleSkippedFile(repository: Repository, path: string, database = db): Promise<IndexSourceResult> {
  const snapshot = await database.sourceSnapshots.where('[repositoryId+path]').equals([repository.id, path]).first();
  if (snapshot?.sha && snapshot.content === undefined && (repository.source ?? 'github') === 'github') {
    const { GitHubClient } = await import('../../services/github/client');
    const { getGitHubToken } = await import('../../services/storage/credentials');
    const client = new GitHubClient({ token: await getGitHubToken() });
    const content = await client.getFileContent(repository.owner, repository.name, repository.commitSha, path, snapshot.sha, repository.isPrivate);
    await database.sourceSnapshots.update(snapshot.id, { content });
    return indexSingleSkippedFile(repository, path, database);
  }
  if (!snapshot?.content) throw new Error('This file is not available in the local snapshot. Re-index the source to refresh its contents.');
  const file = await database.files.where('[repositoryId+path]').equals([repository.id, path]).first();
  if (!file) throw new Error('This file is not listed in the indexed source. Refresh the source first.');
  const manifest = prepareSourceManifest(repository, [{ path, sha: snapshot.sha, size: snapshot.size }], { maxFiles: 2000, maxFileSizeKb: 2048, maxTotalSizeMb: 100, concurrency: 1 });
  return indexPreparedSource({
    manifest, database, limits: { maxFiles: 2000, maxFileSizeKb: 2048, maxTotalSizeMb: 100, concurrency: 1 },
    onlyPaths: [path], readFile: async () => snapshot.content!, forcePaths: [path],
  });
}

export async function hashLocalFile(path: string, content: string): Promise<string> {
  return sha256Text(`${path}\n${content}`);
}
