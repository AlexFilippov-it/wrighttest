import type { ComponentProps, ReactNode } from 'react';
import { Card } from 'antd';

type SectionCardProps = Omit<ComponentProps<typeof Card>, 'title'> & {
  title?: ReactNode;
  description?: ReactNode;
};

export default function SectionCard({ title, description, className, children, ...cardProps }: SectionCardProps) {
  const heading = title || description ? (
    <div className="wt-section-card__heading">
      {title ? <span className="wt-section-card__title">{title}</span> : null}
      {description ? <span className="wt-section-card__description">{description}</span> : null}
    </div>
  ) : undefined;

  return (
    <Card className={['wt-section-card', className].filter(Boolean).join(' ')} title={heading} {...cardProps}>
      {children}
    </Card>
  );
}
