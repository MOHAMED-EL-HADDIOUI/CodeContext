import React, { useRef, useState } from 'react';
import { AlertCircle, FileArchive, FolderGit2, FolderOpen, GitBranch, Globe, Layers3, LoaderCircle, Plus, RefreshCw, Square, Trash2, X } from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import { fetchActiveTabInfoViaBackground } from '../../services/browser/messaging';
import { parseGitHubUrl } from '../../services/github/urlParser';
import { createWorkspace, deleteWorkspace } from '../../features/investigations/notebooks';
import { AlertBanner, Badge, Button, IconButton, Input, Select, StatusDot } from '../common/UIPrimitives';

export const RepositoryBar: React.FC = () => {
  const {
    repositories, activeRepositoryId, workspaceRepositoryIds, workspaces, isIndexing, indexingProgress,
    selectRepository, setWorkspaceRepositories, addAndIndexRepository, importLocalFolder, importZip,
    resumeIndexing, cancelIndexing, removeRepository,
  } = useAppStore();
  const [showAddForm, setShowAddForm] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [tabNotice, setTabNotice] = useState<string | null>(null);
  const [localImporting, setLocalImporting] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const zipInputRef = useRef<HTMLInputElement>(null);
  const activeRepo = repositories.find((repo) => repo.id === activeRepositoryId) ?? null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault(); setTabNotice(null);
    if (!parseGitHubUrl(urlInput.trim())) { setTabNotice('Enter a GitHub repository, branch tree, or file URL.'); return; }
    const repo = await addAndIndexRepository(urlInput.trim());
    if (repo) { setUrlInput(''); setShowAddForm(false); }
  };
  const handleIndexCurrentTab = async () => {
    setTabNotice(null);
    const tab = await fetchActiveTabInfoViaBackground();
    if (!tab.url || !parseGitHubUrl(tab.url)) { setTabNotice('The active tab is not a supported GitHub repository. Paste a repository, branch, or file URL.'); setShowAddForm(true); return; }
    setShowAddForm(false); await addAndIndexRepository(tab.url);
  };
  const handleFolder = async () => {
    setLocalImporting(true); setTabNotice(null);
    try { const repository = await importLocalFolder(); if (repository) setShowAddForm(false); }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; setTabNotice(error instanceof Error ? error.message : 'Unable to import this folder.'); }
    finally { setLocalImporting(false); }
  };
  const handleZip = async (file?: File) => {
    if (!file) return;
    setLocalImporting(true); setTabNotice(null);
    try { const repository = await importZip(file); if (repository) setShowAddForm(false); }
    catch (error) { setTabNotice(error instanceof Error ? error.message : 'Unable to import this archive.'); }
    finally { setLocalImporting(false); if (zipInputRef.current) zipInputRef.current.value = ''; }
  };
  const saveWorkspace = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!workspaceName.trim() || !workspaceRepositoryIds.length) return;
    const workspace = await createWorkspace(workspaceName, workspaceRepositoryIds);
    useAppStore.setState({ workspaces: [...workspaces, workspace] });
    setWorkspaceName(''); setShowWorkspace(false);
  };
  const progressPercent = indexingProgress && indexingProgress.totalToIndex > 0 ? Math.min(100, Math.round(indexingProgress.indexedFiles / indexingProgress.totalToIndex * 100)) : 0;

  return (
    <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-2 space-y-2 shrink-0">
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1 min-w-0 flex items-center">
          <FolderGit2 className="w-3.5 h-3.5 text-[var(--accent-text)] absolute left-2.5 pointer-events-none" />
          <Select aria-label="Active repository or local source" value={activeRepositoryId ?? ''} onChange={(event) => void selectRepository(event.target.value || null)} className="w-full pl-8 pr-2 font-medium truncate">
            {repositories.length === 0 ? <option value="">No source indexed yet</option> : repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.fullName}{repo.ref ? ` @ ${repo.ref}` : ''}{repo.scopePath ? ` / ${repo.scopePath}` : ''} ({repo.indexedFileCount})</option>)}
          </Select>
        </div>
        <IconButton size="sm" onClick={() => setShowWorkspace((value) => !value)} title="Multi-repository workspace" aria-label="Multi-repository workspace" active={workspaceRepositoryIds.length > 1}><Layers3 className="w-4 h-4" /></IconButton>
        <Button size="sm" variant="ghost" onClick={() => setShowAddForm((value) => !value)} title="Add source" aria-label="Add repository or local source"><Plus className="w-4 h-4" /></Button>
        <IconButton size="sm" onClick={() => activeRepo && void addAndIndexRepository(activeRepo.url)} disabled={!activeRepo || isIndexing || (activeRepo?.source ?? 'github') !== 'github'} title="Sync GitHub snapshot" aria-label="Sync GitHub snapshot"><RefreshCw className={`w-3.5 h-3.5 ${isIndexing ? 'animate-spin' : ''}`} /></IconButton>
        <IconButton size="sm" tone="danger" onClick={() => activeRepo && void removeRepository(activeRepo.id)} disabled={!activeRepo || isIndexing} title="Remove source" aria-label="Remove active source"><Trash2 className="w-3.5 h-3.5" /></IconButton>
      </div>
      {activeRepo && <div className="flex items-center gap-1.5 flex-wrap">
        <StatusDot tone={activeRepo.indexingStatus === 'ready' ? 'success' : activeRepo.indexingStatus === 'error' ? 'danger' : 'warning'} />
        <Badge tone={(activeRepo.source ?? 'github') === 'github' ? 'neutral' : 'success'}>{activeRepo.source ?? 'github'}</Badge>
        <span className="inline-flex items-center gap-1 text-[10.5px] text-[var(--text-muted)] min-w-0"><GitBranch className="w-3 h-3" /><span className="truncate font-mono">{activeRepo.ref ?? activeRepo.defaultBranch} · {activeRepo.commitSha.slice(0, 8)}</span></span>
        <span className="text-[10.5px] text-[var(--text-muted)] ml-auto">{activeRepo.indexedFileCount} indexed · {activeRepo.skippedFileCount} skipped</span>
        {activeRepo.indexingStatus === 'cancelled' && <Button size="xs" onClick={() => void resumeIndexing(activeRepo.id)}>Resume</Button>}
      </div>}
      {activeRepo?.scopePath && <div className="text-[10px] text-[var(--text-muted)] truncate">Scoped index: <code>{activeRepo.scopePath}</code></div>}
      {showWorkspace && <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5 space-y-2">
        <h3 className="m-0 text-[11.5px] font-medium flex items-center gap-1.5"><Layers3 className="w-3.5 h-3.5 text-[var(--accent-text)]" /> Query multiple sources together</h3>
        <div className="max-h-32 overflow-auto space-y-1">{repositories.map((repo) => <label key={repo.id} className="flex items-center gap-2 text-[10.5px] cursor-pointer"><input type="checkbox" checked={workspaceRepositoryIds.includes(repo.id)} onChange={() => setWorkspaceRepositories(workspaceRepositoryIds.includes(repo.id) ? workspaceRepositoryIds.filter((id) => id !== repo.id) : [...workspaceRepositoryIds, repo.id])} /><span className="truncate">{repo.fullName} @ {repo.ref ?? repo.defaultBranch}</span></label>)}</div>
        <form onSubmit={(event) => void saveWorkspace(event)} className="flex gap-1.5"><Input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Save workspace as…" aria-label="Workspace name" /><Button size="xs" type="submit" disabled={!workspaceName.trim() || !workspaceRepositoryIds.length}>Save</Button></form>
        {workspaces.length > 0 && <div className="flex gap-1"><Select className="flex-1" aria-label="Load saved workspace" value={selectedWorkspaceId} onChange={(event) => { setSelectedWorkspaceId(event.target.value); const workspace = workspaces.find((item) => item.id === event.target.value); if (workspace) setWorkspaceRepositories(workspace.repositoryIds); }}><option value="">Load saved workspace…</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</Select><IconButton size="xs" tone="danger" aria-label="Delete saved workspace" title="Delete saved workspace" disabled={!selectedWorkspaceId} onClick={() => { void deleteWorkspace(selectedWorkspaceId).then(() => { useAppStore.setState({ workspaces: workspaces.filter((item) => item.id !== selectedWorkspaceId) }); setSelectedWorkspaceId(''); }); }}><Trash2 className="w-3 h-3" /></IconButton></div>}
      </div>}
      {showAddForm && <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5 space-y-2.5">
        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-2">
          <div className="flex items-center justify-between"><span className="text-[11.5px] font-medium">Add GitHub snapshot</span><IconButton size="xs" onClick={() => setShowAddForm(false)} aria-label="Close add source form"><X className="w-3 h-3" /></IconButton></div>
          <div className="flex gap-1.5"><div className="relative flex-1"><Globe className="absolute left-2.5 top-2 w-3.5 h-3.5 text-[var(--text-muted)]" /><Input className="pl-8" value={urlInput} onChange={(event) => setUrlInput(event.target.value)} placeholder="owner/repo or branch/file URL" aria-label="GitHub repository URL" /></div><Button type="submit" size="sm" variant="primary" disabled={isIndexing || !urlInput.trim()}>Index</Button></div>
          <Button type="button" size="xs" variant="ghost" onClick={() => void handleIndexCurrentTab()} disabled={isIndexing}><Globe className="w-3 h-3" /> Index active GitHub tab</Button>
        </form>
        <div className="border-t border-[var(--border-subtle)] pt-2"><p className="m-0 mb-2 text-[10.5px] text-[var(--text-muted)]">Or explore code without GitHub. Files are read locally and never uploaded.</p><div className="flex gap-2"><Button size="xs" onClick={() => void handleFolder()} disabled={localImporting || isIndexing}>{localImporting ? <LoaderCircle className="w-3 h-3 animate-spin" /> : <FolderOpen className="w-3 h-3" />} Local folder</Button><Button size="xs" onClick={() => zipInputRef.current?.click()} disabled={localImporting || isIndexing}><FileArchive className="w-3 h-3" /> Import ZIP</Button><input ref={zipInputRef} type="file" accept=".zip,application/zip" className="hidden" aria-label="Choose ZIP archive" onChange={(event) => void handleZip(event.target.files?.[0])} /></div></div>
      </div>}
      {tabNotice && <AlertBanner tone="warning">{tabNotice}</AlertBanner>}
      {isIndexing && indexingProgress && <div className="space-y-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2">
        <div className="flex items-center justify-between gap-2 text-[11px]"><span className="truncate flex items-center gap-1.5"><LoaderCircle className="w-3 h-3 animate-spin text-[var(--accent-text)]" />{indexingProgress.message}</span><IconButton size="xs" tone="danger" onClick={cancelIndexing} title="Pause indexing" aria-label="Pause indexing"><Square className="w-2.5 h-2.5" /></IconButton></div>
        <div className="h-1 rounded-full bg-[var(--bg-elevated)] overflow-hidden"><div className="h-full bg-[var(--accent-text)] transition-all" style={{ width: `${progressPercent}%` }} /></div>
        <div className="flex justify-between text-[10px] text-[var(--text-muted)]"><span className="truncate font-mono">{indexingProgress.currentFile ?? indexingProgress.phase}</span><span>{indexingProgress.indexedFiles}/{indexingProgress.totalToIndex || '?'} · {progressPercent}%</span></div>
      </div>}
      {!isIndexing && indexingProgress?.phase === 'error' && indexingProgress.error && <AlertBanner tone="danger" icon={<AlertCircle className="w-3.5 h-3.5" />}>{indexingProgress.error}</AlertBanner>}
    </div>
  );
};
