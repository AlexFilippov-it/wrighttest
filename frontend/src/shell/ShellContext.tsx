import { createContext, useContext, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { ProjectRole } from '../types';

export type AppShellProject = {
  id: string;
  name: string;
  role?: ProjectRole;
};

type AppShellContextValue = {
  project: AppShellProject | null;
  setProject: Dispatch<SetStateAction<AppShellProject | null>>;
};

const AppShellContext = createContext<AppShellContextValue | null>(null);

export function AppShellProvider({ value, children }: { value: AppShellContextValue; children: ReactNode }) {
  return <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>;
}

export function useAppShell() {
  const context = useContext(AppShellContext);
  if (!context) throw new Error('useAppShell must be used within AppShell');
  return context;
}

export function useAppShellOptional() {
  return useContext(AppShellContext);
}
