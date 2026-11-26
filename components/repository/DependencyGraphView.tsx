import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, FileCode2, GitBranch, Network, Search } from 'lucide-react';
import type { DependencyGraph, SymbolReference } from '../../types';
import { findSymbolReferences, getRepositoryDependencyGraph } from '../../core/analysis/symbolGraph';
import { useAppStore } from '../../stores/useAppStore';
import { Badge, Button, Input } from '../common/UIPrimitives';

export const DependencyGraphView: React.FC = () => {
  const { activeRepositoryId, repositories, openFileInViewer } = useAppStore();
  const [graph, setGraph] = useState<DependencyGraph>({ nodes: [], edges: [], external: [] });
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [references, setReferences] = useState<SymbolReference[]>([]);
  const [referenceQuery, setReferenceQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const repository = repositories.find((repo) => repo.id === activeRepositoryId);

  useEffect(() => {
    if (!activeRepositoryId) { setGraph({ nodes: [], edges: [], external: [] }); return; }
    void getRepositoryDependencyGraph(activeRepositoryId).then((result) => {
      setGraph(result);
      setSelectedId((current) => current && result.nodes.some((node) => node.id === current) ? current : result.nodes.find((node) => node.inbound + node.outbound > 0)?.id ?? result.nodes[0]?.id ?? null);
    });
  }, [activeRepositoryId, repository?.indexedAt]);

  const visibleNodes = useMemo(() => graph.nodes.filter((node) => !query || node.path.toLowerCase().includes(query.toLowerCase())).slice(0, 100), [graph.nodes, query]);
  const selected = graph.nodes.find((node) => node.id === selectedId);
  const selectedEdges = graph.edges.filter((edge) => edge.source === selectedId || edge.target === selectedId);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  const searchReferences = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeRepositoryId || !referenceQuery.trim()) return;
    setLoading(true);
    try { setReferences(await findSymbolReferences({ repositoryId: activeRepositoryId, symbolName: referenceQuery })); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div><h3 className="m-0 text-[12.5px] font-semibold flex items-center gap-1.5"><Network className="w-4 h-4 text-[var(--accent-text)]" /> Module graph</h3><p className="m-0 mt-1 text-[10.5px] text-[var(--text-muted)]">Resolved imports only; external packages are listed separately.</p></div>
          <Badge tone="neutral">{graph.edges.length} links</Badge>
        </div>
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter modules…" aria-label="Filter graph modules" />
        <div className="flex gap-2 overflow-x-auto pb-2 min-h-[95px] items-center" role="list" aria-label="Interactive module dependency graph">
          {visibleNodes.map((node) => {
            const connected = selectedId && (node.id === selectedId || graph.edges.some((edge) => (edge.source === selectedId && edge.target === node.id) || (edge.target === selectedId && edge.source === node.id)));
            return <button key={node.id} type="button" role="listitem" onClick={() => setSelectedId(node.id)} className={`shrink-0 w-[115px] min-h-[65px] p-2 rounded-lg border text-left cursor-pointer transition-colors ${node.id === selectedId ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]' : connected ? 'border-[var(--border-default)] bg-[var(--bg-elevated)]' : 'border-[var(--border-subtle)] bg-[var(--bg-base)] opacity-90 hover:opacity-100'}`}><FileCode2 className="w-3.5 h-3.5 text-[var(--accent-text)]" /><span className="mt-1 block break-words font-mono text-[9.5px] leading-tight">{node.path.split('/').slice(-2).join('/')}</span><span className="mt-1 block text-[9px] text-[var(--text-muted)]">↓{node.inbound} ↑{node.outbound} · {node.symbolCount} symbols</span></button>;
          })}
          {!visibleNodes.length && <p className="text-[11px] text-[var(--text-muted)]">No modules match this filter.</p>}
        </div>
        {selected && <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5"><div className="flex items-center gap-1.5"><GitBranch className="w-3.5 h-3.5 text-[var(--accent-text)]" /><button type="button" className="min-w-0 flex-1 truncate text-left font-mono text-[10.5px] text-[var(--accent-text)] cursor-pointer" onClick={() => repository && void openFileInViewer(repository.id, selected.path)}>{selected.path}</button></div>{selectedEdges.length ? <div className="mt-2 space-y-1">{selectedEdges.slice(0, 20).map((edge) => <button type="button" key={edge.id} onClick={() => setSelectedId(edge.source === selectedId ? edge.target : edge.source)} className="w-full flex items-center gap-1 text-left text-[10px] cursor-pointer text-[var(--text-secondary)] hover:text-[var(--accent-text)]"><span className="truncate">{nodeById.get(edge.source)?.path}</span><ArrowRight className="w-3 h-3 shrink-0" /><span className="truncate">{nodeById.get(edge.target)?.path}</span></button>)}</div> : <p className="mb-0 mt-2 text-[10.5px] text-[var(--text-muted)]">No resolved local imports for this module.</p>}</div>}
        {graph.external.length > 0 && <details className="text-[10.5px] text-[var(--text-muted)]"><summary className="cursor-pointer">External imports ({graph.external.length})</summary><div className="flex flex-wrap gap-1 mt-2">{graph.external.slice(0, 30).map((name) => <Badge key={name} tone="neutral">{name}</Badge>)}</div></details>}
      </div>
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 space-y-2">
        <h3 className="m-0 text-[12.5px] font-semibold flex items-center gap-1.5"><Search className="w-4 h-4 text-[var(--accent-text)]" /> Definitions & references</h3>
        <form onSubmit={(event) => void searchReferences(event)} className="flex gap-1.5"><Input value={referenceQuery} onChange={(event) => setReferenceQuery(event.target.value)} placeholder="Symbol name, e.g. runAssistantQuery" aria-label="Find symbol references" /><Button type="submit" size="sm" variant="primary" disabled={loading}>Find</Button></form>
        <p className="m-0 text-[10px] text-[var(--text-muted)]">Definitions come from extracted symbols; references are lexical matches, not a language-server type proof.</p>
        <div className="space-y-1.5">{references.map((reference) => <button type="button" key={`${reference.filePath}:${reference.startLine}:${reference.relation}`} className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2 text-left cursor-pointer hover:border-[var(--accent-border)]" onClick={() => repository && void openFileInViewer(repository.id, reference.filePath, reference.startLine, reference.endLine)}><div className="flex items-center gap-1.5"><Badge tone={reference.relation === 'definition' ? 'success' : 'neutral'}>{reference.relation}</Badge><span className="truncate font-mono text-[10.5px]">{reference.filePath}:{reference.startLine}</span></div><code className="block mt-1.5 truncate text-[10px] text-[var(--text-secondary)]">{reference.excerpt}</code></button>)}</div>
      </div>
    </div>
  );
};
