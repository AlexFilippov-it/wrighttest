import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '../support/workspace';
import { testQueue } from '../../../backend/src/queue/queue';
import { buildTestRunJobId } from '../../../backend/src/queue/batch-sequencer';
import { finalizeSuiteChild } from '../../../backend/src/services/suite-runner';
import prisma from '../../../backend/src/prisma';

type SuiteRunState = {
  id: string;
  status: string;
  error: string | null;
  currentOrder: number;
  testRuns: Array<{ id: string; testId: string; status: string; suiteOrder: number | null; currentStep: number | null; startedAt: Date | null; error: string | null }>;
};

const encodedPage = (html: string) => `data:text/html,${encodeURIComponent(html)}`;

async function createCheck(workspace: { adminApi: import('@playwright/test').APIRequestContext; projectId: string }, name: string, steps: Array<Record<string, unknown>>) {
  const response = await workspace.adminApi.post(`/projects/${workspace.projectId}/tests`, {
    data: { name, url: 'about:blank', steps, testData: [], useProjectAuthentication: false }
  });
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json() as { id: string }).id;
}

async function createSuite(workspace: { adminApi: import('@playwright/test').APIRequestContext; projectId: string }, name: string, testIds: string[], mappings: Array<Record<string, unknown>> = []) {
  const response = await workspace.adminApi.post(`/projects/${workspace.projectId}/suites`, {
    data: {
      name,
      testIds,
      executionMode: 'SEQUENTIAL',
      executionConfig: { orderedTestIds: testIds, mappings, dataCaseIndexes: {} }
    }
  });
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json() as { id: string }).id;
}

async function startSuite(workspace: { adminApi: import('@playwright/test').APIRequestContext }, suiteId: string) {
  const response = await workspace.adminApi.post(`/suites/${suiteId}/run`, { data: {} });
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json() as { suiteRunId: string }).suiteRunId;
}

async function readSuiteRun(id: string): Promise<SuiteRunState> {
  const run = await prisma.suiteRun.findUnique({
    where: { id },
    select: {
      id: true, status: true, error: true, currentOrder: true,
      testRuns: { orderBy: { suiteOrder: 'asc' }, select: { id: true, testId: true, status: true, suiteOrder: true, currentStep: true, startedAt: true, error: true } }
    }
  });
  if (!run) throw new Error(`SuiteRun ${id} disappeared.`);
  return run;
}

async function waitForSuiteRun(id: string, timeoutMs = 150_000) {
  const deadline = Date.now() + timeoutMs;
  let run = await readSuiteRun(id);
  while (Date.now() < deadline && !['PASSED', 'FAILED', 'CANCELLED'].includes(run.status)) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    run = await readSuiteRun(id);
  }
  return run;
}

async function waitForCondition<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs: number, message: string) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (Date.now() < deadline && !predicate(value)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }
  if (!predicate(value)) throw new Error(message);
  return value;
}

