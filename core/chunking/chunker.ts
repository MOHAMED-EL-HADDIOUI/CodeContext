import type { CodeChunk, CodeSymbol } from '../../types';

export interface ChunkingInput {
  repositoryId: string;
  fileId: string;
  filePath: string;
  language: string;
  content: string;
  symbols: CodeSymbol[];
  maxChunkLines?: number;
  overlapLines?: number;
}

const DEFAULT_MAX_CHUNK_LINES = 90;
const DEFAULT_OVERLAP_LINES = 10;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function sliceLines(lines: string[], startLine: number, endLine: number): string {
  const safeStart = Math.max(1, startLine);
  const safeEnd = Math.min(lines.length, Math.max(safeStart, endLine));
  return lines.slice(safeStart - 1, safeEnd).join('\n');
}

function splitLargeRange(
  lines: string[],
  startLine: number,
  endLine: number,
  maxLines: number,
  overlap: number,
  base: {
    repositoryId: string;
    fileId: string;
    filePath: string;
    language: string;
    symbolName?: string;
    symbolType?: string;
  },
  chunkIndexStart: number,
): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  let cursor = startLine;
  let idx = chunkIndexStart;

  while (cursor <= endLine) {
    const windowEnd = Math.min(endLine, cursor + maxLines - 1);
    const content = sliceLines(lines, cursor, windowEnd);
    if (content.trim().length > 0) {
      chunks.push({
        id: `${base.fileId}:chunk:${idx}:${cursor}-${windowEnd}`,
        fileId: base.fileId,
        repositoryId: base.repositoryId,
        filePath: base.filePath,
        symbolName: base.symbolName,
        symbolType: base.symbolType,
        content,
        startLine: cursor,
        endLine: windowEnd,
        language: base.language,
        tokenEstimate: estimateTokens(content),
      });
      idx++;
    }
    if (windowEnd >= endLine) break;
    cursor = Math.max(cursor + 1, windowEnd - overlap + 1);
  }

  return chunks;
}

/**
 * AST / symbol-boundary aware chunker with line-based fallback.
 * Guarantees exact 1-based `startLine` and `endLine` matching the original file.
 */
export function chunkSourceFile(input: ChunkingInput): CodeChunk[] {
  const maxLines = input.maxChunkLines ?? DEFAULT_MAX_CHUNK_LINES;
  const overlap = input.overlapLines ?? DEFAULT_OVERLAP_LINES;

  if (!input.content.trim()) return [];
  const lines = input.content.split(/\r?\n/);

  // Filter structural symbols suitable for chunk boundaries (ignore single-line imports)
  const structuralSymbols = input.symbols
    .filter((s) => s.kind !== 'import' && s.kind !== 'export')
    .sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);

  // If file is small or has no structural symbols, use clean line-based chunking
  if (structuralSymbols.length === 0 || lines.length <= maxLines) {
    const primarySymbol = structuralSymbols[0];
    return splitLargeRange(
      lines,
      1,
      lines.length,
      maxLines,
      overlap,
      {
        repositoryId: input.repositoryId,
        fileId: input.fileId,
        filePath: input.filePath,
        language: input.language,
        symbolName: primarySymbol?.name,
        symbolType: primarySymbol?.kind,
      },
      0,
    );
  }

  // Deduplicate nested symbols when parent already fits inside maxLines;
  // keep methods separately when parent class exceeds maxLines.
  const selectedBoundaries: CodeSymbol[] = [];
  for (const sym of structuralSymbols) {
    const coveringParent = selectedBoundaries.find(
      (parent) =>
        parent.startLine <= sym.startLine &&
        parent.endLine >= sym.endLine &&
        parent.endLine - parent.startLine + 1 <= maxLines,
    );
    if (!coveringParent) {
      selectedBoundaries.push(sym);
    }
  }

  const chunks: CodeChunk[] = [];
  let chunkCounter = 0;

  // Capture file header (imports, top-level constants, license/comments) before first symbol
  const firstStart = selectedBoundaries[0]?.startLine ?? 1;
  if (firstStart > 1) {
    const headerChunks = splitLargeRange(
      lines,
      1,
      firstStart - 1,
      maxLines,
      overlap,
      {
        repositoryId: input.repositoryId,
        fileId: input.fileId,
        filePath: input.filePath,
        language: input.language,
        symbolName: 'module_header',
        symbolType: 'header',
      },
      chunkCounter,
    );
    chunks.push(...headerChunks);
    chunkCounter += headerChunks.length;
  }

  let coveredThrough = firstStart - 1;

  for (const sym of selectedBoundaries) {
    // Capture any uncovered gap between symbols
    if (sym.startLine > coveredThrough + 1) {
      const gapChunks = splitLargeRange(
        lines,
        coveredThrough + 1,
        sym.startLine - 1,
        maxLines,
        overlap,
        {
          repositoryId: input.repositoryId,
          fileId: input.fileId,
          filePath: input.filePath,
          language: input.language,
        },
        chunkCounter,
      );
      chunks.push(...gapChunks);
      chunkCounter += gapChunks.length;
    }

    const symChunks = splitLargeRange(
      lines,
      sym.startLine,
      sym.endLine,
      maxLines,
      overlap,
      {
        repositoryId: input.repositoryId,
        fileId: input.fileId,
        filePath: input.filePath,
        language: input.language,
        symbolName: sym.parentSymbol ? `${sym.parentSymbol}.${sym.name}` : sym.name,
        symbolType: sym.kind,
      },
      chunkCounter,
    );
    chunks.push(...symChunks);
    chunkCounter += symChunks.length;
    coveredThrough = Math.max(coveredThrough, sym.endLine);
  }

  // Capture trailing lines after the last symbol
  if (coveredThrough < lines.length) {
    const tailChunks = splitLargeRange(
      lines,
      coveredThrough + 1,
      lines.length,
      maxLines,
      overlap,
      {
        repositoryId: input.repositoryId,
        fileId: input.fileId,
        filePath: input.filePath,
        language: input.language,
      },
      chunkCounter,
    );
    chunks.push(...tailChunks);
  }

  return chunks;
}
