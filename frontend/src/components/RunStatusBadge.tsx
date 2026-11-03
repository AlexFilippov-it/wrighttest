import { useTranslation } from 'react-i18next';
import type { RunStatus } from '../types';
import StatusBadge, { type StatusTone } from '../design-system/StatusBadge';

export default function RunStatusBadge({ status }: { status: RunStatus }) {
  const { t } = useTranslation();
  const config: Record<RunStatus, { tone: StatusTone; label: string }> = {
    PENDING: { tone: 'neutral', label: t('status.pending') },
    RUNNING: { tone: 'info', label: t('status.running') },
    PASSED: { tone: 'success', label: t('common.passed') },
    FAILED: { tone: 'danger', label: t('common.failed') }
  };
  const { tone, label } = config[status];

  return <StatusBadge tone={tone} label={label} />;
}
