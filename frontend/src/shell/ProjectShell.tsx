import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Outlet, useParams } from 'react-router-dom';
import { ErrorState, LoadingState } from '../design-system';
import { getProject } from '../api/client';
import type { ProjectWorkspace } from '../types';
import { useAppShell } from './ShellContext';
import type { ProjectShellOutletContext } from './ProjectShellContext';

function errorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 403) return 'You do not have access to this project.';
    if (error.response?.status === 404) return 'This project does not exist or was removed.';
  }
  return 'The project could not be loaded. Check the connection and try again.';
}

export default function ProjectShell() {
  const { projectId } = useParams<{ projectId: string }>();
  const { setProject: setShellProject } = useAppShell();
  const [project, setProject] = useState<ProjectWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProject = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const nextProject = await getProject(projectId);
      setProject(nextProject);
      setShellProject({ id: nextProject.id, name: nextProject.name, role: nextProject.currentUserRole });
    } catch (loadError) {
      setProject(null);
      setError(errorMessage(loadError));
      setShellProject(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, setShellProject]);

  useEffect(() => {
    void loadProject();
    return () => {
      setShellProject((current) => (current?.id === projectId ? null : current));
    };
  }, [loadProject, projectId, setShellProject]);

  if (loading) return <LoadingState label="Loading project workspace..." rows={5} />;

  if (error || !project) {
    return (
      <ErrorState
        title="Project unavailable"
        description={error}
        retryLabel="Try again"
        onRetry={() => void loadProject()}
      />
    );
  }

  const outletContext: ProjectShellOutletContext = { project, reloadProject: loadProject };
  return <Outlet context={outletContext} />;
}
