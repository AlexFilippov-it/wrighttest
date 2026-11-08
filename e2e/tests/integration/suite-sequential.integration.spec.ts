import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, openAuthenticatedPage, test } from '../support/workspace';

test('sequential suite hands a captured secret output through three isolated checks', async ({ workspace, page }, testInfo) => {
  testInfo.setTimeout(150_000);
  const suffix = `${Date.now()}`;
  const checkIds: string[] = [];
  let suiteId: string | undefined;

  const createCheck = async (name: string, steps: Array<Record<string, unknown>>) => {
    const response = await workspace.adminApi.post(`/projects/${workspace.projectId}/tests`, {
      data: { name, url: 'about:blank', steps, testData: [], useProjectAuthentication: false }
    });
    if (!response.ok()) throw new Error(await response.text());
    expect(response.status()).toBe(201);
    const test = await response.json() as { id: string };
    checkIds.push(test.id);
    return test.id;
  };
  const dataUrl = 'data:text/html,%3Cmain%20id%3D%22user-id%22%3Euser-42%3C%2Fmain%3E';
  const createId = await createCheck(`Suite create ${suffix}`, [
    { action: 'goto', value: dataUrl },
    { action: 'captureValue', selector: "page.locator('#user-id')", captureSource: 'text', saveAs: 'USER_ID', secret: true },
    { action: 'assertText', selector: "page.locator('#user-id')", expected: 'user-42' }
  ]);
  const verifyId = await createCheck(`Suite verify ${suffix}`, [
    { action: 'goto', value: dataUrl },
    { action: 'assertText', selector: "page.locator('#user-id')", expected: '{{USER_ID}}' }
  ]);
  const deleteId = await createCheck(`Suite delete ${suffix}`, [
    { action: 'goto', value: dataUrl },
    { action: 'assertText', selector: "page.locator('#user-id')", expected: '{{USER_ID}}' }
  ]);

  try {
    const created = await workspace.adminApi.post(`/projects/${workspace.projectId}/suites`, {
      data: {
        name: `Sequential suite ${suffix}`,
        testIds: [createId, verifyId, deleteId],
        executionMode: 'SEQUENTIAL',
        executionConfig: {
          orderedTestIds: [createId, verifyId, deleteId],
          mappings: [
            { sourceTestId: createId, outputVariable: 'USER_ID', targetTestId: verifyId, targetVariable: 'USER_ID', required: true, expectedType: 'string' },
            { sourceTestId: createId, outputVariable: 'USER_ID', targetTestId: deleteId, targetVariable: 'USER_ID', required: true, expectedType: 'string' }
          ],
          dataCaseIndexes: {}
        }
      }
    });
    if (!created.ok()) throw new Error(await created.text());
    expect(created.status()).toBe(201);
    suiteId = (await created.json() as { id: string }).id;

    const start = await workspace.adminApi.post(`/suites/${suiteId}/run`, { data: {} });
    if (!start.ok()) throw new Error(await start.text());
    expect(start.status()).toBe(202);
    const { suiteRunId } = await start.json() as { suiteRunId: string };
    let suiteRun: { status: string; error?: string | null; testRuns: Array<{ status: string; testId: string }>; outputMetadata: Array<{ secret: boolean }> } | undefined;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const response = await workspace.adminApi.get(`/suite-runs/${suiteRunId}`);
      if (!response.ok()) throw new Error(await response.text());
      const current = await response.json() as NonNullable<typeof suiteRun>;
      suiteRun = current;
      if (current.status === 'PASSED' || current.status === 'FAILED') break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(suiteRun?.status, suiteRun?.error ?? '').toBe('PASSED');
    expect(suiteRun?.testRuns.map((run) => run.testId)).toEqual([createId, verifyId, deleteId]);
    expect(suiteRun?.testRuns.map((run) => run.status)).toEqual(['PASSED', 'PASSED', 'PASSED']);
    expect(suiteRun?.outputMetadata).toHaveLength(2);
    expect(suiteRun?.outputMetadata.every((item) => item.secret)).toBe(true);
    expect(JSON.stringify(suiteRun)).not.toContain('user-42');

    await page.setViewportSize({ width: 1440, height: 960 });
    const suiteRunPageResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/suite-runs/${suiteRunId}`) &&
      response.status() === 200 &&
      response.headers()['content-type']?.includes('application/json') === true
    );
    await openAuthenticatedPage(page, workspace.owner, `/projects/${workspace.projectId}/suite-runs/${suiteRunId}`);
    const suiteRunPageData = await (await suiteRunPageResponse).json() as { status: string };
    expect(suiteRunPageData.status).toBe('PASSED');
    await expect(page.locator('.wt-page-header__title')).toHaveText(/^(Suite Run|Sequential suite \d+)$/);
    await expect(page.locator('.wt-content-surface')).toHaveCount(3);
    await expect(page.locator('.wt-status-badge--passed').first()).toBeVisible();
    if (process.env.PHASE5_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.PHASE5_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.PHASE5_SCREENSHOT_DIR, 'suite-run-results-desktop.png'), fullPage: true, animations: 'disabled' });
      for (const width of [320, 375, 390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        await expect(page.locator('.wt-suite-run-mobile-cards').first()).toBeVisible();
        await expect(page.locator('.wt-suite-run-mobile-card')).toHaveCount(5);
        await expect(page.locator('.wt-suite-run-mobile-card__action')).toHaveCount(3);
        const viewportWidths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
        expect(viewportWidths.content, `document overflow at ${width}px`).toBeLessThanOrEqual(viewportWidths.viewport);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('.wt-page-header__title')).toHaveText(/^(Suite Run|Sequential suite \d+)$/);
      await page.screenshot({ path: path.join(process.env.PHASE5_SCREENSHOT_DIR, 'suite-run-results-mobile.png'), fullPage: true, animations: 'disabled' });
      await page.setViewportSize({ width: 1440, height: 960 });
    }
  } finally {
    if (suiteId) await workspace.adminApi.delete(`/suites/${suiteId}`).catch(() => undefined);
    for (const id of checkIds) await workspace.adminApi.delete(`/tests/${id}`).catch(() => undefined);
  }
});

test('sequential suite stops after a failed check', async ({ workspace }) => {
  const suffix = `${Date.now()}`;
  const checkIds: string[] = [];
  let suiteId: string | undefined;
  const createCheck = async (name: string, expectedTitle: string) => {
    const response = await workspace.adminApi.post(`/projects/${workspace.projectId}/tests`, {
      data: {
        name,
        url: 'data:text/html,%3Ctitle%3ESuite%20failure%20flow%3C%2Ftitle%3E',
        steps: [
          { action: 'goto', value: 'data:text/html,%3Ctitle%3ESuite%20failure%20flow%3C%2Ftitle%3E' },
          { action: 'assertTitle', expected: expectedTitle }
        ],
        testData: [],
        useProjectAuthentication: false
      }
    });
    if (!response.ok()) throw new Error(await response.text());
    const check = await response.json() as { id: string };
    checkIds.push(check.id);
    return check.id;
  };

  try {
    const firstId = await createCheck(`Suite first ${suffix}`, 'Suite failure flow');
    const failingId = await createCheck(`Suite failing ${suffix}`, 'Unexpected title');
    const skippedId = await createCheck(`Suite must not run ${suffix}`, 'Suite failure flow');
    const suiteResponse = await workspace.adminApi.post(`/projects/${workspace.projectId}/suites`, {
      data: {
        name: `Stop on failure ${suffix}`,
        testIds: [firstId, failingId, skippedId],
        executionMode: 'SEQUENTIAL',
        executionConfig: { orderedTestIds: [firstId, failingId, skippedId], mappings: [], dataCaseIndexes: {} }
      }
    });
    if (!suiteResponse.ok()) throw new Error(await suiteResponse.text());
    suiteId = (await suiteResponse.json() as { id: string }).id;

    const startResponse = await workspace.adminApi.post(`/suites/${suiteId}/run`, { data: {} });
    if (!startResponse.ok()) throw new Error(await startResponse.text());
    const { suiteRunId } = await startResponse.json() as { suiteRunId: string };
    let suiteRun: { status: string; error?: string | null; testRuns: Array<{ status: string; testId: string }> } | undefined;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const response = await workspace.adminApi.get(`/suite-runs/${suiteRunId}`);
      if (!response.ok()) throw new Error(await response.text());
      suiteRun = await response.json() as NonNullable<typeof suiteRun>;
      if (suiteRun.status === 'PASSED' || suiteRun.status === 'FAILED') break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    expect(suiteRun?.status, JSON.stringify(suiteRun)).toBe('FAILED');
    expect(suiteRun?.testRuns.map((run) => run.testId)).toEqual([firstId, failingId]);
    expect(suiteRun?.testRuns.map((run) => run.status)).toEqual(['PASSED', 'FAILED']);
  } finally {
    if (suiteId) await workspace.adminApi.delete(`/suites/${suiteId}`).catch(() => undefined);
    for (const id of checkIds) await workspace.adminApi.delete(`/tests/${id}`).catch(() => undefined);
  }
});
