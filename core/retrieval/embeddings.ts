import type { CodeChunk } from '../../types';
import { db, type ChunkEmbedding, type CodeContextDB } from '../../services/storage/db';

const EMBEDDING_DIM = 128;
const MODEL_NAME = 'local-char-ngram-hash-128d';

/**
 * Lightweight, 100% local, zero-network semantic vector generator using
 * normalized character 3-gram + identifier token random projection.
 * Keeps extension install size tiny while enabling optional local semantic reranking.
 */
export function computeLocalVector(text: string): number[] {
  const vec = new Float64Array(EMBEDDING_DIM);
  const normalized = text
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-z0-9_]+/g, ' ')
    .trim();

  if (!normalized) return Array.from(vec);

  const tokens = normalized.split(/\s+/).filter((t) => t.length >= 2);

  const hashFeature = (feature: string, weight: number) => {
    let h1 = 2166136261;
    let h2 = 0x9e3779b9;
    for (let i = 0; i < feature.length; i++) {
      const c = feature.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 16777619);
      h2 ^= c + ((h2 << 6) >>> 0) + (h2 >>> 2);
    }
    const idx = Math.abs(h1) % EMBEDDING_DIM;
    const sign = (h2 & 1) === 0 ? 1 : -1;
    vec[idx] = (vec[idx] ?? 0) + sign * weight;
  };

  for (const token of tokens) {
    hashFeature(`tok:${token}`, 2.0);
    if (token.length >= 3) {
      for (let i = 0; i <= token.length - 3; i++) {
        hashFeature(`tri:${token.slice(i, i + 3)}`, 0.7);
      }
    }
  }

  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    const v = vec[i] ?? 0;
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      vec[i] = (vec[i] ?? 0) / norm;
    }
  }

  return Array.from(vec);
}

export async function indexLocalEmbeddingsForRepository(
  repositoryId: string,
  database: CodeContextDB = db,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const chunks: CodeChunk[] = await database.chunks
    .where('repositoryId')
    .equals(repositoryId)
    .toArray();

  const batch: ChunkEmbedding[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const text = `${chunk.filePath} ${chunk.symbolName ?? ''} ${chunk.content.slice(0, 1200)}`;
    batch.push({
      chunkId: chunk.id,
      repositoryId,
      vector: computeLocalVector(text),
      model: MODEL_NAME,
      createdAt: Date.now(),
    });
    if (onProgress && (i % 25 === 0 || i === chunks.length - 1)) {
      onProgress(i + 1, chunks.length);
    }
  }

  await database.transaction('rw', [database.embeddings], async () => {
    await database.embeddings.where('repositoryId').equals(repositoryId).delete();
    if (batch.length > 0) {
      await database.embeddings.bulkPut(batch);
    }
  });

  return batch.length;
}
