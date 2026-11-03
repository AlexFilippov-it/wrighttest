import { expect, test } from '../support/workspace';

test('real recorder session starts, reports active status, and stops cleanly', async ({ workspace }) => {
  test.skip(process.env.E2E_RECORDER !== '1', 'Set E2E_RECORDER=1 when headed browser/noVNC services are available');

  const startResponse = await workspace.adminApi.post('/recordings/start', {
    data: {
      projectId: workspace.projectId,
      url: 'https://example.com',
      useProjectAuthentication: false
    }
  });
  expect(startResponse.ok()).toBeTruthy();
  const { sessionId } = await startResponse.json() as { sessionId: string };

  try {
    const statusResponse = await workspace.adminApi.get(`/recordings/${sessionId}`);
    expect(statusResponse.ok()).toBeTruthy();
    await expect.poll(async () => {
      const response = await workspace.adminApi.get(`/recordings/${sessionId}`);
      if (!response.ok()) return 'missing';
      return ((await response.json()) as { status: string }).status;
    }).toBe('active');
  } finally {
    const stopResponse = await workspace.adminApi.post(`/recordings/${sessionId}/stop`);
    expect(stopResponse.ok()).toBeTruthy();
  }
});
