import type { ReactElement, ReactNode } from 'react';
import { Popconfirm } from 'antd';

type ConfirmActionProps = {
  children: ReactElement;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
};

export default function ConfirmAction({
  children,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = true,
  disabled,
  onConfirm
}: ConfirmActionProps) {
  return (
    <Popconfirm
      title={title}
      description={description}
      okText={confirmLabel}
      cancelText={cancelLabel}
      okButtonProps={{ danger }}
      disabled={disabled}
      onConfirm={onConfirm}
    >
      {children}
    </Popconfirm>
  );
}
