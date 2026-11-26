import React, { useMemo, useState } from 'react';
import { BookOpen, Download, Edit3, FileCode2, FileText, Plus, Search, Trash2 } from 'lucide-react';
import type { InvestigationItem } from '../../types';
import { useAppStore } from '../../stores/useAppStore';
import { generateInvestigationMarkdown, downloadTextFile } from '../../features/investigations/notebooks';
import { Badge, Button, EmptyState, Input } from '../common/UIPrimitives';

export const NotebooksView: React.FC = () => {
  const {
    sessions, activeSessionId, chatMessages, investigationItems, repositories,
    createSession, selectSession, renameSession, deleteSession, removeInvestigationItem,
    pinInvestigationItem, openFileInViewer,
  } = useAppStore();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const filteredSessions = useMemo(() => sessions.filter((session) => session.title.toLowerCase().includes(filter.toLowerCase())), [sessions, filter]);

  const exportNotebook = () => {
    if (!activeSession) return;
    const content = generateInvestigationMarkdown({ session: activeSession, repositories, messages: chatMessages, items: investigationItems });
    downloadTextFile(content, `${activeSession.title}.md`);
  };

  return (
    <div className="h-full overflow-auto bg-[var(--bg-base)]">
      <div className="px-3 py-3 border-b border-[var(--border-subtle)] flex items-start justify-between gap-2">
        <div>
          <h2 className="m-0 text-[14px] font-semibold">Investigation notebooks</h2>
          <p className="m-0 mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">Keep questions, evidence, notes, and decisions together.</p>
        </div>
        <Button size="xs" variant="primary" onClick={() => void createSession()}><Plus className="w-3 h-3" /> New</Button>
      </div>
      <div className="p-3 space-y-3">
        <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find an investigation…" aria-label="Find an investigation" />
        <div className="space-y-1.5">
          {filteredSessions.map((session) => (
            <div key={session.id} className={`rounded-lg border p-2 transition-colors ${session.id === activeSessionId ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'}`}>
              {editing === session.id ? (
                <form className="flex gap-1" onSubmit={(event) => { event.preventDefault(); void renameSession(session.id, title); setEditing(null); }}>
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus aria-label="Investigation title" />
                  <Button size="xs" type="submit" variant="primary">Save</Button>
                </form>
              ) : (
                <div className="flex items-center gap-1.5">
                  <button type="button" className="min-w-0 flex-1 text-left cursor-pointer" onClick={() => void selectSession(session.id)}>
                    <span className="block truncate text-[12px] font-medium">{session.title}</span>
                    <span className="mt-1 block text-[10px] text-[var(--text-muted)]">{new Date(session.updatedAt).toLocaleDateString()} · {session.repositoryId ? 'Repository investigation' : 'General investigation'}</span>
                  </button>
                  <button type="button" className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer" title="Rename investigation" aria-label="Rename investigation" onClick={() => { setEditing(session.id); setTitle(session.title); }}><Edit3 className="w-3.5 h-3.5" /></button>
                  <button type="button" className="p-1 text-[var(--text-muted)] hover:text-[var(--danger-text)] cursor-pointer" title="Delete investigation" aria-label="Delete investigation" onClick={() => void deleteSession(session.id)}><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </div>
          ))}
          {!filteredSessions.length && <EmptyState icon={BookOpen} title="No investigations found" description="Create a notebook or change your filter." />}
        </div>

        {activeSession && (
          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="m-0 truncate text-[12.5px] font-semibold">{activeSession.title}</h3>
                <p className="m-0 mt-1 text-[10.5px] text-[var(--text-muted)]">{chatMessages.length} messages · {investigationItems.length} pinned items</p>
              </div>
              <Button size="xs" onClick={exportNotebook}><Download className="w-3 h-3" /> Export</Button>
            </div>
            <form className="space-y-2" onSubmit={(event) => {
              event.preventDefault();
              if (!note.trim()) return;
              void pinInvestigationItem({ type: 'note', title: `Note · ${new Date().toLocaleDateString()}`, content: note.trim() });
              setNote('');
            }}>
              <textarea className="cc-input min-h-[70px] resize-y" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record a finding, decision, or follow-up…" aria-label="Investigation note" />
              <Button type="submit" size="xs" disabled={!note.trim()}><Plus className="w-3 h-3" /> Pin note</Button>
            </form>
            <div className="space-y-2">
              {investigationItems.map((item) => <NotebookItem key={item.id} item={item} onDelete={() => void removeInvestigationItem(item.id)} onOpen={() => item.repositoryId && item.filePath ? void openFileInViewer(item.repositoryId, item.filePath, item.startLine, item.endLine) : undefined} />)}
              {!investigationItems.length && <p className="m-0 text-[11px] text-[var(--text-muted)]">Pin files and symbols from Explore, or add a note above.</p>}
            </div>
          </section>
        )}
        <div className="rounded-lg border border-[var(--border-subtle)] p-2.5 text-[10.5px] leading-relaxed text-[var(--text-muted)]">
          Reports contain conversation content and source locations. Review private source excerpts before sharing an exported file.
        </div>
      </div>
    </div>
  );
};

const NotebookItem: React.FC<{ item: InvestigationItem; onDelete: () => void; onOpen: () => void }> = ({ item, onDelete, onOpen }) => (
  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5">
    <div className="flex items-center gap-1.5">
      {item.type === 'file' ? <FileCode2 className="w-3.5 h-3.5 text-[var(--accent-text)]" /> : item.type === 'search' ? <Search className="w-3.5 h-3.5 text-[var(--accent-text)]" /> : <FileText className="w-3.5 h-3.5 text-[var(--accent-text)]" />}
      <button type="button" className="flex-1 min-w-0 truncate text-left text-[11.5px] font-medium cursor-pointer" onClick={onOpen}>{item.title}</button>
      <Badge tone="neutral">{item.type}</Badge>
      <button type="button" className="p-1 cursor-pointer text-[var(--text-muted)] hover:text-[var(--danger-text)]" onClick={onDelete} aria-label={`Remove ${item.title}`}><Trash2 className="w-3 h-3" /></button>
    </div>
    <p className="mb-0 mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--text-secondary)]">{item.content}</p>
  </div>
);
