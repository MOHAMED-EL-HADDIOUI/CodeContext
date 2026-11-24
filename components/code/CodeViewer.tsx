import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Code2,
  Copy,
  ExternalLink,
  MessageSquarePlus,
  Search,
  Sparkles,
} from 'lucide-react';
import type { CodeSymbol, Repository, RepositoryFile } from '../../types';
import { highlightCodeToLines } from '../../services/code/highlighter';
import { buildGitHubBlobUrl } from '../../services/github/urlParser';
import { db } from '../../services/storage/db';
import { useAppStore } from '../../stores/useAppStore';
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Input,
  Select,
  getLanguageColor,
} from '../common/UIPrimitives';

interface CodeViewerProps {
  repository: Repository;
  file: RepositoryFile;
  highlightStartLine?: number;
  highlightEndLine?: number;
  onBack: () => void;
}

export const CodeViewer: React.FC<CodeViewerProps> = ({
  repository,
  file,
  highlightStartLine,
  highlightEndLine,
  onBack,
}) => {
  const { resolvedTheme, setAttachedSelection, setActiveTab, setChatMode } = useAppStore();
  const [highlightedLines, setHighlightedLines] = useState<string[] | null>(null);
  const [symbols, setSymbols] = useState<CodeSymbol[]>([]);
  const [findQuery, setFindQuery] = useState('');
  const [showFind, setShowFind] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeRange, setActiveRange] = useState<{ start?: number; end?: number }>({
    start: highlightStartLine,
    end: highlightEndLine ?? highlightStartLine,
  });
  const [selectedSnippet, setSelectedSnippet] = useState<string>('');

  const codeContainerRef = useRef<HTMLDivElement>(null);
  const rawLines = useMemo(() => (file.content ?? '').split(/\r?\n/), [file.content]);

  useEffect(() => {
    setActiveRange({
      start: highlightStartLine,
      end: highlightEndLine ?? highlightStartLine,
    });
  }, [file.id, highlightStartLine, highlightEndLine]);

  useEffect(() => {
    let cancelled = false;
    setHighlightedLines(null);
    if (file.content) {
      highlightCodeToLines(file.content, file.language, resolvedTheme).then((lines) => {
        if (!cancelled) setHighlightedLines(lines);
      });
    }
    db.symbols
      .where('fileId')
      .equals(file.id)
      .toArray()
      .then((syms) => {
        if (!cancelled) {
          setSymbols(
            syms.filter((s) => s.kind !== 'import').sort((a, b) => a.startLine - b.startLine),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [file.id, file.content, file.language, resolvedTheme]);

  useEffect(() => {
    if (!activeRange.start) return;
    const el = codeContainerRef.current?.querySelector(`[data-line="${activeRange.start}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeRange.start, file.id, highlightedLines]);

  const matchingLineNumbers = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (!q) return new Set<number>();
    const set = new Set<number>();
    rawLines.forEach((line, idx) => {
      if (line.toLowerCase().includes(q)) set.add(idx + 1);
    });
    return set;
  }, [findQuery, rawLines]);

  const handleCopy = async () => {
    if (!file.content) return;
    await navigator.clipboard.writeText(file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleMouseUp = () => {
    const sel = window.getSelection()?.toString().trim() ?? '';
    setSelectedSnippet(sel);
  };

  const handleAskSelection = () => {
    if (!selectedSnippet) return;
    setAttachedSelection({
      text: selectedSnippet,
      filePath: file.path,
      language: file.language,
      sourceUrl: buildGitHubBlobUrl(
        repository.owner,
        repository.name,
        repository.commitSha,
        file.path,
        activeRange.start,
        activeRange.end,
      ),
      capturedAt: Date.now(),
      kind: 'code',
    });
    setChatMode('explain_selection');
    setActiveTab('chat');
  };

  const handleAskAboutFile = () => {
    setChatMode('explain_file');
    setActiveTab('chat');
  };

  const githubUrl = buildGitHubBlobUrl(
    repository.owner,
    repository.name,
    repository.commitSha,
    file.path,
    activeRange.start,
    activeRange.end,
  );

  return (
    <div className="flex flex-col h-full bg-[var(--bg-code)]">
      {/* File Header Toolbar */}
      <div className="flex items-center justify-between gap-2 px-2.5 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <IconButton size="xs" onClick={onBack} aria-label="Back to file tree" title="Back to file tree">
            <ArrowLeft className="w-3.5 h-3.5" />
          </IconButton>
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: getLanguageColor(file.language) }}
          />
          <span
            className="font-mono text-[12px] font-semibold truncate text-[var(--text-primary)]"
            title={file.path}
          >
            {file.path}
          </span>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <IconButton
            size="xs"
            active={showFind}
            onClick={() => setShowFind((v) => !v)}
            title="Search inside file"
            aria-label="Search inside file"
          >
            <Search className="w-3.5 h-3.5" />
          </IconButton>
          <IconButton
            size="xs"
            onClick={handleCopy}
            title="Copy source code"
            aria-label="Copy source code"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-[var(--success-text)]" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </IconButton>
          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center w-6 h-6 rounded-lg text-[var(--text-secondary)] hover:text-[var(--accent-text)] hover:bg-[var(--bg-hover)] transition-colors"
            title="Open exact commit file on GitHub"
            aria-label="Open on GitHub"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Metadata, Symbol Jump & AI Action Bar */}
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-chrome)] flex-wrap shrink-0">
        <div className="flex items-center gap-1.5">
          <Badge tone="neutral">{file.language}</Badge>
          <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
            {rawLines.length} lines
          </span>
          {symbols.length > 0 && (
            <Select
              aria-label="Jump to symbol"
              defaultValue=""
              onChange={(e) => {
                const sym = symbols.find((s) => s.id === e.target.value);
                if (sym) setActiveRange({ start: sym.startLine, end: sym.endLine });
              }}
              className="h-6.5 max-w-[155px] text-[11px]"
            >
              <option value="">Symbols ({symbols.length})</option>
              {symbols.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.kind}: {s.parentSymbol ? `${s.parentSymbol}.${s.name}` : s.name} (L{s.startLine})
                </option>
              ))}
            </Select>
          )}
        </div>

        <div className="flex items-center gap-1">
          {selectedSnippet ? (
            <Button size="xs" variant="primary" onClick={handleAskSelection}>
              <MessageSquarePlus className="w-3 h-3" /> Ask about selection
            </Button>
          ) : (
            <Button size="xs" variant="subtle" onClick={handleAskAboutFile}>
              <Sparkles className="w-3 h-3" /> Explain file
            </Button>
          )}
        </div>
      </div>

      {showFind && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] shrink-0">
          <Input
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            placeholder="Find in file…"
            aria-label="Find in file"
            className="h-7 text-[12px]"
            autoFocus
          />
          <Badge tone={matchingLineNumbers.size > 0 ? 'accent' : 'neutral'}>
            {matchingLineNumbers.size} match{matchingLineNumbers.size === 1 ? '' : 'es'}
          </Badge>
        </div>
      )}

      {/* Code Viewport */}
      <div
        ref={codeContainerRef}
        onMouseUp={handleMouseUp}
        className="flex-1 overflow-auto font-mono text-[12px] leading-[1.65]"
      >
        {!file.indexed || file.content === undefined ? (
          <EmptyState
            icon={Code2}
            title="File not indexed locally"
            description={file.skippedReason ?? 'This file was skipped during repository indexing.'}
            action={
              <a
                href={githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--accent-text)] underline"
              >
                View original on GitHub <ExternalLink className="w-3.5 h-3.5" />
              </a>
            }
          />
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {rawLines.map((rawLine, idx) => {
                const lineNum = idx + 1;
                const isTarget =
                  activeRange.start !== undefined &&
                  lineNum >= activeRange.start &&
                  lineNum <= (activeRange.end ?? activeRange.start);
                const isFindMatch = matchingLineNumbers.has(lineNum);
                const htmlLine = highlightedLines?.[idx];

                return (
                  <tr
                    key={lineNum}
                    data-line={lineNum}
                    className={
                      isTarget
                        ? 'bg-[var(--accent-soft)]'
                        : isFindMatch
                          ? 'bg-[var(--warning-soft)]'
                          : 'hover:bg-[var(--bg-hover)]/35'
                    }
                  >
                    <td
                      onClick={() => setActiveRange({ start: lineNum, end: lineNum })}
                      className={`select-none text-right pr-3 pl-3 text-[11px] tabular-nums align-top cursor-pointer w-[1%] whitespace-nowrap border-r border-[var(--border-subtle)] ${
                        isTarget
                          ? 'text-[var(--accent-text)] font-semibold'
                          : 'text-[var(--text-muted)]'
                      }`}
                    >
                      {lineNum}
                    </td>
                    <td className="pl-3.5 pr-4 whitespace-pre text-[var(--text-primary)]">
                      {htmlLine !== undefined ? (
                        <span dangerouslySetInnerHTML={{ __html: htmlLine || ' ' }} />
                      ) : (
                        rawLine || ' '
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
