import type { ReactNode } from 'react';
import { Alert, Button } from 'antd';

type ErrorStateProps = {
  title: ReactNode;
  description?: ReactNode;
  retryLabel?: ReactNode;
  onRetry?: () => void;
  className?: string;
};

export default function ErrorState({ title, description, retryLabel, onRetry, className }: ErrorStateProps) {
  return (
    <div className={['wt-error-state', className].filter(Boolean).join(' ')} role="alert">
      <Alert type="error" showIcon message={title} description={description} />
      {onRetry && retryLabel ? (
        <div className="wt-error-state__actions">
          <Button onClick={onRetry}>{retryLabel}</Button>
        </div>
      ) : null}
    </div>
  );
}
