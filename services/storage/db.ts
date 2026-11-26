import Dexie, { type EntityTable } from 'dexie';
import type {
  Repository,
  RepositoryFile,
  CodeSymbol,
  CodeChunk,
  ChatMessage,
  ChatSession,
  SavedReference,
  IndexJob,
  ChangeSet,
  ReviewReport,
  InvestigationItem,
  Workspace,
  EmbeddingModelRecord,
} from '../../types';

export interface ChunkEmbedding {
  chunkId: string;
  repositoryId: string;
  vector: number[];
  model: string;
  createdAt: number;
}

export interface SourceSnapshot {
  id: string;
  repositoryId: string;
  path: string;
  sha: string;
  size: number;
  content?: string;
}

export class CodeContextDB extends Dexie {
  repositories!: EntityTable<Repository, 'id'>;
  files!: EntityTable<RepositoryFile, 'id'>;
  symbols!: EntityTable<CodeSymbol, 'id'>;
  chunks!: EntityTable<CodeChunk, 'id'>;
  chatSessions!: EntityTable<ChatSession, 'id'>;
  chatMessages!: EntityTable<ChatMessage, 'id'>;
  savedReferences!: EntityTable<SavedReference, 'id'>;
  embeddings!: EntityTable<ChunkEmbedding, 'chunkId'>;
  indexJobs!: EntityTable<IndexJob, 'id'>;
  changeSets!: EntityTable<ChangeSet, 'id'>;
  reviewReports!: EntityTable<ReviewReport, 'id'>;
  investigationItems!: EntityTable<InvestigationItem, 'id'>;
  workspaces!: EntityTable<Workspace, 'id'>;
  embeddingModels!: EntityTable<EmbeddingModelRecord, 'id'>;
  sourceSnapshots!: EntityTable<SourceSnapshot, 'id'>;

  constructor(name = 'CodeContextDB') {
    super(name);
    this.version(1).stores({
      repositories: 'id, fullName, owner, indexingStatus, updatedAt',
      files: 'id, repositoryId, [repositoryId+path], path, language, sha, indexed',
      symbols: 'id, repositoryId, fileId, [repositoryId+name], name, kind',
      chunks: 'id, repositoryId, fileId, [repositoryId+filePath], language, symbolName',
      chatSessions: 'id, repositoryId, updatedAt',
      chatMessages: 'id, sessionId, repositoryId, createdAt',
      savedReferences: 'id, url, createdAt',
      embeddings: 'chunkId, repositoryId, model',
    });
    this.version(2)
      .stores({
        repositories:
          'id, fullName, owner, indexingStatus, updatedAt, source, ref, [owner+name+ref+scopePath]',
        files: 'id, repositoryId, [repositoryId+path], path, language, sha, indexed',
        symbols: 'id, repositoryId, fileId, [repositoryId+name], name, kind',
        chunks: 'id, repositoryId, fileId, [repositoryId+filePath], language, symbolName',
        chatSessions: 'id, repositoryId, updatedAt',
        chatMessages: 'id, sessionId, repositoryId, createdAt',
        savedReferences: 'id, url, createdAt',
        embeddings: 'chunkId, repositoryId, model',
        indexJobs: 'id, repositoryId, status, updatedAt',
        changeSets: 'id, repositoryId, createdAt',
        reviewReports: 'id, repositoryId, changeSetId, createdAt',
        investigationItems: 'id, sessionId, repositoryId, updatedAt, type',
        workspaces: 'id, name, updatedAt',
        embeddingModels: 'id, status, updatedAt',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table('repositories')
          .toCollection()
          .modify((repo: Repository) => {
            repo.source ??= 'github';
            repo.ref ??= repo.defaultBranch;
            repo.indexScope ??= 'repository';
          });
      });
    this.version(3).stores({
      sourceSnapshots: 'id, repositoryId, [repositoryId+path], sha',
    });
    this.version(4)
      .stores({
        investigationItems: 'id, sessionId, repositoryId, updatedAt, type',
        workspaces: 'id, name, updatedAt',
        indexJobs: 'id, repositoryId, status, updatedAt',
      })
      .upgrade(async (transaction) => {
        // Keep records and existing source identities intact. Interrupted jobs are
        // never marked complete after an extension upgrade or worker restart.
        await transaction
          .table('indexJobs')
          .toCollection()
          .modify((job: IndexJob) => {
            job.completedFiles ??= [];
            job.pendingFiles ??= [];
            if (job.status === 'running') {
              job.status = 'paused';
              job.phase = 'cancelled';
              job.error = 'Indexing was interrupted by an extension upgrade. Resume to continue.';
            }
          });
        await transaction
          .table('repositories')
          .toCollection()
          .modify((repo: Repository) => {
            if (repo.indexingStatus === 'indexing') {
              repo.indexingStatus = 'cancelled';
              repo.indexingError = 'Indexing paused during extension upgrade. Resume to continue.';
            }
          });
      });
  }
}

