import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bookmark, Check, Code2, Copy, ExternalLink, MessageSquarePlus, Search, X } from 'lucide-react';
import type { CodeSymbol, Repository, RepositoryFile, SymbolReference } from '../../types';
import { highlightCodeToLines } from '../../services/code/highlighter';
import { buildGitHubBlobUrl } from '../../services/github/urlParser';
import { findSymbolReferences } from '../../core/analysis/symbolGraph';
import { db } from '../../services/storage/db';
import { useAppStore } from '../../stores/useAppStore';
import { Badge, Button, EmptyState, IconButton, Input, Select, getLanguageColor } from '../common/UIPrimitives';
import { VirtualList } from '../common/VirtualList';

interface CodeViewerProps {
  repository: Repository;
  file: RepositoryFile;
  highlightStartLine?: number;
  highlightEndLine?: number;
  onBack: () => void;
}

export const CodeViewer: React.FC<CodeViewerProps> = ({ repository, file, highlightStartLine, highlightEndLine, onBack }) => {
  const { resolvedTheme, setAttachedSelection, setActiveTab, setChatMode, openFileInViewer, pinInvestigationItem } = useAppStore();
  const [highlightedLines, setHighlightedLines] = useState<string[] | null>(null);
  const [symbols, setSymbols] = useState<CodeSymbol[]>([]);
  const [findQuery, setFindQuery] = useState('');
  const [showFind, setShowFind] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeRange, setActiveRange] = useState<{ start?: number; end?: number }>({ start: highlightStartLine, end: highlightEndLine ?? highlightStartLine });
  const [selectedSnippet, setSelectedSnippet] = useState('');
  const [references, setReferences] = useState<SymbolReference[]>([]);
  const [inspectedSymbol, setInspectedSymbol] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(550);
  const codeContainerRef = useRef<HTMLDivElement>(null);
  const rawLines = useMemo(() => (file.content ?? '').split(/\r?\n/), [file.content]);
  const githubUrl = (repository.source ?? 'github') === 'github' ? buildGitHubBlobUrl(repository.owner, repository.name, repository.commitSha, file.path, activeRange.start, activeRange.end) : undefined;

  useEffect(() => {
    setActiveRange({ start: highlightStartLine, end: highlightEndLine ?? highlightStartLine });
    setReferences([]); setInspectedSymbol(null);
  }, [file.id, highlightStartLine, highlightEndLine]);

  useEffect(() => {
    let cancelled = false;
    setHighlightedLines(null);
    if (file.content) void highlightCodeToLines(file.content, file.language, resolvedTheme).then((lines) => { if (!cancelled) setHighlightedLines(lines); });
    void db.symbols.where('fileId').equals(file.id).toArray().then((items) => {
      if (!cancelled) setSymbols(items.filter((item) => item.kind !== 'import').sort((a, b) => a.startLine - b.startLine));
    });
    return () => { cancelled = true; };
  }, [file.id, file.content, file.language, resolvedTheme]);

  useEffect(() => {
    const container = codeContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => setViewportHeight(Math.max(100, container.clientHeight)));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const matchingLineNumbers = useMemo(() => {
    const query = findQuery.trim().toLowerCase();
    if (!query) return new Set<number>();
    return new Set(rawLines.flatMap((line, index) => line.toLowerCase().includes(query) ? [index + 1] : []));
  }, [findQuery, rawLines]);

  const handleMouseUp = () => {
    const selection = window.getSelection()?.toString().trim() ?? '';
    setSelectedSnippet(selection);
  };

  const inspectAtLine = async (lineNumber: number, event: React.MouseEvent<HTMLTableRowElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button') || window.getSelection()?.toString()) return;
    setActiveRange({ start: lineNumber, end: lineNumber });
    const text = rawLines[lineNumber - 1] ?? '';
    const rect = (target as HTMLElement).getBoundingClientRect();
    const offset = Math.max(0, Math.min(text.length, Math.floor((event.clientX - rect.left) / 7)));
    const before = text.slice(0, offset).match(/[A-Za-z_$][\w$]*$/)?.[0] ?? '';
    const after = text.slice(offset).match(/^[\w$]*/)?.[0] ?? '';
    const symbol = `${before}${after}`;
    if (symbol.length < 2) return;
    setInspectedSymbol(symbol);
    setReferences(await findSymbolReferences({ repositoryId: repository.id, symbolName: symbol, limit: 60 }));
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-base)]">
      <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="flex items-center gap-2 px-2.5 py-2">
          <IconButton size="xs" onClick={onBack} aria-label="Back to file explorer" title="Back"><ArrowLeft className="w-3.5 h-3.5" /></IconButton>
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getLanguageColor(file.language) }} />
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[12px] font-medium font-mono truncate" title={file.path}>{file.name}</h2>
            <p className="m-0 text-[10px] text-[var(--text-muted)] truncate">{file.path} · {repository.ref ?? repository.commitSha.slice(0, 7)}</p>
          </div>
          <Badge tone="neutral">{file.lineCount} lines</Badge>
          <IconButton size="xs" onClick={() => setShowFind((value) => !value)} active={showFind} title="Find in file" aria-label="Find in file"><Search className="w-3.5 h-3.5" /></IconButton>
          <IconButton size="xs" onClick={() => { void pinInvestigationItem({ type: 'file', title: file.path, content: `Pinned ${repository.fullName}@${repository.ref ?? repository.commitSha}${activeRange.start ? ` · lines ${activeRange.start}–${activeRange.end ?? activeRange.start}` : ''}`, repositoryId: repository.id, filePath: file.path, startLine: activeRange.start, endLine: activeRange.end }); setPinned(true); }} title="Pin to investigation" aria-label="Pin file to investigation"><Bookmark className={`w-3.5 h-3.5 ${pinned ? 'text-[var(--accent-text)]' : ''}`} /></IconButton>
          <IconButton size="xs" onClick={() => { if (file.content) void navigator.clipboard.writeText(file.content); setCopied(true); setTimeout(() => setCopied(false), 1600); }} title="Copy file" aria-label="Copy file">{copied ? <Check className="w-3.5 h-3.5 text-[var(--success-text)]" /> : <Copy className="w-3.5 h-3.5" />}</IconButton>
          {githubUrl && <a href={githubUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center w-6 h-6 rounded-md text-[var(--text-muted)] hover:text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" title="Open at exact commit on GitHub" aria-label="Open at exact commit on GitHub"><ExternalLink className="w-3.5 h-3.5" /></a>}
        </div>
        {showFind && <div className="px-2.5 pb-2 flex items-center gap-2"><Search className="w-3.5 h-3.5 text-[var(--text-muted)]" /><Input autoFocus value={findQuery} onChange={(event) => setFindQuery(event.target.value)} placeholder="Find in file…" aria-label="Search current file" /><span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">{findQuery ? `${matchingLineNumbers.size} line(s)` : ''}</span></div>}
        <div className="flex items-center gap-1.5 px-2.5 pb-2">
          <Code2 className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
          <Select aria-label="Jump to symbol" value="" onChange={(event) => { const line = Number(event.target.value); if (line) setActiveRange({ start: line, end: line }); }} className="flex-1 min-w-0"><option value="">Jump to symbol…</option>{symbols.map((symbol) => <option key={symbol.id} value={symbol.startLine}>{symbol.parentSymbol ? `${symbol.parentSymbol}.` : ''}{symbol.name} · L{symbol.startLine}</option>)}</Select>
        </div>
      </div>
      {selectedSnippet && <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 border-b border-[var(--accent-border)] bg-[var(--accent-soft)]"><span className="text-[10.5px] text-[var(--accent-text)] truncate flex-1">{selectedSnippet.slice(0, 100)}</span><Button size="xs" variant="primary" onClick={() => { setAttachedSelection({ text: selectedSnippet, sourceUrl: githubUrl, pageTitle: file.path, startLine: activeRange.start, endLine: activeRange.end, capturedAt: Date.now(), kind: 'code', language: file.language }); setChatMode('explain_selection'); setActiveTab('chat'); }}><MessageSquarePlus className="w-3 h-3" /> Ask about selection</Button><IconButton size="xs" onClick={() => setSelectedSnippet('')} aria-label="Clear selection"><X className="w-3 h-3" /></IconButton></div>}
      {inspectedSymbol && <div className="shrink-0 max-h-48 overflow-auto border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2"><div className="flex items-center gap-2"><strong className="font-mono text-[11px]">{inspectedSymbol}</strong><Badge tone="neutral">lexical navigation</Badge><button type="button" onClick={() => setInspectedSymbol(null)} className="ml-auto cursor-pointer" aria-label="Close symbol navigation"><X className="w-3 h-3" /></button></div><div className="mt-1.5 space-y-1">{references.slice(0, 20).map((reference) => <button type="button" key={`${reference.fileId}:${reference.startLine}:${reference.relation}`} onClick={() => reference.fileId === file.id ? setActiveRange({ start: reference.startLine, end: reference.endLine }) : void openFileInViewer(repository.id, reference.filePath, reference.startLine, reference.endLine)} className="block w-full truncate text-left font-mono text-[10px] text-[var(--accent-text)] cursor-pointer">{reference.relation === 'definition' ? '◆ ' : '↳ '}{reference.filePath}:{reference.startLine} {reference.excerpt}</button>)}{!references.length && <p className="m-0 text-[10px] text-[var(--text-muted)]">No indexed definitions or references found.</p>}</div></div>}
      <div ref={codeContainerRef} className="flex-1 min-h-0" onMouseUp={handleMouseUp}>
        {rawLines.length === 1 && !rawLines[0] ? <EmptyState icon={Code2} title="No indexed content" description={file.skippedReason ?? 'This file has not been downloaded yet.'} action={<Button size="sm" variant="primary" onClick={async () => { try { const { indexSingleSkippedFile } = await import('../../features/indexing/sourceIndexer'); const result = await indexSingleSkippedFile(repository, file.path); await openFileInViewer(result.repository.id, file.path); useAppStore.setState({ repositories: useAppStore.getState().repositories.map((item) => item.id === result.repository.id ? result.repository : item) }); } catch (error) { useAppStore.setState({ chatError: error instanceof Error ? error.message : 'Unable to index this file.' }); } }}>Index this file</Button>} /> : <VirtualList items={rawLines} itemHeight={21} height={viewportHeight} getKey={(_line, index) => `${file.id}:${index}`} renderItem={(rawLine, index) => {
          const lineNum = index + 1;
          const isTarget = activeRange.start !== undefined && lineNum >= activeRange.start && lineNum <= (activeRange.end ?? activeRange.start);
          const isMatch = matchingLineNumbers.has(lineNum);
          return <table className="w-full border-collapse font-mono text-[11.5px] leading-[21px]"><tbody><tr data-line={lineNum} onClick={(event) => void inspectAtLine(lineNum, event)} className={`cursor-pointer ${isTarget ? 'bg-[var(--accent-soft)]' : isMatch ? 'bg-[var(--warning-soft)]' : 'hover:bg-[var(--bg-hover)]'}`}><td className="py-0 px-2 text-right select-none text-[var(--text-muted)] w-10 border-r border-[var(--border-subtle)]">{lineNum}</td><td className="py-0 pl-3 pr-4 whitespace-pre text-[var(--text-primary)]">{highlightedLines?.[index] !== undefined ? <span dangerouslySetInnerHTML={{ __html: highlightedLines[index] || ' ' }} /> : rawLine || ' '}</td></tr></tbody></table>;
        }} />}
      </div>
    </div>
  );
};
