import React, { useEffect } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import {
  FolderTree,
  GitPullRequest,
  NotebookTabs,
  MessageSquare,
  Moon,
  Search,
  Settings,
  Sun,
  Wrench,
} from 'lucide-react';
import { ChatView } from '../../components/chat/ChatView';
import {
  BrandLogo,
  IconButton,
  SegmentedControl,
  StatusDot,
} from '../../components/common/UIPrimitives';
import { OnboardingView } from '../../components/onboarding/OnboardingView';
import { ExploreView } from '../../components/repository/ExploreView';
import { RepositoryBar } from '../../components/repository/RepositoryBar';
import { SearchView } from '../../components/search/SearchView';
import { ReviewView } from '../../components/review/ReviewView';
import { NotebooksView } from '../../components/investigations/NotebooksView';
import { SettingsView } from '../../components/settings/SettingsView';
import { DevToolsView } from '../../components/tools/DevToolsView';
import { AI_PROVIDER_PRESETS } from '../../services/ai/types';
import { useAppStore, type SidePanelTab } from '../../stores/useAppStore';
import { validateExtensionMessage } from '../../types/messages';

type MainNavTab = Exclude<SidePanelTab, 'settings'>;

export const App: React.FC = () => {
  const {
    initialized,
    activeTab,
    settings,
    resolvedTheme,
    repositories,
    hasSessionApiKey,
    initialize,
    setActiveTab,
    setAttachedSelection,
    refreshIndexingStatus,
    updateAppSettings,
  } = useAppStore();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;

    const listener = (rawMessage: unknown) => {
      const msg = validateExtensionMessage(rawMessage);
      if (!msg) return;
      if (msg.type === 'INDEXING_PROGRESS') {
        void refreshIndexingStatus();
        useAppStore.setState({ indexingProgress: msg.progress, isIndexing: ['indexing', 'fetching_metadata', 'fetching_tree'].includes(msg.progress.phase) });
        if (['ready', 'partial', 'error', 'cancelled'].includes(msg.progress.phase)) {
          const repository = useAppStore.getState().repositories.find((item) => item.id === msg.progress.repositoryId);
          if (repository) useAppStore.setState({ activeRepositoryId: repository.id, workspaceRepositoryIds: [repository.id] });
        }
      }
      if (msg.type === 'SELECTION_CAPTURED') {
        setAttachedSelection(msg.payload);
        setActiveTab('chat');
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [setAttachedSelection, setActiveTab, refreshIndexingStatus]);

  const toggleTheme = () => {
    const next = resolvedTheme === 'dark' ? 'light' : 'dark';
    void updateAppSettings((curr) => ({ ...curr, theme: next }));
  };

  if (!initialized) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--bg-base)] text-[var(--text-secondary)]">
        <div className="flex flex-col items-center gap-2.5">
          <BrandLogo size={28} />
          <span className="text-[12px] text-[var(--text-muted)]">Initializing CodeContext…</span>
        </div>
      </div>
    );
  }

  const showOnboarding = !settings.onboardingCompleted && repositories.length === 0;
  const preset = AI_PROVIDER_PRESETS[settings.ai.provider];
  const aiReady = !preset.requiresApiKey || hasSessionApiKey;

  const navItems = [
    { id: 'chat' as MainNavTab, label: 'Chat', icon: MessageSquare },
    { id: 'explore' as MainNavTab, label: 'Explore', icon: FolderTree },
    { id: 'search' as MainNavTab, label: 'Search', icon: Search },
    { id: 'review' as MainNavTab, label: 'Review', icon: GitPullRequest },
    { id: 'notebooks' as MainNavTab, label: 'Notes', icon: NotebookTabs },
    { id: 'tools' as MainNavTab, label: 'Tools', icon: Wrench },
  ];

  return (
    <MotionConfig reducedMotion="user">
      <div className="h-screen flex flex-col bg-[var(--bg-base)] text-[var(--text-primary)] overflow-hidden">
        {/* Top Chrome Header */}
        <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-chrome)] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <BrandLogo size={24} />
            <div className="min-w-0">
              <h1 className="text-[13.5px] font-semibold leading-tight tracking-[-0.015em] text-[var(--text-primary)] m-0 truncate">
                CodeContext
              </h1>
              <p className="text-[10.5px] text-[var(--text-muted)] m-0 leading-tight truncate">
                Code Intelligence
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              title={
                aiReady
                  ? `AI connected (${settings.ai.model}) — click to configure`
                  : 'Local browsing mode — click to configure AI provider'
              }
              className="inline-flex items-center gap-1.5 h-6.5 px-2 rounded-full text-[11px] font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              <StatusDot tone={aiReady ? 'success' : 'neutral'} pulse={aiReady} />
              <span>{aiReady ? 'AI Ready' : 'Local'}</span>
            </button>

            <IconButton
              onClick={toggleTheme}
              title={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle theme"
            >
              {resolvedTheme === 'dark' ? (
                <Sun className="w-3.5 h-3.5" />
              ) : (
                <Moon className="w-3.5 h-3.5" />
              )}
            </IconButton>

            <IconButton
              active={activeTab === 'settings'}
              onClick={() => setActiveTab(activeTab === 'settings' ? 'chat' : 'settings')}
              title="Settings"
              aria-label="Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </IconButton>
          </div>
        </header>

        {showOnboarding ? (
          <main className="flex-1 min-h-0 overflow-hidden">
            <OnboardingView />
          </main>
        ) : (
          <>
            <RepositoryBar />

            {/* Pill Segmented Primary Navigation */}
            <nav
              aria-label="Primary navigation"
              className="px-2.5 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-chrome)] shrink-0"
            >
              <SegmentedControl
                items={navItems}
                value={activeTab === 'settings' ? null : activeTab}
                onChange={(next) => setActiveTab(next)}
                layoutId="sidepanel-main-nav"
                className="w-full"
              />
            </nav>

            {/* Main View with subtle cross-fade */}
            <main className="flex-1 min-h-0 overflow-hidden relative">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -3 }}
                  transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                  className="h-full"
                >
                  {activeTab === 'chat' && <ChatView />}
                  {activeTab === 'explore' && <ExploreView />}
                  {activeTab === 'search' && <SearchView />}
                  {activeTab === 'review' && <ReviewView />}
                  {activeTab === 'notebooks' && <NotebooksView />}
                  {activeTab === 'tools' && <DevToolsView />}
                  {activeTab === 'settings' && <SettingsView />}
                </motion.div>
              </AnimatePresence>
            </main>
          </>
        )}
      </div>
    </MotionConfig>
  );
};
