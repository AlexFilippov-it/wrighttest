import { expect, test } from '../support/workspace';
import { recoverSuiteRuns } from '../../../backend/src/services/suite-runner';
import { testQueue } from '../../../backend/src/queue/queue';
import redis from '../../../backend/src/redis';
import prisma from '../../../backend/src/prisma';

type SuiteRunResponse = {
  id: string;
  status: string;
  error?: string | null;
  testRuns: Array<{ id: string; testId: string; status: string; suiteOrder: number | null }>;
};

async function createCheck(workspace: { adminApi: import('@playwright/test').APIRequestContext; projectId: string }, name: string, steps: Array<Record<string, unknown>>) {
  const response = await workspace.adminApi.post(`/projects/${workspace.projectId}/tests`, {
    data: { name, url: 'about:blank', steps, testData: [], useProjectAuthentication: false }
  });
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json() as { id: string }).id;
}

async function createSuite(workspace: { adminApi: import('@playwright/test').APIRequestContext; projectId: string }, input: {
  name: string;
  testIds: string[];
  executionMode: 'INDEPENDENT' | 'SEQUENTIAL';
  mappings?: Array<Record<string, unknown>>;
}) {
  const response = await workspace.adminApi.post(`/projects/${workspace.projectId}/suites`, {
    data: {
      name: input.name,
      testIds: input.testIds,
      executionMode: input.executionMode,
      executionConfig: { orderedTestIds: input.testIds, mappings: input.mappings ?? [], dataCaseIndexes: {} }
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

async function getSuiteRun(id: string) {
  const run = await prisma.suiteRun.findUnique({
    where: { id },
    select: { id: true, status: true, error: true, testRuns: { select: { id: true, testId: true, status: true, suiteOrder: true } } }
  });
  if (!run) throw new Error(`SuiteRun ${id} disappeared during the isolated integration test.`);
  return run as SuiteRunResponse;
}

async function waitForTerminal(id: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let current = await getSuiteRun(id);
  while (Date.now() < deadline && !['PASSED', 'FAILED', 'CANCELLED'].includes(current.status)) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    current = await getSuiteRun(id);
  }
  return current;
}

const pageWithText = (value: string) => `data:text/html,%3Cmain%20id%3D%22value%22%3E${encodeURIComponent(value)}%3C%2Fmain%3E`;
const captureSteps = (value: string, secret = false) => [
  { action: 'goto', value: pageWithText(value) },
  { action: 'captureValue', selector: "page.locator('#value')", captureSource: 'text', saveAs: 'RUN_VALUE', secret },
  { action: 'assertText', selector: "page.locator('#value')", expected: value }
];

test.afterAll(async () => {
  await testQueue.close().catch(() => undefined);
  redis.disconnect();
  await prisma.$disconnect().catch(() => undefined);
});

test('repeated startup recovery is idempotent and does not duplicate Suite child runs', async ({ workspace }) => {
  const suffix = `${Date.now()}`;
  const checkId = await createCheck(workspace, `Recovery check ${suffix}`, [
    { action: 'goto', value: pageWithText('recovered') },
    { action: 'assertText', selector: "page.locator('#value')", expected: 'recovered' }
  ]);
  let suiteId: string | undefined;
  try {
    suiteId = await createSuite(workspace, { name: `Recovery suite ${suffix}`, testIds: [checkId], executionMode: 'INDEPENDENT' });
    const runId = await startSuite(workspace, suiteId);

    // This is the exact startup recovery path. Repeating it models a worker restart/redelivery.
    await Promise.all([recoverSuiteRuns(), recoverSuiteRuns()]);
    const result = await waitForTerminal(runId);
    expect(result.status, result.error ?? '').toBe('PASSED');
    expect(result.testRuns).toHaveLength(1);
    expect(new Set(result.testRuns.map((run) => run.id)).size).toBe(1);
  } finally {
    if (suiteId) await workspace.adminApi.delete(`/suites/${suiteId}`).catch(() => undefined);
    await workspace.adminApi.delete(`/tests/${checkId}`).catch(() => undefined);
  }
});

test('parallel sequential Suite Runs keep output values isolated', async ({ workspace }) => {
  const suffix = `${Date.now()}`;
  const checkIds: string[] = [];
  const suiteIds: string[] = [];
  try {
    const sourceA = await createCheck(workspace, `Parallel source A ${suffix}`, captureSteps(`token-a-${suffix}`));
    const sourceB = await createCheck(workspace, `Parallel source B ${suffix}`, captureSteps(`token-b-${suffix}`));
    const target = await createCheck(workspace, `Parallel target ${suffix}`, [
      { action: 'goto', value: 'data:text/html,%3Cmain%20id%3D%22value%22%3E{{RUN_VALUE}}%3C%2Fmain%3E' },
      { action: 'assertText', selector: "page.locator('#value')", expected: '{{RUN_VALUE}}' }
    ]);
    checkIds.push(sourceA, sourceB, target);
    const suiteA = await createSuite(workspace, { name: `Parallel suite A ${suffix}`, testIds: [sourceA, target], executionMode: 'SEQUENTIAL', mappings: [
      { sourceTestId: sourceA, outputVariable: 'RUN_VALUE', targetTestId: target, targetVariable: 'RUN_VALUE', required: true, expectedType: 'string' }
    ] });
    const suiteB = await createSuite(workspace, { name: `Parallel suite B ${suffix}`, testIds: [sourceB, target], executionMode: 'SEQUENTIAL', mappings: [
      { sourceTestId: sourceB, outputVariable: 'RUN_VALUE', targetTestId: target, targetVariable: 'RUN_VALUE', required: true, expectedType: 'string' }
    ] });
    suiteIds.push(suiteA, suiteB);
    const [runA, runB] = await Promise.all([startSuite(workspace, suiteA), startSuite(workspace, suiteB)]);
    await Promise.all([recoverSuiteRuns(), recoverSuiteRuns()]);
    const [resultA, resultB] = await Promise.all([waitForTerminal(runA), waitForTerminal(runB)]);
    expect(resultA.status, resultA.error ?? '').toBe('PASSED');
    expect(resultB.status, resultB.error ?? '').toBe('PASSED');
    expect(resultA.testRuns.map((run) => run.testId)).toEqual([sourceA, target]);
    expect(resultB.testRuns.map((run) => run.testId)).toEqual([sourceB, target]);
    expect(resultA.testRuns[1].id).not.toBe(resultB.testRuns[1].id);
    expect(new Set(resultA.testRuns.map((run) => run.suiteOrder)).size).toBe(resultA.testRuns.length);
    expect(new Set(resultB.testRuns.map((run) => run.suiteOrder)).size).toBe(resultB.testRuns.length);
  } finally {
    for (const id of suiteIds) await workspace.adminApi.delete(`/suites/${id}`).catch(() => undefined);
    for (const id of checkIds) await workspace.adminApi.delete(`/tests/${id}`).catch(() => undefined);
  }
});

test('cancellation racing with a child transition prevents later checks from running', async ({ workspace }) => {
  test.setTimeout(90_000);
  const suffix = `${Date.now()}`;
  const checkIds: string[] = [];
  let suiteId: string | undefined;
  try {
    const first = await createCheck(workspace, `Cancel first ${suffix}`, [
      { action: 'goto', value: pageWithText('ready') },
      { action: 'waitForSelector', selector: "page.locator('#missing')" }
    ]);
    const second = await createCheck(workspace, `Cancel second ${suffix}`, [
      { action: 'goto', value: pageWithText('second') },
      { action: 'assertText', selector: "page.locator('#value')", expected: 'second' }
    ]);
    const third = await createCheck(workspace, `Cancel third ${suffix}`, [
      { action: 'goto', value: pageWithText('third') },
      { action: 'assertText', selector: "page.locator('#value')", expected: 'third' }
    ]);
    checkIds.push(first, second, third);
    suiteId = await createSuite(workspace, { name: `Cancel race ${suffix}`, testIds: checkIds, executionMode: 'SEQUENTIAL' });
    const runId = await startSuite(workspace, suiteId);

    const deadline = Date.now() + 20_000;
    let current = await getSuiteRun(runId);
    while (Date.now() < deadline && !current.testRuns.some((run) => run.testId === first && run.status === 'RUNNING')) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      current = await getSuiteRun(runId);
    }
    expect(current.testRuns.find((run) => run.testId === first)?.status).toBe('RUNNING');

    const cancel = await workspace.adminApi.post(`/suite-runs/${runId}/cancel`, { data: {} });
    expect(cancel.status()).toBe(200);
    current = await waitForTerminal(runId);
    expect(current.status).toBe('CANCELLED');
    expect(current.testRuns.some((run) => run.testId === second && ['RUNNING', 'PASSED'].includes(run.status))).toBe(false);
    expect(current.testRuns.some((run) => run.testId === third && ['RUNNING', 'PASSED'].includes(run.status))).toBe(false);
    const childDeadline = Date.now() + 20_000;
    while (Date.now() < childDeadline && current.testRuns.some((run) => run.testId === first && run.status === 'RUNNING')) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      current = await getSuiteRun(runId);
    }
    expect(current.testRuns.find((run) => run.testId === first)?.status).not.toBe('RUNNING');
  } finally {
    if (suiteId) await workspace.adminApi.delete(`/suites/${suiteId}`).catch(() => undefined);
    for (const id of checkIds) await workspace.adminApi.delete(`/tests/${id}`).catch(() => undefined);
  }
});

test('Independent mode keeps its parallel execution contract', async ({ workspace }) => {
  const suffix = `${Date.now()}`;
  const checkIds: string[] = [];
  let suiteId: string | undefined;
  try {
    for (const value of ['one', 'two', 'three']) {
      checkIds.push(await createCheck(workspace, `Independent ${value} ${suffix}`, [
        { action: 'goto', value: pageWithText(value) },
        { action: 'assertText', selector: "page.locator('#value')", expected: value }
      ]));
    }
    suiteId = await createSuite(workspace, { name: `Independent suite ${suffix}`, testIds: checkIds, executionMode: 'INDEPENDENT' });
    const runId = await startSuite(workspace, suiteId);
    const result = await waitForTerminal(runId);
    expect(result.status, result.error ?? '').toBe('PASSED');
    expect(result.testRuns.map((run) => run.testId).sort()).toEqual([...checkIds].sort());
    expect(result.testRuns.every((run) => run.status === 'PASSED')).toBe(true);
  } finally {
    if (suiteId) await workspace.adminApi.delete(`/suites/${suiteId}`).catch(() => undefined);
    for (const id of checkIds) await workspace.adminApi.delete(`/tests/${id}`).catch(() => undefined);
  }
});
