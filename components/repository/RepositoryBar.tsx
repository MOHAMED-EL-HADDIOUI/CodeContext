import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  FolderGit2,
  GitBranch,
  Globe,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import { fetchActiveTabInfoViaBackground } from '../../services/browser/messaging';
import { parseGitHubUrl } from '../../services/github/urlParser';
import {
  AlertBanner,
  Badge,
  Button,
  IconButton,
  Input,
  Select,
  StatusDot,
} from '../common/UIPrimitives';

export const RepositoryBar: React.FC = () => {
  const {
    repositories,
    activeRepositoryId,
    isIndexing,
    indexingProgress,
    selectRepository,
    addAndIndexRepository,
    cancelIndexing,
    removeRepository,
  } = useAppStore();

  const [showAddForm, setShowAddForm] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [tabNotice, setTabNotice] = useState<string | null>(null);

  const activeRepo = repositories.find((r) => r.id === activeRepositoryId) ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTabNotice(null);
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    if (!parseGitHubUrl(trimmed)) {
      setTabNotice('Enter a valid GitHub URL (e.g. https://github.com/owner/repo) or owner/repo.');
      return;
    }
    const repo = await addAndIndexRepository(trimmed);
    if (repo) {
      setUrlInput('');
      setShowAddForm(false);
    }
  };

  const handleIndexCurrentTab = async () => {
    setTabNotice(null);
    const tab = await fetchActiveTabInfoViaBackground();
    if (!tab.url) {
      setTabNotice('No active browser tab URL detected. Paste a GitHub URL below.');
      setShowAddForm(true);
      return;
    }
    const parsed = parseGitHubUrl(tab.url);
    if (!parsed) {
      setTabNotice('Active tab is not a GitHub repository. Paste any GitHub URL below.');
      setShowAddForm(true);
      return;
    }
    setShowAddForm(false);
    await addAndIndexRepository(tab.url);
  };

  const progressPercent =
    indexingProgress && indexingProgress.totalToIndex > 0
      ? Math.min(100, Math.round((indexingProgress.indexedFiles / indexingProgress.totalToIndex) * 100))
      : 0;

  const coveragePercent =
    activeRepo && activeRepo.fileCount > 0
      ? Math.min(100, Math.round((activeRepo.indexedFileCount / activeRepo.fileCount) * 100))
      : 0;

  return (
    <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-2 space-y-2 shrink-0">
      {/* Selector Row */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1 min-w-0 flex items-center">
          <FolderGit2 className="w-3.5 h-3.5 text-[var(--accent-text)] absolute left-2.5 pointer-events-none" />
          <Select
            aria-label="Active repository"
            value={activeRepositoryId ?? ''}
            onChange={(e) => selectRepository(e.target.value || null)}
            className="w-full pl-8 pr-2 font-medium truncate"
          >
            {repositories.length === 0 ? (
              <option value="">No repository indexed yet</option>
            ) : (
              repositories.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.fullName} ({repo.indexedFileCount} files)
                </option>
              ))
            )}
          </Select>
        </div>

        <Button
          size="sm"
          variant="secondary"
          onClick={handleIndexCurrentTab}
          disabled={isIndexing}
          title="Index active GitHub tab"
          aria-label="Index active GitHub tab"
        >
          <Globe className="w-3.5 h-3.5 text-[var(--accent-text)]" />
          <span>Tab</span>
        </Button>

        <Button
          size="sm"
          variant={showAddForm ? 'primary' : 'secondary'}
          onClick={() => {
            setShowAddForm((v) => !v);
            setTabNotice(null);
          }}
          disabled={isIndexing}
          title="Add repository by URL"
          aria-label="Add repository by URL"
        >
          {showAddForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
        </Button>
      </div>

      {/* Active Repo Telemetry Strip */}
      {activeRepo && !isIndexing && (
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)] text-[11px]">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="inline-flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
              <StatusDot
                tone={
                  activeRepo.indexingStatus === 'ready'
                    ? 'success'
                    : activeRepo.indexingStatus === 'partial'
                      ? 'warning'
                      : 'neutral'
                }
              />
              {activeRepo.indexingStatus === 'ready'
                ? 'Indexed'
                : activeRepo.indexingStatus === 'partial'
                  ? 'Partial'
                  : activeRepo.indexingStatus}
            </span>

            <span className="inline-flex items-center gap-1 font-mono text-[var(--text-secondary)]">
              <GitBranch className="w-3 h-3 text-[var(--text-muted)]" />
              {activeRepo.defaultBranch}
            </span>

            <span className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-muted)]">
              {activeRepo.commitSha.slice(0, 7)}
            </span>

            <span className="text-[var(--text-muted)] tabular-nums" title={`${coveragePercent}% of discovered files indexed`}>
              {activeRepo.indexedFileCount}/{activeRepo.fileCount} files
            </span>
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <IconButton
              size="xs"
              onClick={() => addAndIndexRepository(activeRepo.url)}
              title="Incremental re-index"
              aria-label="Re-index repository"
            >
              <RefreshCw className="w-3 h-3" />
            </IconButton>
            <IconButton
              size="xs"
              tone="danger"
              onClick={() => removeRepository(activeRepo.id)}
              title="Delete indexed repository"
              aria-label="Delete indexed repository"
            >
              <Trash2 className="w-3 h-3" />
            </IconButton>
          </div>
        </div>
      )}

      {/* Animated Add URL Drawer */}
      <AnimatePresence initial={false}>
        {showAddForm && (
          <motion.form
            key="add-repo-form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onSubmit={handleSubmit}
            className="overflow-hidden"
          >
            <div className="pt-1 space-y-1.5">
              <div className="flex gap-1.5">
                <Input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://github.com/owner/repo or owner/repo"
                  aria-label="GitHub repository URL"
                  autoFocus
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={!urlInput.trim() || isIndexing}
                >
                  Index
                </Button>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] m-0">
                Works with repo URLs, tree paths, and blob links. Public repos need no token.
              </p>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {tabNotice && (
        <AlertBanner tone="warning" icon={<AlertCircle className="w-3.5 h-3.5" />}>
          {tabNotice}
        </AlertBanner>
      )}

      {/* Indexing Progress Panel */}
      {isIndexing && indexingProgress && (
        <div className="rounded-lg border border-[var(--accent-border)] bg-[var(--bg-elevated)] p-2.5 space-y-2 shadow-[var(--shadow-xs)]">
          <div className="flex items-center justify-between gap-2 text-[11.5px]">
            <span className="inline-flex items-center gap-1.5 font-medium text-[var(--text-primary)] truncate">
              <StatusDot tone="accent" pulse />
              <span className="truncate">{indexingProgress.message}</span>
            </span>
            <Button
              size="xs"
              variant="danger"
              onClick={cancelIndexing}
              aria-label="Cancel indexing"
            >
              <Square className="w-2.5 h-2.5 fill-current" /> Cancel
            </Button>
          </div>
          <div className="h-1.5 w-full rounded-full bg-[var(--bg-base)] overflow-hidden">
            <motion.div
              className="h-full bg-[var(--accent-text)] rounded-full"
              initial={{ width: '6%' }}
              animate={{ width: `${Math.max(8, progressPercent)}%` }}
              transition={{ duration: 0.2 }}
            />
          </div>
          <div className="flex items-center justify-between text-[10.5px] text-[var(--text-muted)] tabular-nums">
            <span className="truncate max-w-[60%] font-mono">
              {indexingProgress.currentFile ?? indexingProgress.phase}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <Badge tone="accent">{progressPercent}%</Badge>
              <span>
                {indexingProgress.indexedFiles}/{indexingProgress.totalToIndex || '?'} ·{' '}
                {indexingProgress.skippedFiles} skipped
              </span>
            </div>
          </div>
        </div>
      )}

      {!isIndexing && indexingProgress?.phase === 'error' && indexingProgress.error && (
        <AlertBanner tone="danger" icon={<AlertCircle className="w-3.5 h-3.5" />}>
          {indexingProgress.error}
        </AlertBanner>
      )}
    </div>
  );
};
