import MiniSearch from 'minisearch';
import type { CodeChunk, CodeSymbol, SearchResult } from '../../types';
import { db, type CodeContextDB } from '../../services/storage/db';

export type SearchCategory = 'all' | 'code' | 'symbols' | 'files' | 'imports';

export interface SearchQueryOptions {
  repositoryId: string;
  query: string;
  category?: SearchCategory;
  language?: string;
  directory?: string;
  limit?: number;
  queryVector?: number[];
  queryVectorModel?: string;
  database?: CodeContextDB;
}

interface MiniSearchDoc {
  id: string;
  fileId: string;
  filePath: string;
  symbolName: string;
  symbolType: string;
  language: string;
  content: string;
  startLine: number;
  endLine: number;
}

const searchIndexCache = new Map<
  string,
  { count: number; fingerprint: string; mini: MiniSearch<MiniSearchDoc>; chunkMap: Map<string, CodeChunk> }
>();

export function invalidateSearchCache(repositoryId?: string): void {
  if (repositoryId) {
    searchIndexCache.delete(repositoryId);
  } else {
    searchIndexCache.clear();
  }
}

function tokenizeCode(text: string): string[] {
  // Splits camelCase, PascalCase, snake_case, kebab-case, and paths while preserving full tokens
  const rawTokens = text.split(/[^A-Za-z0-9_]+/).filter((t) => t.length >= 2);
  const expanded: string[] = [];
  for (const tok of rawTokens) {
    const lower = tok.toLowerCase();
    expanded.push(lower);
    const subParts = tok
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .toLowerCase()
      .split(/\s+/)
      .filter((p) => p.length >= 2 && p !== lower);
    expanded.push(...subParts);
  }
  return expanded;
}

