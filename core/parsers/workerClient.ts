import type { CodeChunk, CodeSymbol } from '../../types';
import { extractSymbols } from '../../core/symbols/extractor';
import { extractTreeSitterSymbols } from '../../core/parsers/astSymbols';
import { chunkSourceFile } from '../../core/chunking/chunker';
import type { ParseWorkerInput, ParseWorkerOutput } from '../../workers/sourceParser.worker';

export interface AnalyzeSourceInput extends Omit<ParseWorkerInput, 'id'> {
  useWorker?: boolean;
}
export interface AnalyzeSourceResult { symbols: CodeSymbol[]; chunks: CodeChunk[]; parser: 'tree-sitter' | 'structural'; error?: string }

let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<number, { resolve: (result: AnalyzeSourceResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function stopWorker(): void {
  worker?.terminate();
  worker = null;
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Parser worker stopped.')); }
  pending.clear();
}

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('../../workers/sourceParser.worker.ts', import.meta.url), { type: 'module', name: 'codecontext-parser' });
    worker.onmessage = (event: MessageEvent<ParseWorkerOutput | { id: number; error: string }>) => {
      const result = event.data;
      const task = pending.get(result.id);
      if (!task) return;
      clearTimeout(task.timer); pending.delete(result.id);
      if ('error' in result) task.reject(new Error(result.error)); else task.resolve(result);
    };
    worker.onerror = () => stopWorker();
    return worker;
  } catch { return null; }
}

async function analyzeInCurrentContext(input: AnalyzeSourceInput): Promise<AnalyzeSourceResult> {
  const treeSitterSymbols = await extractTreeSitterSymbols(input);
  const symbols = treeSitterSymbols?.length ? treeSitterSymbols : extractSymbols(input);
  return { symbols, chunks: chunkSourceFile({ ...input, symbols }), parser: treeSitterSymbols?.length ? 'tree-sitter' : 'structural' };
}

export async function analyzeSourceFile(input: AnalyzeSourceInput): Promise<AnalyzeSourceResult> {
  const instance = input.useWorker === false ? null : getWorker();
  if (!instance) return analyzeInCurrentContext(input);
  try {
    return await new Promise<AnalyzeSourceResult>((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); stopWorker(); reject(new Error(`Parser timed out for ${input.filePath}.`)); }, 20000);
      pending.set(id, { resolve, reject, timer });
      try { instance.postMessage({ ...input, id }); }
      catch { clearTimeout(timer); pending.delete(id); reject(new Error('Parser worker could not receive this file.')); }
    });
  } catch {
    // A broken worker must not turn a readable source file into a skipped file.
    return analyzeInCurrentContext(input);
  }
}
