import type { ReactNode } from 'react';
import {
  BellOutlined,
  DatabaseOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  DashboardOutlined,
  KeyOutlined,
  PlayCircleOutlined,
  SettingOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  WalletOutlined
} from '@ant-design/icons';

export type ProjectNavigationItem = {
  key: string;
  icon: ReactNode;
  ownerOnly?: boolean;
};

export const projectMainNavigation: ProjectNavigationItem[] = [
  { key: 'overview', icon: <DashboardOutlined /> },
  { key: 'checks', icon: <CheckSquareOutlined /> },
  { key: 'suites', icon: <UnorderedListOutlined /> },
  { key: 'runs', icon: <PlayCircleOutlined /> },
  { key: 'schedules', icon: <CalendarOutlined /> }
];

export const projectConfigurationNavigation: ProjectNavigationItem[] = [
  { key: 'environments', icon: <WalletOutlined /> },
  { key: 'authentication', icon: <KeyOutlined /> },
  { key: 'connections', icon: <DatabaseOutlined /> },
  { key: 'alerts', icon: <BellOutlined /> },
  { key: 'settings', icon: <SettingOutlined /> },
  { key: 'members', icon: <TeamOutlined />, ownerOnly: true }
];
