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
  type E2EWorkspaceState,
  waitForE2eApiRequestSlot,
  withRateLimitRetry,
  withRateLimitRetries
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

type TestFixtures = {
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
  if (path.startsWith('/projects/')) {
    const projectId = path.split('/')[2];
    await expect(
      page.locator(`.wt-shell-navigation a[href^="/projects/${projectId}/"]`).first()
    ).toBeVisible({ timeout: 120_000 });
  }
}

export const test = base.extend<TestFixtures>({
  page: async ({ page }, use, testInfo) => {
    testInfo.setTimeout(120_000);
    const apiOrigin = new URL(apiBaseUrl).origin;
    await page.route((url) => url.origin === apiOrigin, async (route) => {
      await waitForE2eApiRequestSlot();
      let response = await route.fetch();
      if (response.status() === 429) {
        const body = await response.text();
        const headerDelay = Number(response.headers()['retry-after']);
        const bodyDelay = Number(body.match(/retry in\s+(\d+(?:\.\d+)?)\s+seconds/i)?.[1]);
        const waitSeconds = Number.isFinite(headerDelay) && headerDelay > 0 ? headerDelay : bodyDelay;

        if (Number.isFinite(waitSeconds) && waitSeconds > 0 && waitSeconds <= 90) {
          testInfo.setTimeout(120_000);
          await new Promise((resolve) => setTimeout(resolve, Math.ceil(waitSeconds * 1000)));
          await waitForE2eApiRequestSlot();
          response = await route.fetch();
        }
      }
      await route.fulfill({ response });
    });
    try {
      await use(page);
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  },
  workspace: async ({}, use, testInfo) => {
    const state = JSON.parse(await fs.readFile(workspaceStatePath, 'utf8')) as E2EWorkspaceState;
    const baseAdminApi = await request.newContext({
      baseURL: apiBaseUrl,
      extraHTTPHeaders: { Authorization: `Bearer ${state.owner.token}` }
    });
    const adminApi = withRateLimitRetries(baseAdminApi, () => testInfo.setTimeout(120_000));

    try {
      await use({
        ...state,
        adminApi,
      });
    } finally {
      await baseAdminApi.dispose();
    }
  }
});

export { apiBaseUrl };
export { expect };
