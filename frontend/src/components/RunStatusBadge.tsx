import { Badge, Tag } from 'antd';
import type { RunStatus } from '../types';

const config: Record<RunStatus, { color: string; label: string }> = {
  PENDING: { color: 'default', label: 'Pending' },
  RUNNING: { color: 'processing', label: 'Running' },
  PASSED: { color: 'success', label: 'Passed' },
  FAILED: { color: 'error', label: 'Failed' }
};

export default function RunStatusBadge({ status }: { status: RunStatus }) {
  const { color, label } = config[status];

  return <Badge status={color as any} text={<Tag color={color}>{label}</Tag>} />;
}
