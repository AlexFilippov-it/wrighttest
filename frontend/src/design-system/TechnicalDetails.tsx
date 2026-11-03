import type { ReactNode } from 'react';
import { Collapse } from 'antd';

type TechnicalDetailsProps = {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

export default function TechnicalDetails({ title, children, defaultOpen, className }: TechnicalDetailsProps) {
  return (
    <Collapse
      className={['wt-technical-details', className].filter(Boolean).join(' ')}
      defaultActiveKey={defaultOpen ? ['details'] : undefined}
      items={[{ key: 'details', label: title, children }]}
    />
  );
}
