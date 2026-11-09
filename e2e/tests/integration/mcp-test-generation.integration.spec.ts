import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, test } from '../support/workspace';
import { apiBaseUrl } from '../../support/workspace-state';

const FORM_URL = 'https://www.selenium.dev/selenium/web/web-form.html';
const POST_FORM_URL = 'https://httpbin.org/forms/post';

function parseTextResult<T>(response: unknown): T {
  if (!response || typeof response !== 'object' || !('content' in response)) {
    throw new Error('MCP tool returned no content');
  }
  const content = response.content;
  if (!Array.isArray(content)) throw new Error('MCP tool returned invalid content');
  const first = content[0];
  if (!first || typeof first !== 'object' || !('text' in first) || typeof first.text !== 'string') {
    throw new Error('MCP tool returned no text payload');
  }
  if ('isError' in response && response.isError === true) throw new Error(first.text);
  return JSON.parse(first.text) as T;
}

async function callTool<T>(client: Client, name: string, args: Record<string, unknown>) {
  return parseTextResult<T>(await client.callTool({ name, arguments: args }));
}

async function waitForTerminalRun(client: Client, runId: string) {
  const deadline = Date.now() + 90_000;
  let status = '';
  while (Date.now() < deadline) {
    const current = await callTool<{ status: string }>(client, 'get_run_status', { runId });
    status = current.status;
    if (status === 'PASSED' || status === 'FAILED') return status;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Run ${runId} did not reach a terminal status; last status was ${status || 'unknown'}`);
}

test('MCP generation workflow plans four observed scenarios, runs a suite, and repairs one confirmed locator defect', async ({ workspace }, testInfo) => {
  testInfo.setTimeout(300_000);
  const suffix = Date.now();
  let tokenId: string | undefined;
  let client: Client | undefined;
  let activeSessionId: string | undefined;
  const checkIds: string[] = [];
  let suiteId: string | undefined;

  const startSession = async () => {
    const session = await callTool<{ id: string; title: string; actions: { action: string; selector?: string; value?: string }[] }>(
      client!, 'browser_start', { projectId: workspace.projectId, url: FORM_URL }
    );
    activeSessionId = session.id;
    return session;
  };

  const closeSession = async () => {
    if (!activeSessionId) return;
    await callTool(client!, 'browser_close', { projectId: workspace.projectId, sessionId: activeSessionId }).catch(() => undefined);
    activeSessionId = undefined;
  };

  const createCheck = async (name: string, steps: Record<string, unknown>[], url = FORM_URL) => {
    const check = await callTool<{ id: string }>(client!, 'create_check', {
      projectId: workspace.projectId,
      name: `${name} ${suffix}`,
      url,
      steps,
      useProjectAuthentication: false
    });
    checkIds.push(check.id);
    return check.id;
  };

  try {
    const tokenResponse = await workspace.adminApi.post('/auth/api-tokens', {
      data: { name: `MCP generation E2E ${suffix}`, expiresInDays: 1 }
    });
    expect(tokenResponse.status()).toBe(201);
    const issued = await tokenResponse.json() as { id: string; token: string };
    tokenId = issued.id;

    const root = process.cwd();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'mcp-server/src/index.ts')],
      env: {
        ...process.env,
        WRIGHTTEST_URL: apiBaseUrl,
        WRIGHTTEST_API_TOKEN: issued.token
      } as Record<string, string>,
      cwd: root,
      stderr: 'pipe'
    });
    client = new Client({ name: 'wrighttest-test-generation-e2e', version: '1.0.0' });
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(32);
    const projects = await callTool<{ id: string }[]>(client, 'list_projects', {});
    expect(projects.some((project) => project.id === workspace.projectId)).toBe(true);

    // Scenario 1: the page title is an observed, stable load outcome.
    const initial = await startSession();
    const initialSnapshot = await callTool<{ snapshot: string }>(client, 'browser_snapshot', {
      projectId: workspace.projectId, sessionId: activeSessionId
    });
    expect(initial.title).toBe('Web form');
    expect(initialSnapshot.snapshot).toContain('Text input');
    expect(initialSnapshot.snapshot).toContain('Dropdown (select)');
    expect(initialSnapshot.snapshot).toContain('Default checkbox');
    const pageLoadCheckId = await createCheck('Form page loads', [
      { action: 'goto', value: FORM_URL },
      { action: 'assertTitle', expected: 'Web form', options: { exact: true } }
    ]);

    await closeSession();

    // Scenario 2: user-approved synthetic submission to the established HTTPBin test endpoint.
    const syntheticValue = `WrightTest synthetic QA ${suffix}`;
    const postPage = await callTool<{ id: string }>(client, 'browser_start', {
      projectId: workspace.projectId, url: POST_FORM_URL
    });
    activeSessionId = postPage.id;
    const postSnapshot = await callTool<{ snapshot: string }>(client, 'browser_snapshot', {
      projectId: workspace.projectId, sessionId: activeSessionId
    });
    expect(postSnapshot.snapshot).toContain('Customer name');
    expect(postSnapshot.snapshot).toContain('Submit order');
    await callTool(client, 'browser_fill', {
      projectId: workspace.projectId,
      sessionId: activeSessionId,
      selector: "page.getByLabel('Customer name:')",
      value: syntheticValue
    });
    await callTool(client, 'browser_click', {
      projectId: workspace.projectId,
      sessionId: activeSessionId,
      selector: "page.getByRole('button', { name: 'Submit order' })",
      confirmedSideEffect: true
    });
    const submitted = await callTool<{
      url: string;
      title: string;
      snapshot: string;
      actions: { action: string; selector?: string; value?: string }[];
      blockedRequests: string[];
    }>(client, 'browser_snapshot', { projectId: workspace.projectId, sessionId: activeSessionId });
    expect(submitted.url).toContain('/post');
    expect(submitted.snapshot).toContain(syntheticValue);
    const submitCheckId = await createCheck('Synthetic form submission', [
      ...submitted.actions,
      { action: 'assertText', selector: "page.locator('body')", expected: syntheticValue }
    ], POST_FORM_URL);
    await closeSession();

    // Scenario 3: the option label/value pair is observed in the page snapshot/source.
    const selectPage = await startSession();
    const selectSnapshot = await callTool<{ snapshot: string }>(client, 'browser_snapshot', {
      projectId: workspace.projectId, sessionId: activeSessionId
    });
    expect(selectSnapshot.snapshot).toContain('One');
    expect(selectSnapshot.snapshot).toContain('Two');
    expect(selectPage.title).toBe('Web form');
    await callTool(client, 'browser_select', {
      projectId: workspace.projectId,
      sessionId: activeSessionId,
      selector: "page.getByLabel('Dropdown (select)')",
      value: '2'
    });
    const selected = await callTool<{ actions: { action: string; selector?: string; value?: string }[] }>(client, 'browser_snapshot', {
      projectId: workspace.projectId, sessionId: activeSessionId
    });
    expect(selected.actions.at(-1)).toMatchObject({ action: 'selectOption', value: '2' });
    const selectCheckId = await createCheck('Dropdown selects option Two', [
      ...selected.actions,
      { action: 'assertValue', selector: "page.getByLabel('Dropdown (select)')", expected: '2' }
    ]);
    await closeSession();

    // Scenario 4: toggle an observed unchecked box and assert its resulting state.
    await startSession();
    const checkboxSnapshot = await callTool<{ snapshot: string }>(client, 'browser_snapshot', {
      projectId: workspace.projectId, sessionId: activeSessionId
    });
    expect(checkboxSnapshot.snapshot).toContain('Default checkbox');
    await callTool(client, 'browser_click', {
      projectId: workspace.projectId,
      sessionId: activeSessionId,
      selector: "page.getByLabel('Default checkbox')"
    });
    const checked = await callTool<{ actions: { action: string; selector?: string; value?: string }[] }>(client, 'browser_snapshot', {
      projectId: workspace.projectId, sessionId: activeSessionId
    });
    expect(checked.actions.at(-1)).toMatchObject({ action: 'click' });
    const checkboxCheckId = await createCheck('Default checkbox can be checked', [
      ...checked.actions,
      { action: 'assertChecked', selector: "page.getByLabel('Default checkbox')" }
    ]);
    await closeSession();

    const suite = await callTool<{ id: string }>(client, 'create_suite', {
      projectId: workspace.projectId,
      name: `Observed browser scenarios ${suffix}`,
      checkIds: [pageLoadCheckId, submitCheckId, selectCheckId, checkboxCheckId]
    });
    suiteId = suite.id;
    const queuedSuite = await callTool<{ jobs: { testRunId: string }[] }>(client, 'run_suite', { suiteId });
    expect(queuedSuite.jobs).toHaveLength(4);
    const suiteStatuses = await Promise.all(queuedSuite.jobs.map(({ testRunId }) => waitForTerminalRun(client!, testRunId)));
    expect(suiteStatuses).toEqual(['PASSED', 'PASSED', 'PASSED', 'PASSED']);
    for (const { testRunId } of queuedSuite.jobs) {
      const results = await callTool<{ status: string; stepResults: { status: string }[] }>(client, 'get_run_results', { runId: testRunId });
      expect(results.status).toBe('PASSED');
      expect(results.stepResults.length).toBeGreaterThan(0);
      expect(results.stepResults.every((step) => step.status === 'passed')).toBe(true);
    }

    // Deliberately wrong, observed-label locator. Diagnose its real failure, then repair the locator only.
    const repairCheckId = await createCheck('Locator repair demonstration', [
      { action: 'goto', value: FORM_URL },
      { action: 'assertVisible', selector: "page.getByLabel('Email address')", options: { timeout: 1000 } }
    ]);
    const failedRun = await callTool<{ testRunId: string }>(client, 'run_check', { checkId: repairCheckId });
    expect(await waitForTerminalRun(client, failedRun.testRunId)).toBe('FAILED');
    const failure = await callTool<{ status: string; stepResults: { status: string; error?: string }[] }>(client, 'get_run_results', {
      runId: failedRun.testRunId
    });
    expect(failure.status).toBe('FAILED');
    expect(failure.stepResults.some((step) => step.status === 'failed' && step.error?.includes('Email address'))).toBe(true);

    const repaired = await callTool<{ id: string; steps: unknown[] }>(client, 'update_check', {
      checkId: repairCheckId,
      steps: [
        { action: 'goto', value: FORM_URL },
        { action: 'assertVisible', selector: "page.getByLabel('Text input')" }
      ]
    });
    expect(repaired.id).toBe(repairCheckId);
    const repairedRun = await callTool<{ testRunId: string }>(client, 'run_check', { checkId: repairCheckId });
    expect(await waitForTerminalRun(client, repairedRun.testRunId)).toBe('PASSED');
    const repairedResults = await callTool<{ status: string; stepResults: { status: string }[] }>(client, 'get_run_results', {
      runId: repairedRun.testRunId
    });
    expect(repairedResults.status).toBe('PASSED');
    expect(repairedResults.stepResults.every((step) => step.status === 'passed')).toBe(true);
  } finally {
    await closeSession();
    await client?.close().catch(() => undefined);
    if (suiteId) await workspace.adminApi.delete(`/suites/${suiteId}`).catch(() => undefined);
    for (const checkId of checkIds) await workspace.adminApi.delete(`/tests/${checkId}`).catch(() => undefined);
    if (tokenId) await workspace.adminApi.delete(`/auth/api-tokens/${tokenId}`).catch(() => undefined);
  }
});
