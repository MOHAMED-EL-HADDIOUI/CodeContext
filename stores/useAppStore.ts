import { create } from 'zustand';
import type {
  AppSettings,
  ChatMessage,
  ChatMode,
  ChatSession,
  IndexingProgress,
  InvestigationItem,
  Repository,
  RepositoryFile,
  RetrievalStage,
  SavedReference,
  SelectedCodeContext,
  TransmissionPreview,
  Workspace,
} from '../types';
import { invalidateSearchCache } from '../core/retrieval/search';
import { indexLocalEmbeddingsForRepository } from '../core/retrieval/embeddings';
import { indexNeuralEmbeddingsForRepository, initializeNeuralEmbeddings } from '../core/retrieval/neuralEmbeddings';
import { runAssistantQuery, prepareAssistantQuery } from '../features/ai/rag';
import { indexLocalSource } from '../features/indexing/indexer';
import { clearPendingSelection, fetchPendingSelection, sendExtensionMessage } from '../services/browser/messaging';
import { AI_PROVIDER_PRESETS } from '../services/ai/types';
import { clearAllCredentials, getAIApiKey, getGitHubToken, hasAIApiKey } from '../services/storage/credentials';
import { clearAllDatabaseData, db, deleteRepositoryData } from '../services/storage/db';
import { DEFAULT_SETTINGS, loadSettings, resetSettings, saveSettings } from '../services/storage/settings';
import { createInvestigationSession, listInvestigations, saveInvestigation, deleteInvestigation, addInvestigationItem } from '../features/investigations/notebooks';
import { readDirectoryHandle, readFileList, readZipSource, filterLocalSourceFiles, type SourceFileInput } from '../services/ingestion/localSources';

export type SidePanelTab = 'chat' | 'explore' | 'search' | 'review' | 'notebooks' | 'tools' | 'settings';

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
  workspaceRepositoryIds: string[];
  workspaces: Workspace[];
  indexingProgress: IndexingProgress | null;
  isIndexing: boolean;
  indexingAbortController: AbortController | null;
  activeFileTarget: ActiveFileTarget | null;
  chatMode: ChatMode;
  chatMessages: ChatMessage[];
  sessions: ChatSession[];
  activeSessionId: string | null;
  investigationItems: InvestigationItem[];
  isStreaming: boolean;
  streamingContent: string;
  chatError: string | null;
  chatAbortController: AbortController | null;
  attachedSelection: SelectedCodeContext | null;
  pendingConsentPrompt: string | null;
  retrievalStages: RetrievalStage[];
  transmissionPreview: TransmissionPreview | null;
  savedReferences: SavedReference[];
  embeddingStatus: string | null;
  initialize: () => Promise<void>;
  setActiveTab: (tab: SidePanelTab) => void;
  setChatMode: (mode: ChatMode) => void;
  updateAppSettings: (updater: (current: AppSettings) => AppSettings) => Promise<void>;
  refreshCredentialStatus: () => Promise<void>;
  selectRepository: (repositoryId: string | null) => Promise<void>;
  setWorkspaceRepositories: (repositoryIds: string[]) => void;
  refreshIndexingStatus: () => Promise<void>;
  addAndIndexRepository: (urlOrSlug: string) => Promise<Repository | null>;
  importLocalFolder: () => Promise<Repository | null>;
  importLocalFiles: (files: FileList | File[], name?: string) => Promise<Repository | null>;
  importZip: (file: File) => Promise<Repository | null>;
  resumeIndexing: (repositoryId: string) => Promise<Repository | null>;
  cancelIndexing: () => void;
  removeRepository: (repositoryId: string) => Promise<void>;
  buildLocalEmbeddings: (repositoryId: string) => Promise<number>;
  setupNeuralEmbeddings: (modelId: string) => Promise<void>;
  openFileInViewer: (repositoryId: string, filePath: string, startLine?: number, endLine?: number) => Promise<void>;
  closeFileViewer: () => void;
  setAttachedSelection: (selection: SelectedCodeContext | null) => void;
  saveReference: (ref: Omit<SavedReference, 'id' | 'createdAt'>) => Promise<void>;
  deleteReference: (id: string) => Promise<void>;
  createSession: (title?: string) => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  pinInvestigationItem: (item: Omit<InvestigationItem, 'id' | 'createdAt' | 'updatedAt' | 'sessionId'>) => Promise<void>;
  removeInvestigationItem: (id: string) => Promise<void>;
  sendMessage: (question: string, overrideMode?: ChatMode) => Promise<void>;
  previewTransmission: (question: string) => Promise<TransmissionPreview | null>;
  confirmConsentAndSend: () => Promise<void>;
  dismissConsentPrompt: () => void;
  stopGeneration: () => void;
  regenerateLastResponse: () => Promise<void>;
  clearChatHistory: () => Promise<void>;
  clearAllData: () => Promise<void>;
}

