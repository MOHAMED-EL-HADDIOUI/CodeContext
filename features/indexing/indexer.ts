import type {
  IndexingProgress,
  IndexingLimits,
  RepositorySource,
} from '../../types';
import { GitHubClient, mapGitHubError } from '../../services/github/client';
import { parseGitHubUrl } from '../../services/github/urlParser';
import { getFileExtension, detectLanguageFromPath } from '../../core/parsers/language';
import { createLocalSourceId, computeContentRevision } from '../../core/indexing/sourceIdentity';
import { db, type CodeContextDB, type SourceSnapshot } from '../../services/storage/db';
import type { SourceFileInput } from '../../services/ingestion/localSources';
import {
  createManifestRepository,
  indexPreparedSource,
  prepareSourceManifest,
  hashLocalFile,
  type DiscoveredSourceFile,
  type IndexSourceResult,
} from './sourceIndexer';

export interface IndexGitHubOptions {
  urlOrSlug: string;
  githubToken?: string;
  limits: IndexingLimits;
  signal?: AbortSignal;
  database?: CodeContextDB;
  githubClient?: GitHubClient;
  onProgress?: (progress: IndexingProgress) => void;
  resumeJobId?: string;
}

export type IndexRepositoryResult = IndexSourceResult;

export async function indexGitHubRepository(options: IndexGitHubOptions): Promise<IndexRepositoryResult> {
  const parsed = parseGitHubUrl(options.urlOrSlug);
  if (!parsed) throw new Error('Enter a valid GitHub repository, branch tree, or file URL.');
  const database = options.database ?? db;
  const client = options.githubClient ?? new GitHubClient({ token: options.githubToken });
  const temporaryId = createLocalSourceId(parsed.fullName, parsed.subPath);
  options.onProgress?.({
    repositoryId: temporaryId, phase: 'fetching_metadata', discoveredFiles: 0, totalToIndex: 0,
    indexedFiles: 0, skippedFiles: 0, message: `Resolving ${parsed.fullName}@${parsed.ref ?? 'default branch'}…`,
  });
  let metadata;
  try {
    if (parsed.ref && parsed.subPath) {
      const initialRef = parsed.ref;
      const segments = parsed.subPath.split('/');
      let resolved = false;
      let lastError: unknown;
      for (let index = 0; index < segments.length; index++) {
        const candidateRef = `${initialRef}${index ? `/${segments.slice(0, index).join('/')}` : ''}`;
        const candidatePath = segments.slice(index).join('/');
        try {
          await client.resolveRef(parsed.owner, parsed.repo, candidateRef, options.signal);
          if (candidatePath && !(await client.resolvePathRef(parsed.owner, parsed.repo, candidateRef, candidatePath, options.signal))) continue;
          parsed.ref = candidateRef;
          parsed.subPath = candidatePath || undefined;
          resolved = true;
          break;
        } catch (error) {
          lastError = error;
          if (options.signal?.aborted) throw error;
        }
      }
      if (!resolved) throw lastError ?? new Error('The branch and path could not be resolved.');
    }
    metadata = await client.getRepositoryMetadata(parsed.owner, parsed.repo, parsed.ref, options.signal);
  } catch (error) {
    throw mapGitHubError(error);
  }
  const repository = createManifestRepository({
    owner: metadata.owner,
    name: metadata.name,
    fullName: metadata.fullName,
    url: parsed.subPath && parsed.ref ? `https://github.com/${metadata.fullName}/${parsed.kind}/${parsed.ref.split('/').map(encodeURIComponent).join('/')}/${parsed.subPath.split('/').map(encodeURIComponent).join('/')}` : parsed.ref ? `https://github.com/${metadata.fullName}/tree/${parsed.ref.split('/').map(encodeURIComponent).join('/')}` : metadata.url,
    ref: parsed.ref ?? metadata.resolvedRef ?? metadata.defaultBranch,
    scopePath: parsed.subPath,
    indexScope: parsed.kind,
    commitSha: metadata.commitSha,
    defaultBranch: metadata.defaultBranch,
    languages: metadata.languages,
    description: metadata.description,
    stars: metadata.stars,
    isPrivate: metadata.isPrivate,
  });
  // Plain repository URLs keep the v1 owner/repo identity. Explicit refs and
  // path scopes get their own snapshot identities so branches never mix.
  if (parsed.kind === 'repository' && !parsed.ref && !parsed.subPath) repository.id = parsed.fullName.toLowerCase();
  const existing = await database.repositories.get(repository.id);
  Object.assign(repository, {
    createdAt: existing?.createdAt ?? repository.createdAt,
    indexedAt: existing?.indexedAt,
    readmeContent: existing?.readmeContent,
    readmePath: existing?.readmePath,
  });
  await database.repositories.put(repository);
  const tree = await client.getRepositoryTree(metadata.owner, metadata.name, metadata.commitSha, options.signal);
  const entries = tree.entries.filter((entry) => entry.type === 'blob').map((entry) => ({
    path: entry.path, sha: entry.sha, size: entry.size,
  }));
  const manifest = prepareSourceManifest(repository, entries, options.limits, tree.truncated);
  manifest.rateLimit = tree.rateLimit;
  const snapshots: SourceSnapshot[] = entries.map((entry) => ({
    id: `${repository.id}::${entry.path}`,
    repositoryId: repository.id,
    path: entry.path,
    sha: entry.sha,
    size: entry.size,
  }));
  await database.sourceSnapshots.bulkPut(snapshots);
  try {
    return await indexPreparedSource({
      manifest,
      limits: options.limits,
      signal: options.signal,
      database,
      jobId: options.resumeJobId,
      onProgress: options.onProgress,
      readFile: async (file, signal) => {
        const content = await client.getFileContent(metadata.owner, metadata.name, metadata.commitSha, file.path, file.sha, metadata.isPrivate, signal);
        await database.sourceSnapshots.update(`${repository.id}::${file.path}`, { content });
        return content;
      },
    });
  } catch (error) {
    const mapped = error instanceof DOMException && error.name === 'AbortError' ? error : mapGitHubError(error);
    await database.repositories.update(repository.id, { indexingStatus: mapped.name === 'AbortError' ? 'cancelled' : 'error', indexingError: mapped.message, updatedAt: Date.now() });
    await database.indexJobs.where('repositoryId').equals(repository.id).modify({ status: mapped.name === 'AbortError' ? 'paused' : 'error', phase: mapped.name === 'AbortError' ? 'cancelled' : 'error', error: mapped.message, updatedAt: Date.now() });
    options.onProgress?.({
      repositoryId: repository.id, phase: 'error', discoveredFiles: entries.length, totalToIndex: manifest.files.length,
      indexedFiles: 0, skippedFiles: 0, message: mapped.message, error: mapped.message,
    });
    throw mapped;
  }
}

