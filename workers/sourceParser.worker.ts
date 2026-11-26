import type { CodeChunk, CodeSymbol } from '../types';
import { extractSymbols } from '../core/symbols/extractor';
import { extractTreeSitterSymbols } from '../core/parsers/astSymbols';
import { chunkSourceFile } from '../core/chunking/chunker';

export interface ParseWorkerInput {
  id: number;
  repositoryId: string;
  fileId: string;
  filePath: string;
  language: string;
  content: string;
}
export interface ParseWorkerOutput {
  id: number;
  symbols: CodeSymbol[];
  chunks: CodeChunk[];
  parser: 'tree-sitter' | 'structural';
}

self.onmessage = async (event: MessageEvent<ParseWorkerInput>) => {
  const input = event.data;
  try {
    const treeSitterSymbols = await extractTreeSitterSymbols(input);
    const symbols = treeSitterSymbols?.length ? treeSitterSymbols : extractSymbols(input);
    const chunks = chunkSourceFile({ ...input, symbols });
    const result: ParseWorkerOutput = { id: input.id, symbols, chunks, parser: treeSitterSymbols?.length ? 'tree-sitter' : 'structural' };
    self.postMessage(result);
  } catch (error) {
    self.postMessage({ id: input.id, error: error instanceof Error ? error.message : 'Parsing failed.' });
  }
};