async function startWorker() {
  const tsxCli = path.join(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
  const child = spawn(process.execPath, [tsxCli, 'backend/scripts/suite-worker-process.ts'], {
    cwd: process.cwd(),
    env: process.env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout?.on('data', (data: Buffer) => { logs += data.toString(); });
  child.stderr?.on('data', (data: Buffer) => { logs += data.toString(); });
  await waitForCondition(
    async () => ({ ready: logs.includes('[SuiteWorker] ready'), exitCode: child.exitCode }),
    (state) => state.ready || state.exitCode !== null,
    30_000,
    'Dedicated Suite worker failed to start.'
  );
  if (!logs.includes('[SuiteWorker] ready')) throw new Error(`Suite worker exited before becoming ready. ${logs}`);
  return { child, getLogs: () => logs };
}

async function stopWorker(worker: { child: ChildProcess }, signal: NodeJS.Signals = 'SIGTERM') {
  if (worker.child.exitCode !== null) return;
  try {
    if (worker.child.pid && process.platform !== 'win32') process.kill(-worker.child.pid, signal);
    else worker.child.kill(signal);
  } catch {
    worker.child.kill(signal);
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Dedicated Suite worker did not exit after the requested signal.')), 15_000);
    worker.child.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
}

test('Sequential Suite recovers after its worker is killed during the second Check', async ({ workspace }) => {
  test.setTimeout(240_000);
  const suffix = `${Date.now()}`;
  const checkIds: string[] = [];
  let suiteId: string | undefined;
  let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
  let replacement: Awaited<ReturnType<typeof startWorker>> | undefined;
  const secretValue = `restart-secret-${suffix}`;

  try {
    const first = await createCheck(workspace, `Restart first ${suffix}`, [
      { action: 'goto', value: encodedPage(`<main id="id">${secretValue}</main>`) },
      { action: 'captureValue', selector: "page.locator('#id')", captureSource: 'text', saveAs: 'USER_ID', secret: true },
      { action: 'assertText', selector: "page.locator('#id')", expected: secretValue }
    ]);
    const second = await createCheck(workspace, `Restart second ${suffix}`, [
      { action: 'goto', value: encodedPage(`<main id="id">${secretValue}</main><div id="ready">loading</div><script>setTimeout(() => { document.querySelector("#ready").textContent = "ready"; }, 2000)</script>`) },
      { action: 'assertText', selector: "page.locator('#ready')", expected: 'ready' },
      { action: 'assertText', selector: "page.locator('#id')", expected: '{{USER_ID}}' },
      { action: 'captureValue', selector: "page.locator('#id')", captureSource: 'text', saveAs: 'USER_ID', secret: true }
    ]);
    const third = await createCheck(workspace, `Restart third ${suffix}`, [
      { action: 'goto', value: encodedPage('<main id="id">{{USER_ID}}</main>').replace('%7B%7BUSER_ID%7D%7D', '{{USER_ID}}') },
      { action: 'assertText', selector: "page.locator('#id')", expected: '{{USER_ID}}' }
    ]);
    checkIds.push(first, second, third);
    suiteId = await createSuite(workspace, `Worker restart ${suffix}`, checkIds, [
      { sourceTestId: first, outputVariable: 'USER_ID', targetTestId: second, targetVariable: 'USER_ID', required: true, expectedType: 'string' },
      { sourceTestId: second, outputVariable: 'USER_ID', targetTestId: third, targetVariable: 'USER_ID', required: true, expectedType: 'string' }
    ]);

    worker = await startWorker();
    const suiteRunId = await startSuite(workspace, suiteId);
    const runningSecond = await waitForCondition(
      () => readSuiteRun(suiteRunId),
      (run) => run.testRuns.some((item) => item.testId === second && item.status === 'RUNNING' && (item.currentStep ?? 0) >= 2),
      90_000,
      'Second Check did not enter the delayed step before the worker-restart deadline.'
    );
    expect(runningSecond.testRuns.find((item) => item.testId === first)?.status).toBe('PASSED');
    expect(runningSecond.testRuns).toHaveLength(2);

    await stopWorker(worker, 'SIGKILL');
    worker = undefined;
    replacement = await startWorker();

    const completed = await waitForSuiteRun(suiteRunId);
    expect(completed.status, `${completed.error ?? ''}; children=${JSON.stringify(completed.testRuns)}`).toBe('PASSED');
    expect(completed.testRuns.map((item) => item.testId)).toEqual(checkIds);
    expect(completed.testRuns.map((item) => item.suiteOrder)).toEqual([0, 1, 2]);
    expect(completed.testRuns.every((item) => item.status === 'PASSED')).toBe(true);
    expect(new Set(completed.testRuns.map((item) => item.id)).size).toBe(3);

    const apiResponse = await workspace.adminApi.get(`/suite-runs/${suiteRunId}`);
    expect(apiResponse.ok()).toBeTruthy();
    const safeResponse = await apiResponse.text();
    expect(safeResponse).not.toContain(secretValue);
    expect(safeResponse).toContain('"secret":true');
    expect(replacement.getLogs()).not.toContain(secretValue);
  } finally {
    if (worker) await stopWorker(worker).catch(() => undefined);
    if (replacement) await stopWorker(replacement).catch(() => undefined);
    if (suiteId) await workspace.adminApi.delete(`/suites/${suiteId}`).catch(() => undefined);
    for (const id of checkIds) await workspace.adminApi.delete(`/tests/${id}`).catch(() => undefined);
  }
});

test('startup recovery queues a committed next Check and a queued Check waits for worker startup', async ({ workspace }) => {
  test.setTimeout(120_000);
  const suffix = `${Date.now()}`;
  const checkIds: string[] = [];
  const suiteIds: string[] = [];
  const workers: Array<Awaited<ReturnType<typeof startWorker>>> = [];

  try {
    const queuedCheck = await createCheck(workspace, `Queued before worker ${suffix}`, [
      { action: 'goto', value: encodedPage('<main>queued</main>') },
      { action: 'assertText', selector: 'body', expected: 'queued' }
    ]);
    checkIds.push(queuedCheck);
    const queuedSuite = await createSuite(workspace, `Queued suite ${suffix}`, [queuedCheck]);
    suiteIds.push(queuedSuite);
    const queuedRunId = await startSuite(workspace, queuedSuite);
    expect((await readSuiteRun(queuedRunId)).testRuns).toHaveLength(1);
    workers.push(await startWorker());
    const queuedRun = await waitForSuiteRun(queuedRunId);
    expect(queuedRun.status, queuedRun.error ?? '').toBe('PASSED');
    await stopWorker(workers.pop()!);

    const first = await createCheck(workspace, `Txn completed before enqueue ${suffix}`, [
      { action: 'goto', value: encodedPage('<main>first</main>') },
      { action: 'assertText', selector: 'body', expected: 'first' }
    ]);
    const second = await createCheck(workspace, `Recovered next ${suffix}`, [
      { action: 'goto', value: encodedPage('<main>second</main>') },
      { action: 'assertText', selector: 'body', expected: 'second' }
    ]);
    checkIds.push(first, second);
    const suiteId = await createSuite(workspace, `Commit gap ${suffix}`, [first, second]);
    suiteIds.push(suiteId);
    const runId = await startSuite(workspace, suiteId);
    const firstRun = (await readSuiteRun(runId)).testRuns[0];
    const queuedFirstJob = await testQueue.getJob(buildTestRunJobId(firstRun.id));
    expect(queuedFirstJob).toBeTruthy();
    await queuedFirstJob!.remove();

    let recoverySecondId = '';
    await prisma.$transaction(async (tx) => {
      await tx.testRun.update({ where: { id: firstRun.id }, data: { status: 'PASSED', startedAt: new Date(), finishedAt: new Date(), durationMs: 1 } });
      const next = await finalizeSuiteChild(tx, firstRun.id, 'PASSED', []);
      expect(next?.testId).toBe(second);
      recoverySecondId = next!.id;
    });
    expect(await testQueue.getJob(buildTestRunJobId(recoverySecondId))).toBeFalsy();

    workers.push(await startWorker());
    const recoveredRun = await waitForSuiteRun(runId);
    expect(recoveredRun.status, recoveredRun.error ?? '').toBe('PASSED');
    expect(recoveredRun.testRuns.map((item) => item.testId)).toEqual([first, second]);
    expect(new Set(recoveredRun.testRuns.map((item) => item.id)).size).toBe(2);
  } finally {
    for (const worker of workers) await stopWorker(worker).catch(() => undefined);
    for (const id of suiteIds) await workspace.adminApi.delete(`/suites/${id}`).catch(() => undefined);
    for (const id of checkIds) await workspace.adminApi.delete(`/tests/${id}`).catch(() => undefined);
  }
});
