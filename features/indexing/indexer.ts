import type {
  CodeChunk,
  CodeSymbol,
  IndexingLimits,
  IndexingProgress,
  Repository,
  RepositoryFile,
} from '../../types';
import { computeFilePriority, isLikelyBinaryContent, shouldIndexFile } from '../../core/parsers/filter';
import { detectLanguageFromPath, getFileExtension } from '../../core/parsers/language';
import { extractSymbols } from '../../core/symbols/extractor';
import { chunkSourceFile } from '../../core/chunking/chunker';
import { GitHubClient, mapGitHubError } from '../../services/github/client';
import { parseGitHubUrl } from '../../services/github/urlParser';
import { db, type CodeContextDB } from '../../services/storage/db';

export interface IndexRepositoryOptions {
  urlOrSlug: string;
  githubToken?: string;
  limits: IndexingLimits;
  signal?: AbortSignal;
  database?: CodeContextDB;
  githubClient?: GitHubClient;
  onProgress?: (progress: IndexingProgress) => void;
}

export interface IndexRepositoryResult {
  repository: Repository;
  reusedFiles: number;
  newlyIndexedFiles: number;
  deletedFiles: number;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  signal: AbortSignal | undefined,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const maxWorkers = Math.max(1, Math.min(concurrency, items.length));

  async function next(): Promise<void> {
    while (cursor < items.length) {
      if (signal?.aborted) {
        throw new DOMException('Indexing cancelled by user', 'AbortError');
      }
      const index = cursor++;
      const item = items[index];
      if (item !== undefined) {
        await worker(item);
      }
    }
  }

  await Promise.all(Array.from({ length: maxWorkers }, () => next()));
}

