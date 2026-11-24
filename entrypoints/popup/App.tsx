import React, { useEffect, useState } from 'react';
import {
  ChevronRight,
  FolderGit2,
  GitBranch,
  PanelRightOpen,
  Settings,
  Sparkles,
} from 'lucide-react';
import type { Repository } from '../../types';
import {
  AlertBanner,
  Badge,
  BrandLogo,
  Button,
  IconButton,
  StatusDot,
} from '../../components/common/UIPrimitives';
import {
  getActiveTabInfo,
  openSidePanelForCurrentWindow,
} from '../../services/browser/permissions';
import { parseGitHubUrl, type ParsedGitHubUrl } from '../../services/github/urlParser';
import { db } from '../../services/storage/db';
import { loadSettings } from '../../services/storage/settings';

export const PopupApp: React.FC = () => {
  const [detectedRepo, setDetectedRepo] = useState<ParsedGitHubUrl | null>(null);
  const [windowId, setWindowId] = useState<number | undefined>(undefined);
  const [recentRepos, setRecentRepos] = useState<Repository[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [settings, tab, repos] = await Promise.all([
        loadSettings(),
        getActiveTabInfo(),
        db.repositories.orderBy('updatedAt').reverse().limit(4).toArray(),
      ]);
      const theme = settings.theme === 'light' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', theme);
      setWindowId(tab.windowId);
      setRecentRepos(repos);
      if (tab.url) {
        setDetectedRepo(parseGitHubUrl(tab.url));
      }
    })();
  }, []);

  const handleOpenSidePanel = async () => {
    const ok = await openSidePanelForCurrentWindow(windowId);
    if (ok) {
      window.close();
    } else {
      setStatusMsg(
        'Could not open Side Panel automatically. Press Alt+Shift+C or use Chrome Side Panel.',
      );
    }
  };

  const handleOpenOptions = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    }
  };

  return (
    <div className="w-[360px] bg-[var(--bg-base)] text-[var(--text-primary)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3.5 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-chrome)]">
        <div className="flex items-center gap-2.5">
          <BrandLogo size={26} />
          <div>
            <h1 className="text-[14px] font-semibold tracking-[-0.015em] m-0 leading-tight">
              CodeContext
            </h1>
            <p className="text-[11px] text-[var(--text-muted)] m-0 leading-tight">
              Understand Any Codebase
            </p>
          </div>
        </div>
        <IconButton
          onClick={handleOpenOptions}
          title="Open Settings"
          aria-label="Open Settings"
        >
          <Settings className="w-4 h-4" />
        </IconButton>
      </div>

      <div className="p-3.5 space-y-3.5">
        {detectedRepo && (
          <div className="rounded-xl border border-[var(--accent-border)] bg-[var(--bg-surface)] p-3 space-y-1.5 shadow-[var(--shadow-xs)]">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--accent-text)]">
                <StatusDot tone="accent" pulse />
                Active GitHub tab detected
              </span>
              <Badge tone="accent">{detectedRepo.kind}</Badge>
            </div>
            <div className="font-mono text-[13px] font-semibold text-[var(--text-primary)] truncate">
              {detectedRepo.fullName}
            </div>
            {detectedRepo.subPath && (
              <div className="font-mono text-[11px] text-[var(--text-muted)] truncate">
                {detectedRepo.subPath}
              </div>
            )}
          </div>
        )}

        <Button
          variant="primary"
          size="md"
          className="w-full justify-between px-3.5"
          onClick={() => void handleOpenSidePanel()}
        >
          <span className="inline-flex items-center gap-2">
            <PanelRightOpen className="w-4 h-4" />
            Open CodeContext Side Panel
          </span>
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-black/25 text-white/90 border border-white/15">
            Alt+Shift+C
          </kbd>
        </Button>

        {statusMsg && <AlertBanner tone="warning">{statusMsg}</AlertBanner>}

        {/* Recent Repositories */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--text-muted)]">
            <span>Indexed repositories</span>
            <span className="tabular-nums">{recentRepos.length}</span>
          </div>

          {recentRepos.length === 0 ? (
            <div className="cc-card rounded-xl p-3 text-[12px] text-[var(--text-secondary)] flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-[var(--accent-text)]" />
              </div>
              <span className="leading-snug">
                Open the Side Panel to index a GitHub repository and explore its code locally.
              </span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {recentRepos.map((repo) => (
                <button
                  key={repo.id}
                  type="button"
                  onClick={() => void handleOpenSidePanel()}
                  className="w-full cc-card rounded-xl px-3 py-2 flex items-center justify-between gap-2 text-left hover:border-[var(--accent-border)] hover:bg-[var(--bg-elevated)] transition-all cursor-pointer group"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <FolderGit2 className="w-3.5 h-3.5 text-[var(--accent-text)] shrink-0" />
                      <span className="font-mono text-[12px] font-semibold truncate text-[var(--text-primary)] group-hover:text-[var(--accent-text)] transition-colors">
                        {repo.fullName}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10.5px] text-[var(--text-muted)] tabular-nums pl-5">
                      <span className="inline-flex items-center gap-1 font-mono">
                        <GitBranch className="w-2.5 h-2.5" /> {repo.defaultBranch}
                      </span>
                      <span>{repo.indexedFileCount} files</span>
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--accent-text)] shrink-0 transition-colors" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3.5 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-chrome)] text-[10.5px] text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone="success" /> Local-first · MV3
        </span>
        <span>v1.0.0</span>
      </div>
    </div>
  );
};
