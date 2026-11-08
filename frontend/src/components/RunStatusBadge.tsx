import { useTranslation } from 'react-i18next';
import type { RunStatus } from '../types';
import StatusBadge, { type StatusTone } from '../design-system/StatusBadge';

export default function RunStatusBadge({ status }: { status: RunStatus }) {
  const { t } = useTranslation();
  const config: Record<RunStatus, { tone: StatusTone; label: string }> = {
    PENDING: { tone: 'pending', label: t('status.pending') },
    RUNNING: { tone: 'running', label: t('status.running') },
    PASSED: { tone: 'passed', label: t('common.passed') },
    FAILED: { tone: 'failed', label: t('common.failed') }
  };
  const { tone, label } = config[status];

  return <StatusBadge status={status} tone={tone} label={label} />;
}
