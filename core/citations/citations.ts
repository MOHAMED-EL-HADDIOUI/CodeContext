import type { CodeChunk, Repository, SourceCitation } from '../../types';
import { buildGitHubBlobUrl } from '../../services/github/urlParser';

export interface IndexedSourceContext {
  refId: string; // e.g., "S1"
  chunk: CodeChunk;
  citation: SourceCitation;
}

/**
 * Creates verified source citation objects strictly from real indexed chunks
 * and the repository's pinned commit SHA. Never fabricates paths or lines.
 */
export function buildSourceContexts(
  repository: Repository,
  chunks: CodeChunk[],
): IndexedSourceContext[] {
  return chunks.map((chunk, idx) => {
    const excerptLines = chunk.content.split(/\r?\n/).slice(0, 8).join('\n');
    const citation: SourceCitation = {
      repositoryId: repository.id,
      filePath: chunk.filePath,
      commitSha: repository.commitSha,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      excerpt: excerptLines.length > 420 ? `${excerptLines.slice(0, 420)}…` : excerptLines,
      symbolName: chunk.symbolName,
      githubUrl: (repository.source ?? 'github') === 'github' ? buildGitHubBlobUrl(
        repository.owner,
        repository.name,
        repository.commitSha,
        chunk.filePath,
        chunk.startLine,
        chunk.endLine,
      ) : undefined,
    };
    return {
      refId: `S${idx + 1}`,
      chunk,
      citation,
    };
  });
}

/**
 * Extracts only verified citations referenced by the model answer (e.g. [S1], [S2], or matching file paths).
 * Guarantees no unverified/hallucinated file paths or line ranges are returned.
 */
export function resolveVerifiedCitations(
  answerText: string,
  contexts: IndexedSourceContext[],
): SourceCitation[] {
  if (contexts.length === 0) return [];

  const matched = new Map<string, SourceCitation>();

  // 1. Check explicit [S1], [S2] references
  const tagRegex = /\[S(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(answerText)) !== null) {
    const num = Number.parseInt(match[1] ?? '', 10);
    const ctx = contexts[num - 1];
    if (ctx) {
      const key = `${ctx.citation.filePath}:${ctx.citation.startLine}-${ctx.citation.endLine}`;
      matched.set(key, ctx.citation);
    }
  }

  // 2. Also match exact retrieved file paths mentioned in the answer
  for (const ctx of contexts) {
    if (answerText.includes(ctx.citation.filePath)) {
      const key = `${ctx.citation.filePath}:${ctx.citation.startLine}-${ctx.citation.endLine}`;
      matched.set(key, ctx.citation);
    }
  }

  // 3. If the model answered using retrieved context without explicit [Sn] tags,
  // attach the top verified retrieved sources (unless it explicitly said no relevant code found).
  const saysNotFound =
    /could not find relevant|no relevant code|not found in the indexed|insufficient indexed/i.test(
      answerText,
    );

  if (matched.size === 0 && !saysNotFound) {
    for (const ctx of contexts.slice(0, 3)) {
      const key = `${ctx.citation.filePath}:${ctx.citation.startLine}-${ctx.citation.endLine}`;
      matched.set(key, ctx.citation);
    }
  }

  return Array.from(matched.values());
}
