import React, { useEffect, useMemo, useState } from 'react';
import { Code2, FileCode2, Search as SearchIcon, Sparkles, X } from 'lucide-react';
import type { SearchResult } from '../../types';
import { computeLocalVector } from '../../core/retrieval/embeddings';
import { searchRepository, type SearchCategory } from '../../core/retrieval/search';
import { db } from '../../services/storage/db';
import { useAppStore } from '../../stores/useAppStore';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  getLanguageColor,
} from '../common/UIPrimitives';

export const SearchView: React.FC = () => {
  const {
    repositories,
    activeRepositoryId,
    settings,
    openFileInViewer,
    buildLocalEmbeddings,
  } = useAppStore();

  const activeRepo = repositories.find((r) => r.id === activeRepositoryId) ?? null;

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SearchCategory>('all');
  const [language, setLanguage] = useState('all');
  const [directory, setDirectory] = useState('all');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [availableLangs, setAvailableLangs] = useState<string[]>([]);
  const [availableDirs, setAvailableDirs] = useState<string[]>([]);
  const [embeddingCount, setEmbeddingCount] = useState(0);
  const [buildingVectors, setBuildingVectors] = useState(false);

  const activeRepoId = activeRepo?.id;
  const activeRepoIndexedAt = activeRepo?.indexedAt;

  useEffect(() => {
    if (!activeRepoId) {
      setAvailableLangs([]);
      setAvailableDirs([]);
      setEmbeddingCount(0);
      return;
    }
    let cancelled = false;
    Promise.all([
      db.files.where('repositoryId').equals(activeRepoId).filter((f) => f.indexed).toArray(),
      db.embeddings.where('repositoryId').equals(activeRepoId).count(),
    ]).then(([files, embCount]) => {
      if (cancelled) return;
      const langs = Array.from(new Set(files.map((f) => f.language))).sort();
      const dirs = Array.from(
        new Set(files.map((f) => (f.path.includes('/') ? f.path.split('/')[0]! : '(root)'))),
      ).sort();
      setAvailableLangs(langs);
      setAvailableDirs(dirs);
      setEmbeddingCount(embCount);
    });
    return () => {
      cancelled = true;
    };
  }, [activeRepoId, activeRepoIndexedAt]);

  useEffect(() => {
    if (!activeRepoId || !query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const queryVector =
          settings.ai.enableLocalEmbeddings && embeddingCount > 0
            ? computeLocalVector(query)
            : undefined;
        const hits = await searchRepository({
          repositoryId: activeRepoId,
          query,
          category,
          language,
          directory,
          limit: 30,
          queryVector,
        });
        if (!cancelled) setResults(hits);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 140);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    activeRepoId,
    query,
    category,
    language,
    directory,
    settings.ai.enableLocalEmbeddings,
    embeddingCount,
  ]);

  const handleBuildVectors = async () => {
    if (!activeRepo) return;
    setBuildingVectors(true);
    try {
      const count = await buildLocalEmbeddings(activeRepo.id);
      setEmbeddingCount(count);
    } finally {
      setBuildingVectors(false);
    }
  };

  const categories: Array<{ id: SearchCategory; label: string }> = useMemo(
    () => [
      { id: 'all', label: 'All' },
      { id: 'code', label: 'Code' },
      { id: 'symbols', label: 'Symbols' },
      { id: 'files', label: 'Files' },
      { id: 'imports', label: 'Imports' },
    ],
    [],
  );

  if (!activeRepo) {
    return (
      <EmptyState
        icon={SearchIcon}
        title="Local Hybrid Code Search"
        description="Index a GitHub repository first to search symbols, filenames, imports, and code locally with zero API key required."
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg-base)]">
      {/* Command Search Header */}
      <div className="p-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-2 shrink-0">
        <div className="relative">
          <SearchIcon className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search functions, classes, exact text, imports…"
            aria-label="Search repository code"
            className="pl-8 pr-8 h-9"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategory(cat.id)}
                className={`px-2 py-0.5 rounded-md text-[11px] font-medium cursor-pointer transition-all border ${
                  category === cat.id
                    ? 'bg-[var(--accent-soft)] text-[var(--accent-text)] border-[var(--accent-border)]'
                    : 'text-[var(--text-secondary)] border-transparent hover:bg-[var(--bg-hover)]'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {query.trim() && !searching && (
            <span className="text-[10.5px] text-[var(--text-muted)] tabular-nums">
              {results.length} result{results.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <Select
            aria-label="Filter results by language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="h-7 text-[11.5px]"
          >
            <option value="all">All languages</option>
            {availableLangs.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Filter results by directory"
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
            className="h-7 text-[11.5px]"
          >
            <option value="all">All directories</option>
            {availableDirs.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </div>

        {settings.ai.enableLocalEmbeddings && embeddingCount === 0 && (
          <div className="flex items-center justify-between gap-2 text-[11px] bg-[var(--bg-elevated)] px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)]">
            <span className="text-[var(--text-secondary)]">
              Local semantic vectors not built yet.
            </span>
            <Button
              size="xs"
              variant="subtle"
              onClick={handleBuildVectors}
              disabled={buildingVectors}
            >
              <Sparkles className="w-3 h-3" /> {buildingVectors ? 'Building…' : 'Build vectors'}
            </Button>
          </div>
        )}
      </div>

      {/* Results List */}
      <div className="flex-1 overflow-auto p-2.5 space-y-2">
        {!query.trim() ? (
          <EmptyState
            icon={SearchIcon}
            title={`Search ${activeRepo.name}`}
            description={`Instantly search ${activeRepo.indexedFileCount} indexed files and ${activeRepo.symbolCount} symbols offline using hybrid lexical + symbol ranking${embeddingCount > 0 ? ' + local semantic vectors' : ''}.`}
          />
        ) : searching ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-xl cc-shimmer" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <EmptyState
            icon={FileCode2}
            title="No matches found"
            description={`No indexed code matched "${query}". Try a broader term or reset language/directory filters.`}
          />
        ) : (
          results.map((res) => (
            <button
              key={res.chunkId}
              type="button"
              onClick={() =>
                openFileInViewer(res.repositoryId, res.filePath, res.startLine, res.endLine)
              }
              className="w-full cc-card rounded-xl p-2.5 text-left hover:border-[var(--accent-border)] hover:bg-[var(--bg-elevated)] transition-all space-y-2 cursor-pointer group"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: getLanguageColor(res.language) }}
                  />
                  <span className="font-mono text-[12px] font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-text)] truncate transition-colors">
                    {res.filePath}
                  </span>
                </div>
                <span className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--bg-base)] text-[var(--text-muted)] tabular-nums shrink-0">
                  L{res.startLine}–{res.endLine}
                </span>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {res.symbolName && (
                  <Badge tone="accent">
                    <Code2 className="w-2.5 h-2.5" /> {res.symbolName}
                  </Badge>
                )}
                <Badge tone="neutral">{res.language}</Badge>
                <Badge tone={res.matchSource === 'hybrid' ? 'success' : 'neutral'}>
                  {res.matchSource}
                </Badge>
                <span className="ml-auto text-[10.5px] text-[var(--text-muted)] tabular-nums">
                  {res.score}
                </span>
              </div>

              <pre className="m-0 p-2 rounded-lg bg-[var(--bg-code)] border border-[var(--border-subtle)] font-mono text-[11px] leading-[1.45] text-[var(--text-secondary)] overflow-x-auto max-h-28">
                {res.excerpt}
              </pre>
            </button>
          ))
        )}
      </div>
    </div>
  );
};
