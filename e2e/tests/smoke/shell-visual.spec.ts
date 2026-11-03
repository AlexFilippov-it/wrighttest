import path from 'node:path';
import fs from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { apiBaseUrl, expect, openAuthenticatedPage, test } from '../support/workspace';

const outputDirectory = path.resolve(process.cwd(), 'output/playwright');

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
}

test('AppShell and ProjectShell remain usable at foundation viewports', async ({ page, workspace }) => {
  await fs.mkdir(outputDirectory, { recursive: true });
  const createdAt = new Date().toISOString();
  const projectSummary = {
    id: workspace.projectId,
    name: workspace.projectName,
    createdAt,
    updatedAt: createdAt,
    currentUserRole: 'OWNER',
    checksCount: 1,
    activeSchedulesCount: 0,
    alertChannelsCount: 0,
    alertChannelTypes: [],
    lastRunAt: null,
    lastRunStatus: null,
    passRate30d: null,
    totalRuns30d: 0,
    passedRuns30d: 0,
    failedRuns30d: 0,
    failedChecks: 0,
    flakyChecks: 0,
    health: 'no_runs'
  };
  const projectWorkspace = {
    ...projectSummary,
    summary: {
      checksCount: 1,
      lastResult: null,
      lastRunAt: null,
      passRate30d: null,
      totalRuns30d: 0,
      passedRuns30d: 0,
      failedRuns30d: 0,
      activeSchedulesCount: 0,
      alertChannelsCount: 0,
      avgDurationMs: null,
      failedChecks: 0,
      flakyChecks: 0
    },
    tests: [{
      id: workspace.checkId,
      projectId: workspace.projectId,
      name: workspace.checkName,
      url: 'data:text/html,<title>WrightTest E2E</title><main>Ready</main>',
      steps: [
        { action: 'goto', value: 'data:text/html,<title>WrightTest E2E</title><main>Ready</main>' },
        { action: 'assertTitle', expected: 'WrightTest E2E' }
      ],
      testData: [],
      device: null,
      environmentId: null,
      useProjectAuthentication: false,
      createdAt,
      runCount: 0,
      lastRunAt: null,
      lastRunStatus: null,
      lastRunDurationMs: null,
      latestRun: null,
      scheduleCount: 0,
      schedules: []
    }],
    suites: []
  };
  const dashboard = {
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      passRate: 0,
      avgDurationMs: 0,
      activeFailures: 0,
      flakyChecks: 0
    },
    recentRuns: [],
    activeIssues: [],
    flakyChecks: [],
    chart: []
  };
  const apiOrigin = new URL(apiBaseUrl).origin;

  await page.route((url) => {
    if (url.origin !== apiOrigin) return false;
    return url.pathname === '/projects'
      || url.pathname === `/projects/${workspace.projectId}`
      || url.pathname === '/dashboard';
  }, async (route) => {
    const url = new URL(route.request().url());
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type'
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    const body = url.pathname === '/projects'
      ? [projectSummary]
      : url.pathname === '/dashboard'
        ? dashboard
        : projectWorkspace;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers,
      body: JSON.stringify(body)
    });
  });

  const routes = [
    { name: 'dashboard', path: '/dashboard', heading: 'Dashboard' },
    { name: 'overview', path: `/projects/${workspace.projectId}/overview`, heading: 'Overview' },
    { name: 'checks', path: `/projects/${workspace.projectId}/checks`, heading: 'Checks' },
    { name: 'suites', path: `/projects/${workspace.projectId}/suites`, heading: 'Suites' }
  ];

  const assertAndCaptureRoute = async (route: typeof routes[number], width: number) => {
    await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    if (route.name !== 'dashboard') {
      const visibleProjectNavigation = page.locator('[aria-label="Project navigation"]:visible');
      await expect(visibleProjectNavigation).toHaveCount(width <= 1024 ? 0 : 1);
      await expect(page.getByRole('heading', { name: workspace.projectName })).toHaveCount(0);
    }
    if (route.name === 'checks' && width === 768) {
      const checkNameWidth = await page.getByRole('link', { name: workspace.checkName }).evaluate(
        (element) => element.getBoundingClientRect().width
      );
      expect(checkNameWidth).toBeGreaterThan(120);
      await expect(page.getByRole('button', { name: 'Run' }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open' }).first()).toBeVisible();
    }
    if (route.name === 'suites') {
      const emptyStateAlignment = await page.locator('.wt-empty-state__copy').evaluate((element) => {
        const styles = window.getComputedStyle(element);
        return {
          alignItems: styles.alignItems,
          textAlign: styles.textAlign
        };
      });
      expect(emptyStateAlignment).toEqual({ alignItems: 'center', textAlign: 'center' });
    }
    await page.screenshot({
      path: path.join(outputDirectory, `wrighttest-shell-${route.name}-${width}.png`),
      fullPage: true,
      animations: 'disabled'
    });
  };

  const navigateWithShell = async (label: string, width: number) => {
    if (width <= 1024) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      const drawer = page.getByRole('dialog');
      await expect(drawer).toBeVisible();
      await drawer.getByRole('link', { name: label, exact: true }).click();
      await expect(drawer).toHaveCount(0);
      return;
    }

    await page.getByRole('link', { name: label, exact: true }).click();
  };

  await openAuthenticatedPage(page, workspace.owner, '/dashboard');

  for (const width of [1440, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    if (!page.url().endsWith('/dashboard')) {
      await navigateWithShell('Dashboard', width);
    }
    await assertAndCaptureRoute(routes[0], width);

    await page.goto(routes[1].path);
    await assertAndCaptureRoute(routes[1], width);

    await navigateWithShell('Checks', width);
    await assertAndCaptureRoute(routes[2], width);

    await navigateWithShell('Suites', width);
    await assertAndCaptureRoute(routes[3], width);

    if (width === 768) {
      await navigateWithShell('Overview', width);
      await expect(page).toHaveURL(new RegExp(`/projects/${workspace.projectId}/overview$`));
    }
  }

  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`/projects/${workspace.projectId}/checks`);
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  await expect(page.getByText('Project section', { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
