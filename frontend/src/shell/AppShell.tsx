import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Drawer, Layout, Select, Tooltip, Typography } from 'antd';
import {
  AppstoreOutlined,
  DashboardOutlined,
  FolderOpenOutlined,
  LeftOutlined,
  MenuOutlined,
  PlayCircleOutlined,
  RightOutlined,
  TranslationOutlined
} from '@ant-design/icons';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  const { email, isSystemAdmin } = useAuth();
  const { t } = useTranslation();
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
            aria-label={t('nav.currentProjectNamed', { name: project.name })}
          >
            <AppstoreOutlined />
          </Link>
        </Tooltip>
      ) : null;
    }

    return (
      <div className="wt-app-shell__project-switcher">
        <Text type="secondary">{project ? t('nav.currentProject') : t('nav.openProject')}</Text>
        <Select
          aria-label={t('common.switchProject')}
          value={project?.id}
          placeholder={t('nav.selectProject')}
          onChange={openProject}
          options={projectOptions.map((option) => ({
            value: option.id,
            label: (
              <Tooltip title={option.name} placement="right">
                <span className="wt-app-shell__project-option">{option.name}</span>
              </Tooltip>
            )
          }))}
          notFoundContent={t('nav.noProjects')}
        />
        {project?.role ? <span className="wt-app-shell__role">{t(`role.${project.role.toLowerCase()}`)}</span> : null}
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
              <small>{t('brand.description', { defaultValue: APP_DESCRIPTION })}</small>
            </span>
          ) : null}
        </Link>
      </Tooltip>

      {project ? (
        <>
          {renderProjectSwitcher(compact)}
          <nav aria-label={t('nav.project')} className="wt-shell-navigation">
            <ShellNavLink compact={compact} to="/projects" label={t('nav.allProjects')} icon={<FolderOpenOutlined />} end onNavigate={() => setDrawerOpen(false)} />
            <NavigationGroup compact={compact} title={t('nav.project')}>
              {projectMainNavigation.map((item) => (
                <ShellNavLink
                  key={item.key}
                  compact={compact}
                  to={`/projects/${project.id}/${item.key}`}
                  label={t(`project.${item.key}`)}
                  icon={item.icon}
                  onNavigate={() => setDrawerOpen(false)}
                />
              ))}
            </NavigationGroup>
            <NavigationGroup compact={compact} title={t('nav.configuration')}>
              {visibleConfiguration.map((item) => (
                <ShellNavLink
                  key={item.key}
                  compact={compact}
                  to={`/projects/${project.id}/${item.key}`}
                  label={t(`project.${item.key}`)}
                  icon={item.icon}
                  onNavigate={() => setDrawerOpen(false)}
                />
              ))}
            </NavigationGroup>
            <NavigationGroup compact={compact} title={t('nav.workspace')}>
              <ShellNavLink compact={compact} to="/dashboard" label={t('nav.dashboard')} icon={<DashboardOutlined />} end onNavigate={() => setDrawerOpen(false)} />
              <ShellNavLink compact={compact} to="/runs" label={t('nav.allRuns')} icon={<PlayCircleOutlined />} end onNavigate={() => setDrawerOpen(false)} />
            </NavigationGroup>
            {isSystemAdmin ? <NavigationGroup compact={compact} title={t('nav.system')}><ShellNavLink compact={compact} to="/instance/language" label={t('nav.language')} icon={<TranslationOutlined />} end onNavigate={() => setDrawerOpen(false)} /></NavigationGroup> : null}
          </nav>
        </>
      ) : (
        <>
          <nav aria-label={t('nav.primary')} className="wt-shell-navigation">
            <ShellNavLink compact={compact} to="/dashboard" label={t('nav.dashboard')} icon={<DashboardOutlined />} end onNavigate={() => setDrawerOpen(false)} />
            <ShellNavLink compact={compact} to="/projects" label={t('nav.projects')} icon={<FolderOpenOutlined />} end onNavigate={() => setDrawerOpen(false)} />
            <ShellNavLink compact={compact} to="/runs" label={t('nav.allRuns')} icon={<PlayCircleOutlined />} end onNavigate={() => setDrawerOpen(false)} />
          </nav>
          {projectOptions.length > 0 ? renderProjectSwitcher(compact) : null}
          {isSystemAdmin ? <NavigationGroup compact={compact} title={t('nav.system')}><ShellNavLink compact={compact} to="/instance/language" label={t('nav.language')} icon={<TranslationOutlined />} end onNavigate={() => setDrawerOpen(false)} /></NavigationGroup> : null}
        </>
      )}

      <div className="wt-app-shell__account">
        <Button
          className="wt-app-shell__collapse"
          type="text"
          icon={compact ? <RightOutlined /> : <LeftOutlined />}
          aria-label={compact ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
          onClick={() => setSidebarCollapsed((current) => !current)}
        >
          {compact ? null : t('nav.collapseSidebar')}
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
            <Button type="text" icon={<MenuOutlined />} aria-label={t('nav.openNavigation')} onClick={() => setDrawerOpen(true)} />
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
