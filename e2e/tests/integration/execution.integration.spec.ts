import { expect, openAuthenticatedPage, test } from '../support/workspace';

test('real worker executes the fixture check and its result opens in the UI', async ({ page, workspace }) => {
  const queueResponse = await workspace.adminApi.post(`/tests/${workspace.checkId}/run`, { data: {} });
  expect(queueResponse.ok()).toBeTruthy();
  const { testRunId } = await queueResponse.json() as { testRunId: string };

  let status = 'PENDING';
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && (status === 'PENDING' || status === 'RUNNING')) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const runResponse = await workspace.adminApi.get(`/runs/${testRunId}`);
    expect(runResponse.ok()).toBeTruthy();
    status = ((await runResponse.json()) as { status: string }).status;
  }

  expect(status).toBe('PASSED');
  await openAuthenticatedPage(page, workspace.owner, `/runs/${testRunId}`);
  await expect(page.getByRole('heading', { name: 'Run details' })).toBeVisible();
  await expect(page.getByText('Passed', { exact: true }).first()).toBeVisible();
});
