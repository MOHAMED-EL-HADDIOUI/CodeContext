import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Code2,
  FolderGit2,
  Globe,
  KeyRound,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { fetchActiveTabInfoViaBackground } from '../../services/browser/messaging';
import { parseGitHubUrl } from '../../services/github/urlParser';
import { useAppStore } from '../../stores/useAppStore';
import { AlertBanner, BrandLogo, Button, Input } from '../common/UIPrimitives';

const SAMPLE_REPOS = ['pmndrs/zustand', 'wxt-dev/wxt', 'colinhacks/zod'];

const PILLARS = [
  { icon: Code2, label: 'Symbol Tree', detail: 'AST-aware parsing' },
  { icon: Search, label: 'Local Search', detail: 'No API key needed' },
  { icon: Sparkles, label: 'Cited AI', detail: 'Commit-pinned lines' },
];

export const OnboardingView: React.FC = () => {
  const { addAndIndexRepository, isIndexing, updateAppSettings, setActiveTab } = useAppStore();
  const [repoInput, setRepoInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const completeOnboarding = async (nextTab: 'chat' | 'settings' = 'chat') => {
    await updateAppSettings((curr) => ({ ...curr, onboardingCompleted: true }));
    setActiveTab(nextTab);
  };

  const handleIndexUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!parseGitHubUrl(repoInput.trim())) {
      setError('Enter a valid GitHub repository URL or owner/repo.');
      return;
    }
    const repo = await addAndIndexRepository(repoInput.trim());
    if (repo) {
      await completeOnboarding('chat');
    }
  };

  const handleIndexCurrentTab = async () => {
    setError(null);
    const tab = await fetchActiveTabInfoViaBackground();
    if (!tab.url || !parseGitHubUrl(tab.url)) {
      setError('Active tab is not a GitHub repository. Paste a URL or pick an example below.');
      return;
    }
    const repo = await addAndIndexRepository(tab.url);
    if (repo) {
      await completeOnboarding('chat');
    }
  };

  return (
    <div className="h-full overflow-auto cc-dot-grid">
      <div className="min-h-full p-4 flex flex-col justify-between gap-5">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="space-y-4"
        >
          {/* Editorial Hero Header */}
          <div className="pt-1 space-y-2.5">
            <div className="flex items-center gap-3">
              <div className="p-1.5 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-default)] shadow-[var(--shadow-sm)]">
                <BrandLogo size={34} />
              </div>
              <div>
                <h1 className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--text-primary)] m-0 leading-tight">
                  Welcome to CodeContext
                </h1>
                <p className="text-[12px] text-[var(--text-muted)] m-0">
                  Understand Any Codebase. Ask Better Questions.
                </p>
              </div>
            </div>

            <p className="text-[12.5px] text-[var(--text-secondary)] leading-relaxed m-0">
              Turn Chrome&apos;s Side Panel into a local-first codebase workspace: browse symbols, search source files offline, and ask grounded AI questions with verifiable commit-pinned citations.
            </p>
          </div>

          {/* 3-Pillar Capability Strip */}
          <div className="grid grid-cols-3 gap-2">
            {PILLARS.map(({ icon: Icon, label, detail }) => (
              <div
                key={label}
                className="cc-card rounded-xl p-2.5 space-y-1 text-center"
              >
                <div className="w-7 h-7 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent-border)] mx-auto flex items-center justify-center">
                  <Icon className="w-3.5 h-3.5 text-[var(--accent-text)]" />
                </div>
                <div className="text-[11.5px] font-semibold text-[var(--text-primary)] leading-tight">
                  {label}
                </div>
                <div className="text-[10.5px] text-[var(--text-muted)] leading-tight">
                  {detail}
                </div>
              </div>
            ))}
          </div>

          {/* Quick-Index Primary Action Card */}
          <form
            onSubmit={handleIndexUrl}
            className="cc-card-elevated rounded-xl p-3.5 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--text-primary)]">
                <FolderGit2 className="w-4 h-4 text-[var(--accent-text)]" />
                Index your first repository
              </div>
            </div>

            <Button
              type="button"
              variant="primary"
              size="md"
              className="w-full"
              onClick={() => void handleIndexCurrentTab()}
              disabled={isIndexing}
            >
              <Globe className="w-4 h-4" /> Index Active GitHub Tab
            </Button>

            <div className="flex items-center gap-2 text-[10.5px] text-[var(--text-muted)]">
              <div className="h-px flex-1 bg-[var(--border-subtle)]" />
              <span>or paste repository URL</span>
              <div className="h-px flex-1 bg-[var(--border-subtle)]" />
            </div>

            <div className="flex gap-1.5">
              <Input
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                placeholder="https://github.com/owner/repository"
                aria-label="Repository URL"
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={isIndexing || !repoInput.trim()}
              >
                Index
              </Button>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              <span className="text-[10.5px] text-[var(--text-muted)]">Try:</span>
              {SAMPLE_REPOS.map((slug) => (
                <button
                  key={slug}
                  type="button"
                  onClick={() => setRepoInput(slug)}
                  className="px-2 py-0.5 rounded-md text-[10.5px] font-mono bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors cursor-pointer"
                >
                  {slug}
                </button>
              ))}
            </div>

            {error && <AlertBanner tone="danger">{error}</AlertBanner>}
          </form>

          {/* Local-First Privacy Assurance */}
          <div className="cc-card rounded-xl p-3 flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[var(--success-soft)] border border-[var(--success-border)] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-[var(--success-text)]" />
            </div>
            <div className="space-y-0.5 text-[11.5px] text-[var(--text-secondary)]">
              <div className="font-semibold text-[var(--text-primary)]">
                Local-first &amp; zero telemetry
              </div>
              <p className="m-0 leading-relaxed text-[var(--text-muted)]">
                Files and search indexes stay in your browser&apos;s IndexedDB. Nothing is sent to an AI endpoint until you add a provider and explicitly approve consent.
              </p>
            </div>
          </div>
        </motion.div>

        <div className="flex items-center justify-between gap-2 pt-3 border-t border-[var(--border-subtle)]">
          <Button size="sm" variant="secondary" onClick={() => void completeOnboarding('settings')}>
            <KeyRound className="w-3.5 h-3.5 text-[var(--accent-text)]" /> Configure AI
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void completeOnboarding('chat')}>
            Skip setup <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};
