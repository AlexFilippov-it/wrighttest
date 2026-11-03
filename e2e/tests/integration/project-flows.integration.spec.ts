import { expect, test } from '../support/workspace';

test('checks support create, update, and delete', async ({ workspace }, testInfo) => {
  testInfo.setTimeout(120_000);
  const name = `E2E CRUD check ${Date.now()}`;
  let checkId: string | undefined;

  try {
    const create = await workspace.adminApi.post(`/projects/${workspace.projectId}/tests`, {
      data: {
        name,
        url: 'data:text/html,<title>WrightTest CRUD</title>',
        steps: [{ action: 'goto', value: 'data:text/html,<title>WrightTest CRUD</title>' }],
        testData: [],
        useProjectAuthentication: false
      }
    });
    expect(create.status()).toBe(201);
    const created = await create.json() as { id: string; name: string };
    checkId = created.id;
    expect(created.name).toBe(name);

    const update = await workspace.adminApi.patch(`/tests/${checkId}`, { data: { name: `${name} updated` } });
    expect(update.ok()).toBeTruthy();
    expect((await update.json() as { name: string }).name).toBe(`${name} updated`);

    const remove = await workspace.adminApi.delete(`/tests/${checkId}`);
    expect(remove.status()).toBe(204);
    checkId = undefined;
  } finally {
    if (checkId) await workspace.adminApi.delete(`/tests/${checkId}`).catch(() => undefined);
  }
});

test('suites can be managed and executed; schedules can be safely managed disabled', async ({ workspace }, testInfo) => {
  testInfo.setTimeout(120_000);
  const suiteName = `E2E suite ${Date.now()}`;
  let suiteId: string | undefined;
  let scheduleId: string | undefined;

  try {
    const createSuite = await workspace.adminApi.post(`/projects/${workspace.projectId}/suites`, {
      data: { name: suiteName, testIds: [workspace.checkId] }
    });
    expect(createSuite.status()).toBe(201);
    const createdSuite = await createSuite.json() as { id: string; name: string };
    suiteId = createdSuite.id;
    expect(createdSuite.name).toBe(suiteName);

    const updateSuite = await workspace.adminApi.patch(`/suites/${suiteId}`, {
      data: { name: `${suiteName} updated` }
    });
    expect(updateSuite.ok()).toBeTruthy();
    expect((await updateSuite.json() as { name: string }).name).toBe(`${suiteName} updated`);

    const suiteRun = await workspace.adminApi.post(`/suites/${suiteId}/run`, { data: {} });
    expect(suiteRun.status()).toBe(202);
    const queued = await suiteRun.json() as { queued: number; jobs: { testRunId: string }[] };
    expect(queued.queued).toBe(1);
    expect(queued.jobs).toHaveLength(1);

    let runStatus = 'PENDING';
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && (runStatus === 'PENDING' || runStatus === 'RUNNING')) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const run = await workspace.adminApi.get(`/runs/${queued.jobs[0].testRunId}`);
      expect(run.ok()).toBeTruthy();
      runStatus = ((await run.json()) as { status: string }).status;
    }
    expect(runStatus).toBe('PASSED');

    const scheduleName = `${suiteName} schedule`;
    const createSchedule = await workspace.adminApi.post(`/projects/${workspace.projectId}/schedules`, {
      data: {
        name: scheduleName,
        cron: '*/5 * * * *',
        suiteId,
        enabled: false
      }
    });
    expect(createSchedule.status()).toBe(201);
    const createdSchedule = await createSchedule.json() as { id: string; name: string; enabled: boolean };
    scheduleId = createdSchedule.id;
    expect(createdSchedule.enabled).toBe(false);

    const updateSchedule = await workspace.adminApi.patch(`/schedules/${scheduleId}`, {
      data: { name: `${scheduleName} updated` }
    });
    expect(updateSchedule.ok()).toBeTruthy();
    expect((await updateSchedule.json() as { name: string; enabled: boolean })).toMatchObject({
      name: `${scheduleName} updated`,
      enabled: false
    });

    const removeSchedule = await workspace.adminApi.delete(`/schedules/${scheduleId}`);
    expect(removeSchedule.status()).toBe(204);
    scheduleId = undefined;

    const removeSuite = await workspace.adminApi.delete(`/suites/${suiteId}`);
    expect(removeSuite.status()).toBe(204);
    suiteId = undefined;
  } finally {
    if (scheduleId) await workspace.adminApi.delete(`/schedules/${scheduleId}`).catch(() => undefined);
    if (suiteId) await workspace.adminApi.delete(`/suites/${suiteId}`).catch(() => undefined);
  }
});
