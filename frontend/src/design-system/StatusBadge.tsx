import type { ReactNode } from 'react';
import { Tag } from 'antd';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

type StatusBadgeProps = {
  label: ReactNode;
  tone?: StatusTone;
  icon?: ReactNode;
  className?: string;
};

export default function StatusBadge({ label, tone = 'neutral', icon, className }: StatusBadgeProps) {
  return (
    <Tag className={['wt-status-badge', `wt-status-badge--${tone}`, className].filter(Boolean).join(' ')} icon={icon}>
      {label}
    </Tag>
  );
}
