import type { ReactNode } from 'react';
import { Skeleton, Space } from 'antd';

type LoadingStateProps = {
  label?: ReactNode;
  rows?: number;
  className?: string;
};

export default function LoadingState({ label, rows = 3, className }: LoadingStateProps) {
  return (
    <div className={['wt-loading-state', className].filter(Boolean).join(' ')} aria-busy="true" aria-live="polite">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {label ? <span>{label}</span> : null}
        <Skeleton active title paragraph={{ rows }} />
      </Space>
    </div>
  );
}
