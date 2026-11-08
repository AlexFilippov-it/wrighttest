import { expect, openAuthenticatedPage, test } from '../support/workspace';

test('Owner can manage the project and sees Members', async ({ page, workspace }) => {
  await openAuthenticatedPage(page, workspace.owner, `/projects/${workspace.projectId}/checks`);

  await expect(page.getByRole('button', { name: 'New Check' }).first()).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Run suite' }).first()).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Members' })).toBeVisible();
});

test('Editor can edit and run checks but cannot manage Members or create projects', async ({ page, workspace }) => {
  await openAuthenticatedPage(page, workspace.editor, `/projects/${workspace.projectId}/checks`);

  await expect(page.getByRole('button', { name: 'New Check' }).first()).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Run suite' }).first()).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Members' })).toHaveCount(0);

  await page.goto('/projects');
  await expect(page.getByRole('button', { name: 'New Project' }).first()).toBeDisabled();

  await page.goto(`/tests/${workspace.checkId}/edit`);
  await expect(page.getByRole('button', { name: 'Run check' }).first()).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Start recording' }).first()).toBeEnabled();
});

test('Viewer receives read-only controls in project and check editor', async ({ page, workspace }) => {
  await openAuthenticatedPage(page, workspace.viewer, `/projects/${workspace.projectId}/checks`);

  await expect(page.getByText('Read-only access', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Check' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run suite' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Members' })).toHaveCount(0);

  await page.goto(`/projects/${workspace.projectId}/members`);
  await expect(page.getByText('Owner access required', { exact: true })).toBeVisible();

  await page.goto(`/projects/${workspace.projectId}/suites`);
  await expect(page.getByText('You can view suites, but you cannot change or run them.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Suite' })).toHaveCount(0);

  await page.goto(`/tests/${workspace.checkId}/edit`);
  await expect(page.getByRole('heading', { name: 'Edit Check' })).toBeVisible();
  await expect(page.getByText('You can view this check, but you cannot make changes.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run check' }).first()).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Start recording' }).first()).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save changes' }).first()).toBeDisabled();
});