export const db = new CodeContextDB();

const repositoryTables = (database: CodeContextDB) => [
  database.files,
  database.symbols,
  database.chunks,
  database.chatSessions,
  database.chatMessages,
  database.embeddings,
  database.indexJobs,
  database.changeSets,
  database.reviewReports,
  database.investigationItems,
  database.sourceSnapshots,
];

export async function deleteRepositoryData(repositoryId: string, database = db): Promise<void> {
  await database.transaction(
    'rw',
    [database.repositories, ...repositoryTables(database)],
    async () => {
      await Promise.all([
        database.files.where('repositoryId').equals(repositoryId).delete(),
        database.symbols.where('repositoryId').equals(repositoryId).delete(),
        database.chunks.where('repositoryId').equals(repositoryId).delete(),
        database.embeddings.where('repositoryId').equals(repositoryId).delete(),
        database.chatMessages.where('repositoryId').equals(repositoryId).delete(),
        database.chatSessions.where('repositoryId').equals(repositoryId).delete(),
        database.indexJobs.where('repositoryId').equals(repositoryId).delete(),
        database.changeSets.where('repositoryId').equals(repositoryId).delete(),
        database.reviewReports.where('repositoryId').equals(repositoryId).delete(),
        database.investigationItems.where('repositoryId').equals(repositoryId).delete(),
        database.sourceSnapshots.where('repositoryId').equals(repositoryId).delete(),
      ]);
      await database.repositories.delete(repositoryId);
    },
  );
}

export async function clearAllDatabaseData(database = db): Promise<void> {
  await database.transaction(
    'rw',
    [
      database.repositories,
      ...repositoryTables(database),
      database.savedReferences,
      database.workspaces,
      database.embeddingModels,
    ],
    async () => {
      await Promise.all([
        database.repositories.clear(),
        database.files.clear(),
        database.symbols.clear(),
        database.chunks.clear(),
        database.chatSessions.clear(),
        database.chatMessages.clear(),
        database.savedReferences.clear(),
        database.embeddings.clear(),
        database.indexJobs.clear(),
        database.changeSets.clear(),
        database.reviewReports.clear(),
        database.investigationItems.clear(),
        database.sourceSnapshots.clear(),
        database.workspaces.clear(),
        database.embeddingModels.clear(),
      ]);
    },
  );
}

export async function getStorageStats(database = db): Promise<{
  repositories: number;
  files: number;
  symbols: number;
  chunks: number;
  messages: number;
  references: number;
  bytes?: number;
}> {
  const [repositories, files, symbols, chunks, messages, references] = await Promise.all([
    database.repositories.count(),
    database.files.count(),
    database.symbols.count(),
    database.chunks.count(),
    database.chatMessages.count(),
    database.savedReferences.count(),
  ]);
  const estimate = await globalThis.navigator?.storage?.estimate?.().catch(() => undefined);
  return { repositories, files, symbols, chunks, messages, references, bytes: estimate?.usage };
}

export async function exportUserData(database = db): Promise<string> {
  const [
    repositories,
    chatSessions,
    chatMessages,
    savedReferences,
    investigationItems,
    workspaces,
    reviewReports,
  ] = await Promise.all([
    database.repositories.toArray(),
    database.chatSessions.toArray(),
    database.chatMessages.toArray(),
    database.savedReferences.toArray(),
    database.investigationItems.toArray(),
    database.workspaces.toArray(),
    database.reviewReports.toArray(),
  ]);
  // Secrets and full local source blobs are deliberately excluded.
  const payload = {
    exportedAt: new Date().toISOString(),
    version: '2.0.0',
    repositories: repositories.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      url: r.url,
      source: r.source ?? 'github',
      ref: r.ref ?? r.defaultBranch,
      scopePath: r.scopePath,
      commitSha: r.commitSha,
      languages: r.languages,
      indexedFileCount: r.indexedFileCount,
      indexedAt: r.indexedAt,
    })),
    chatSessions,
    chatMessages,
    savedReferences,
    investigationItems,
    workspaces,
    reviewReports,
  };
  return JSON.stringify(payload, null, 2);
}
