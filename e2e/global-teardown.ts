import fs from 'node:fs/promises';
import { request, type FullConfig } from '@playwright/test';
import { apiBaseUrl, workspaceStatePath, type E2EWorkspaceState } from './support/workspace-state';

export default async function globalTeardown(_config: FullConfig) {
  let state: E2EWorkspaceState;
  try {
    state = JSON.parse(await fs.readFile(workspaceStatePath, 'utf8')) as E2EWorkspaceState;
  } catch {
    return;
  }

  const adminApi = await request.newContext({
    baseURL: apiBaseUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${state.owner.token}` }
  });

  try {
    await adminApi.delete(`/projects/${state.projectId}`).catch(() => undefined);
  } finally {
    await adminApi.dispose();
    await fs.rm(workspaceStatePath, { force: true });
  }
}
