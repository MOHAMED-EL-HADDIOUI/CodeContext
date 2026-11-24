import { create } from 'zustand';
import type {
  AppSettings,
  ChatMessage,
  ChatMode,
  IndexingProgress,
  Repository,
  RepositoryFile,
  SavedReference,
  SelectedCodeContext,
} from '../types';
import { invalidateSearchCache } from '../core/retrieval/search';
import { indexLocalEmbeddingsForRepository } from '../core/retrieval/embeddings';
import { runAssistantQuery } from '../features/ai/rag';
import { indexGitHubRepository } from '../features/indexing/indexer';
import {
  clearPendingSelection,
  fetchPendingSelection,
} from '../services/browser/messaging';
import { AI_PROVIDER_PRESETS } from '../services/ai/types';
import {
  clearAllCredentials,
  getAIApiKey,
  getGitHubToken,
  hasAIApiKey,
} from '../services/storage/credentials';
import {
  clearAllDatabaseData,
  db,
  deleteRepositoryData,
} from '../services/storage/db';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  resetSettings,
  saveSettings,
} from '../services/storage/settings';

export type SidePanelTab = 'chat' | 'explore' | 'search' | 'tools' | 'settings';

export interface ActiveFileTarget {
  file: RepositoryFile;
  highlightStartLine?: number;
  highlightEndLine?: number;
}

interface AppState {
  initialized: boolean;
  activeTab: SidePanelTab;
  settings: AppSettings;
  resolvedTheme: 'dark' | 'light';
  hasSessionApiKey: boolean;
  hasSessionGitHubToken: boolean;

  repositories: Repository[];
  activeRepositoryId: string | null;
  indexingProgress: IndexingProgress | null;
  isIndexing: boolean;
  indexingAbortController: AbortController | null;

  activeFileTarget: ActiveFileTarget | null;

  // Chat state
  chatMode: ChatMode;
  chatMessages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  chatError: string | null;
  chatAbortController: AbortController | null;
  attachedSelection: SelectedCodeContext | null;
  pendingConsentPrompt: string | null;

  // Saved documentation references
  savedReferences: SavedReference[];

  // Actions
  initialize: () => Promise<void>;
  setActiveTab: (tab: SidePanelTab) => void;
  setChatMode: (mode: ChatMode) => void;
  updateAppSettings: (updater: (current: AppSettings) => AppSettings) => Promise<void>;
  refreshCredentialStatus: () => Promise<void>;

  // Repository actions
  selectRepository: (repositoryId: string | null) => Promise<void>;
  addAndIndexRepository: (urlOrSlug: string) => Promise<Repository | null>;
  cancelIndexing: () => void;
  removeRepository: (repositoryId: string) => Promise<void>;
  buildLocalEmbeddings: (repositoryId: string) => Promise<number>;

  // Code viewer actions
  openFileInViewer: (
    repositoryId: string,
    filePath: string,
    startLine?: number,
    endLine?: number,
  ) => Promise<void>;
  closeFileViewer: () => void;

  // Selection & documentation actions
  setAttachedSelection: (selection: SelectedCodeContext | null) => void;
  saveReference: (ref: Omit<SavedReference, 'id' | 'createdAt'>) => Promise<void>;
  deleteReference: (id: string) => Promise<void>;

  // Chat actions
  sendMessage: (question: string, overrideMode?: ChatMode) => Promise<void>;
  confirmConsentAndSend: () => Promise<void>;
  dismissConsentPrompt: () => void;
  stopGeneration: () => void;
  regenerateLastResponse: () => Promise<void>;
  clearChatHistory: () => Promise<void>;

  // Data management
  clearAllData: () => Promise<void>;
}

