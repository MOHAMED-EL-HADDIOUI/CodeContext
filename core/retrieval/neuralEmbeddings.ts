import type { NeuralEmbeddingProvider } from '../../types';
import { db, type CodeContextDB } from '../../services/storage/db';

export const LOCAL_NEURAL_MODELS = [
  { id: 'Xenova/all-MiniLM-L6-v2', name: 'MiniLM-L6 · Balanced', sizeMb: 23, dimensions: 384 },
  {
    id: 'Xenova/jina-embeddings-v2-small-en',
    name: 'Jina v2 Small · Technical English',
    sizeMb: 33,
    dimensions: 512,
  },
] as const;

type PipelineFunction = (
  text: string | string[],
  options?: Record<string, unknown>,
) => Promise<{ data: Float32Array }>;
let pipelineInstance: PipelineFunction | null = null;
let loadedModelId: string | null = null;
let loadingPromise: Promise<PipelineFunction> | null = null;

export async function getNeuralEmbeddingProvider(
  modelId = 'Xenova/all-MiniLM-L6-v2',
  onProgress?: (progress: number) => void,
  allowNetwork = true,
): Promise<NeuralEmbeddingProvider> {
  if (pipelineInstance && loadedModelId === modelId)
    return {
      id: modelId,
      ready: true,
      embed: async (text) =>
        Array.from((await pipelineInstance!(text, { pooling: 'mean', normalize: true })).data),
    };
  if (pipelineInstance)
    throw new Error('Finish using the current local model before switching to another model.');
  if (!loadingPromise) {
    loadingPromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.allowRemoteModels = allowNetwork;
      env.allowLocalModels = !allowNetwork;
      if (location.protocol === 'chrome-extension:') {
        const runtimeUrl =
          typeof chrome !== 'undefined' && chrome.runtime?.getURL
            ? chrome.runtime.getURL('onnx/')
            : new URL('/onnx/', location.origin).href;
        const wasm = env.backends.onnx.wasm;
        if (!wasm) throw new Error('The local ONNX WASM runtime is unavailable.');
        wasm.wasmPaths = runtimeUrl;
        wasm.numThreads = 1;
        wasm.proxy = false;
      }
      const fn = await pipeline('feature-extraction', modelId, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: (event: { status?: string; progress?: number }) => {
          if (event.status === 'progress' && typeof event.progress === 'number')
            onProgress?.(event.progress);
        },
      });
      pipelineInstance = fn as unknown as PipelineFunction;
      loadedModelId = modelId;
      return pipelineInstance;
    })();
  }
  try {
    const fn = await loadingPromise;
    return {
      id: modelId,
      ready: true,
      embed: async (text) =>
        Array.from((await fn(text, { pooling: 'mean', normalize: true })).data),
    };
  } catch (error) {
    loadingPromise = null;
    throw error;
  }
}

let configuredProvider: NeuralEmbeddingProvider | null = null;
export function getConfiguredEmbeddingProvider(): NeuralEmbeddingProvider | null {
  return configuredProvider;
}

export async function restoreNeuralEmbeddings(
  modelId: string,
  database: CodeContextDB = db,
): Promise<NeuralEmbeddingProvider | null> {
  const record = await database.embeddingModels.get(modelId);
  if (record?.status !== 'ready') return null;
  try {
    configuredProvider = await getNeuralEmbeddingProvider(modelId, undefined, false);
    return configuredProvider;
  } catch {
    configuredProvider = null;
    return null;
  }
}

export async function initializeNeuralEmbeddings(
  modelId: string,
  database: CodeContextDB = db,
  onProgress?: (progress: number) => void,
): Promise<void> {
  const model = LOCAL_NEURAL_MODELS.find((item) => item.id === modelId) ?? LOCAL_NEURAL_MODELS[0];
  await database.embeddingModels.put({
    id: model.id,
    name: model.name,
    sizeMb: model.sizeMb,
    status: 'downloading',
    progress: 0,
    updatedAt: Date.now(),
  });
  try {
    configuredProvider = await getNeuralEmbeddingProvider(model.id, async (progress) => {
      onProgress?.(progress);
      await database.embeddingModels.update(model.id, { progress, updatedAt: Date.now() });
    });
    await database.embeddingModels.put({
      id: model.id,
      name: model.name,
      sizeMb: model.sizeMb,
      status: 'ready',
      progress: 100,
      updatedAt: Date.now(),
    });
  } catch (error) {
    await database.embeddingModels.put({
      id: model.id,
      name: model.name,
      sizeMb: model.sizeMb,
      status: 'error',
      progress: 0,
      error: error instanceof Error ? error.message : 'Could not download model.',
      updatedAt: Date.now(),
    });
    throw error;
  }
}

export async function indexNeuralEmbeddingsForRepository(
  repositoryId: string,
  database = db,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const provider = configuredProvider;
  if (!provider?.ready)
    throw new Error('Enable and download a local neural embedding model first.');
  const chunks = await database.chunks.where('repositoryId').equals(repositoryId).toArray();
  let completed = 0;
  const batchSize = 8;
  for (let start = 0; start < chunks.length; start += batchSize) {
    const batch = chunks.slice(start, start + batchSize);
    const rows = [];
    for (const chunk of batch) {
      const previous = await database.embeddings.get(chunk.id);
      if (previous?.model === provider.id && previous.vector.length > 0) {
        rows.push(previous);
        continue;
      }
      const text = `${chunk.filePath}\n${chunk.symbolName ?? ''}\n${chunk.content.slice(0, 3000)}`;
      rows.push({
        chunkId: chunk.id,
        repositoryId,
        vector: await provider.embed(text),
        model: provider.id,
        createdAt: Date.now(),
      });
    }
    await database.embeddings.bulkPut(rows);
    completed += batch.length;
    onProgress?.(completed, chunks.length);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return completed;
}