export interface IndexLocalOptions {
  name: string;
  source: Extract<RepositorySource, 'local-folder' | 'local-zip'>;
  files: SourceFileInput[];
  limits: IndexingLimits;
  database?: CodeContextDB;
  signal?: AbortSignal;
  onProgress?: (progress: IndexingProgress) => void;
  resumeJobId?: string;
}

export async function indexLocalSource(options: IndexLocalOptions): Promise<IndexRepositoryResult> {
  const database = options.database ?? db;
  const now = Date.now();
  const id = options.source === 'local-folder' ? createLocalSourceId(options.name) : createLocalSourceId(options.name).replace('local-folder', 'local-zip');
  const existing = await database.repositories.get(id);
  const files: DiscoveredSourceFile[] = [];
  const snapshots: SourceSnapshot[] = [];
  const languages: Record<string, number> = {};
  for (const file of options.files) {
    const sha = await hashLocalFile(file.path, file.content);
    const size = new TextEncoder().encode(file.content).byteLength;
    const language = detectLanguageFromPath(file.path);
    languages[language] = (languages[language] ?? 0) + size;
    files.push({ path: file.path, sha, size, priority: 0 });
    snapshots.push({ id: `${id}::${file.path}`, repositoryId: id, path: file.path, sha, size, content: file.content });
  }
  const revision = computeContentRevision(files.map((file) => `${file.path}:${file.sha}`));
  const repository = createManifestRepository({
    id,
    source: options.source,
    owner: 'local',
    name: options.name,
    fullName: `local/${options.name}`,
    url: `local://${encodeURIComponent(options.name)}`,
    ref: revision,
    commitSha: revision,
    scopePath: undefined,
    existing: existing ?? undefined,
    languages,
  });
  repository.createdAt = existing?.createdAt ?? now;
  const manifest = prepareSourceManifest(repository, files, options.limits);
  await database.sourceSnapshots.bulkPut(snapshots);
  const contents = new Map(options.files.map((file) => [file.path, file.content]));
  return indexPreparedSource({
    manifest,
    database,
    jobId: options.resumeJobId,
    limits: options.limits,
    signal: options.signal,
    onProgress: options.onProgress,
    readFile: async (file) => {
      const content = contents.get(file.path) ?? (await database.sourceSnapshots.get(`${id}::${file.path}`))?.content;
      if (content === undefined) throw new Error(`Local file is no longer available: ${file.path}`);
      return content;
    },
  });
}

export { getFileExtension };
