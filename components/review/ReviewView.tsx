import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, ExternalLink, FileDiff, GitCommit, GitPullRequest, LoaderCircle, Play, ShieldCheck } from 'lucide-react';
import type { ChangeSet, ChangeSetFile, ReviewReport, RetrievalStage } from '../../types';
import { parsePatchHunks, loadGitHubChangeSet } from '../../services/github/changes';
import { GitHubClient } from '../../services/github/client';
import { getGitHubToken, getAIApiKey } from '../../services/storage/credentials';
import { generateChangeReview, buildChangeReviewPreview, type PreparedChangeReview } from '../../features/review/changeReview';
import { db } from '../../services/storage/db';
import { useAppStore } from '../../stores/useAppStore';
import { AlertBanner, Badge, Button, EmptyState, Input } from '../common/UIPrimitives';
import { downloadTextFile } from '../../features/investigations/notebooks';
import { AI_PROVIDER_PRESETS } from '../../services/ai/types';

export const ReviewView: React.FC = () => {
  const { settings, repositories, openFileInViewer } = useAppStore();
  const [url, setUrl] = useState('');
  const [changeSet, setChangeSet] = useState<ChangeSet | null>(null);
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<RetrievalStage[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [preview, setPreview] = useState<PreparedChangeReview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  useEffect(() => {
    let current = true;
    if (!changeSet) { setPreview(null); return; }
    setPreviewLoading(true);
    void buildChangeReviewPreview(changeSet, settings.ai).then((result) => { if (current) setPreview(result); }).catch((err) => { if (current) setError(err instanceof Error ? err.message : 'Could not prepare review context.'); }).finally(() => { if (current) setPreviewLoading(false); });
    return () => { current = false; };
  }, [changeSet, settings.ai]);

  const load = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setError(null); setReport(null); setLoading(true);
    try {
      const loaded = await loadGitHubChangeSet(new GitHubClient({ token: await getGitHubToken() }), url);
      await db.changeSets.put(loaded);
      setChangeSet(loaded);
      setExpanded(new Set(loaded.files.slice(0, 1).map((file) => file.path)));
      const previous = await db.reviewReports.where('changeSetId').equals(loaded.id).reverse().sortBy('createdAt');
      setReport(previous[0] ?? null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load change.'); }
    finally { setLoading(false); }
  };

  const review = async (allowTransmission = false) => {
    if (!changeSet) return;
    if (!settings.ai.consentGiven && !allowTransmission) { setShowPrivacy(true); return; }
    if (allowTransmission && !settings.ai.consentGiven) {
      await useAppStore.getState().updateAppSettings((current) => ({ ...current, ai: { ...current.ai, consentGiven: true } }));
    }
    setReviewing(true); setError(null);
    try {
      const result = await generateChangeReview({
        changeSet, aiConfig: settings.ai, apiKey: await getAIApiKey(settings.ai.provider),
        onProgress: (progress) => setStages(progress.stages),
      });
      setReport(result);
    } catch (err) { setError(err instanceof Error ? err.message : 'Review failed.'); }
    finally { setReviewing(false); }
  };

  const exportReview = () => {
    if (!changeSet || !report) return;
    const comments = report.comments.map((comment) => `### ${comment.severity.toUpperCase()} · ${comment.title}\n\n\`${comment.filePath}:${comment.startLine}-${comment.endLine}\`\n\n${comment.body}\n\n${comment.citation?.githubUrl ?? ''}`).join('\n\n');
    downloadTextFile(`# ${changeSet.title}\n\nBase: ${changeSet.baseSha}\n\nHead: ${changeSet.headSha}\n\n${report.summary}\n\n${comments || 'No material findings.'}`, `${changeSet.title}-review.md`);
  };

  return (
    <div className="h-full overflow-auto">
      <div className="px-3 py-3 border-b border-[var(--border-subtle)]">
        <h2 className="m-0 text-[14px] font-semibold flex items-center gap-1.5"><GitPullRequest className="w-4 h-4 text-[var(--accent-text)]" /> Change review</h2>
        <p className="m-0 mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">Review actual diffs with findings verified against added lines.</p>
      </div>
      <div className="p-3 space-y-3">
        <form onSubmit={(event) => void load(event)} className="space-y-2">
          <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/repo/pull/123" aria-label="GitHub pull request, commit, or compare URL" />
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary" disabled={loading || !url.trim()}>{loading ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <FileDiff className="w-3.5 h-3.5" />} Load diff</Button>
            <Button type="button" size="sm" onClick={() => { const repo = repositories.find((item) => (item.source ?? 'github') === 'github'); if (repo) setUrl(`${repo.url.replace(/\/$/, '')}/pull/`); }}>From repository</Button>
          </div>
        </form>
        {error && <AlertBanner tone="danger">{error}</AlertBanner>}
        {showPrivacy && preview && (
          <div className="rounded-xl border border-[var(--warning-border)] bg-[var(--warning-soft)] p-3 space-y-2">
            <h3 className="m-0 text-[12px] font-semibold flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> Review data transmission</h3>
            <p className="m-0 text-[11px] leading-relaxed text-[var(--text-secondary)]">Changed hunks from {preview.includedFiles}/{changeSet?.files.length ?? 0} files (about {preview.tokens.toLocaleString()} tokens including related context) will be sent to {settings.ai.model} at {settings.ai.baseUrl || AI_PROVIDER_PRESETS[settings.ai.provider].defaultBaseUrl}.</p>
            {preview.relatedFiles.length > 0 && <p className="m-0 font-mono text-[10px] text-[var(--text-secondary)]">Related source: {preview.relatedFiles.join(', ')}</p>}
            {preview.relatedRevision && <p className="m-0 text-[10.5px]">Related indexed source is from revision {preview.relatedRevision.slice(0, 10)}, not the review head.</p>}
            <p className="m-0 text-[10.5px] text-[var(--text-muted)]">No credentials are included.</p>
            <details className="text-[10.5px]"><summary className="inline cursor-pointer text-[var(--accent-text)]">View exact payload</summary><pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--bg-code)] p-2 text-[10px]">{preview.prompt}</pre></details>
            <div className="flex gap-2">
              <Button size="xs" variant="primary" onClick={() => { setShowPrivacy(false); void review(true); }}>Allow and review</Button>
              <Button size="xs" onClick={() => setShowPrivacy(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {changeSet && (
          <>
            <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 space-y-2.5">
              <div className="flex items-start gap-2">
                {changeSet.kind === 'commit' ? <GitCommit className="mt-0.5 w-4 h-4 shrink-0 text-[var(--accent-text)]" /> : <GitPullRequest className="mt-0.5 w-4 h-4 shrink-0 text-[var(--accent-text)]" />}
                <div className="min-w-0 flex-1"><a href={changeSet.url} target="_blank" rel="noopener noreferrer" className="block text-[12.5px] font-medium leading-snug hover:text-[var(--accent-text)]">{changeSet.title}</a><span className="mt-1 block font-mono text-[10px] text-[var(--text-muted)]">{changeSet.baseRef} → {changeSet.headRef}</span></div>
              </div>
              <div className="flex flex-wrap gap-1.5"><Badge tone="neutral">{changeSet.files.length} files</Badge><Badge tone="success">+{changeSet.additions}</Badge><Badge tone="danger">−{changeSet.deletions}</Badge><Badge tone="neutral">base {changeSet.baseSha.slice(0, 7)}</Badge></div>
              <Button size="sm" variant="primary" className="w-full" disabled={reviewing || previewLoading} onClick={() => void review()}>{reviewing || previewLoading ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} {reviewing ? 'Reviewing changes…' : previewLoading ? 'Preparing exact transmission preview…' : 'Review with AI'}</Button>
            </section>
            {stages.length > 0 && reviewing && <StageList stages={stages} />}
            {report && (
              <section className="space-y-2">
                <div className="rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] p-3">
                  <div className="flex items-center justify-between gap-2"><h3 className="m-0 text-[12.5px] font-semibold">Review report</h3><Button size="xs" onClick={exportReview}><Download className="w-3 h-3" /> Export</Button></div>
                  <p className="mb-0 mt-2 whitespace-pre-wrap text-[11.5px] leading-relaxed text-[var(--text-secondary)]">{report.summary}</p>
                </div>
                {report.comments.map((comment) => (
                  <article key={comment.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5">
                    <div className="flex items-start gap-2"><AlertTriangle className={`mt-0.5 w-3.5 h-3.5 shrink-0 ${comment.severity === 'critical' ? 'text-[var(--danger-text)]' : 'text-[var(--warning-text)]'}`} /><div className="min-w-0 flex-1"><h4 className="m-0 text-[11.5px] font-semibold">{comment.title}</h4><button type="button" className="mt-1 block font-mono text-[10px] text-[var(--accent-text)] cursor-pointer" onClick={() => { const repo = repositories.find((item) => item.id === report.repositoryId); if (repo) void openFileInViewer(repo.id, comment.filePath, comment.startLine, comment.endLine); }}>{comment.filePath}:{comment.startLine}–{comment.endLine}</button></div><Badge tone={comment.severity === 'critical' ? 'danger' : 'warning'}>{comment.severity}</Badge></div>
                    <p className="mb-0 mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--text-secondary)]">{comment.body}</p>
                    {comment.citation?.githubUrl && <a className="mt-2 inline-flex items-center gap-1 text-[10.5px] text-[var(--accent-text)]" href={comment.citation.githubUrl} target="_blank" rel="noopener noreferrer">Verify at {comment.citation.commitSha.slice(0, 7)} <ExternalLink className="w-3 h-3" /></a>}
                  </article>
                ))}
                {!report.comments.length && <div className="rounded-lg border border-[var(--success-border)] bg-[var(--success-soft)] p-3 text-[11px] flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[var(--success-text)]" /> No verified material findings in the supplied diff.</div>}
              </section>
            )}
            <section className="space-y-2">
              <h3 className="m-0 text-[12px] font-semibold">Changed files</h3>
              {changeSet.files.map((file) => <DiffFile key={file.path} file={file} open={expanded.has(file.path)} onToggle={() => setExpanded((current) => { const next = new Set(current); if (next.has(file.path)) next.delete(file.path); else next.add(file.path); return next; })} />)}
            </section>
          </>
        )}
        {!changeSet && !loading && <EmptyState icon={GitPullRequest} title="Understand what changed" description="Paste a PR, commit, or comparison URL. You can inspect the complete diff locally without configuring AI." />}
      </div>
    </div>
  );

};

const StageList: React.FC<{ stages: RetrievalStage[] }> = ({ stages }) => <div className="rounded-lg border border-[var(--border-subtle)] p-2 space-y-1">{stages.map((stage) => <div className="flex items-center gap-2 text-[10.5px] text-[var(--text-muted)]" key={stage.id}>{stage.status === 'active' ? <LoaderCircle className="w-3 h-3 animate-spin text-[var(--accent-text)]" /> : <CheckCircle2 className={`w-3 h-3 ${stage.status === 'complete' ? 'text-[var(--success-text)]' : ''}`} />}<span>{stage.detail}</span></div>)}</div>;

const DiffFile: React.FC<{ file: ChangeSetFile; open: boolean; onToggle: () => void }> = ({ file, open, onToggle }) => {
  const hunks = useMemo(() => parsePatchHunks(file.patch), [file.patch]);
  return <div className="rounded-lg border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-surface)]"><button type="button" onClick={onToggle} className="w-full flex items-center gap-2 p-2.5 text-left cursor-pointer hover:bg-[var(--bg-hover)]">{open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}<span className="min-w-0 flex-1 truncate font-mono text-[10.5px]">{file.path}</span><Badge tone="neutral">{file.status}</Badge><span className="text-[10px] text-[var(--success-text)]">+{file.additions}</span><span className="text-[10px] text-[var(--danger-text)]">−{file.deletions}</span></button>{open && <div className="border-t border-[var(--border-subtle)] overflow-x-auto bg-[var(--bg-code)]">{file.patch ? <pre className="m-0 p-2.5 font-mono text-[10px] leading-relaxed whitespace-pre text-[var(--text-secondary)]">{file.patch.split('\n').map((line, index) => <div key={index} className={line.startsWith('+') ? 'text-[var(--success-text)] bg-[var(--success-soft)]' : line.startsWith('-') ? 'text-[var(--danger-text)] bg-[var(--danger-soft)]' : ''}>{line}</div>)}</pre> : <p className="m-0 p-3 text-[11px] text-[var(--text-muted)]">GitHub did not return a textual patch for this file. {hunks.length} hunks.</p>}</div>}</div>;
};
