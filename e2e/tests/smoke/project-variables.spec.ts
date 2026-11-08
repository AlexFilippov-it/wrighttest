import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, openAuthenticatedPage, test } from '../support/workspace';

test('Owner can create and inspect project variables on desktop and mobile', async ({ page, workspace }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAuthenticatedPage(page, workspace.owner, `/projects/${workspace.projectId}/variables`);

  await expect(page.getByRole('heading', { name: 'Project Variables' })).toBeVisible();
  await page.getByRole('button', { name: 'Add variable' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create project variable' });
  await dialog.getByLabel('Name').fill('E2E_LABEL');
  await dialog.getByRole('textbox', { name: /Value/ }).fill('from UI');
  const createResponsePromise = page.waitForResponse((response) =>
    response.url().includes(`/projects/${workspace.projectId}/variables`) && response.request().method() === 'POST'
  );
  await dialog.getByRole('button', { name: 'OK' }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  expect(await createResponse.json()).toMatchObject({ name: 'E2E_LABEL', value: 'from UI' });

  const desktopVariables = page.locator('.wt-project-variable-desktop');
  await expect(desktopVariables.getByText('E2E_LABEL', { exact: true })).toBeVisible();
  await expect(desktopVariables.getByText('from UI', { exact: true })).toBeVisible();
  await expect(page.getByText('Project variable created')).toBeHidden({ timeout: 5000 });
  await page.getByText(workspace.owner.email, { exact: true }).evaluateAll((items) => {
    for (const item of items) item.textContent = 'E2E Owner';
  });

  const screenshotDirectory = process.env.PHASE5_SCREENSHOT_DIR;
  if (screenshotDirectory) {
    await fs.mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDirectory, 'project-variables-desktop.png'), animations: 'disabled' });
  }

  for (const width of [320, 375, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('heading', { name: 'Project Variables' })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    expect(dimensions.content, `Unexpected horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
    if (width < 768) {
      await expect(page.locator('.wt-project-variable-mobile-card')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
    } else {
      await expect(page.locator('.wt-project-variable-desktop')).toBeVisible();
    }
    if (width === 390 && screenshotDirectory) {
      await page.screenshot({ path: path.join(screenshotDirectory, 'project-variables-mobile.png'), animations: 'disabled', fullPage: true });
    }
  }
});
