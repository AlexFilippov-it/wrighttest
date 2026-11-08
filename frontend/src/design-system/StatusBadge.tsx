import type { ReactNode } from 'react';
import { Tag } from 'antd';

export type StatusTone =
  | 'neutral' | 'info' | 'success' | 'warning' | 'danger'
  | 'passed' | 'failed' | 'running' | 'pending' | 'cancelled' | 'skipped' | 'queued' | 'timed-out';

type StatusBadgeProps = {
  label: ReactNode;
  tone?: StatusTone;
  status?: string;
  icon?: ReactNode;
  className?: string;
};

const STATUS_TONES: Record<string, StatusTone> = {
  PASSED: 'passed', PASS: 'passed', SUCCEEDED: 'passed',
  FAILED: 'failed', FAILURE: 'failed', ERROR: 'failed',
  RUNNING: 'running', IN_PROGRESS: 'running',
  PENDING: 'pending', QUEUED: 'queued', WAITING: 'pending',
  CANCELLED: 'cancelled', CANCELED: 'cancelled',
  SKIPPED: 'skipped',
  TIMED_OUT: 'timed-out', TIMEOUT: 'timed-out'
};

export default function StatusBadge({ label, tone = 'neutral', status, icon, className }: StatusBadgeProps) {
  const resolvedTone = status ? (STATUS_TONES[status.toUpperCase()] ?? tone) : tone;
  return (
    <Tag className={['wt-status-badge', `wt-status-badge--${resolvedTone}`, className].filter(Boolean).join(' ')} icon={icon}>
      {label}
    </Tag>
  );
}
