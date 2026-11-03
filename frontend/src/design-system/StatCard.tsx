import { useId, type CSSProperties, type ReactNode } from 'react';
import { Card, Skeleton } from 'antd';

type StatCardProps = {
  title: ReactNode;
  value: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  status?: ReactNode;
  loading?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
  valueStyle?: CSSProperties;
};

export default function StatCard({
  title,
  value,
  description,
  meta,
  status,
  loading = false,
  onClick,
  ariaLabel,
  className,
  valueStyle
}: StatCardProps) {
  const descriptionId = useId();
  const supportingText = description ?? meta;

  return (
    <Card
      className={['wt-stat-card', onClick ? 'wt-stat-card--interactive' : '', className].filter(Boolean).join(' ')}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={ariaLabel}
      aria-describedby={supportingText ? descriptionId : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      } : undefined}
    >
      <div className="wt-stat-card__title">{title}</div>
      {loading ? (
        <Skeleton active title={false} paragraph={{ rows: 2, width: ['38%', '72%'] }} />
      ) : (
        <>
          <div className="wt-stat-card__value" style={valueStyle}>{value}</div>
          {supportingText || status ? (
            <div className="wt-stat-card__footer">
              {supportingText ? <div className="wt-stat-card__description" id={descriptionId}>{supportingText}</div> : null}
              {status ? <div className="wt-stat-card__status">{status}</div> : null}
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
