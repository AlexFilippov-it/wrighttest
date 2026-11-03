import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Outlet, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ErrorState, LoadingState } from '../design-system';
import { getProject } from '../api/client';
import type { ProjectWorkspace } from '../types';
import { useAppShell } from './ShellContext';
import type { ProjectShellOutletContext } from './ProjectShellContext';

function errorMessage(error: unknown, t: (key: string) => string) {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 403) return t('projectShell.noAccess');
    if (error.response?.status === 404) return t('projectShell.notFound');
  }
  return t('projectShell.loadFailed');
}

export default function ProjectShell() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const { setProject: setShellProject } = useAppShell();
  const [project, setProject] = useState<ProjectWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const projectLoadRef = useRef<{ projectId: string; promise: Promise<void> } | null>(null);

  const loadProject = useCallback(() => {
    if (!projectId) return Promise.resolve();
    if (projectLoadRef.current?.projectId === projectId) return projectLoadRef.current.promise;

    const promise = (async () => {
      setLoading(true);
      setError(null);
      try {
        const nextProject = await getProject(projectId);
        setProject(nextProject);
        setShellProject({ id: nextProject.id, name: nextProject.name, role: nextProject.currentUserRole });
      } catch (loadError) {
        setProject(null);
        setError(errorMessage(loadError, t));
        setShellProject(null);
      } finally {
        setLoading(false);
      }
    })();

    projectLoadRef.current = { projectId, promise };
    void promise.then(
      () => { if (projectLoadRef.current?.promise === promise) projectLoadRef.current = null; },
      () => { if (projectLoadRef.current?.promise === promise) projectLoadRef.current = null; }
    );
    return promise;
  }, [projectId, setShellProject, t]);

  useEffect(() => {
    void loadProject();
    return () => {
      setShellProject((current) => (current?.id === projectId ? null : current));
    };
  }, [loadProject, projectId, setShellProject]);

  if (loading) return <LoadingState label={t('common.loadingProjectWorkspace')} rows={5} />;

  if (error || !project) {
    return (
      <ErrorState
        title={t('common.projectUnavailable')}
        description={error}
        retryLabel={t('common.tryAgain')}
        onRetry={() => void loadProject()}
      />
    );
  }

  const outletContext: ProjectShellOutletContext = { project, reloadProject: loadProject };
  return <Outlet context={outletContext} />;
}