export async function indexGitHubRepository(
  options: IndexRepositoryOptions,
): Promise<IndexRepositoryResult> {
  const parsed = parseGitHubUrl(options.urlOrSlug);
  if (!parsed) {
    throw new Error(
      'Invalid GitHub URL. Enter a repository URL such as https://github.com/owner/repository.',
    );
  }

  const database = options.database ?? db;
  const client = options.githubClient ?? new GitHubClient({ token: options.githubToken });
  const repoId = parsed.fullName.toLowerCase();
  const now = Date.now();

  const emit = (p: Omit<IndexingProgress, 'repositoryId'>) => {
    options.onProgress?.({ repositoryId: repoId, ...p });
  };

  emit({
    phase: 'fetching_metadata',
    discoveredFiles: 0,
    totalToIndex: 0,
    indexedFiles: 0,
    skippedFiles: 0,
    message: `Fetching metadata for ${parsed.fullName}…`,
  });

  const existingRepo = await database.repositories.get(repoId);

  let metadata;
  try {
    metadata = await client.getRepositoryMetadata(
      parsed.owner,
      parsed.repo,
      parsed.ref,
      options.signal,
    );
  } catch (err) {
    const mapped = mapGitHubError(err);
    emit({
      phase: 'error',
      discoveredFiles: 0,
      totalToIndex: 0,
      indexedFiles: 0,
      skippedFiles: 0,
      message: mapped.message,
      error: mapped.message,
    });
    throw mapped;
  }

  // Persist initial repository shell
  const repoRecord: Repository = {
    id: repoId,
    owner: metadata.owner,
    name: metadata.name,
    fullName: metadata.fullName,
    url: metadata.url,
    description: metadata.description,
    defaultBranch: metadata.defaultBranch,
    commitSha: metadata.commitSha,
    languages: metadata.languages,
    stars: metadata.stars,
    isPrivate: metadata.isPrivate,
    fileCount: existingRepo?.fileCount ?? 0,
    indexedFileCount: existingRepo?.indexedFileCount ?? 0,
    skippedFileCount: existingRepo?.skippedFileCount ?? 0,
    chunkCount: existingRepo?.chunkCount ?? 0,
    symbolCount: existingRepo?.symbolCount ?? 0,
    readmeContent: existingRepo?.readmeContent,
    readmePath: existingRepo?.readmePath,
    truncatedTree: false,
    indexingStatus: 'fetching_tree',
    indexingError: undefined,
    indexedAt: existingRepo?.indexedAt,
    createdAt: existingRepo?.createdAt ?? now,
    updatedAt: now,
  };
  await database.repositories.put(repoRecord);

  emit({
    phase: 'fetching_tree',
    discoveredFiles: 0,
    totalToIndex: 0,
    indexedFiles: 0,
    skippedFiles: 0,
    rateLimitRemaining: metadata.rateLimit.remaining,
    rateLimitReset: metadata.rateLimit.reset,
    message: `Loading file tree at commit ${metadata.commitSha.slice(0, 7)}…`,
  });

  let treeResult;
  try {
    treeResult = await client.getRepositoryTree(
      metadata.owner,
      metadata.name,
      metadata.commitSha,
      options.signal,
    );
  } catch (err) {
    const mapped = mapGitHubError(err);
    await database.repositories.update(repoId, {
      indexingStatus: 'error',
      indexingError: mapped.message,
      updatedAt: Date.now(),
    });
    emit({
      phase: 'error',
      discoveredFiles: 0,
      totalToIndex: 0,
      indexedFiles: 0,
      skippedFiles: 0,
      message: mapped.message,
      error: mapped.message,
    });
    throw mapped;
  }

  // Filter blobs (optionally scoped if user passed a subdirectory URL)
  const subPathPrefix =
    parsed.kind === 'tree' && parsed.subPath
      ? `${parsed.subPath.replace(/\/+$/, '')}/`
      : undefined;

  const allBlobs = treeResult.entries.filter((e) => {
    if (e.type !== 'blob') return false;
    if (subPathPrefix && !e.path.startsWith(subPathPrefix) && !/^readme/i.test(e.path)) {
      return false;
    }
    return true;
  });

  const eligibleBlobs: Array<{ path: string; sha: string; size: number; priority: number }> = [];
  const skippedRecords: RepositoryFile[] = [];

  for (const blob of allBlobs) {
    const decision = shouldIndexFile(blob.path, blob.size, options.limits);
    if (!decision.include) {
      skippedRecords.push({
        id: `${repoId}::${blob.path}`,
        repositoryId: repoId,
        path: blob.path,
        name: blob.path.split('/').pop() ?? blob.path,
        extension: getFileExtension(blob.path),
        language: detectLanguageFromPath(blob.path),
        size: blob.size,
        sha: blob.sha,
        lineCount: 0,
        indexed: false,
        skippedReason: decision.reason,
      });
    } else {
      eligibleBlobs.push({
        path: blob.path,
        sha: blob.sha,
        size: blob.size,
        priority: computeFilePriority(blob.path),
      });
    }
  }

  // Prioritize README, manifests, entrypoints, core source before applying maxFiles & maxTotalSizeMb caps
  eligibleBlobs.sort((a, b) => b.priority - a.priority || a.path.localeCompare(b.path));

  const maxTotalBytes = options.limits.maxTotalSizeMb * 1024 * 1024;
  let runningBytes = 0;
  const selectedBlobs: typeof eligibleBlobs = [];

  for (const blob of eligibleBlobs) {
    if (selectedBlobs.length >= options.limits.maxFiles) {
      skippedRecords.push({
        id: `${repoId}::${blob.path}`,
        repositoryId: repoId,
        path: blob.path,
        name: blob.path.split('/').pop() ?? blob.path,
        extension: getFileExtension(blob.path),
        language: detectLanguageFromPath(blob.path),
        size: blob.size,
        sha: blob.sha,
        lineCount: 0,
        indexed: false,
        skippedReason: `Exceeded maxFiles limit (${options.limits.maxFiles})`,
      });
      continue;
    }
    if (runningBytes + blob.size > maxTotalBytes) {
      skippedRecords.push({
        id: `${repoId}::${blob.path}`,
        repositoryId: repoId,
        path: blob.path,
        name: blob.path.split('/').pop() ?? blob.path,
        extension: getFileExtension(blob.path),
        language: detectLanguageFromPath(blob.path),
        size: blob.size,
        sha: blob.sha,
        lineCount: 0,
        indexed: false,
        skippedReason: `Exceeded total size limit (${options.limits.maxTotalSizeMb} MB)`,
      });
      continue;
    }
    runningBytes += blob.size;
    selectedBlobs.push(blob);
  }

  // Incremental indexing: detect unchanged vs changed vs deleted files
  const existingFiles = await database.files.where('repositoryId').equals(repoId).toArray();
  const existingByPath = new Map(existingFiles.map((f) => [f.path, f]));
  const currentBlobPaths = new Set(allBlobs.map((b) => b.path));

  const deletedFileIds: string[] = [];
  for (const oldFile of existingFiles) {
    if (!currentBlobPaths.has(oldFile.path)) {
      deletedFileIds.push(oldFile.id);
    }
  }

  if (deletedFileIds.length > 0) {
    await database.transaction(
      'rw',
      [database.files, database.symbols, database.chunks, database.embeddings],
      async () => {
        for (const fid of deletedFileIds) {
          await database.symbols.where('fileId').equals(fid).delete();
          await database.chunks.where('fileId').equals(fid).delete();
          await database.files.delete(fid);
        }
      },
    );
  }

  const toFetch: typeof selectedBlobs = [];
  let reusedFiles = 0;

  for (const blob of selectedBlobs) {
    const prev = existingByPath.get(blob.path);
    if (prev && prev.indexed && prev.sha === blob.sha && prev.content !== undefined) {
      reusedFiles++;
    } else {
      toFetch.push(blob);
    }
  }

  let indexedCount = reusedFiles;
  let newlyIndexedFiles = 0;
  let skippedCount = skippedRecords.length;
  let readmeContent = repoRecord.readmeContent;
  let readmePath = repoRecord.readmePath;

  // Store skipped file stubs so the file tree still shows complete repo structure
  if (skippedRecords.length > 0) {
    await database.files.bulkPut(skippedRecords);
  }

  await database.repositories.update(repoId, {
    indexingStatus: 'indexing',
    fileCount: allBlobs.length,
    truncatedTree: treeResult.truncated,
    updatedAt: Date.now(),
  });

  emit({
    phase: 'indexing',
    discoveredFiles: allBlobs.length,
    totalToIndex: selectedBlobs.length,
    indexedFiles: indexedCount,
    skippedFiles: skippedCount,
    rateLimitRemaining: treeResult.rateLimit.remaining,
    rateLimitReset: treeResult.rateLimit.reset,
    message:
      reusedFiles > 0
        ? `Incremental sync: reusing ${reusedFiles} unchanged files, indexing ${toFetch.length} updated files…`
        : `Indexing ${toFetch.length} source files…`,
  });

  try {
    await runWithConcurrency(toFetch, options.limits.concurrency, options.signal, async (blob) => {
      const fileId = `${repoId}::${blob.path}`;
      const language = detectLanguageFromPath(blob.path);

      try {
        const content = await client.getFileContent(
          metadata.owner,
          metadata.name,
          metadata.commitSha,
          blob.path,
          blob.sha,
          metadata.isPrivate,
          options.signal,
        );

        if (isLikelyBinaryContent(content)) {
          skippedCount++;
          await database.files.put({
            id: fileId,
            repositoryId: repoId,
            path: blob.path,
            name: blob.path.split('/').pop() ?? blob.path,
            extension: getFileExtension(blob.path),
            language,
            size: blob.size,
            sha: blob.sha,
            lineCount: 0,
            indexed: false,
            skippedReason: 'Detected binary content',
          });
          return;
        }

        const lineCount = content.split(/\r?\n/).length;
        const symbols: CodeSymbol[] = extractSymbols({
          repositoryId: repoId,
          fileId,
          filePath: blob.path,
          language,
          content,
        });
        const chunks: CodeChunk[] = chunkSourceFile({
          repositoryId: repoId,
          fileId,
          filePath: blob.path,
          language,
          content,
          symbols,
        });

        const fileRecord: RepositoryFile = {
          id: fileId,
          repositoryId: repoId,
          path: blob.path,
          name: blob.path.split('/').pop() ?? blob.path,
          extension: getFileExtension(blob.path),
          language,
          size: blob.size,
          sha: blob.sha,
          content,
          lineCount,
          indexed: true,
        };

        await database.transaction(
          'rw',
          [database.files, database.symbols, database.chunks],
          async () => {
            await database.symbols.where('fileId').equals(fileId).delete();
            await database.chunks.where('fileId').equals(fileId).delete();
            await database.files.put(fileRecord);
            if (symbols.length > 0) await database.symbols.bulkPut(symbols);
            if (chunks.length > 0) await database.chunks.bulkPut(chunks);
          },
        );

        if (/^readme(\.\w+)?$/i.test(blob.path)) {
          readmeContent = content;
          readmePath = blob.path;
        }

        indexedCount++;
        newlyIndexedFiles++;

        emit({
          phase: 'indexing',
          discoveredFiles: allBlobs.length,
          totalToIndex: selectedBlobs.length,
          indexedFiles: indexedCount,
          skippedFiles: skippedCount,
          currentFile: blob.path,
          message: `Indexed ${indexedCount} of ${selectedBlobs.length} files`,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw err;
        }
        skippedCount++;
        await database.files.put({
          id: fileId,
          repositoryId: repoId,
          path: blob.path,
          name: blob.path.split('/').pop() ?? blob.path,
          extension: getFileExtension(blob.path),
          language,
          size: blob.size,
          sha: blob.sha,
          lineCount: 0,
          indexed: false,
          skippedReason: err instanceof Error ? err.message : 'Failed to fetch file',
        });
      }
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      const [chunkCount, symbolCount] = await Promise.all([
        database.chunks.where('repositoryId').equals(repoId).count(),
        database.symbols.where('repositoryId').equals(repoId).count(),
      ]);
      await database.repositories.update(repoId, {
        indexingStatus: 'cancelled',
        indexedFileCount: indexedCount,
        skippedFileCount: skippedCount,
        chunkCount,
        symbolCount,
        updatedAt: Date.now(),
      });
      emit({
        phase: 'cancelled',
        discoveredFiles: allBlobs.length,
        totalToIndex: selectedBlobs.length,
        indexedFiles: indexedCount,
        skippedFiles: skippedCount,
        message: `Indexing cancelled (${indexedCount} files indexed so far).`,
      });
      const updated = (await database.repositories.get(repoId))!;
      return {
        repository: updated,
        reusedFiles,
        newlyIndexedFiles,
        deletedFiles: deletedFileIds.length,
      };
    }
    throw err;
  }

  // Ensure README is set if reused from previous index
  if (!readmeContent) {
    const readmeFile = await database.files
      .where('repositoryId')
      .equals(repoId)
      .filter((f) => /^readme(\.\w+)?$/i.test(f.path) && Boolean(f.content))
      .first();
    if (readmeFile?.content) {
      readmeContent = readmeFile.content;
      readmePath = readmeFile.path;
    }
  }

  const [chunkCount, symbolCount] = await Promise.all([
    database.chunks.where('repositoryId').equals(repoId).count(),
    database.symbols.where('repositoryId').equals(repoId).count(),
  ]);

  const isPartial =
    treeResult.truncated || eligibleBlobs.length > selectedBlobs.length || skippedCount > 0;
  const finalStatus =
    treeResult.truncated || eligibleBlobs.length > selectedBlobs.length ? 'partial' : 'ready';

  const finalRepo: Repository = {
    ...repoRecord,
    fileCount: allBlobs.length,
    indexedFileCount: indexedCount,
    skippedFileCount: skippedCount,
    chunkCount,
    symbolCount,
    readmeContent,
    readmePath,
    truncatedTree: treeResult.truncated,
    indexingStatus: finalStatus,
    indexingError: undefined,
    indexedAt: Date.now(),
    updatedAt: Date.now(),
  };

  await database.repositories.put(finalRepo);

  emit({
    phase: finalStatus,
    discoveredFiles: allBlobs.length,
    totalToIndex: selectedBlobs.length,
    indexedFiles: indexedCount,
    skippedFiles: skippedCount,
    message: isPartial
      ? `Indexed ${indexedCount} files (${skippedCount} skipped or capped).`
      : `Indexed ${indexedCount} files (${symbolCount} symbols, ${chunkCount} chunks).`,
  });

  return {
    repository: finalRepo,
    reusedFiles,
    newlyIndexedFiles,
    deletedFiles: deletedFileIds.length,
  };
}