function resolveTheme(mode: AppSettings['theme']): 'dark' | 'light' {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function applyThemeAttribute(theme: 'dark' | 'light'): void {
  document.documentElement.setAttribute('data-theme', theme);
}
function getLegacySessionId(repoId: string | null): string {
  return repoId ? `session:${repoId}` : 'session:general';
}
function uniqueId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
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
  workspaceRepositoryIds: [],
  workspaces: [],
  indexingProgress: null,
  isIndexing: false,
  indexingAbortController: null,
  activeFileTarget: null,
  chatMode: 'ask_codebase',
  chatMessages: [],
  sessions: [],
  activeSessionId: null,
  investigationItems: [],
  isStreaming: false,
  streamingContent: '',
  chatError: null,
  chatAbortController: null,
  attachedSelection: null,
  pendingConsentPrompt: null,
  retrievalStages: [],
  transmissionPreview: null,
  savedReferences: [],
  embeddingStatus: null,

  initialize: async () => {
    const [settings, repos, refs, pendingSelection, sessions, workspaces] = await Promise.all([
      loadSettings(), db.repositories.orderBy('updatedAt').reverse().toArray(),
      db.savedReferences.orderBy('createdAt').reverse().toArray(), fetchPendingSelection(),
      listInvestigations(), db.workspaces.toArray(),
    ]);
    const resolvedTheme = resolveTheme(settings.theme);
    applyThemeAttribute(resolvedTheme);
    const activeRepositoryId = settings.activeRepositoryId && repos.some((repo) => repo.id === settings.activeRepositoryId)
      ? settings.activeRepositoryId : repos[0]?.id ?? null;
    const activeSession = sessions[0] ?? createInvestigationSession(activeRepositoryId);
    if (!sessions.length) await saveInvestigation(activeSession);
    const chatMessages = await db.chatMessages.where('sessionId').equals(activeSession.id).sortBy('createdAt');
    const [hasKey, ghToken, items] = await Promise.all([
      hasAIApiKey(settings.ai.provider), getGitHubToken(), db.investigationItems.where('sessionId').equals(activeSession.id).toArray(),
    ]);
    if (settings.ai.neuralEmbeddingsEnabled && settings.ai.embeddingModelId) {
      const { restoreNeuralEmbeddings } = await import('../core/retrieval/neuralEmbeddings');
      const provider = await restoreNeuralEmbeddings(settings.ai.embeddingModelId);
      if (provider) set({ embeddingStatus: 'Local neural model ready.' });
    }
    if (pendingSelection) await clearPendingSelection();
    set({
      initialized: true, settings, resolvedTheme, repositories: repos, activeRepositoryId,
      workspaceRepositoryIds: activeRepositoryId ? [activeRepositoryId] : [],
      chatMessages, sessions: sessions.length ? sessions : [activeSession], activeSessionId: activeSession.id,
      investigationItems: items, savedReferences: refs, workspaces,
      hasSessionApiKey: hasKey, hasSessionGitHubToken: Boolean(ghToken),
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
    set({ settings: next, resolvedTheme, hasSessionApiKey: await hasAIApiKey(next.ai.provider) });
  },
  refreshCredentialStatus: async () => {
    const [hasKey, ghToken] = await Promise.all([hasAIApiKey(get().settings.ai.provider), getGitHubToken()]);
    set({ hasSessionApiKey: hasKey, hasSessionGitHubToken: Boolean(ghToken) });
  },

  selectRepository: async (repositoryId) => {
    set({
      activeRepositoryId: repositoryId, workspaceRepositoryIds: repositoryId ? [repositoryId] : [],
      activeFileTarget: null, chatError: null, transmissionPreview: null,
    });
    await get().updateAppSettings((curr) => ({ ...curr, activeRepositoryId: repositoryId ?? undefined }));
  },
  setWorkspaceRepositories: (repositoryIds) => set({ workspaceRepositoryIds: [...new Set(repositoryIds)], transmissionPreview: null }),

  addAndIndexRepository: async (urlOrSlug) => {
    get().indexingAbortController?.abort();
    const controller = new AbortController();
    set({ isIndexing: true, indexingAbortController: controller,
      indexingProgress: { repositoryId: '', phase: 'fetching_metadata', discoveredFiles: 0, totalToIndex: 0, indexedFiles: 0, skippedFiles: 0, message: 'Starting background repository index…' },
    });
    const response = await sendExtensionMessage<{ ok: boolean; error?: string }>({ type: 'INDEX_GITHUB', urlOrSlug, limits: get().settings.indexing });
    if (!response?.ok) { set({ isIndexing: false, indexingProgress: { repositoryId: '', phase: 'error', discoveredFiles: 0, totalToIndex: 0, indexedFiles: 0, skippedFiles: 0, message: response?.error ?? 'Background indexing could not start.', error: response?.error ?? 'Background indexing could not start.' } }); return null; }
    await get().updateAppSettings((current) => ({ ...current, onboardingCompleted: true }));
    return get().repositories.find((repository) => repository.url.toLowerCase() === urlOrSlug.toLowerCase()) ?? null;
  },

  refreshIndexingStatus: async () => {
    const response = await sendExtensionMessage<{ repositories?: Repository[] }>({ type: 'GET_INDEXING_STATUS' });
    const repositories = response?.repositories ?? await db.repositories.orderBy('updatedAt').reverse().toArray();
    const running = repositories.find((repository) => ['indexing', 'fetching_metadata', 'fetching_tree'].includes(repository.indexingStatus));
    const active = repositories.find((repository) => repository.id === get().activeRepositoryId);
    set({
      repositories,
      activeRepositoryId: get().activeRepositoryId && repositories.some((repository) => repository.id === get().activeRepositoryId) ? get().activeRepositoryId : repositories[0]?.id ?? null,
      isIndexing: Boolean(running),
      indexingProgress: running ? { repositoryId: running.id, phase: running.indexingStatus, discoveredFiles: running.fileCount, totalToIndex: running.fileCount, indexedFiles: running.indexedFileCount, skippedFiles: running.skippedFileCount, message: 'Indexing in the background…' } : active ? { repositoryId: active.id, phase: active.indexingStatus, discoveredFiles: active.fileCount, totalToIndex: active.fileCount, indexedFiles: active.indexedFileCount, skippedFiles: active.skippedFileCount, message: active.indexingError ?? `Indexed ${active.indexedFileCount} files.` } : null,
    });
  },

  importLocalFolder: async () => {
    if (!('showDirectoryPicker' in window)) {
      const input = document.createElement('input');
      input.type = 'file';
      input.webkitdirectory = true;
      input.multiple = true;
      const files = await new Promise<FileList | null>((resolve) => {
        input.onchange = () => resolve(input.files);
        input.click();
      });
      return files?.length ? get().importLocalFiles(files) : null;
    }
    const picker = (window as Window & { showDirectoryPicker: (options?: { mode: 'read' }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    const handle = await picker.call(window, { mode: 'read' });
    set({ isIndexing: true, indexingProgress: { repositoryId: '', phase: 'fetching_tree', discoveredFiles: 0, totalToIndex: 0, indexedFiles: 0, skippedFiles: 0, message: 'Reading local folder…' } });
    const files = await readDirectoryHandle(handle, get().settings.indexing);
    return runLocalImport(get, set, handle.name, 'local-folder', files);
  },

  importLocalFiles: async (fileList, name) => {
    const files = await readFileList(fileList, get().settings.indexing);
    if (!files.length) throw new Error('No readable source files found. Check file limits and .gitignore rules.');
    return runLocalImport(get, set, name ?? 'local-project', 'local-folder', files);
  },
  importZip: async (file) => {
    if (file.size > 100 * 1024 * 1024) throw new Error('ZIP archives must be 100 MB or smaller.');
    const name = file.name.replace(/\.zip$/i, '');
    const files = filterLocalSourceFiles(readZipSource(new Uint8Array(await file.arrayBuffer()), file.name), get().settings.indexing);
    if (!files.length) throw new Error('The ZIP contains no readable source files.');
    set({ isIndexing: true, indexingProgress: { repositoryId: '', phase: 'fetching_tree', discoveredFiles: files.length, totalToIndex: files.length, indexedFiles: 0, skippedFiles: 0, message: 'Preparing the local ZIP snapshot…' } });
    const response = await sendExtensionMessage<{ ok: boolean; error?: string }>({ type: 'INDEX_LOCAL_ZIP', name, files, limits: get().settings.indexing });
    if (response?.ok) return runLocalImport(get, set, name, 'local-zip', files);
    // Extension-less unit tests and unsupported browser shells retain the local path.
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return runLocalImport(get, set, name, 'local-zip', files);
    set({ isIndexing: false });
    throw new Error(response?.error ?? 'The extension background worker could not start ZIP indexing. Reload the extension and try again.');
  },
  resumeIndexing: async (repositoryId) => {
    const repository = get().repositories.find((repo) => repo.id === repositoryId);
    if (!repository) return null;
    const response = await sendExtensionMessage<{ ok: boolean; error?: string }>({ type: 'RESUME_INDEXING', repositoryId, limits: get().settings.indexing });
    if (!response?.ok) { set({ chatError: response?.error ?? 'Could not resume indexing.', isIndexing: false }); return null; }
    set({ isIndexing: true, indexingProgress: { repositoryId, phase: 'fetching_metadata', discoveredFiles: repository.fileCount, totalToIndex: repository.fileCount, indexedFiles: repository.indexedFileCount, skippedFiles: repository.skippedFileCount, message: 'Resuming remaining files…' } });
    return repository;
  },
  cancelIndexing: () => {
    get().indexingAbortController?.abort();
    const repositoryId = get().activeRepositoryId;
    if (repositoryId) void sendExtensionMessage({ type: 'CANCEL_INDEXING', repositoryId });
  },
  removeRepository: async (repositoryId) => {
    await deleteRepositoryData(repositoryId);
    invalidateSearchCache(repositoryId);
    const repos = await db.repositories.orderBy('updatedAt').reverse().toArray();
    const nextActive = get().activeRepositoryId === repositoryId ? repos[0]?.id ?? null : get().activeRepositoryId;
    set({ repositories: repos, activeRepositoryId: nextActive, workspaceRepositoryIds: nextActive ? [nextActive] : [], activeFileTarget: get().activeFileTarget?.file.repositoryId === repositoryId ? null : get().activeFileTarget });
  },
  buildLocalEmbeddings: async (repositoryId) => {
    if (get().settings.ai.neuralEmbeddingsEnabled) return indexNeuralEmbeddingsForRepository(repositoryId);
    return indexLocalEmbeddingsForRepository(repositoryId);
  },
  setupNeuralEmbeddings: async (modelId) => {
    set({ embeddingStatus: 'Preparing local model…' });
    try {
      await initializeNeuralEmbeddings(modelId, db, (progress) => set({ embeddingStatus: `Downloading model: ${Math.round(progress)}%` }));
      set({ embeddingStatus: 'Local neural model ready.' });
      await get().updateAppSettings((current) => ({ ...current, ai: { ...current.ai, neuralEmbeddingsEnabled: true, embeddingModelId: modelId, enableLocalEmbeddings: true } }));
    } catch (error) {
      set({ embeddingStatus: error instanceof Error ? error.message : 'Failed to initialize local embeddings.' });
      throw error;
    }
  },

  openFileInViewer: async (repositoryId, filePath, startLine, endLine) => {
    const file = await db.files.where('[repositoryId+path]').equals([repositoryId, filePath]).first();
    if (!file) return;
    set({ activeRepositoryId: repositoryId, activeTab: 'explore', activeFileTarget: { file, highlightStartLine: startLine, highlightEndLine: endLine ?? startLine } });
  },
  closeFileViewer: () => set({ activeFileTarget: null }),
  setAttachedSelection: (selection) => set({ attachedSelection: selection, chatMode: selection ? 'explain_selection' : get().chatMode }),
  saveReference: async (ref) => {
    await db.savedReferences.put({ ...ref, id: uniqueId('ref'), createdAt: Date.now() });
    set({ savedReferences: await db.savedReferences.orderBy('createdAt').reverse().toArray() });
  },
  deleteReference: async (id) => {
    await db.savedReferences.delete(id);
    set({ savedReferences: await db.savedReferences.orderBy('createdAt').reverse().toArray() });
  },

  createSession: async (title) => {
    const session = createInvestigationSession(get().activeRepositoryId, title?.trim() || 'New investigation');
    set({ sessions: [session, ...get().sessions], activeSessionId: session.id, chatMessages: [], investigationItems: [], transmissionPreview: null, chatError: null });
    await saveInvestigation(session);
    set({ activeTab: 'chat' });
  },
  selectSession: async (sessionId) => {
    const [chatMessages, investigationItems] = await Promise.all([
      db.chatMessages.where('sessionId').equals(sessionId).sortBy('createdAt'),
      db.investigationItems.where('sessionId').equals(sessionId).toArray(),
    ]);
    const session = get().sessions.find((item) => item.id === sessionId);
    set({ activeSessionId: sessionId, chatMessages, investigationItems, activeRepositoryId: session?.repositoryId ?? get().activeRepositoryId, activeTab: 'chat', chatError: null, transmissionPreview: null });
  },
  renameSession: async (sessionId, title) => {
    const session = get().sessions.find((item) => item.id === sessionId);
    if (!session || !title.trim()) return;
    const updated = { ...session, title: title.trim(), updatedAt: Date.now() };
    await saveInvestigation(updated);
    set({ sessions: get().sessions.map((item) => item.id === sessionId ? updated : item) });
  },
  deleteSession: async (sessionId) => {
    await deleteInvestigation(sessionId);
    const sessions = get().sessions.filter((session) => session.id !== sessionId);
    if (get().activeSessionId === sessionId) {
      set({ sessions, activeSessionId: sessions[0]?.id ?? null });
      if (sessions[0]) await get().selectSession(sessions[0].id);
      else await get().createSession();
    } else set({ sessions });
  },
  pinInvestigationItem: async (input) => {
    let sessionId = get().activeSessionId;
    if (!sessionId) { await get().createSession(); sessionId = get().activeSessionId; }
    if (!sessionId) return;
    await addInvestigationItem({ ...input, sessionId });
    set({ investigationItems: await db.investigationItems.where('sessionId').equals(sessionId).toArray() });
  },
  removeInvestigationItem: async (id) => {
    await db.investigationItems.delete(id);
    set({ investigationItems: get().investigationItems.filter((item) => item.id !== id) });
  },

  previewTransmission: async (question) => {
    const state = get();
    const repositories = state.repositories.filter((repo) => state.workspaceRepositoryIds.includes(repo.id));
    const activeRepository = state.repositories.find((repo) => repo.id === state.activeRepositoryId);
    const prompt = await prepareAssistantQuery({
      question, mode: state.chatMode, repository: activeRepository, repositories: repositories.length ? repositories : activeRepository ? [activeRepository] : [],
      activeFile: state.activeFileTarget?.file, selectedContext: state.attachedSelection ?? undefined,
      history: state.chatMessages, aiConfig: state.settings.ai,
    });
    set({ transmissionPreview: prompt.preview });
    return prompt.preview;
  },

  sendMessage: async (question, overrideMode) => {
    const trimmed = question.trim();
    if (!trimmed) return;
    const state = get();
    const mode = overrideMode ?? state.chatMode;
    const preset = AI_PROVIDER_PRESETS[state.settings.ai.provider];
    const apiKey = await getAIApiKey(state.settings.ai.provider);
    if (preset.requiresApiKey && !apiKey) {
      set({ chatError: `No session API key configured for ${preset.name}. Add it in Settings; it remains in session storage.` });
      return;
    }
    let activeSessionId = state.activeSessionId;
    if (!activeSessionId) { await get().createSession(); activeSessionId = get().activeSessionId; }
    if (!activeSessionId) return;
    const activeRepo = state.repositories.find((repo) => repo.id === state.activeRepositoryId);
    const repositories = state.repositories.filter((repo) => state.workspaceRepositoryIds.includes(repo.id));
    if (!state.settings.ai.consentGiven) {
      set({ pendingConsentPrompt: trimmed, chatMode: mode });
      void get().previewTransmission(trimmed).catch((error) => set({ chatError: error instanceof Error ? error.message : 'Could not prepare context.' }));
      return;
    }
    const userMsg: ChatMessage = { id: uniqueId('msg'), sessionId: activeSessionId, repositoryId: activeRepo?.id, role: 'user', content: trimmed, mode, createdAt: Date.now() };
    await db.chatMessages.put(userMsg);
    const updatedHistory = [...state.chatMessages, userMsg];
    const controller = new AbortController();
    set({ chatMessages: updatedHistory, isStreaming: true, streamingContent: '', chatError: null, chatAbortController: controller, pendingConsentPrompt: null, retrievalStages: [] });
    try {
      const result = await runAssistantQuery({
        question: trimmed, mode, repository: activeRepo, repositories: repositories.length ? repositories : activeRepo ? [activeRepo] : [],
        activeFile: state.activeFileTarget?.file, selectedContext: state.attachedSelection ?? undefined,
        history: state.chatMessages, aiConfig: state.settings.ai, apiKey, signal: controller.signal,
        onToken: (accumulated) => set({ streamingContent: accumulated }),
        onStage: (retrievalStages) => set({ retrievalStages }),
      });
      const assistantMsg: ChatMessage = { id: uniqueId('msg'), sessionId: activeSessionId, repositoryId: activeRepo?.id, role: 'assistant', content: result.content, mode, citations: result.citations, incompleteIndexWarning: result.incompleteIndexWarning, createdAt: Date.now() };
      await db.chatMessages.put(assistantMsg);
      const session = get().sessions.find((item) => item.id === activeSessionId);
      if (session) await saveInvestigation({ ...session, title: session.title === 'New investigation' ? trimmed.slice(0, 70) : session.title });
      set({ chatMessages: [...updatedHistory, assistantMsg], isStreaming: false, streamingContent: '', chatAbortController: null, transmissionPreview: result.preview });
    } catch (error) {
      const partial = get().streamingContent.trim();
      const message = error instanceof Error ? error.message : 'AI request failed.';
      const isAbort = message.toLowerCase().includes('stopped by user');
      if (partial && isAbort) {
        const partialMsg: ChatMessage = { id: uniqueId('msg'), sessionId: activeSessionId, repositoryId: activeRepo?.id, role: 'assistant', content: `${partial}\n\n*(Generation stopped)*`, mode, createdAt: Date.now() };
        await db.chatMessages.put(partialMsg);
        set({ chatMessages: [...updatedHistory, partialMsg], isStreaming: false, streamingContent: '', chatAbortController: null, chatError: null });
      } else set({ isStreaming: false, streamingContent: '', chatAbortController: null, chatError: isAbort ? null : message });
    }
  },
  confirmConsentAndSend: async () => {
    const pending = get().pendingConsentPrompt;
    await get().updateAppSettings((curr) => ({ ...curr, ai: { ...curr.ai, consentGiven: true } }));
    set({ pendingConsentPrompt: null });
    if (pending) await get().sendMessage(pending);
  },
  dismissConsentPrompt: () => set({ pendingConsentPrompt: null, transmissionPreview: null }),
  stopGeneration: () => get().chatAbortController?.abort(),
  regenerateLastResponse: async () => {
    const messages = get().chatMessages;
    const index = messages.findLastIndex((message) => message.role === 'user');
    if (index < 0) return;
    const lastUser = messages[index]!;
    const toRemove = messages.slice(index);
    await db.chatMessages.bulkDelete(toRemove.map((message) => message.id));
    set({ chatMessages: messages.slice(0, index) });
    await get().sendMessage(lastUser.content, lastUser.mode ?? get().chatMode);
  },
  clearChatHistory: async () => {
    const sessionId = get().activeSessionId;
    if (sessionId) await db.chatMessages.where('sessionId').equals(sessionId).delete();
    set({ chatMessages: [], chatError: null, streamingContent: '', transmissionPreview: null });
  },
  clearAllData: async () => {
    await Promise.all([clearAllDatabaseData(), clearAllCredentials(), resetSettings()]);
    invalidateSearchCache();
    applyThemeAttribute('dark');
    set({
      settings: DEFAULT_SETTINGS, resolvedTheme: 'dark', repositories: [], activeRepositoryId: null,
      workspaceRepositoryIds: [], activeFileTarget: null, chatMessages: [], sessions: [], activeSessionId: null,
      investigationItems: [], savedReferences: [], workspaces: [], attachedSelection: null,
      hasSessionApiKey: false, hasSessionGitHubToken: false, indexingProgress: null, chatError: null,
      transmissionPreview: null,
    });
  },
}));

function runLocalImport(
  get: () => AppState,
  set: (partial: Partial<AppState>) => void,
  name: string,
  source: 'local-folder' | 'local-zip',
  files: SourceFileInput[],
): Promise<Repository | null> {
  return (async () => {
    const controller = new AbortController();
    set({ isIndexing: true, indexingAbortController: controller, indexingProgress: { repositoryId: '', phase: 'indexing', discoveredFiles: files.length, totalToIndex: files.length, indexedFiles: 0, skippedFiles: 0, message: `Indexing ${name} locally…` } });
    try {
      const result = await indexLocalSource({ name, source, files, limits: get().settings.indexing, signal: controller.signal, onProgress: (indexingProgress) => set({ indexingProgress }) });
      const repositories = await db.repositories.orderBy('updatedAt').reverse().toArray();
      set({ repositories, activeRepositoryId: result.repository.id, workspaceRepositoryIds: [result.repository.id], isIndexing: false, indexingAbortController: null });
      await get().updateAppSettings((current) => ({ ...current, activeRepositoryId: result.repository.id, onboardingCompleted: true }));
      return result.repository;
    } catch (error) {
      set({ isIndexing: false, indexingAbortController: null, chatError: error instanceof Error ? error.message : 'Local import failed.' });
      throw error;
    }
  })();
}

export { getLegacySessionId };
