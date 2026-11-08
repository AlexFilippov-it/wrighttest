import { expect, openAuthenticatedPage, test } from '../support/workspace';

test('system admin creates and opens a project from the Projects page', async ({ page, workspace }) => {
  const projectName = `UI-created project ${Date.now()}`;
  let createdProjectId: string | undefined;

  await openAuthenticatedPage(page, workspace.owner, '/projects');
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  try {
    await page.getByRole('button', { name: 'New Project' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New Project' });
    await dialog.getByLabel('Project name').fill(projectName);
    const projectListRefresh = page.waitForResponse(async (response) => {
      if (!response.url().endsWith('/projects') || response.request().method() !== 'GET' || response.status() !== 200) {
        return false;
      }
      const projects = await response.json().catch(() => null) as Array<{ id: string; name: string }> | null;
      return projects?.some((project) => project.name === projectName) ?? false;
    });
    await dialog.getByRole('button', { name: 'Create' }).click();
    const refreshedProjects = await projectListRefresh.then((response) => response.json()) as Array<{ id: string; name: string }>;
    createdProjectId = refreshedProjects.find((project) => project.name === projectName)?.id;
    expect(createdProjectId, 'created project should be present in the refreshed UI project list').toBeTruthy();

    const projectLink = page.getByRole('link', { name: projectName });
    await expect(projectLink).toBeVisible();

    const projectsResponse = await workspace.adminApi.get('/projects');
    expect(projectsResponse.ok()).toBeTruthy();
    const projects = await projectsResponse.json() as Array<{ id: string; name: string }>;
    expect(projects.some((project) => project.id === createdProjectId && project.name === projectName)).toBeTruthy();

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
