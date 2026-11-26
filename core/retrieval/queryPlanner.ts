import type { CodeChunk, SearchResult } from '../../types';

const STOP_WORDS = new Set([
  'what', 'where', 'when', 'which', 'does', 'how', 'why', 'the', 'this', 'that', 'with', 'from', 'into',
  'repository', 'codebase', 'code', 'file', 'function', 'class', 'explain', 'show', 'tell', 'about',
  'main', 'please', 'could', 'would', 'there', 'their', 'have', 'has', 'using', 'used', 'uses', 'works',
]);

export function extractSearchTerms(question: string): string[] {
  const candidates = question.match(/[A-Za-z_$][\w$.-]*(?:\/[\w$.-]+)*/g) ?? [];
  const expanded = candidates.flatMap((candidate) => {
    const words = candidate.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s._/-]+/);
    return [candidate, ...words];
  });
  return [...new Set(expanded.filter((term) => term.length >= 3 && !STOP_WORDS.has(term.toLowerCase())))].slice(0, 12);
}

export function buildRetrievalQueries(question: string, mode: string): string[] {
  const terms = extractSearchTerms(question);
  const shortQuery = terms.slice(0, 5).join(' ');
  const queries = [shortQuery || question.slice(0, 240)];
  if (terms.length > 5) queries.push(terms.slice(5, 10).join(' '));
  if (mode === 'explain_architecture') queries.push('architecture entrypoint module service core');
  if (mode === 'trace_flow') queries.push('main initialize handler request execute');
  if (mode === 'explain_dependencies') queries.push('dependencies imports package requirements');
  return [...new Set(queries.filter(Boolean))].slice(0, 3);
}

export interface ScoredChunk {
  chunk: CodeChunk;
  score: number;
  sources: Set<string>;
}

/** Reciprocal rank fusion is stable across repositories and independent of raw score scales. */
export function fuseRankedResults(resultSets: SearchResult[][], chunkMap: Map<string, CodeChunk>, limit = 12): ScoredChunk[] {
  const fused = new Map<string, ScoredChunk>();
  for (const results of resultSets) {
    results.forEach((result, index) => {
      const chunk = chunkMap.get(result.chunkId);
      if (!chunk) return;
      const existing = fused.get(chunk.id) ?? { chunk, score: 0, sources: new Set<string>() };
      existing.score += 1 / (60 + index + 1);
      existing.sources.add(result.matchSource);
      fused.set(chunk.id, existing);
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

export function allocateContextBudget(chunks: CodeChunk[], budgetTokens: number, maxSources = 12): CodeChunk[] {
  const selected: CodeChunk[] = [];
  let tokens = 0;
  const reserved = Math.min(budgetTokens, 600);
  for (const chunk of chunks) {
    if (selected.length >= maxSources) break;
    const cost = chunk.tokenEstimate + 35;
    if (tokens + cost > budgetTokens - reserved) continue;
    selected.push(chunk);
    tokens += cost;
  }
  return selected;
}
