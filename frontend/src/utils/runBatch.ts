import type { RunStatus, TestRunBatch } from '../types';

export function formatRunBatchDuration(ms?: number | null) {
  if (ms === null || ms === undefined) return '—';
  return `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}s`;
}

export function getRunBatchDurationMs(batch: Pick<TestRunBatch, 'startedAt' | 'finishedAt'>) {
  if (!batch.finishedAt) return null;
  return Math.max(0, new Date(batch.finishedAt).getTime() - new Date(batch.startedAt).getTime());
}

export function getRunBatchSummaryText(batch: Pick<TestRunBatch, 'status' | 'totalCases' | 'completedCases' | 'passedCases' | 'failedCases'>) {
  if (batch.status === 'PENDING' || batch.status === 'RUNNING') {
    return `${batch.completedCases} of ${batch.totalCases} completed`;
  }

  return `${batch.totalCases} cases · ${batch.passedCases} passed · ${batch.failedCases} failed`;
}

export function isRunBatchTerminal(status: RunStatus) {
  return status === 'PASSED' || status === 'FAILED';
}

export function getErrorPreview(error?: string | null, maxLength = 120) {
  if (!error) return 'Failed';
  const firstLine = error.replace(/\r/g, '').split('\n').map((line) => line.trim()).find(Boolean) ?? 'Failed';
  if (firstLine.length <= maxLength) return firstLine;
  return `${firstLine.slice(0, maxLength - 1)}…`;
}
