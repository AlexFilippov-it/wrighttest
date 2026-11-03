import { expect, test } from '../support/workspace';

test('login page fits desktop and mobile and preserves password controls', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const dimensions = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
    await expect(page.locator('.wt-login-card')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  }

  const password = page.locator('input[autocomplete="current-password"]');
  await expect(password).toHaveAttribute('type', 'password');
  await page.locator('.ant-input-password-icon').click();
  await expect(password).toHaveAttribute('type', 'text');
});

test('login opens Dashboard and global Projects navigation supports browser history', async ({ page, workspace }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(workspace.owner.email);
  await page.getByLabel('Password').fill(workspace.owner.password);
  await page.getByLabel('Password').press('Enter');

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.getByRole('link', { name: 'Projects' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { name: 'Projects', level: 2 })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/projects$/);
});