async function getOrBuildMiniSearch(
  repositoryId: string,
  database: CodeContextDB,
): Promise<{ mini: MiniSearch<MiniSearchDoc>; chunkMap: Map<string, CodeChunk> }> {
  const chunks = await database.chunks.where('repositoryId').equals(repositoryId).toArray();
  const cached = searchIndexCache.get(repositoryId);
  const fingerprint = chunks.map((chunk) => chunk.id).join('|');
  if (cached && cached.count === chunks.length && cached.fingerprint === fingerprint) {
    return { mini: cached.mini, chunkMap: cached.chunkMap };
  }

  const mini = new MiniSearch<MiniSearchDoc>({
    fields: ['symbolName', 'filePath', 'content'],
    storeFields: ['fileId', 'filePath', 'symbolName', 'symbolType', 'language', 'startLine', 'endLine'],
    tokenize: tokenizeCode,
    searchOptions: {
      boost: { symbolName: 4, filePath: 2.5, content: 1 },
      prefix: true,
      fuzzy: 0.15,
    },
  });

  const chunkMap = new Map<string, CodeChunk>();
  const docs: MiniSearchDoc[] = [];

  for (const chunk of chunks) {
    chunkMap.set(chunk.id, chunk);
    docs.push({
      id: chunk.id,
      fileId: chunk.fileId,
      filePath: chunk.filePath,
      symbolName: chunk.symbolName ?? '',
      symbolType: chunk.symbolType ?? '',
      language: chunk.language,
      content: chunk.content,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
    });
  }

  mini.addAll(docs);
  searchIndexCache.set(repositoryId, { count: chunks.length, fingerprint, mini, chunkMap });
  return { mini, chunkMap };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function buildExcerpt(content: string, query: string, maxChars = 320): string {
  const lines = content.split(/\r?\n/);
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  let matchIdx = 0;
  if (terms.length > 0) {
    const found = lines.findIndex((line) => {
      const lower = line.toLowerCase();
      return terms.some((t) => lower.includes(t));
    });
    if (found >= 0) matchIdx = found;
  }

  const start = Math.max(0, matchIdx - 1);
  const excerpt = lines.slice(start, start + 6).join('\n').trim();
  return excerpt.length > maxChars ? `${excerpt.slice(0, maxChars)}…` : excerpt;
}

function matchesFilters(
  filePath: string,
  language: string,
  filterLang?: string,
  filterDir?: string,
): boolean {
  if (filterLang && filterLang !== 'all' && language.toLowerCase() !== filterLang.toLowerCase()) {
    return false;
  }
  if (filterDir && filterDir !== 'all') {
    const norm = filterDir.replace(/\/+$/, '');
    if (norm === '(root)') {
      if (filePath.includes('/')) return false;
    } else if (!filePath.startsWith(`${norm}/`) && filePath !== norm) {
      return false;
    }
  }
  return true;
}

/**
 * Hybrid retrieval engine:
 * Lexical (MiniSearch) + Symbol Search + Filename Search + Optional Local Vector Reranking.
 */
export async function searchRepository(options: SearchQueryOptions): Promise<SearchResult[]> {
  const query = options.query.trim();
  if (!query) return [];

  const database = options.database ?? db;
  const limit = options.limit ?? 20;
  const category = options.category ?? 'all';
  const lowerQuery = query.toLowerCase();

  const { mini, chunkMap } = await getOrBuildMiniSearch(options.repositoryId, database);
  const candidateScores = new Map<
    string,
    {
      result: SearchResult;
      score: number;
      sources: Set<SearchResult['matchSource']>;
    }
  >();

  const upsertCandidate = (
    key: string,
    result: SearchResult,
    scoreBoost: number,
    source: SearchResult['matchSource'],
  ) => {
    const existing = candidateScores.get(key);
    if (existing) {
      existing.score += scoreBoost;
      existing.sources.add(source);
      existing.result.score = existing.score;
      if (existing.sources.size > 1) {
        existing.result.matchSource = 'hybrid';
      }
    } else {
      candidateScores.set(key, {
        result: { ...result, score: scoreBoost, matchSource: source },
        score: scoreBoost,
        sources: new Set([source]),
      });
    }
  };

  // 1. Symbol / Import search
  if (category === 'all' || category === 'symbols' || category === 'imports') {
    const symbols: CodeSymbol[] = await database.symbols
      .where('repositoryId')
      .equals(options.repositoryId)
      .toArray();

    const files = await database.files
      .where('repositoryId')
      .equals(options.repositoryId)
      .toArray();
    const fileMap = new Map(files.map((f) => [f.id, f]));

    for (const sym of symbols) {
      if (category === 'imports' && sym.kind !== 'import') continue;
      if (category === 'symbols' && sym.kind === 'import') continue;

      const symLower = sym.name.toLowerCase();
      const sigLower = (sym.signature ?? '').toLowerCase();
      const exactMatch = symLower === lowerQuery;
      const prefixMatch = symLower.startsWith(lowerQuery);
      const containsMatch = symLower.includes(lowerQuery) || sigLower.includes(lowerQuery);

      if (!exactMatch && !prefixMatch && !containsMatch) continue;

      const file = fileMap.get(sym.fileId);
      const language = file?.language ?? 'plaintext';
      if (!matchesFilters(sym.filePath, language, options.language, options.directory)) continue;

      const score = exactMatch ? 120 : prefixMatch ? 85 : 55;
      const lines = file?.content?.split(/\r?\n/) ?? [];
      const excerpt =
        lines.slice(Math.max(0, sym.startLine - 1), Math.min(lines.length, sym.startLine + 5)).join('\n') ||
        sym.signature ||
        sym.name;

      // Map back to containing chunk if available so hybrid fusion aligns
      let matchingChunkId = `sym:${sym.id}`;
      for (const [cid, chunk] of chunkMap.entries()) {
        if (
          chunk.fileId === sym.fileId &&
          chunk.startLine <= sym.startLine &&
          chunk.endLine >= sym.startLine
        ) {
          matchingChunkId = cid;
          break;
        }
      }

      upsertCandidate(
        matchingChunkId,
        {
          chunkId: matchingChunkId,
          fileId: sym.fileId,
          repositoryId: options.repositoryId,
          filePath: sym.filePath,
          language,
          symbolName: sym.parentSymbol ? `${sym.parentSymbol}.${sym.name}` : sym.name,
          symbolType: sym.kind,
          startLine: sym.startLine,
          endLine: sym.endLine,
          excerpt: excerpt.slice(0, 320),
          score,
          matchSource: 'symbol',
        },
        score,
        'symbol',
      );
    }
  }

  // 2. Filename search
  if (category === 'all' || category === 'files') {
    const files = await database.files
      .where('repositoryId')
      .equals(options.repositoryId)
      .toArray();

    for (const file of files) {
      if (!file.indexed) continue;
      if (!matchesFilters(file.path, file.language, options.language, options.directory)) continue;

      const pathLower = file.path.toLowerCase();
      const nameLower = file.name.toLowerCase();
      if (!pathLower.includes(lowerQuery)) continue;

      const score = nameLower === lowerQuery ? 110 : nameLower.includes(lowerQuery) ? 75 : 50;
      const firstChunk = Array.from(chunkMap.values()).find((c) => c.fileId === file.id);
      const chunkId = firstChunk?.id ?? `file:${file.id}`;

      upsertCandidate(
        chunkId,
        {
          chunkId,
          fileId: file.id,
          repositoryId: options.repositoryId,
          filePath: file.path,
          language: file.language,
          symbolName: firstChunk?.symbolName,
          symbolType: firstChunk?.symbolType,
          startLine: firstChunk?.startLine ?? 1,
          endLine: firstChunk?.endLine ?? Math.min(file.lineCount || 1, 20),
          excerpt: buildExcerpt(firstChunk?.content ?? file.content ?? file.path, query),
          score,
          matchSource: 'filename',
        },
        score,
        'filename',
      );
    }
  }

  // 3. Lexical full-text search via MiniSearch + exact substring boost
  if (category === 'all' || category === 'code') {
    const lexicalHits = mini.search(query);
    for (const hit of lexicalHits.slice(0, limit * 3)) {
      const chunk = chunkMap.get(hit.id);
      if (!chunk) continue;
      if (!matchesFilters(chunk.filePath, chunk.language, options.language, options.directory)) {
        continue;
      }

      const exactSubstringBonus = chunk.content.toLowerCase().includes(lowerQuery) ? 25 : 0;
      const normalizedScore = Math.min(100, hit.score * 6) + exactSubstringBonus;

      upsertCandidate(
        chunk.id,
        {
          chunkId: chunk.id,
          fileId: chunk.fileId,
          repositoryId: chunk.repositoryId,
          filePath: chunk.filePath,
          language: chunk.language,
          symbolName: chunk.symbolName,
          symbolType: chunk.symbolType,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          excerpt: buildExcerpt(chunk.content, query),
          score: normalizedScore,
          matchSource: 'lexical',
        },
        normalizedScore,
        'lexical',
      );
    }

    // Fallback exact substring scan for punctuation-heavy queries (e.g. "=>", "v1/auth", "err != nil")
    if (lexicalHits.length < 5 && query.length >= 3) {
      for (const chunk of chunkMap.values()) {
        if (!matchesFilters(chunk.filePath, chunk.language, options.language, options.directory)) {
          continue;
        }
        if (chunk.content.toLowerCase().includes(lowerQuery)) {
          upsertCandidate(
            chunk.id,
            {
              chunkId: chunk.id,
              fileId: chunk.fileId,
              repositoryId: chunk.repositoryId,
              filePath: chunk.filePath,
              language: chunk.language,
              symbolName: chunk.symbolName,
              symbolType: chunk.symbolType,
              startLine: chunk.startLine,
              endLine: chunk.endLine,
              excerpt: buildExcerpt(chunk.content, query),
              score: 65,
              matchSource: 'lexical',
            },
            65,
            'lexical',
          );
        }
      }
    }
  }

  // 4. Optional local vector retrieval & reranking when embeddings exist
  if (options.queryVector && options.queryVector.length > 0 && (category === 'all' || category === 'code')) {
    const embeddings = await database.embeddings
      .where('repositoryId')
      .equals(options.repositoryId)
      .toArray();

    for (const emb of embeddings) {
      const chunk = chunkMap.get(emb.chunkId);
      const vectorModel = options.queryVectorModel ?? 'local-char-ngram-hash-128d';
      if (emb.model !== vectorModel || emb.vector.length !== options.queryVector.length) continue;
      if (!chunk) continue;
      if (!matchesFilters(chunk.filePath, chunk.language, options.language, options.directory)) {
        continue;
      }
      const sim = cosineSimilarity(options.queryVector, emb.vector);
      if (sim < 0.25) continue;

      const vectorScore = sim * 80;
      upsertCandidate(
        chunk.id,
        {
          chunkId: chunk.id,
          fileId: chunk.fileId,
          repositoryId: chunk.repositoryId,
          filePath: chunk.filePath,
          language: chunk.language,
          symbolName: chunk.symbolName,
          symbolType: chunk.symbolType,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          excerpt: buildExcerpt(chunk.content, query),
          score: vectorScore,
          matchSource: 'semantic',
        },
        vectorScore,
        'semantic',
      );
    }
  }

  return Array.from(candidateScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({
      ...entry.result,
      score: Math.round(entry.score * 10) / 10,
    }));
}
