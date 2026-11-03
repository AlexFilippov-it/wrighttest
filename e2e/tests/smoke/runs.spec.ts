import { apiBaseUrl, expect, openAuthenticatedPage, test } from '../support/workspace';

test('Runs opens a run result and both routes support refresh and browser history', async ({ page, workspace }) => {
  const runId = 'e2e-ui-run';
  const startedAt = new Date().toISOString();
  const finishedAt = new Date(Date.now() + 1_200).toISOString();
  const apiOrigin = new URL(apiBaseUrl).origin;

  await page.route(
    (url) => url.origin === apiOrigin && url.pathname === '/runs',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          runs: [{
            runId,
            testId: workspace.checkId,
            checkName: workspace.checkName,
            projectId: workspace.projectId,
            projectName: workspace.projectName,
            status: 'PASSED',
            durationMs: 1_200,
            startedAt,
            trigger: 'Manual',
            scheduleName: null,
            environmentId: null
          }],
          total: 1,
          days: 30,
          limit: 20,
          summary: {
            total: 1,
            passed: 1,
            failed: 0,
            passRate: 100,
            avgDurationMs: 1_200,
            slowestRun: null
          }
        })
      });
    }
  );

  await page.route(
    (url) => url.origin === apiOrigin && url.pathname === `/runs/${runId}`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: runId,
          status: 'PASSED',
          startedAt,
          finishedAt,
          durationMs: 1_200,
          screenshots: [],
          currentStep: 1,
          totalSteps: 1,
          testId: workspace.checkId,
          trace: { available: false, reason: 'Synthetic UI smoke run' },
          stepResults: [{
            index: 0,
            action: 'assertTitle',
            target: 'WrightTest E2E',
            status: 'passed',
            durationMs: 50
          }],
          test: {
            id: workspace.checkId,
            name: workspace.checkName,
            url: 'data:text/html,<title>WrightTest E2E</title>',
            device: null,
            environmentId: null,
            useProjectAuthentication: false,
            steps: [
              { action: 'goto', value: 'data:text/html,<title>WrightTest E2E</title>' },
              { action: 'assertTitle', expected: 'WrightTest E2E' }
            ],
            testData: [],
            projectId: workspace.projectId,
            createdAt: startedAt,
            project: {
              id: workspace.projectId,
              name: workspace.projectName,
              createdAt: startedAt
            }
          },
          environment: null,
          schedule: null
        })
      });
    }
  );

  await page.setViewportSize({ width: 1073, height: 802 });
  await openAuthenticatedPage(page, workspace.owner, '/runs');
  await expect(page.getByRole('heading', { name: 'Runs', exact: true })).toBeVisible();
  await expect(page.getByText(workspace.checkName)).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Started' })).toBeHidden();
  await expect(page.getByRole('columnheader', { name: 'Trigger' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open result' })).toBeVisible();
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(documentWidth).toBeLessThanOrEqual(1073);

  await page.getByRole('button', { name: 'Open result' }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}$`));
  await expect(page.getByRole('heading', { name: 'Run Result' })).toBeVisible();
  await expect(page.getByText('Step results')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Run Result' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/runs$/);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}$`));
});
