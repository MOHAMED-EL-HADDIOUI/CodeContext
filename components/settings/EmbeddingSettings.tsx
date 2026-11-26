import React, { useState } from 'react';
import { BrainCircuit, CheckCircle2, Download, LoaderCircle, ShieldCheck } from 'lucide-react';
import { LOCAL_NEURAL_MODELS } from '../../core/retrieval/neuralEmbeddings';
import { requestOriginPermission } from '../../services/browser/permissions';
import { useAppStore } from '../../stores/useAppStore';
import { AlertBanner, Badge, Button, Select, SwitchControl } from '../common/UIPrimitives';

export const EmbeddingSettings: React.FC = () => {
  const { settings, activeRepositoryId, repositories, embeddingStatus, setupNeuralEmbeddings, buildLocalEmbeddings, updateAppSettings } = useAppStore();
  const [modelId, setModelId] = useState(settings.ai.embeddingModelId);
  const [working, setWorking] = useState(false);
  const model = LOCAL_NEURAL_MODELS.find((item) => item.id === modelId) ?? LOCAL_NEURAL_MODELS[0];
  const active = repositories.find((repository) => repository.id === activeRepositoryId);

  const download = async () => {
    setWorking(true);
    try {
      const allowed = await requestOriginPermission('https://huggingface.co');
      if (!allowed) throw new Error('Permission to download the model from huggingface.co was denied. No model was downloaded.');
      await setupNeuralEmbeddings(model.id);
    } catch { /* Store reports actionable model-loading errors. */ }
    finally { setWorking(false); }
  };
  const build = async () => {
    if (!activeRepositoryId) return;
    setWorking(true);
    try {
      const count = await buildLocalEmbeddings(activeRepositoryId);
      useAppStore.setState({ embeddingStatus: `Built ${count.toLocaleString()} vectors locally for ${active?.fullName ?? 'this source'}.` });
    } catch (error) { useAppStore.setState({ embeddingStatus: error instanceof Error ? error.message : 'Vector indexing failed.' }); }
    finally { setWorking(false); }
  };

  return <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
    <SwitchControl checked={settings.ai.enableLocalEmbeddings} onChange={(checked) => void updateAppSettings((current) => ({ ...current, ai: { ...current.ai, enableLocalEmbeddings: checked } }))} label="Local vector reranking" description={settings.ai.neuralEmbeddingsEnabled ? 'Uses the downloaded neural model when it is ready; otherwise no vector is mixed across models.' : 'Lightweight hashed vectors; no downloads and no network requests.'} />
    <div className="border-t border-[var(--border-subtle)] pt-3 space-y-2.5">
      <div className="flex items-center gap-1.5"><BrainCircuit className="w-4 h-4 text-[var(--accent-text)]" /><h3 className="m-0 text-[12px] font-semibold">Optional neural embeddings</h3>{settings.ai.neuralEmbeddingsEnabled && <Badge tone="success">Enabled</Badge>}</div>
      <p className="m-0 text-[11px] leading-relaxed text-[var(--text-muted)]">Download a compact model for stronger local semantic retrieval. Only the model is downloaded on setup; repository code and questions are never sent to Hugging Face.</p>
      <label className="block text-[11px] font-medium text-[var(--text-secondary)]" htmlFor="cc-embedding-model">Local model</label>
      <Select id="cc-embedding-model" value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={working}>{LOCAL_NEURAL_MODELS.map((item) => <option key={item.id} value={item.id}>{item.name} · ~{item.sizeMb} MB · {item.dimensions}D</option>)}</Select>
      <p className="m-0 text-[10.5px] leading-relaxed text-[var(--text-muted)]"><ShieldCheck className="w-3 h-3 inline mr-1" />Requires access to huggingface.co. WebGPU is used when available; cached files support later offline use. Approximate download size: {model.sizeMb} MB.</p>
      <div className="flex flex-wrap gap-1.5"><Button size="xs" variant="primary" onClick={() => void download()} disabled={working || !settings.ai.enableLocalEmbeddings}>{working ? <LoaderCircle className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} {settings.ai.neuralEmbeddingsEnabled && settings.ai.embeddingModelId === model.id ? 'Reload local model' : 'Download & enable'}</Button><Button size="xs" onClick={() => void build()} disabled={working || !activeRepositoryId || !settings.ai.enableLocalEmbeddings}><CheckCircle2 className="w-3 h-3" /> Build vectors for active source</Button>{settings.ai.neuralEmbeddingsEnabled && <Button size="xs" variant="ghost" onClick={() => void updateAppSettings((current) => ({ ...current, ai: { ...current.ai, neuralEmbeddingsEnabled: false } }))}>Use lightweight vectors</Button>}</div>
      {embeddingStatus && <AlertBanner tone={embeddingStatus.toLowerCase().includes('failed') || embeddingStatus.toLowerCase().includes('denied') ? 'danger' : 'info'}>{embeddingStatus}</AlertBanner>}
    </div>
  </div>;
};
