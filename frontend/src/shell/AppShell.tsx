import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Drawer, Layout, Select, Tooltip, Typography } from 'antd';
import {
  AppstoreOutlined,
  DashboardOutlined,
  FolderOpenOutlined,
  LeftOutlined,
  MenuOutlined,
  PlayCircleOutlined,
  RightOutlined
} from '@ant-design/icons';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { getProjects } from '../api/client';
import appLogo from '../assets/wrighttest_logo.png';
import UserMenu from '../components/UserMenu';
import { useAuth } from '../context/AuthContext';
import type { ProjectSummary } from '../types';
import { APP_DESCRIPTION, APP_NAME } from '../utils/appMeta';
import { AppShellProvider } from './ShellContext';
import type { AppShellProject } from './ShellContext';
import { projectConfigurationNavigation, projectMainNavigation } from './projectNavigation';
import './shell.css';

const { Sider, Content } = Layout;
const { Text, Title } = Typography;
const SIDEBAR_STORAGE_KEY = 'wt_sidebar_collapsed';

function readCachedProjects(cacheKey: string) {
  try {
    const value = window.sessionStorage.getItem(cacheKey);
    return value ? JSON.parse(value) as ProjectSummary[] : [];
  } catch {
    return [];
  }
}

export default function AppShell() {
  const navigate = useNavigate();
  const { email } = useAuth();
  const projectsCacheKey = `wt_projects:${email ?? 'anonymous'}`;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [project, setProject] = useState<AppShellProject | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>(() => readCachedProjects(projectsCacheKey));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true'
  );

  useEffect(() => {
    const cachedProjects = readCachedProjects(projectsCacheKey);
    if (cachedProjects.length > 0) {
      setProjects(cachedProjects);
      return;
    }

    let cancelled = false;
    void getProjects()
      .then((availableProjects) => {
        if (!cancelled) {
          setProjects(availableProjects);
          window.sessionStorage.setItem(projectsCacheKey, JSON.stringify(availableProjects));
        }
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectsCacheKey]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const projectOptions = useMemo(() => {
    const options = projects.map((availableProject) => ({
      id: availableProject.id,
      name: availableProject.name
    }));
    if (project) {
      const currentIndex = options.findIndex((option) => option.id === project.id);
      if (currentIndex === -1) {
        options.unshift({ id: project.id, name: project.name });
      } else {
        options[currentIndex] = { id: project.id, name: project.name };
      }
    }
    return options;
  }, [project, projects]);

  const visibleConfiguration = projectConfigurationNavigation.filter(
    (item) => !item.ownerOnly || project?.role === 'OWNER'
  );

  const openProject = (projectId: string) => {
    navigate(`/projects/${projectId}/checks`);
    setDrawerOpen(false);
  };

  const renderProjectSwitcher = (compact: boolean) => {
    if (compact) {
      return project ? (
        <Tooltip title={project.name} placement="right">
          <Link
            to={`/projects/${project.id}/checks`}
            className="wt-app-shell__compact-project"
            aria-label={`Current project: ${project.name}`}
          >
            <AppstoreOutlined />
          </Link>
        </Tooltip>
      ) : null;
    }

    return (
      <div className="wt-app-shell__project-switcher">
        <Text type="secondary">{project ? 'Current project' : 'Open project'}</Text>
        <Select
          aria-label="Switch project"
          value={project?.id}
          placeholder="Select a project"
          onChange={openProject}
          options={projectOptions.map((option) => ({
            value: option.id,
            label: (
              <Tooltip title={option.name} placement="right">
                <span className="wt-app-shell__project-option">{option.name}</span>
              </Tooltip>
            )
          }))}
          notFoundContent="No projects available"
        />
        {project?.role ? <span className="wt-app-shell__role">{project.role.toLowerCase()}</span> : null}
      </div>
    );
  };

  const renderSidebar = (compact: boolean) => (
    <div className={compact ? 'wt-app-shell__sidebar-content wt-app-shell__sidebar-content--compact' : 'wt-app-shell__sidebar-content'}>
      <Tooltip title={compact ? APP_NAME : undefined} placement="right">
        <Link to="/dashboard" className="wt-app-shell__brand" onClick={() => setDrawerOpen(false)}>
          <img src={appLogo} alt={`${APP_NAME} logo`} />
          {!compact ? (
            <span>
              <strong>{APP_NAME}</strong>
              <small>{APP_DESCRIPTION}</small>
            </span>
          ) : null}
        </Link>
      </Tooltip>

      {project ? (
        <>
          {renderProjectSwitcher(compact)}
          <nav aria-label="Project navigation" className="wt-shell-navigation">
            <ShellNavLink compact={compact} to="/projects" label="All projects" icon={<FolderOpenOutlined />} end onNavigate={() => setDrawerOpen(false)} />
            <NavigationGroup compact={compact} title="Project">
              {projectMainNavigation.map((item) => (
                <ShellNavLink
                  key={item.key}
                  compact={compact}
                  to={`/projects/${project.id}/${item.key}`}
                  label={item.label}
                  icon={item.icon}
                  onNavigate={() => setDrawerOpen(false)}
                />
              ))}
            </NavigationGroup>
            <NavigationGroup compact={compact} title="Configuration">
              {visibleConfiguration.map((item) => (
                <ShellNavLink
                  key={item.key}
                  compact={compact}
                  to={`/projects/${project.id}/${item.key}`}
                  label={item.label}
                  icon={item.icon}
                  onNavigate={() => setDrawerOpen(false)}
                />
              ))}
            </NavigationGroup>
            <NavigationGroup compact={compact} title="Workspace">
              <ShellNavLink compact={compact} to="/dashboard" label="Dashboard" icon={<DashboardOutlined />} end onNavigate={() => setDrawerOpen(false)} />
              <ShellNavLink compact={compact} to="/runs" label="All Runs" icon={<PlayCircleOutlined />} end onNavigate={() => setDrawerOpen(false)} />
            </NavigationGroup>
          </nav>
        </>
      ) : (
        <>
          <nav aria-label="Primary navigation" className="wt-shell-navigation">
            <ShellNavLink compact={compact} to="/dashboard" label="Dashboard" icon={<DashboardOutlined />} end onNavigate={() => setDrawerOpen(false)} />
            <ShellNavLink compact={compact} to="/projects" label="Projects" icon={<FolderOpenOutlined />} end onNavigate={() => setDrawerOpen(false)} />
            <ShellNavLink compact={compact} to="/runs" label="All Runs" icon={<PlayCircleOutlined />} end onNavigate={() => setDrawerOpen(false)} />
          </nav>
          {projectOptions.length > 0 ? renderProjectSwitcher(compact) : null}
        </>
      )}

      <div className="wt-app-shell__account">
        <Button
          className="wt-app-shell__collapse"
          type="text"
          icon={compact ? <RightOutlined /> : <LeftOutlined />}
          aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setSidebarCollapsed((current) => !current)}
        >
          {compact ? null : 'Collapse sidebar'}
        </Button>
        <UserMenu tone="light" compact={compact} />
      </div>
    </div>
  );

  return (
    <AppShellProvider value={{ project, setProject }}>
      <Layout className={sidebarCollapsed ? 'wt-app-shell wt-app-shell--collapsed' : 'wt-app-shell'}>
        <Sider
          className="wt-app-shell__sider"
          width={240}
          collapsedWidth={72}
          collapsed={sidebarCollapsed}
          trigger={null}
          theme="light"
        >
          {renderSidebar(sidebarCollapsed)}
        </Sider>

        <Drawer
          className="wt-app-shell__drawer"
          placement="left"
          size={280}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          styles={{ body: { padding: 0 } }}
          title={null}
        >
          {renderSidebar(false)}
        </Drawer>

        <Layout className="wt-app-shell__main">
          <header className="wt-app-shell__mobile-header">
            <Button type="text" icon={<MenuOutlined />} aria-label="Open navigation" onClick={() => setDrawerOpen(true)} />
            <Link to="/dashboard" className="wt-app-shell__mobile-brand">
              <img src={appLogo} alt="" />
              <Title level={5}>{APP_NAME}</Title>
            </Link>
            <UserMenu tone="light" compact />
          </header>
          <Content className="wt-app-shell__content">
            <Outlet />
          </Content>
        </Layout>
      </Layout>
    </AppShellProvider>
  );
}

function NavigationGroup({ compact, title, children }: { compact: boolean; title: string; children: ReactNode }) {
  return (
    <section className="wt-shell-navigation__group">
      {!compact ? <Text type="secondary">{title}</Text> : null}
      {children}
    </section>
  );
}

function ShellNavLink({
  compact,
  to,
  label,
  icon,
  end,
  onNavigate
}: {
  compact: boolean;
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  onNavigate: () => void;
}) {
  return (
    <Tooltip title={compact ? label : undefined} placement="right">
      <NavLink to={to} end={end} className="wt-shell-navigation__link" onClick={onNavigate}>
        <span className="wt-shell-navigation__icon" aria-hidden="true">{icon}</span>
        {!compact ? <span className="wt-shell-navigation__label">{label}</span> : null}
      </NavLink>
    </Tooltip>
  );
}
