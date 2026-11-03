import type { ReactNode } from 'react';
import { Empty } from 'antd';

type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  image?: ReactNode;
  className?: string;
};

export default function EmptyState({ title, description, action, image, className }: EmptyStateProps) {
  return (
    <div className={['wt-empty-state', className].filter(Boolean).join(' ')}>
      <Empty
        image={image ?? Empty.PRESENTED_IMAGE_SIMPLE}
        description={(
          <span className="wt-empty-state__copy">
            <span className="wt-empty-state__title">{title}</span>
            {description ? <span className="wt-empty-state__description">{description}</span> : null}
          </span>
        )}
      >
        {action}
      </Empty>
    </div>
  );
}