function resolveTheme(mode: AppSettings['theme']): 'dark' | 'light' {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

function applyThemeAttribute(theme: 'dark' | 'light'): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

function getSessionId(repoId: string | null): string {
  return repoId ? `session:${repoId}` : 'session:general';
}

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  activeTab: 'chat',
  settings: DEFAULT_SETTINGS,
  resolvedTheme: 'dark',
  hasSessionApiKey: false,
  hasSessionGitHubToken: false,

  repositories: [],
  activeRepositoryId: null,
  indexingProgress: null,
  isIndexing: false,
  indexingAbortController: null,

  activeFileTarget: null,

  chatMode: 'ask_codebase',
  chatMessages: [],
  isStreaming: false,
  streamingContent: '',
  chatError: null,
  chatAbortController: null,
  attachedSelection: null,
  pendingConsentPrompt: null,

  savedReferences: [],

  initialize: async () => {
    const [settings, repos, refs, pendingSelection] = await Promise.all([
      loadSettings(),
      db.repositories.orderBy('updatedAt').reverse().toArray(),
      db.savedReferences.orderBy('createdAt').reverse().toArray(),
      fetchPendingSelection(),
    ]);

    const resolvedTheme = resolveTheme(settings.theme);
    applyThemeAttribute(resolvedTheme);

    const activeRepositoryId =
      settings.activeRepositoryId && repos.some((r) => r.id === settings.activeRepositoryId)
        ? settings.activeRepositoryId
        : repos[0]?.id ?? null;

    const sessionId = getSessionId(activeRepositoryId);
    const chatMessages = await db.chatMessages
      .where('sessionId')
      .equals(sessionId)
      .sortBy('createdAt');

    const [hasKey, ghToken] = await Promise.all([
      hasAIApiKey(settings.ai.provider),
      getGitHubToken(),
    ]);

    if (pendingSelection) {
      await clearPendingSelection();
    }

    set({
      initialized: true,
      settings,
      resolvedTheme,
      repositories: repos,
      activeRepositoryId,
      chatMessages,
      savedReferences: refs,
      hasSessionApiKey: hasKey,
      hasSessionGitHubToken: Boolean(ghToken),
      attachedSelection: pendingSelection ?? get().attachedSelection,
      chatMode: pendingSelection ? 'explain_selection' : get().chatMode,
      activeTab: pendingSelection ? 'chat' : get().activeTab,
    });
  },

  setActiveTab: (tab) => set({ activeTab: tab }),

  setChatMode: (mode) => set({ chatMode: mode }),

  updateAppSettings: async (updater) => {
    const next = await saveSettings(updater(get().settings));
    const resolvedTheme = resolveTheme(next.theme);
    applyThemeAttribute(resolvedTheme);
    const hasKey = await hasAIApiKey(next.ai.provider);
    set({ settings: next, resolvedTheme, hasSessionApiKey: hasKey });
  },

  refreshCredentialStatus: async () => {
    const { settings } = get();
    const [hasKey, ghToken] = await Promise.all([
      hasAIApiKey(settings.ai.provider),
      getGitHubToken(),
    ]);
    set({
      hasSessionApiKey: hasKey,
      hasSessionGitHubToken: Boolean(ghToken),
    });
  },

  selectRepository: async (repositoryId) => {
    const sessionId = getSessionId(repositoryId);
    const chatMessages = await db.chatMessages
      .where('sessionId')
      .equals(sessionId)
      .sortBy('createdAt');

    set({
      activeRepositoryId: repositoryId,
      activeFileTarget: null,
      chatMessages,
      chatError: null,
    });

    await get().updateAppSettings((curr) => ({
      ...curr,
      activeRepositoryId: repositoryId ?? undefined,
    }));
  },

  addAndIndexRepository: async (urlOrSlug) => {
    const existingController = get().indexingAbortController;
    if (existingController) existingController.abort();

    const controller = new AbortController();
    set({
      isIndexing: true,
      indexingAbortController: controller,
      indexingProgress: {
        repositoryId: '',
        phase: 'fetching_metadata',
        discoveredFiles: 0,
        totalToIndex: 0,
        indexedFiles: 0,
        skippedFiles: 0,
        message: 'Preparing repository index…',
      },
    });

    try {
      const githubToken = await getGitHubToken();
      const result = await indexGitHubRepository({
        urlOrSlug,
        githubToken,
        limits: get().settings.indexing,
        signal: controller.signal,
        onProgress: (progress) => set({ indexingProgress: progress }),
      });

      invalidateSearchCache(result.repository.id);

      if (get().settings.ai.enableLocalEmbeddings) {
        await indexLocalEmbeddingsForRepository(result.repository.id);
      }

      const repos = await db.repositories.orderBy('updatedAt').reverse().toArray();
      const sessionId = getSessionId(result.repository.id);
      const chatMessages = await db.chatMessages
        .where('sessionId')
        .equals(sessionId)
        .sortBy('createdAt');

      set({
        repositories: repos,
        activeRepositoryId: result.repository.id,
        chatMessages,
        isIndexing: false,
        indexingAbortController: null,
      });

      await get().updateAppSettings((curr) => ({
        ...curr,
        activeRepositoryId: result.repository.id,
        onboardingCompleted: true,
      }));

      return result.repository;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to index repository.';
      set({
        isIndexing: false,
        indexingAbortController: null,
        indexingProgress: {
          repositoryId: '',
          phase: 'error',
          discoveredFiles: 0,
          totalToIndex: 0,
          indexedFiles: 0,
          skippedFiles: 0,
          message,
          error: message,
        },
      });
      return null;
    }
  },

  cancelIndexing: () => {
    const controller = get().indexingAbortController;
    if (controller) {
      controller.abort();
    }
  },

  removeRepository: async (repositoryId) => {
    await deleteRepositoryData(repositoryId);
    invalidateSearchCache(repositoryId);
    const repos = await db.repositories.orderBy('updatedAt').reverse().toArray();
    const nextActive =
      get().activeRepositoryId === repositoryId ? repos[0]?.id ?? null : get().activeRepositoryId;

    const chatMessages = await db.chatMessages
      .where('sessionId')
      .equals(getSessionId(nextActive))
      .sortBy('createdAt');

    set({
      repositories: repos,
      activeRepositoryId: nextActive,
      activeFileTarget:
        get().activeFileTarget?.file.repositoryId === repositoryId ? null : get().activeFileTarget,
      chatMessages,
    });
  },

  buildLocalEmbeddings: async (repositoryId) => {
    return indexLocalEmbeddingsForRepository(repositoryId);
  },

  openFileInViewer: async (repositoryId, filePath, startLine, endLine) => {
    const file = await db.files
      .where('[repositoryId+path]')
      .equals([repositoryId, filePath])
      .first();

    if (!file) return;

    set({
      activeRepositoryId: repositoryId,
      activeTab: 'explore',
      activeFileTarget: {
        file,
        highlightStartLine: startLine,
        highlightEndLine: endLine ?? startLine,
      },
    });
  },

  closeFileViewer: () => set({ activeFileTarget: null }),

  setAttachedSelection: (selection) =>
    set({
      attachedSelection: selection,
      chatMode: selection ? 'explain_selection' : get().chatMode,
    }),

  saveReference: async (ref) => {
    const record: SavedReference = {
      ...ref,
      id: `ref:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    };
    await db.savedReferences.put(record);
    const savedReferences = await db.savedReferences.orderBy('createdAt').reverse().toArray();
    set({ savedReferences });
  },

  deleteReference: async (id) => {
    await db.savedReferences.delete(id);
    const savedReferences = await db.savedReferences.orderBy('createdAt').reverse().toArray();
    set({ savedReferences });
  },

  sendMessage: async (question, overrideMode) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    const state = get();
    const mode = overrideMode ?? state.chatMode;
    const preset = AI_PROVIDER_PRESETS[state.settings.ai.provider];
    const apiKey = await getAIApiKey(state.settings.ai.provider);

    if (preset.requiresApiKey && !apiKey) {
      set({
        chatError: `No session API key configured for ${preset.name}. Open Settings to add your API key (stored in session memory only).`,
      });
      return;
    }

    // Explicit privacy consent gate before sending source code / webpage content externally
    if (!state.settings.ai.consentGiven) {
      set({ pendingConsentPrompt: trimmed, chatMode: mode });
      return;
    }

    const activeRepo =
      state.repositories.find((r) => r.id === state.activeRepositoryId) ?? undefined;
    const sessionId = getSessionId(activeRepo?.id ?? null);

    const userMsg: ChatMessage = {
      id: `msg:${Date.now()}:u`,
      sessionId,
      repositoryId: activeRepo?.id,
      role: 'user',
      content: trimmed,
      mode,
      createdAt: Date.now(),
    };

    await db.chatMessages.put(userMsg);
    const updatedHistory = [...state.chatMessages, userMsg];

    const controller = new AbortController();
    set({
      chatMessages: updatedHistory,
      isStreaming: true,
      streamingContent: '',
      chatError: null,
      chatAbortController: controller,
      pendingConsentPrompt: null,
    });

    try {
      const result = await runAssistantQuery({
        question: trimmed,
        mode,
        repository: activeRepo,
        activeFile: state.activeFileTarget?.file,
        selectedContext: state.attachedSelection ?? undefined,
        history: state.chatMessages,
        aiConfig: state.settings.ai,
        apiKey,
        signal: controller.signal,
        onToken: (accumulated) => set({ streamingContent: accumulated }),
      });

      const assistantMsg: ChatMessage = {
        id: `msg:${Date.now()}:a`,
        sessionId,
        repositoryId: activeRepo?.id,
        role: 'assistant',
        content: result.content,
        mode,
        citations: result.citations,
        incompleteIndexWarning: result.incompleteIndexWarning,
        createdAt: Date.now(),
      };

      await db.chatMessages.put(assistantMsg);

      set({
        chatMessages: [...updatedHistory, assistantMsg],
        isStreaming: false,
        streamingContent: '',
        chatAbortController: null,
      });
    } catch (err) {
      const partial = get().streamingContent.trim();
      const message = err instanceof Error ? err.message : 'AI request failed.';
      const isAbort = message.toLowerCase().includes('stopped by user');

      if (partial && isAbort) {
        const partialMsg: ChatMessage = {
          id: `msg:${Date.now()}:a`,
          sessionId,
          repositoryId: activeRepo?.id,
          role: 'assistant',
          content: `${partial}\n\n*(Generation stopped)*`,
          mode,
          createdAt: Date.now(),
        };
        await db.chatMessages.put(partialMsg);
        set({
          chatMessages: [...updatedHistory, partialMsg],
          isStreaming: false,
          streamingContent: '',
          chatAbortController: null,
          chatError: null,
        });
      } else {
        set({
          isStreaming: false,
          streamingContent: '',
          chatAbortController: null,
          chatError: isAbort ? null : message,
        });
      }
    }
  },

  confirmConsentAndSend: async () => {
    const pending = get().pendingConsentPrompt;
    await get().updateAppSettings((curr) => ({
      ...curr,
      ai: { ...curr.ai, consentGiven: true },
    }));
    set({ pendingConsentPrompt: null });
    if (pending) {
      await get().sendMessage(pending);
    }
  },

  dismissConsentPrompt: () => set({ pendingConsentPrompt: null }),

  stopGeneration: () => {
    const controller = get().chatAbortController;
    if (controller) controller.abort();
  },

  regenerateLastResponse: async () => {
    const { chatMessages } = get();
    if (chatMessages.length === 0) return;

    // Find last user message
    const lastUserIdx = [...chatMessages].reverse().findIndex((m) => m.role === 'user');
    if (lastUserIdx < 0) return;
    const realIndex = chatMessages.length - 1 - lastUserIdx;
    const lastUser = chatMessages[realIndex]!;

    // Delete last user message and any trailing assistant messages to replay cleanly
    const toRemove = chatMessages.slice(realIndex);
    await db.chatMessages.bulkDelete(toRemove.map((m) => m.id));
    set({ chatMessages: chatMessages.slice(0, realIndex) });

    await get().sendMessage(lastUser.content, lastUser.mode ?? get().chatMode);
  },

  clearChatHistory: async () => {
    const sessionId = getSessionId(get().activeRepositoryId);
    await db.chatMessages.where('sessionId').equals(sessionId).delete();
    set({ chatMessages: [], chatError: null, streamingContent: '' });
  },

  clearAllData: async () => {
    await Promise.all([clearAllDatabaseData(), clearAllCredentials(), resetSettings()]);
    invalidateSearchCache();
    applyThemeAttribute('dark');
    set({
      settings: DEFAULT_SETTINGS,
      resolvedTheme: 'dark',
      repositories: [],
      activeRepositoryId: null,
      activeFileTarget: null,
      chatMessages: [],
      savedReferences: [],
      attachedSelection: null,
      hasSessionApiKey: false,
      hasSessionGitHubToken: false,
      indexingProgress: null,
      chatError: null,
    });
  },
}));
