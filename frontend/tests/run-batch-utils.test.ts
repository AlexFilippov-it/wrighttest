import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatRunBatchDuration,
  getErrorPreview,
  getRunBatchDurationMs,
  getRunBatchSummaryText,
  isRunBatchTerminal
} from '../src/utils/runBatch';

test('run batch summary text reports running progress', () => {
  assert.equal(getRunBatchSummaryText({
    status: 'RUNNING',
    totalCases: 3,
    completedCases: 1,
    passedCases: 1,
    failedCases: 0
  }), '1 of 3 completed');
});

test('run batch summary text reports passed and failed totals', () => {
  assert.equal(getRunBatchSummaryText({
    status: 'PASSED',
    totalCases: 2,
    completedCases: 2,
    passedCases: 2,
    failedCases: 0
  }), '2 cases · 2 passed · 0 failed');

  assert.equal(getRunBatchSummaryText({
    status: 'FAILED',
    totalCases: 3,
    completedCases: 3,
    passedCases: 2,
    failedCases: 1
  }), '3 cases · 2 passed · 1 failed');
});

test('run batch duration helpers format elapsed time', () => {
  assert.equal(formatRunBatchDuration(undefined), '—');
  assert.equal(formatRunBatchDuration(1250), '1.25s');
  assert.equal(formatRunBatchDuration(12500), '12.5s');
  assert.equal(getRunBatchDurationMs({
    startedAt: '2026-07-15T10:00:00.000Z',
    finishedAt: '2026-07-15T10:00:03.250Z'
  }), 3250);
});

test('terminal status helper identifies when polling should stop', () => {
  assert.equal(isRunBatchTerminal('PENDING'), false);
  assert.equal(isRunBatchTerminal('RUNNING'), false);
  assert.equal(isRunBatchTerminal('PASSED'), true);
  assert.equal(isRunBatchTerminal('FAILED'), true);
});

test('error preview keeps only a short first line', () => {
  assert.equal(getErrorPreview('First failure line\nstack trace'), 'First failure line');
  assert.equal(getErrorPreview('x'.repeat(130), 20), `${'x'.repeat(19)}…`);
});
