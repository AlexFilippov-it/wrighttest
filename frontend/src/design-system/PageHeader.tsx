import type { ReactNode } from 'react';
import { Breadcrumb } from 'antd';
import { Link } from 'react-router-dom';

export type PageHeaderBreadcrumb = {
  key: string;
  label: ReactNode;
  href?: string;
};

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: PageHeaderBreadcrumb[];
  actions?: ReactNode;
  className?: string;
};

export default function PageHeader({ title, description, breadcrumbs, actions, className }: PageHeaderProps) {
  return (
    <header className={['wt-page-header', className].filter(Boolean).join(' ')}>
      <div className="wt-page-header__content">
        {breadcrumbs?.length ? (
          <Breadcrumb
            items={breadcrumbs.map((item) => ({
              key: item.key,
              title: item.href ? <Link to={item.href}>{item.label}</Link> : item.label
            }))}
          />
        ) : null}
        <h1 className="wt-page-header__title">{title}</h1>
        {description ? <p className="wt-page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="wt-page-header__actions">{actions}</div> : null}
    </header>
  );
}
