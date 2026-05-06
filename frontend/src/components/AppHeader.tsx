import { Layout, Space, Typography } from 'antd';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import appLogo from '../assets/wrighttest_logo.png';
import { APP_DESCRIPTION, APP_NAME } from '../utils/appMeta';

const { Header } = Layout;
const { Title, Text } = Typography;

type AppHeaderProps = {
  actions?: ReactNode;
};

export default function AppHeader({ actions }: AppHeaderProps) {
  const location = useLocation();

  const navItems = [
    {
      label: 'Dashboard',
      to: '/dashboard',
      active: location.pathname === '/dashboard'
    },
    {
      label: 'Projects',
      to: '/projects',
      active:
        location.pathname === '/projects' ||
        location.pathname.startsWith('/projects/') ||
        location.pathname.startsWith('/tests/')
    },
    {
      label: 'Runs',
      to: '/runs',
      active: location.pathname === '/runs' || location.pathname.startsWith('/runs/')
    }
  ];

  return (
    <Header
      style={{
        background: 'rgba(15, 23, 42, 0.92)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 24,
        flexWrap: 'wrap',
        minHeight: 72,
        paddingInline: 24
      }}
    >
      <Link
        to="/dashboard"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          minWidth: 0,
          textDecoration: 'none'
        }}
      >
        <img
          src={appLogo}
          alt={`${APP_NAME} logo`}
          style={{ width: 34, height: 34, flexShrink: 0, objectFit: 'contain' }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 }}>
          <Title level={4} style={{ color: '#fff', margin: 0, lineHeight: 1.05 }}>
            {APP_NAME}
          </Title>
          <Text style={{ color: 'rgba(255,255,255,0.72)', lineHeight: 1.1 }}>
            {APP_DESCRIPTION}
          </Text>
        </div>
      </Link>

      <Space wrap size={16} style={{ flex: '1 1 320px', justifyContent: 'center' }}>
        {navItems.map((item) => {
          const active = item.active;
          return (
            <Link
              key={item.to}
              to={item.to}
              style={{
                color: '#fff',
                opacity: active ? 1 : 0.74,
                fontWeight: active ? 600 : 500,
                padding: '8px 14px',
                borderRadius: 999,
                background: active ? 'rgba(255,255,255,0.14)' : 'transparent',
                transition: 'background 0.2s ease, opacity 0.2s ease',
                textDecoration: 'none'
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </Space>

      {actions ? <Space wrap style={{ justifyContent: 'flex-end' }}>{actions}</Space> : null}
    </Header>
  );
}
