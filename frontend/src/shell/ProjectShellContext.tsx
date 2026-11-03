import { useOutletContext } from 'react-router-dom';
import type { ProjectWorkspace } from '../types';

export type ProjectShellOutletContext = {
  project: ProjectWorkspace;
  reloadProject: () => Promise<void>;
};

export function useProjectShell() {
  return useOutletContext<ProjectShellOutletContext>();
}
