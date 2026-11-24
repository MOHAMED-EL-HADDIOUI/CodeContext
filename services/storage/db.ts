import Dexie, { type EntityTable } from 'dexie';
import type {
  Repository,
  RepositoryFile,
  CodeSymbol,
  CodeChunk,
  ChatMessage,
  ChatSession,
  SavedReference,
} from '../../types';

export interface ChunkEmbedding {
  chunkId: string;
  repositoryId: string;
  vector: number[];
  model: string;
  createdAt: number;
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
  }
}

export const db = new CodeContextDB();

export async function deleteRepositoryData(repositoryId: string, database = db): Promise<void> {
  await database.transaction(
    'rw',
    [
      database.repositories,
      database.files,
      database.symbols,
      database.chunks,
      database.chatSessions,
      database.chatMessages,
      database.embeddings,
    ],
    async () => {
      await database.files.where('repositoryId').equals(repositoryId).delete();
      await database.symbols.where('repositoryId').equals(repositoryId).delete();
      await database.chunks.where('repositoryId').equals(repositoryId).delete();
      await database.embeddings.where('repositoryId').equals(repositoryId).delete();
      await database.chatMessages.where('repositoryId').equals(repositoryId).delete();
      await database.chatSessions.where('repositoryId').equals(repositoryId).delete();
      await database.repositories.delete(repositoryId);
    },
  );
}

export async function clearAllDatabaseData(database = db): Promise<void> {
  await database.transaction(
    'rw',
    [
      database.repositories,
      database.files,
      database.symbols,
      database.chunks,
      database.chatSessions,
      database.chatMessages,
      database.savedReferences,
      database.embeddings,
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
}> {
  const [repositories, files, symbols, chunks, messages, references] = await Promise.all([
    database.repositories.count(),
    database.files.count(),
    database.symbols.count(),
    database.chunks.count(),
    database.chatMessages.count(),
    database.savedReferences.count(),
  ]);
  return { repositories, files, symbols, chunks, messages, references };
}

export async function exportUserData(database = db): Promise<string> {
  const [repositories, chatSessions, chatMessages, savedReferences] = await Promise.all([
    database.repositories.toArray(),
    database.chatSessions.toArray(),
    database.chatMessages.toArray(),
    database.savedReferences.toArray(),
  ]);

  // Never include secrets or full source blobs in lightweight export
  const payload = {
    exportedAt: new Date().toISOString(),
    version: '1.0.0',
    repositories: repositories.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      url: r.url,
      defaultBranch: r.defaultBranch,
      commitSha: r.commitSha,
      languages: r.languages,
      indexedFileCount: r.indexedFileCount,
      indexedAt: r.indexedAt,
    })),
    chatSessions,
    chatMessages,
    savedReferences,
  };

  return JSON.stringify(payload, null, 2);
}
