import {
  expect,
  request,
  test as base,
  type APIRequestContext,
  type Page
} from '@playwright/test';
import fs from 'node:fs/promises';
import {
  apiBaseUrl,
  workspaceStatePath,
  type AuthSession,
  type E2EWorkspaceState
} from '../../support/workspace-state';

export type E2EWorkspace = {
  projectId: string;
  projectName: string;
  checkId: string;
  checkName: string;
  adminApi: APIRequestContext;
  owner: AuthSession;
  editor: AuthSession;
  viewer: AuthSession;
};

type WorkerFixtures = {
  workspace: E2EWorkspace;
};

export async function openAuthenticatedPage(page: Page, session: AuthSession, path: string) {
  const apiOrigin = new URL(apiBaseUrl).origin;
  await page.route((url) => {
    if (url.origin !== apiOrigin) return false;
    if (url.pathname === '/auth/me' || url.pathname === '/devices') return true;
    return /^\/projects\/[^/]+\/(suites|environments|schedules|channels|authentication|members)$/.test(url.pathname);
  }, async (route) => {
    const url = new URL(route.request().url());
    const corsHeaders = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type'
    };

    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }

    if (url.pathname === '/auth/me') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          userId: `e2e-${session.email}`,
          email: session.email,
          canCreateProject: session.email === process.env.ADMIN_EMAIL,
          isSystemAdmin: session.email === process.env.ADMIN_EMAIL
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: '[]'
    });
  });

  await page.goto('/login');
  await page.evaluate(({ token, email }) => {
    window.localStorage.setItem('wt_token', token);
    window.localStorage.setItem('wt_email', email);
  }, { token: session.token, email: session.email });
  await page.goto(path);
  await expect(page).not.toHaveURL(/\/login$/);
}

export const test = base.extend<{}, WorkerFixtures>({
  workspace: [async ({}, use) => {
    const state = JSON.parse(await fs.readFile(workspaceStatePath, 'utf8')) as E2EWorkspaceState;
    const adminApi = await request.newContext({
      baseURL: apiBaseUrl,
      extraHTTPHeaders: { Authorization: `Bearer ${state.owner.token}` }
    });

    try {
      await use({
        ...state,
        adminApi,
      });
    } finally {
      await adminApi.dispose();
    }
  }, { scope: 'worker' }]
});

export { apiBaseUrl };
export { expect };
