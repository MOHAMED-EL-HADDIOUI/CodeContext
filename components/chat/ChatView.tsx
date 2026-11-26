import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Bookmark,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  Copy,
  ExternalLink,
  FileCode2,
  GitBranch,
  MousePointerClick,
  Package,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type { ChatMode, SourceCitation } from '../../types';
import { CHAT_MODE_LABELS } from '../../features/ai/rag';
import { requestPageSelectionExtraction } from '../../services/browser/messaging';
import { useAppStore } from '../../stores/useAppStore';
import { MarkdownView } from '../common/MarkdownView';
import {
  AlertBanner,
  Badge,
  BrandLogo,
  Button,
  EmptyState,
  IconButton,
  Select,
  StatusDot,
} from '../common/UIPrimitives';

const CODE_SELECTION_ACTIONS: Array<{ label: string; prompt: string }> = [
  { label: 'Explain simply', prompt: 'Explain this selected code simply and clearly.' },
  { label: 'Technical', prompt: 'Give a detailed technical explanation of this selected code.' },
  { label: 'Find bugs', prompt: 'Analyze this selected code for possible bugs, edge cases, and security issues.' },
  { label: 'Line by line', prompt: 'Explain this selected code line by line.' },
  { label: 'Improve', prompt: 'Suggest concrete refactoring and performance improvements for this code.' },
  { label: 'Dependencies', prompt: 'Explain the dependencies, types, and external APIs used by this code.' },
  { label: 'Generate tests', prompt: 'Generate focused unit tests covering normal and edge cases for this code.' },
  { label: 'Complexity', prompt: 'Analyze the time and space complexity of this code.' },
];

const DOC_SELECTION_ACTIONS: Array<{ label: string; prompt: string }> = [
  { label: 'Summarize API', prompt: 'Summarize this documentation passage concisely for a developer.' },
  { label: 'Explain examples', prompt: 'Explain the code examples and usage patterns in this documentation.' },
  { label: 'Extract params', prompt: 'Extract all documented API parameters, options, types, and defaults in a table.' },
  { label: 'List methods', prompt: 'Identify all documented methods, endpoints, and return values.' },
];

const STARTER_PROMPTS: Array<{
  label: string;
  subtitle: string;
  prompt: string;
  mode: ChatMode;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    label: 'Explain repo',
    subtitle: 'Purpose & core files',
    prompt: 'Explain what this repository does and its core components.',
    mode: 'ask_codebase',
    icon: Compass,
  },
  {
    label: 'Architecture',
    subtitle: 'Layers & boundaries',
    prompt: 'Explain the software architecture, layers, and entrypoints.',
    mode: 'explain_architecture',
    icon: Boxes,
  },
  {
    label: 'Trace flow',
    subtitle: 'End-to-end execution',
    prompt: 'Trace the main execution flow through this application.',
    mode: 'trace_flow',
    icon: GitBranch,
  },
  {
    label: 'Dependencies',
    subtitle: 'Packages & manifests',
    prompt: 'Explain the key dependencies and how they are used.',
    mode: 'explain_dependencies',
    icon: Package,
  },
];

