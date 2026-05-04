import { Layout, Space, Typography } from 'antd';
import type { ReactNode } from 'react';

const { Header } = Layout;
const { Title, Text } = Typography;

type AppHeaderProps = {
  actions?: ReactNode;
};

export default function AppHeader({ actions }: AppHeaderProps) {
  return (
    <Header style={{ background: 'rgba(15, 23, 42, 0.92)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 }}>
        <Title level={4} style={{ color: '#fff', margin: 0, lineHeight: 1.1 }}>
          WrightTest
        </Title>
        <Text style={{ color: 'rgba(255,255,255,0.72)', lineHeight: 1.1 }}>
          UI Test Automation Platform
        </Text>
      </div>
      {actions ? <Space wrap>{actions}</Space> : null}
    </Header>
  );
}
