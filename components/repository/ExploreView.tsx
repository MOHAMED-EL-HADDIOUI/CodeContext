import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Boxes,
  ChevronDown,
  ChevronRight,
  Code2,
  FileCode2,
  Folder,
  FolderOpen,
  Layers,
  Package,
  Sparkles,
} from 'lucide-react';
import type { CodeSymbol, DependencyInfo, RepositoryFile } from '../../types';
import { extractDependenciesFromFiles } from '../../core/analysis/dependencies';
import { db } from '../../services/storage/db';
import { useAppStore } from '../../stores/useAppStore';
import { CodeViewer } from '../code/CodeViewer';
import { DependencyGraphView } from './DependencyGraphView';
import { VirtualTree } from '../common/VirtualTree';
import { MarkdownView } from '../common/MarkdownView';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  getLanguageColor,
} from '../common/UIPrimitives';

type ExploreSubTab = 'files' | 'symbols' | 'readme' | 'deps' | 'overview' | 'graph';

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  file?: RepositoryFile;
  children: TreeNode[];
}

function buildFileTree(files: RepositoryFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sorted) {
    const parts = file.path.split('/');
    let currentChildren = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = i === parts.length - 1;

      if (isFile) {
        currentChildren.push({
          name: part,
          path: currentPath,
          isDir: false,
          file,
          children: [],
        });
      } else {
        let dirNode = dirMap.get(currentPath);
        if (!dirNode) {
          dirNode = {
            name: part,
            path: currentPath,
            isDir: true,
            children: [],
          };
          dirMap.set(currentPath, dirNode);
          currentChildren.push(dirNode);
        }
        currentChildren = dirNode.children;
      }
    }
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.children.length > 0) sortNodes(n.children);
    }
  };
  sortNodes(root);
  return root;
}

const TreeRow: React.FC<{
  node: TreeNode;
  depth: number;
  isOpen: boolean;
  toggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
}> = ({ node, depth, isOpen, toggleDir, onOpenFile }) => {

  if (node.isDir) {
    return (
      <div>
        <button
          type="button"
          onClick={() => toggleDir(node.path)}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          className="w-full flex items-center gap-1.5 py-1.5 pr-2 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-md transition-colors cursor-pointer"
        >
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
          )}
          {isOpen ? (
            <FolderOpen className="w-3.5 h-3.5 text-[var(--accent-text)] shrink-0" />
          ) : (
            <Folder className="w-3.5 h-3.5 text-[var(--accent-text)] shrink-0" />
          )}
          <span className="truncate font-medium">{node.name}</span>
          <span className="ml-auto text-[10px] text-[var(--text-muted)] tabular-nums">
            {node.children.length}
          </span>
        </button>
      </div>
    );
  }

  const langColor = getLanguageColor(node.file?.language ?? 'plaintext');

  return (
    <button
      type="button"
      onClick={() => onOpenFile(node.path)}
      style={{ paddingLeft: `${depth * 14 + 26}px` }}
      className="w-full flex items-center gap-2 py-1 pr-2 text-left text-[12px] hover:bg-[var(--bg-hover)] rounded-md transition-colors cursor-pointer group"
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: node.file?.indexed ? langColor : 'var(--border-default)' }}
        aria-hidden="true"
      />
      <span
        className={`truncate font-mono ${
          node.file?.indexed
            ? 'text-[var(--text-primary)] group-hover:text-[var(--accent-text)]'
            : 'text-[var(--text-muted)]'
        } transition-colors`}
      >
        {node.name}
      </span>
      {!node.file?.indexed && (
        <span className="ml-auto text-[10px] px-1 rounded bg-[var(--bg-elevated)] text-[var(--text-muted)] shrink-0">
          skipped
        </span>
      )}
    </button>
  );
};

