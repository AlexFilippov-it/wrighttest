import type { ReactNode } from 'react';
import {
  BellOutlined,
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
  label: string;
  icon: ReactNode;
  ownerOnly?: boolean;
};

export const projectMainNavigation: ProjectNavigationItem[] = [
  { key: 'overview', label: 'Overview', icon: <DashboardOutlined /> },
  { key: 'checks', label: 'Checks', icon: <CheckSquareOutlined /> },
  { key: 'suites', label: 'Suites', icon: <UnorderedListOutlined /> },
  { key: 'runs', label: 'Runs', icon: <PlayCircleOutlined /> },
  { key: 'schedules', label: 'Schedules', icon: <CalendarOutlined /> }
];

export const projectConfigurationNavigation: ProjectNavigationItem[] = [
  { key: 'environments', label: 'Environments', icon: <WalletOutlined /> },
  { key: 'authentication', label: 'Authentication', icon: <KeyOutlined /> },
  { key: 'alerts', label: 'Alerts', icon: <BellOutlined /> },
  { key: 'settings', label: 'Settings', icon: <SettingOutlined /> },
  { key: 'members', label: 'Members', icon: <TeamOutlined />, ownerOnly: true }
];