const CitationCard: React.FC<{
  citation: SourceCitation;
  index: number;
  onOpenLocal: (citation: SourceCitation) => void;
}> = ({ citation, index, onOpenLocal }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] overflow-hidden transition-colors hover:border-[var(--border-default)]">
      <div className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 text-[11.5px]">
        <button
          type="button"
          onClick={() => onOpenLocal(citation)}
          className="flex items-center gap-1.5 min-w-0 text-left group cursor-pointer"
          title="Jump to lines in local Code Viewer"
        >
          <span className="inline-flex items-center justify-center w-4.5 h-4.5 rounded-md bg-[var(--accent-soft)] border border-[var(--accent-border)] text-[var(--accent-text)] text-[10px] font-semibold shrink-0 tabular-nums">
            {index + 1}
          </span>
          <FileCode2 className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--accent-text)] shrink-0 transition-colors" />
          <span className="font-mono truncate text-[var(--text-primary)] group-hover:text-[var(--accent-text)] transition-colors">
            {citation.filePath}
          </span>
          <span className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-muted)] tabular-nums shrink-0">
            L{citation.startLine}–{citation.endLine}
          </span>
        </button>

        <div className="flex items-center gap-0.5 shrink-0">
          <IconButton
            size="xs"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Hide excerpt' : 'Preview source excerpt'}
            aria-label={expanded ? 'Hide excerpt' : 'Show source excerpt'}
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </IconButton>
          {citation.githubUrl && (
            <a
              href={citation.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center w-6 h-6 rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-text)] hover:bg-[var(--bg-hover)] transition-colors"
              title="Open commit-pinned lines on GitHub"
              aria-label="Open on GitHub"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="overflow-hidden"
          >
            <pre className="m-0 px-3 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-code)] font-mono text-[11px] leading-[1.5] text-[var(--text-secondary)] overflow-x-auto max-h-44">
              {citation.excerpt}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const ChatView: React.FC = () => {
  const {
    repositories,
    activeRepositoryId,
    chatMode,
    chatMessages,
    isStreaming,
    streamingContent,
    chatError,
    attachedSelection,
    pendingConsentPrompt,
    retrievalStages,
    transmissionPreview,
    sessions,
    activeSessionId,
    selectSession,
    createSession,
    workspaceRepositoryIds,
    settings,
    setChatMode,
    setAttachedSelection,
    setActiveTab,
    openFileInViewer,
    saveReference,
    sendMessage,
    confirmConsentAndSend,
    dismissConsentPrompt,
    stopGeneration,
    regenerateLastResponse,
    clearChatHistory,
  } = useAppStore();

  const [input, setInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  const activeRepo = repositories.find((r) => r.id === activeRepositoryId) ?? null;
  const selectedRepositories = repositories.filter((repository) => workspaceRepositoryIds.includes(repository.id));

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length, streamingContent]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = input.trim();
    if (!q || isStreaming) return;
    setInput('');
    await sendMessage(q);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handleCopyMessage = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1600);
  };

  const handleCaptureTabSelection = async () => {
    setCaptureNotice(null);
    const extracted = await requestPageSelectionExtraction();
    if (!extracted) {
      setCaptureNotice('Select text or code on the active webpage first, or right-click → Ask CodeContext.');
      return;
    }
    setAttachedSelection(extracted);
  };

  const handleSaveSelectionReference = async () => {
    if (!attachedSelection) return;
    await saveReference({
      title: attachedSelection.pageTitle || attachedSelection.filePath || 'Saved excerpt',
      url: attachedSelection.sourceUrl || '',
      excerpt: attachedSelection.text.slice(0, 2000),
      language: attachedSelection.language,
    });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 1800);
  };

  const handleOpenCitation = (citation: SourceCitation) => {
    void openFileInViewer(
      citation.repositoryId,
      citation.filePath,
      citation.startLine,
      citation.endLine,
    );
  };

  const selectionActions =
    attachedSelection?.kind === 'documentation' ? DOC_SELECTION_ACTIONS : CODE_SELECTION_ACTIONS;

  return (
    <div className="flex flex-col h-full bg-[var(--bg-base)]">
      {/* Mode & Action Bar */}
      {/* Investigation and source context */}
      <div className="shrink-0 px-2.5 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center gap-1.5">
        <Bookmark className="w-3.5 h-3.5 text-[var(--accent-text)] shrink-0" />
        <Select aria-label="Active investigation" value={activeSessionId ?? ''} onChange={(event) => void selectSession(event.target.value)} className="flex-1 min-w-0">
          {sessions.map((session) => <option value={session.id} key={session.id}>{session.title}</option>)}
        </Select>
        <Button size="xs" variant="ghost" onClick={() => void createSession()}>New</Button>
        {selectedRepositories.length > 1 && <Badge tone="accent">{selectedRepositories.length} sources</Badge>}
      </div>
      {selectedRepositories.length > 1 && <div className="shrink-0 flex gap-1 overflow-x-auto px-2.5 py-1.5 border-b border-[var(--border-subtle)]">{selectedRepositories.map((repository) => <Badge tone="neutral" key={repository.id}>{repository.fullName}@{repository.ref ?? repository.commitSha.slice(0, 6)}</Badge>)}</div>}

      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-[var(--accent-text)] shrink-0" />
          <Select
            aria-label="Assistant mode"
            value={chatMode}
            onChange={(e) => setChatMode(e.target.value as ChatMode)}
            className="h-7 text-[11.5px] font-medium max-w-[185px]"
          >
            {(Object.keys(CHAT_MODE_LABELS) as ChatMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {CHAT_MODE_LABELS[mode].label}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="xs"
            variant="ghost"
            onClick={handleCaptureTabSelection}
            title="Capture highlighted text from the active webpage"
          >
            <MousePointerClick className="w-3.5 h-3.5 text-[var(--accent-text)]" /> Capture
          </Button>
          {chatMessages.length > 0 && (
            <IconButton
              size="xs"
              tone="danger"
              onClick={clearChatHistory}
              disabled={isStreaming}
              title="Clear conversation"
              aria-label="Clear conversation"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </IconButton>
          )}
        </div>
      </div>

      {/* Attached Selection Drawer */}
      <AnimatePresence initial={false}>
        {attachedSelection && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="mx-3 mt-2.5 rounded-xl border border-[var(--accent-border)] bg-[var(--bg-surface)] p-2.5 space-y-2 shadow-[var(--shadow-sm)] shrink-0"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Badge tone="accent">
                  {attachedSelection.kind === 'documentation' ? 'Docs' : 'Selection'}
                </Badge>
                {attachedSelection.language && <Badge tone="neutral">{attachedSelection.language}</Badge>}
                <span className="text-[11px] text-[var(--text-muted)] truncate font-mono">
                  {attachedSelection.filePath || attachedSelection.pageTitle || attachedSelection.sourceUrl}
                </span>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <IconButton
                  size="xs"
                  onClick={handleSaveSelectionReference}
                  title="Save reference locally"
                  aria-label="Save reference locally"
                >
                  {savedNotice ? (
                    <Check className="w-3 h-3 text-[var(--success-text)]" />
                  ) : (
                    <Bookmark className="w-3 h-3" />
                  )}
                </IconButton>
                <IconButton
                  size="xs"
                  onClick={() => setAttachedSelection(null)}
                  aria-label="Detach selection"
                >
                  <X className="w-3.5 h-3.5" />
                </IconButton>
              </div>
            </div>

            <pre className="m-0 p-2 rounded-lg bg-[var(--bg-code)] border border-[var(--border-subtle)] font-mono text-[11px] max-h-24 overflow-auto text-[var(--text-secondary)]">
              {attachedSelection.text.slice(0, 600)}
              {attachedSelection.text.length > 600 ? '\n…' : ''}
            </pre>

            <div className="flex flex-wrap gap-1">
              {selectionActions.map((act) => (
                <button
                  key={act.label}
                  type="button"
                  disabled={isStreaming}
                  onClick={() => void sendMessage(act.prompt, 'explain_selection')}
                  className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] hover:border-[var(--accent-border)] text-[var(--text-primary)] border border-[var(--border-subtle)] transition-all cursor-pointer disabled:opacity-45"
                >
                  {act.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {captureNotice && (
        <div className="mx-3 mt-2 shrink-0">
          <AlertBanner
            tone="warning"
            action={
              <IconButton size="xs" onClick={() => setCaptureNotice(null)} aria-label="Dismiss notice">
                <X className="w-3 h-3" />
              </IconButton>
            }
          >
            {captureNotice}
          </AlertBanner>
        </div>
      )}

      {/* Privacy Consent Gate */}
      <AnimatePresence initial={false}>
        {pendingConsentPrompt && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="mx-3 mt-2.5 rounded-xl border border-[var(--accent-border)] bg-[var(--bg-elevated)] p-3 space-y-2.5 shadow-[var(--shadow-sm)] shrink-0"
          >
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4 text-[var(--accent-text)]" />
              </div>
              <div className="space-y-1 text-[12px]">
                <p className="font-semibold text-[var(--text-primary)] m-0">
                  Confirm external AI transmission
                </p>
                <p className="text-[var(--text-secondary)] m-0 leading-relaxed">
                  Review the exact context before sending it to <span className="font-mono text-[var(--text-primary)]">{settings.ai.baseUrl || settings.ai.provider}</span> ({settings.ai.model}). Your credentials are never included in source excerpts or exports.
                  {transmissionPreview && <span className="mt-2 block rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2 text-[10.5px]">
                    <strong>{transmissionPreview.sourceCount} source excerpts</strong> · about {transmissionPreview.estimatedTokens.toLocaleString()} tokens · {transmissionPreview.includesHistory ? 'recent history included' : 'no prior history'}
                    {transmissionPreview.sources.slice(0, 8).map((source) => <span key={`${source.repositoryId}:${source.filePath}:${source.startLine}`} className="mt-1 block font-mono truncate">{source.repositoryName}/{source.filePath}:{source.startLine}–{source.endLine}</span>)}
                  </span>}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-1.5">
              <Button size="xs" variant="ghost" onClick={dismissConsentPrompt}>
                Cancel
              </Button>
              <Button size="xs" variant="primary" onClick={() => void confirmConsentAndSend()}>
                Allow &amp; send
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages Viewport */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {chatMessages.length === 0 && !isStreaming ? (
          activeRepo ? (
            <div className="py-3 space-y-4">
              <div className="cc-card rounded-xl p-3.5 space-y-2 cc-dot-grid">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <BrandLogo size={20} />
                    <h2 className="text-[14px] font-semibold tracking-[-0.015em] text-[var(--text-primary)] m-0 truncate">
                      Ask {activeRepo.name}
                    </h2>
                  </div>
                  <Badge tone="success">{activeRepo.indexedFileCount} files</Badge>
                </div>
                <p className="text-[12px] text-[var(--text-secondary)] m-0 leading-relaxed">
                  Grounded in {activeRepo.symbolCount} extracted symbols and {activeRepo.chunkCount} chunks at commit{' '}
                  <span className="font-mono text-[var(--text-primary)]">
                    {activeRepo.commitSha.slice(0, 7)}
                  </span>
                  . Every answer cites verifiable source lines.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {STARTER_PROMPTS.map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <motion.button
                      key={item.label}
                      type="button"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18, delay: idx * 0.04 }}
                      onClick={() => void sendMessage(item.prompt, item.mode)}
                      className="cc-card p-2.5 text-left rounded-xl hover:border-[var(--accent-border)] hover:bg-[var(--bg-elevated)] transition-all duration-150 space-y-1.5 cursor-pointer group"
                    >
                      <div className="w-7 h-7 rounded-lg bg-[var(--bg-elevated)] group-hover:bg-[var(--accent-soft)] border border-[var(--border-subtle)] group-hover:border-[var(--accent-border)] flex items-center justify-center transition-colors">
                        <Icon className="w-3.5 h-3.5 text-[var(--text-secondary)] group-hover:text-[var(--accent-text)] transition-colors" />
                      </div>
                      <div>
                        <div className="text-[12px] font-semibold text-[var(--text-primary)] leading-tight">
                          {item.label}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] leading-snug mt-0.5">
                          {item.subtitle}
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={Sparkles}
              title="Codebase Assistant"
              description="Index any GitHub repository above, or highlight code on a webpage and click Capture to analyze it here."
            />
          )
        ) : (
          <>
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={msg.role === 'user' ? 'flex justify-end' : 'space-y-2'}
              >
                {msg.role === 'user' ? (
                  <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-[var(--bg-elevated)] border border-[var(--border-default)] px-3.5 py-2 text-[12.5px] text-[var(--text-primary)] shadow-[var(--shadow-xs)] whitespace-pre-wrap">
                    {msg.content}
                  </div>
                ) : (
                  <div className="cc-card rounded-xl p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 pb-1 border-b border-[var(--border-subtle)]">
                      <div className="flex items-center gap-1.5">
                        <BrandLogo size={16} />
                        <span className="text-[11.5px] font-semibold text-[var(--text-primary)]">
                          CodeContext
                        </span>
                        {msg.mode && (
                          <Badge tone="neutral">{CHAT_MODE_LABELS[msg.mode].label}</Badge>
                        )}
                      </div>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => handleCopyMessage(msg.id, msg.content)}
                      >
                        {copiedId === msg.id ? (
                          <>
                            <Check className="w-3 h-3 text-[var(--success-text)]" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" /> Copy
                          </>
                        )}
                      </Button>
                    </div>

                    {msg.incompleteIndexWarning && (
                      <AlertBanner
                        tone="warning"
                        icon={<AlertTriangle className="w-3.5 h-3.5" />}
                      >
                        {msg.incompleteIndexWarning}
                      </AlertBanner>
                    )}

                    <MarkdownView content={msg.content} />

                    {msg.citations && msg.citations.length > 0 && (
                      <div className="pt-2.5 border-t border-[var(--border-subtle)] space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--text-secondary)]">
                          <span>Verified Sources</span>
                          <span className="tabular-nums text-[var(--text-muted)]">
                            {msg.citations.length} ref{msg.citations.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {msg.citations.map((cit, idx) => (
                            <CitationCard
                              key={`${cit.filePath}:${cit.startLine}-${cit.endLine}`}
                              citation={cit}
                              index={idx}
                              onOpenLocal={handleOpenCitation}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {isStreaming && (
              <div className="rounded-xl border border-[var(--accent-border)] bg-[var(--bg-surface)] p-3 space-y-2.5 shadow-[var(--shadow-sm)]">
                <div className="flex items-center gap-2 text-[11.5px] font-medium text-[var(--accent-text)]">
                  <StatusDot tone="accent" pulse />
                  <span>{streamingContent ? 'Generating grounded answer…' : 'Preparing evidence and verified sources…'}</span>
                </div>
                {retrievalStages.length > 0 && <div className="space-y-1.5" aria-live="polite">{retrievalStages.map((stage) => <div key={stage.id} className="flex items-center gap-2 text-[10.5px] text-[var(--text-secondary)]"><span className={`w-1.5 h-1.5 rounded-full ${stage.status === 'active' ? 'bg-[var(--accent-text)] animate-pulse' : stage.status === 'complete' ? 'bg-[var(--success-text)]' : 'bg-[var(--text-muted)]'}`} /><span>{stage.detail}</span></div>)}</div>}
                {streamingContent ? (
                  <MarkdownView content={streamingContent} />
                ) : (
                  <div className="space-y-2 py-1">
                    <div className="h-3 w-4/5 rounded cc-shimmer" />
                    <div className="h-3 w-3/5 rounded cc-shimmer" />
                    <div className="h-3 w-2/3 rounded cc-shimmer" />
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {chatError && (
          <AlertBanner
            tone="danger"
            action={
              chatError.toLowerCase().includes('settings') ? (
                <Button size="xs" variant="secondary" onClick={() => setActiveTab('settings')}>
                  Settings
                </Button>
              ) : undefined
            }
          >
            {chatError}
          </AlertBanner>
        )}

        <div ref={scrollEndRef} />
      </div>

      {/* Floating Docked Command Composer */}
      <form
        onSubmit={handleSubmit}
        className="p-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-chrome)] shrink-0"
      >
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] focus-within:border-[var(--accent-text)] focus-within:shadow-[0_0_0_3px_var(--accent-ring)] transition-all duration-150 overflow-hidden">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder={
              activeRepo
                ? `Ask about ${activeRepo.name}…`
                : 'Ask about attached code or index a repository…'
            }
            aria-label="Ask CodeContext"
            className="w-full resize-none px-3 pt-2.5 pb-1.5 text-[12.5px] bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] border-0 focus:outline-none"
          />

          <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-muted)] truncate max-w-[140px]">
                {settings.ai.model}
              </span>
              <span className="hidden sm:inline text-[10px] text-[var(--text-muted)]">
                <kbd className="cc-kbd">↵</kbd> send
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {!isStreaming && chatMessages.some((m) => m.role === 'user') && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void regenerateLastResponse()}
                  title="Regenerate last answer"
                >
                  <RefreshCw className="w-3 h-3" /> Retry
                </Button>
              )}

              {isStreaming ? (
                <Button size="xs" variant="danger" onClick={stopGeneration}>
                  <Square className="w-2.5 h-2.5 fill-current" /> Stop
                </Button>
              ) : (
                <Button type="submit" size="xs" variant="primary" disabled={!input.trim()}>
                  Send <Send className="w-3 h-3" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};