export const ExploreView: React.FC = () => {
  const {
    repositories,
    activeRepositoryId,
    activeFileTarget,
    openFileInViewer,
    closeFileViewer,
    setChatMode,
    setActiveTab,
    sendMessage,
  } = useAppStore();

  const activeRepo = repositories.find((r) => r.id === activeRepositoryId) ?? null;

  const [subTab, setSubTab] = useState<ExploreSubTab>('files');
  const [files, setFiles] = useState<RepositoryFile[]>([]);
  const [symbols, setSymbols] = useState<CodeSymbol[]>([]);
  const [fileFilter, setFileFilter] = useState('');
  const [langFilter, setLangFilter] = useState('all');
  const [symbolFilter, setSymbolFilter] = useState('');
  const [symbolKind, setSymbolKind] = useState('all');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const activeRepoId = activeRepo?.id;
  const activeRepoIndexedAt = activeRepo?.indexedAt;

  useEffect(() => {
    if (!activeRepoId) {
      setFiles([]);
      setSymbols([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      db.files.where('repositoryId').equals(activeRepoId).toArray(),
      db.symbols.where('repositoryId').equals(activeRepoId).toArray(),
    ]).then(([f, s]) => {
      if (cancelled) return;
      setFiles(f);
      setSymbols(s);
      const topDirs = new Set(
        f
          .map((item) => item.path.split('/')[0])
          .filter((seg, _i, _arr) => seg && f.some((x) => x.path.startsWith(`${seg}/`))),
      );
      if (topDirs.size <= 5) {
        setExpandedDirs(new Set(topDirs as Set<string>));
      } else {
        setExpandedDirs(new Set(['src']));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeRepoId, activeRepoIndexedAt]);

  const languages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of files) {
      if (!f.indexed) continue;
      counts.set(f.language, (counts.get(f.language) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [files]);

  const filteredFiles = useMemo(() => {
    const q = fileFilter.trim().toLowerCase();
    return files.filter((f) => {
      if (langFilter !== 'all' && f.language !== langFilter) return false;
      if (q && !f.path.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [files, fileFilter, langFilter]);

  const fileTree = useMemo(() => buildFileTree(filteredFiles), [filteredFiles]);
  const visibleTree = useMemo(() => {
    const rows: Array<{ node: TreeNode; depth: number }> = [];
    const visit = (nodes: TreeNode[], depth: number) => {
      for (const node of nodes) {
        rows.push({ node, depth });
        if (node.isDir && expandedDirs.has(node.path)) visit(node.children, depth + 1);
      }
    };
    visit(fileTree, 0);
    return rows;
  }, [fileTree, expandedDirs]);

  const filteredSymbols = useMemo(() => {
    const q = symbolFilter.trim().toLowerCase();
    return symbols
      .filter((s) => {
        if (symbolKind !== 'all' && s.kind !== symbolKind) return false;
        if (q && !s.name.toLowerCase().includes(q) && !s.filePath.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      });
  }, [symbols, symbolFilter, symbolKind]);

  const dependencies: DependencyInfo[] = useMemo(
    () => extractDependenciesFromFiles(files),
    [files],
  );

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  if (!activeRepo) {
    return (
      <EmptyState
        icon={Folder}
        title="No repository selected"
        description="Index a GitHub repository above to explore its nested file tree, symbols, README, and dependencies offline."
      />
    );
  }

  if (activeFileTarget && activeFileTarget.file.repositoryId === activeRepo.id) {
    return (
      <CodeViewer
        repository={activeRepo}
        file={activeFileTarget.file}
        highlightStartLine={activeFileTarget.highlightStartLine}
        highlightEndLine={activeFileTarget.highlightEndLine}
        onBack={closeFileViewer}
      />
    );
  }

  const totalLangBytes = Object.values(activeRepo.languages).reduce((a, b) => a + b, 0);
  const topLanguages = Object.entries(activeRepo.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const subTabs: Array<{
    id: ExploreSubTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
  }> = [
    { id: 'files', label: 'Files', icon: FileCode2, count: activeRepo.indexedFileCount },
    { id: 'symbols', label: 'Symbols', icon: Code2, count: symbols.length },
    { id: 'readme', label: 'README', icon: BookOpen },
    { id: 'deps', label: 'Deps', icon: Package, count: dependencies.length },
    { id: 'overview', label: 'Overview', icon: Layers },
    { id: 'graph', label: 'Graph', icon: Boxes },
  ];

  return (
    <div className="flex flex-col h-full bg-[var(--bg-base)]">
      {/* Sub-navigation Pill Strip */}
      <div className="flex items-center gap-1 px-2.5 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-x-auto shrink-0">
        {subTabs.map(({ id, label, icon: Icon, count }) => {
          const active = subTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-medium transition-all cursor-pointer shrink-0 border ${
                active
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-text)] border-[var(--accent-border)]'
                  : 'text-[var(--text-secondary)] border-transparent hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
              {count !== undefined && (
                <span className="text-[10px] opacity-75 tabular-nums">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* GRAPH TAB */}
      {subTab === 'graph' && <div className="flex-1 overflow-auto p-2.5"><DependencyGraphView /></div>}

      {/* FILES TAB */}
      {subTab === 'files' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center gap-1.5 p-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-chrome)]">
            <Input
              value={fileFilter}
              onChange={(e) => setFileFilter(e.target.value)}
              placeholder="Filter files by path…"
              aria-label="Filter files"
            />
            <Select
              aria-label="Filter by language"
              value={langFilter}
              onChange={(e) => setLangFilter(e.target.value)}
              className="max-w-[125px]"
            >
              <option value="all">All langs</option>
              {languages.map(([lang, count]) => (
                <option key={lang} value={lang}>
                  {lang} ({count})
                </option>
              ))}
            </Select>
          </div>

          <VirtualTree
            items={fileFilter.trim() ? filteredFiles.map((file) => ({ node: { name: file.name, path: file.path, isDir: false, file, children: [] }, depth: 0 })) : visibleTree}
            itemHeight={30}
            label="Repository files"
            className="p-1.5"
            getKey={(row) => row.node.path}
            empty={<EmptyState icon={FileCode2} title="No matching files" description={`No files matched "${fileFilter}". Try a shorter path fragment.`} />}
          >
            {(row) => <TreeRow node={row.node} depth={row.depth} isOpen={expandedDirs.has(row.node.path)} toggleDir={toggleDir} onOpenFile={(path) => openFileInViewer(activeRepo.id, path)} />}
          </VirtualTree>
        </div>
      )}

      {/* SYMBOLS TAB */}
      {subTab === 'symbols' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center gap-1.5 p-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-chrome)]">
            <Input
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value)}
              placeholder="Filter functions, classes, types…"
              aria-label="Filter symbols"
            />
            <Select
              aria-label="Filter symbol kind"
              value={symbolKind}
              onChange={(e) => setSymbolKind(e.target.value)}
              className="max-w-[125px]"
            >
              <option value="all">All ({symbols.length})</option>
              <option value="function">Functions</option>
              <option value="class">Classes</option>
              <option value="method">Methods</option>
              <option value="interface">Interfaces</option>
              <option value="type">Types</option>
              <option value="import">Imports</option>
            </Select>
          </div>

          <VirtualTree
            items={filteredSymbols}
            itemHeight={60}
            label="Repository symbols"
            className="p-2"
            getKey={(symbol) => symbol.id}
            empty={<EmptyState icon={Code2} title="No matching symbols" description="Try another symbol name or switch the kind filter back to All." />}
          >
            {(sym) => (
              <button type="button" onClick={() => openFileInViewer(activeRepo.id, sym.filePath, sym.startLine, sym.endLine)} className="w-full cc-card rounded-lg px-3 py-2 text-left hover:border-[var(--accent-border)] hover:bg-[var(--bg-elevated)] transition-all cursor-pointer space-y-1">
                <div className="flex items-center justify-between gap-2"><span className="font-mono text-[12px] font-semibold text-[var(--text-primary)] truncate">{sym.parentSymbol ? `${sym.parentSymbol}.${sym.name}` : sym.name}</span><Badge tone={sym.kind === 'class' || sym.kind === 'interface' ? 'accent' : 'neutral'}>{sym.kind}</Badge></div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]"><span className="font-mono truncate">{sym.filePath}</span><span className="font-mono tabular-nums shrink-0">L{sym.startLine}{sym.endLine > sym.startLine ? `–${sym.endLine}` : ''}</span></div>
              </button>
            )}
          </VirtualTree>
        </div>
      )}

      {/* README TAB */}
      {subTab === 'readme' && (
        <div className="flex-1 overflow-auto p-4">
          {activeRepo.readmeContent ? (
            <div className="cc-card rounded-xl p-4">
              <MarkdownView content={activeRepo.readmeContent} />
            </div>
          ) : (
            <EmptyState
              icon={BookOpen}
              title="No README found"
              description="No root README markdown file was detected in this indexed repository."
            />
          )}
        </div>
      )}

      {/* DEPENDENCIES TAB */}
      {subTab === 'deps' && (
        <div className="flex-1 overflow-auto p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-[var(--text-primary)]">
              Detected packages ({dependencies.length})
            </span>
            <Button
              size="xs"
              variant="subtle"
              onClick={() => {
                setChatMode('explain_dependencies');
                setActiveTab('chat');
                void sendMessage(
                  'Explain the key dependencies and architecture libraries in this repository.',
                  'explain_dependencies',
                );
              }}
            >
              <Sparkles className="w-3 h-3" /> Explain with AI
            </Button>
          </div>
          {dependencies.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No manifests detected"
              description="Supports package.json, requirements.txt, Cargo.toml, and go.mod."
            />
          ) : (
            <div className="space-y-1.5">
              {dependencies.map((dep, i) => (
                <div
                  key={`${dep.sourceFile}-${dep.name}-${i}`}
                  className="cc-card rounded-lg px-3 py-2 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-[12px] font-medium text-[var(--text-primary)] truncate">
                      {dep.name}
                    </div>
                    <div className="text-[10.5px] text-[var(--text-muted)] font-mono truncate">
                      {dep.sourceFile}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                      {dep.version}
                    </span>
                    <Badge tone={dep.scope === 'dependencies' ? 'accent' : 'neutral'}>
                      {dep.scope === 'devDependencies' ? 'dev' : dep.scope}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* OVERVIEW TAB */}
      {subTab === 'overview' && (
        <div className="flex-1 overflow-auto p-3.5 space-y-3.5">
          <div className="cc-card rounded-xl p-3.5 space-y-2">
            <h2 className="text-[14.5px] font-semibold tracking-[-0.015em] text-[var(--text-primary)] m-0">
              {activeRepo.fullName}
            </h2>
            {activeRepo.description && (
              <p className="text-[12.5px] text-[var(--text-secondary)] m-0 leading-relaxed">
                {activeRepo.description}
              </p>
            )}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <Badge tone="neutral">{activeRepo.defaultBranch}</Badge>
              <Badge tone="neutral" className="font-mono">
                {activeRepo.commitSha.slice(0, 10)}
              </Badge>
              {activeRepo.stars !== undefined && (
                <Badge tone="neutral">{activeRepo.stars.toLocaleString()} stars</Badge>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="cc-card rounded-xl p-2.5">
              <div className="text-[10.5px] text-[var(--text-muted)]">Indexed files</div>
              <div className="text-[16px] font-semibold tabular-nums text-[var(--text-primary)] mt-0.5">
                {activeRepo.indexedFileCount}
              </div>
              <div className="text-[10px] text-[var(--text-muted)] tabular-nums">
                of {activeRepo.fileCount} total
              </div>
            </div>
            <div className="cc-card rounded-xl p-2.5">
              <div className="text-[10.5px] text-[var(--text-muted)]">Symbols</div>
              <div className="text-[16px] font-semibold tabular-nums text-[var(--text-primary)] mt-0.5">
                {activeRepo.symbolCount}
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">AST extracted</div>
            </div>
            <div className="cc-card rounded-xl p-2.5">
              <div className="text-[10.5px] text-[var(--text-muted)]">Chunks</div>
              <div className="text-[16px] font-semibold tabular-nums text-[var(--text-primary)] mt-0.5">
                {activeRepo.chunkCount}
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">Searchable</div>
            </div>
          </div>

          {totalLangBytes > 0 && (
            <div className="cc-card rounded-xl p-3.5 space-y-2.5">
              <h3 className="text-[12px] font-semibold text-[var(--text-primary)] m-0">
                Language composition
              </h3>

              {/* Proportional Stacked Language Bar */}
              <div className="h-2.5 w-full rounded-full overflow-hidden flex gap-0.5 bg-[var(--bg-base)]">
                {topLanguages.map(([lang, bytes]) => {
                  const pct = Math.max(2, (bytes / totalLangBytes) * 100);
                  return (
                    <div
                      key={lang}
                      title={`${lang}: ${Math.round(pct)}%`}
                      style={{
                        width: `${pct}%`,
                        backgroundColor: getLanguageColor(lang),
                      }}
                      className="h-full first:rounded-l-full last:rounded-r-full"
                    />
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-0.5">
                {topLanguages.map(([lang, bytes]) => {
                  const pct = Math.max(1, Math.round((bytes / totalLangBytes) * 100));
                  return (
                    <div key={lang} className="flex items-center justify-between text-[11.5px]">
                      <span className="inline-flex items-center gap-1.5 text-[var(--text-primary)] truncate">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: getLanguageColor(lang) }}
                        />
                        <span className="truncate">{lang}</span>
                      </span>
                      <span className="text-[var(--text-muted)] tabular-nums">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <Button
            variant="primary"
            size="md"
            className="w-full"
            onClick={() => {
              setChatMode('explain_architecture');
              setActiveTab('chat');
              void sendMessage(
                'Explain the architecture and core modules of this repository.',
                'explain_architecture',
              );
            }}
          >
            <Boxes className="w-4 h-4" /> Explain Repository Architecture
          </Button>
        </div>
      )}
    </div>
  );
};
