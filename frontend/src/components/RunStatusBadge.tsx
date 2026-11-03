import type { RunStatus } from '../types';
import StatusBadge, { type StatusTone } from '../design-system/StatusBadge';

const config: Record<RunStatus, { tone: StatusTone; label: string }> = {
  PENDING: { tone: 'neutral', label: 'Pending' },
  RUNNING: { tone: 'info', label: 'Running' },
  PASSED: { tone: 'success', label: 'Passed' },
  FAILED: { tone: 'danger', label: 'Failed' }
};

export default function RunStatusBadge({ status }: { status: RunStatus }) {
  const { tone, label } = config[status];

  return <StatusBadge tone={tone} label={label} />;
}
