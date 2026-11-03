import { expect, openAuthenticatedPage, test } from '../support/workspace';

test('registered project routes survive refresh and Suites supports Back/Forward', async ({ page, workspace }) => {
  const projectNavigation = page.locator('.wt-shell-navigation').first();
  await openAuthenticatedPage(page, workspace.owner, `/projects/${workspace.projectId}/overview`);
  await expect(page.locator('.wt-app-shell__project-switcher .ant-select')).toBeVisible();
  await expect(page.getByRole('heading', { name: workspace.projectName })).toHaveCount(0);
  await expect(page.getByRole('link', { name: workspace.projectName })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Overview' })).toHaveClass(/active/);
  await expect(page.getByText('Pass rate', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/projects/${workspace.projectId}/overview$`));
  await expect(page.getByRole('link', { name: 'Overview' })).toHaveClass(/active/);

  await projectNavigation.getByRole('link', { name: 'Checks' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${workspace.projectId}/checks$`));
  await expect(page.getByRole('link', { name: workspace.checkName })).toBeVisible();
  await expect(page.getByText('Pass rate', { exact: true })).toHaveCount(0);

  await projectNavigation.getByRole('link', { name: 'Runs', exact: true }).click();
  await expect(page.getByText('Recent results', { exact: true })).toBeVisible();

  await projectNavigation.getByRole('link', { name: 'Schedules' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${workspace.projectId}/schedules$`));

  await projectNavigation.getByRole('link', { name: 'Environments' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${workspace.projectId}/environments$`));

  await projectNavigation.getByRole('link', { name: 'Authentication' }).click();
  await expect(page.getByText('Create an environment before configuring reusable authentication.')).toBeVisible();

  await projectNavigation.getByRole('link', { name: 'Alerts' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${workspace.projectId}/alerts$`));

  await projectNavigation.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByText('Project settings', { exact: true })).toBeVisible();

  await projectNavigation.getByRole('link', { name: 'Members' }).click();
  await expect(page.getByText('Project members', { exact: true })).toBeVisible();

  await page.goto(`/projects/${workspace.projectId}/overview`);
  await projectNavigation.getByRole('link', { name: 'Suites' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${workspace.projectId}/suites$`));
  await expect(page.getByRole('heading', { name: 'Suites', level: 1 })).toBeVisible();
  await expect(page.getByText('Reusable groups of checks that can be run together.')).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/projects/${workspace.projectId}/overview$`));
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/projects/${workspace.projectId}/suites$`));
});

test('project switcher changes project context and URL', async ({ page, workspace }) => {
  const projectName = `Switcher project ${Date.now()}`;
  const response = await workspace.adminApi.post('/projects', { data: { name: projectName } });
  expect(response.ok()).toBeTruthy();
  const created = await response.json() as { id: string };

  try {
    await openAuthenticatedPage(page, workspace.owner, `/projects/${workspace.projectId}/checks`);
    await page.locator('.wt-app-shell__project-switcher .ant-select').click();
    await page.getByText(projectName, { exact: true }).last().click();
    await expect(page).toHaveURL(new RegExp(`/projects/${created.id}/checks$`));
    await expect(page.getByRole('link', { name: projectName })).toBeVisible();
  } finally {
    await workspace.adminApi.delete(`/projects/${created.id}`);
  }
});

test('legacy and unknown project routes resolve predictably', async ({ page, workspace }) => {
  await openAuthenticatedPage(page, workspace.owner, `/projects/${workspace.projectId}`);
  await expect(page).toHaveURL(new RegExp(`/projects/${workspace.projectId}/checks$`));

  await page.goto(`/projects/${workspace.projectId}/notifications`);
  await expect(page).toHaveURL(new RegExp(`/projects/${workspace.projectId}/alerts$`));

  await page.goto(`/projects/${workspace.projectId}/missing-section`);
  await expect(page.getByText('Page not found', { exact: true })).toBeVisible();
});

test('check opens in the editor and its fields can be edited without saving', async ({ page, workspace }) => {
  await openAuthenticatedPage(page, workspace.owner, `/projects/${workspace.projectId}/checks`);
  await page.getByRole('link', { name: workspace.checkName }).click();

  await expect(page).toHaveURL(new RegExp(`/tests/${workspace.checkId}/edit$`));
  await expect(page.getByRole('heading', { name: 'Edit Check' })).toBeVisible();

  await page.setViewportSize({ width: 1073, height: 802 });
  const stepsHeaderTitle = page.locator('.wt-editor-steps-card > .ant-card-head .ant-card-head-title');
  const stepsHeaderWidth = await stepsHeaderTitle.evaluate((element) => element.getBoundingClientRect().width);
  expect(stepsHeaderWidth).toBeGreaterThan(300);

  await page.setViewportSize({ width: 390, height: 844 });
  const testDataDescription = page.getByText(
    'Define scenario variables used anywhere in your browser flow, including inputs and expected results.',
    { exact: true }
  );
  await expect(testDataDescription).toBeVisible();
  const descriptionLayout = await testDataDescription.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      right: bounds.right,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight)
    };
  });
  expect(descriptionLayout.right).toBeLessThanOrEqual(390);
  expect(descriptionLayout.scrollWidth).toBeLessThanOrEqual(descriptionLayout.clientWidth);
  expect(descriptionLayout.lineHeight).toBeGreaterThan(0);

  const checkName = page.getByLabel('Check name');
  const startUrl = page.getByLabel('Start URL');
  await expect(checkName).toHaveValue(workspace.checkName);
  await expect(startUrl).toHaveValue(/WrightTest E2E/);

  await checkName.fill(`${workspace.checkName} draft`);
  await expect(checkName).toHaveValue(`${workspace.checkName} draft`);
  await expect(page.getByRole('button', { name: 'Save changes' }).first()).toBeEnabled();
});
