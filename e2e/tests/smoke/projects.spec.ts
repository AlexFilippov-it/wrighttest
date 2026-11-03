import { expect, openAuthenticatedPage, test } from '../support/workspace';

test('system admin creates and opens a project from the Projects page', async ({ page, workspace }) => {
  const projectName = `UI-created project ${Date.now()}`;
  let createdProjectId: string | undefined;

  await openAuthenticatedPage(page, workspace.owner, '/projects');

  try {
    await page.getByRole('button', { name: 'New Project' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New Project' });
    await dialog.getByLabel('Project name').fill(projectName);
    await dialog.getByRole('button', { name: 'Create' }).click();

    const projectLink = page.getByRole('link', { name: projectName });
    await expect(projectLink).toBeVisible();

    const projectsResponse = await workspace.adminApi.get('/projects');
    expect(projectsResponse.ok()).toBeTruthy();
    const projects = await projectsResponse.json() as Array<{ id: string; name: string }>;
    createdProjectId = projects.find((project) => project.name === projectName)?.id;
    expect(createdProjectId).toBeTruthy();

    await projectLink.click();
    await expect(page).toHaveURL(new RegExp(`/projects/${createdProjectId}/checks$`));
    await expect(page.getByRole('heading', { name: 'Checks' })).toBeVisible();
    await expect(page.getByRole('link', { name: projectName })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Switch project' })).toBeVisible();
  } finally {
    if (createdProjectId) {
      await workspace.adminApi.delete(`/projects/${createdProjectId}`);
    }
  }
});
