import type { ReactNode } from 'react';
import type { MenuProps } from 'antd';
import { Button, Dropdown } from 'antd';
import { MoreOutlined } from '@ant-design/icons';

type TableActionsProps = {
  children?: ReactNode;
  menu?: MenuProps;
  moreLabel?: string;
  className?: string;
};

export default function TableActions({ children, menu, moreLabel, className }: TableActionsProps) {
  return (
    <div className={['wt-table-actions', className].filter(Boolean).join(' ')}>
      {children}
      {menu ? (
        <Dropdown menu={menu} trigger={['click']} placement="bottomRight">
          <Button aria-label={moreLabel} icon={<MoreOutlined />} />
        </Dropdown>
      ) : null}
    </div>
  );
}
