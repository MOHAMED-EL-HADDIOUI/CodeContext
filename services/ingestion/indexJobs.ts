import type { IndexingProgress, IndexJob } from '../../types';
import { db } from '../storage/db';

const activeJobs = new Map<string, AbortController>();

export async function saveIndexProgress(progress: IndexingProgress): Promise<void> {
  const job = await db.indexJobs.where('repositoryId').equals(progress.repositoryId).first();
  if (!job) return;
  await db.indexJobs.update(job.id, {
    status: progress.phase === 'cancelled' ? 'cancelled' : progress.phase === 'error' ? 'error' : ['ready', 'partial'].includes(progress.phase) ? 'completed' : 'running',
    phase: progress.phase,
    processedFiles: progress.indexedFiles,
    skippedFiles: progress.skippedFiles,
    error: progress.error,
    updatedAt: Date.now(),
  });
}

export function getIndexJobController(jobId: string): AbortController {
  const existing = activeJobs.get(jobId);
  if (existing) return existing;
  const controller = new AbortController();
  activeJobs.set(jobId, controller);
  return controller;
}

export function cancelIndexJob(jobId: string): void {
  activeJobs.get(jobId)?.abort();
}

export function removeIndexJobController(jobId: string): void {
  activeJobs.delete(jobId);
}

export async function getLatestIndexJob(repositoryId: string): Promise<IndexJob | undefined> {
  return db.indexJobs.where('repositoryId').equals(repositoryId).reverse().sortBy('updatedAt').then((jobs) => jobs[0]);
}

export async function recoverInterruptedJobs(): Promise<IndexJob[]> {
  const jobs = await db.indexJobs.where('status').anyOf('queued', 'running').toArray();
  const now = Date.now();
  for (const job of jobs) {
    await db.indexJobs.update(job.id, { status: 'paused', phase: 'cancelled', updatedAt: now });
    await db.repositories.update(job.repositoryId, {
      indexingStatus: 'cancelled',
      indexingError: 'Indexing was interrupted. Resume to index only the remaining files.',
      updatedAt: now,
    });
  }
  return jobs;
}
