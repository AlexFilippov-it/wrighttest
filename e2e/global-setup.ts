import fs from 'node:fs/promises';
import path from 'node:path';
import { request, type FullConfig } from '@playwright/test';
import {
  addMember,
  apiBaseUrl,
  login,
  requiredEnvironmentVariable,
  requireOk,
  workspaceStatePath,
  type E2EWorkspaceState
} from './support/workspace-state';

export default async function globalSetup(_config: FullConfig) {
  const adminEmail = requiredEnvironmentVariable('ADMIN_EMAIL');
  const adminPassword = requiredEnvironmentVariable('ADMIN_PASSWORD');
  const memberPassword = process.env.E2E_MEMBER_PASSWORD?.trim() || 'wrighttest-e2e-password';
  const editorEmail = process.env.E2E_EDITOR_EMAIL?.trim() || 'e2e-editor@wrighttest.app';
  const viewerEmail = process.env.E2E_VIEWER_EMAIL?.trim() || 'e2e-viewer@wrighttest.app';
  const publicApi = await request.newContext({ baseURL: apiBaseUrl });
  const owner = await login(publicApi, adminEmail, adminPassword);
  const adminApi = await request.newContext({
    baseURL: apiBaseUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${owner.token}` }
  });
  const projectName = `E2E Workspace ${Date.now()}`;
  let projectId: string | undefined;

  try {
    const projectResponse = await adminApi.post('/projects', { data: { name: projectName } });
    await requireOk(projectResponse, 'Create E2E project');
    projectId = ((await projectResponse.json()) as { id: string }).id;

    const checkName = 'E2E editable check';
    const checkResponse = await adminApi.post(`/projects/${projectId}/tests`, {
      data: {
        name: checkName,
        url: 'data:text/html,<title>WrightTest E2E</title><main>Ready</main>',
        steps: [
          { action: 'goto', value: 'data:text/html,<title>WrightTest E2E</title><main>Ready</main>' },
          { action: 'assertTitle', expected: 'WrightTest E2E' }
        ],
        testData: [],
        useProjectAuthentication: false
      }
    });
    await requireOk(checkResponse, 'Create E2E check');
    const checkId = ((await checkResponse.json()) as { id: string }).id;

    await addMember(adminApi, projectId, editorEmail, memberPassword, 'EDITOR');
    await addMember(adminApi, projectId, viewerEmail, memberPassword, 'VIEWER');
    const editor = await login(publicApi, editorEmail, memberPassword);
    const viewer = await login(publicApi, viewerEmail, memberPassword);

    const state: E2EWorkspaceState = {
      projectId,
      projectName,
      checkId,
      checkName,
      owner,
      editor,
      viewer
    };
    await fs.mkdir(path.dirname(workspaceStatePath), { recursive: true });
    await fs.writeFile(workspaceStatePath, JSON.stringify(state), { mode: 0o600 });
  } catch (error) {
    if (projectId) {
      await adminApi.delete(`/projects/${projectId}`).catch(() => undefined);
    }
    throw error;
  } finally {
    await adminApi.dispose();
    await publicApi.dispose();
  }
}
