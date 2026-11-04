import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, test } from '../support/workspace';
import { apiBaseUrl } from '../../support/workspace-state';

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
  if ('isError' in response && response.isError === true) {
    throw new Error(first.text);
  }
  return JSON.parse(first.text) as T;
}

test('stdio MCP client lists projects, creates and runs a check, then reads the result', async ({ workspace }, testInfo) => {
  testInfo.setTimeout(120_000);
  const tokenName = `E2E MCP ${Date.now()}`;
  const projectName = `E2E MCP project ${Date.now()}`;
  const checkName = `E2E MCP check ${Date.now()}`;
  let tokenId: string | undefined;
  let projectId: string | undefined;
  let checkId: string | undefined;
  let suiteId: string | undefined;
  let client: Client | undefined;

  try {
    const tokenResponse = await workspace.adminApi.post('/auth/api-tokens', {
      data: { name: tokenName, expiresInDays: 1 }
    });
    expect(tokenResponse.status()).toBe(201);
    const token = await tokenResponse.json() as { id: string; token: string };
    tokenId = token.id;

    const repositoryRoot = process.cwd();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        path.join(repositoryRoot, 'node_modules/tsx/dist/cli.mjs'),
        path.join(repositoryRoot, 'mcp-server/src/index.ts')
      ],
      env: {
        ...process.env,
        WRIGHTTEST_URL: apiBaseUrl,
        WRIGHTTEST_API_TOKEN: token.token
      } as Record<string, string>,
      cwd: repositoryRoot,
      stderr: 'pipe'
    });
    client = new Client({ name: 'wrighttest-e2e', version: '1.0.0' });
    await client.connect(transport);

    const toolList = await client.listTools();
    const toolNames = toolList.tools.map((tool) => tool.name);
    expect(toolNames).toHaveLength(24);
    expect(toolNames).toEqual(expect.arrayContaining([
      'browser_start', 'browser_navigate', 'browser_snapshot', 'browser_click', 'browser_fill',
      'browser_select', 'browser_screenshot', 'browser_wait', 'browser_close'
    ]));

    const createdProject = parseTextResult<{ id: string }>(await client.callTool({
      name: 'create_project',
      arguments: { name: projectName }
    }));
    projectId = createdProject.id;

    const renamedProject = parseTextResult<{ id: string; name: string }>(await client.callTool({
      name: 'update_project',
      arguments: { projectId, name: `${projectName} renamed` }
    }));
    expect(renamedProject).toMatchObject({ id: projectId, name: `${projectName} renamed` });

    const projects = parseTextResult<{ id: string; name: string }[]>(await client.callTool({ name: 'list_projects', arguments: {} }));
    expect(projects.some((project) => project.id === projectId)).toBeTruthy();

    const createdCheck = parseTextResult<{ id: string }>(await client.callTool({
      name: 'create_check',
      arguments: {
        projectId,
        name: checkName,
        url: 'data:text/html,<title>WrightTest MCP E2E</title><main>Ready</main>',
        steps: [
          { action: 'goto', value: 'data:text/html,<title>WrightTest MCP E2E</title><main>Ready</main>' },
          { action: 'assertTitle', expected: 'WrightTest MCP E2E' }
        ],
        useProjectAuthentication: false
      }
    }));
    checkId = createdCheck.id;

    const updatedCheck = parseTextResult<{ id: string; name: string }>(await client.callTool({
      name: 'update_check',
      arguments: { checkId, name: `${checkName} updated` }
    }));
    expect(updatedCheck).toMatchObject({ id: checkId, name: `${checkName} updated` });
    const checkAfterUpdate = parseTextResult<{ steps: unknown[] }>(await client.callTool({
      name: 'get_check',
      arguments: { checkId }
    }));
    expect(checkAfterUpdate.steps).toHaveLength(2);

    const queued = parseTextResult<{ testRunId: string }>(await client.callTool({
      name: 'run_check',
      arguments: { checkId }
    }));
    expect(queued.testRunId).toBeTruthy();

    let runStatus = '';
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const status = parseTextResult<{ status: string }>(await client.callTool({
        name: 'get_run_status',
        arguments: { runId: queued.testRunId }
      }));
      runStatus = status.status;
      if (runStatus === 'PASSED' || runStatus === 'FAILED') break;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    const results = parseTextResult<{ status: string; stepResults: { action: string; status: string }[] }>(await client.callTool({
      name: 'get_run_results',
      arguments: { runId: queued.testRunId }
    }));
    expect(runStatus, JSON.stringify(results)).toBe('PASSED');
    expect(results.status, JSON.stringify(results)).toBe('PASSED');
    expect(results.stepResults, JSON.stringify(results)).toEqual([
      expect.objectContaining({ index: 0, action: 'goto', status: 'passed' }),
      expect.objectContaining({ index: 1, action: 'assertTitle', status: 'passed' })
    ]);

    const suite = parseTextResult<{ id: string }>(await client.callTool({
      name: 'create_suite',
      arguments: { projectId, name: `E2E MCP suite ${Date.now()}`, checkIds: [checkId] }
    }));
    suiteId = suite.id;

    const updatedSuite = parseTextResult<{ testIds: string[] }>(await client.callTool({
      name: 'add_check_to_suite',
      arguments: { projectId, suiteId, checkId }
    }));
    expect(updatedSuite.testIds).toContain(checkId);

    const suiteRun = parseTextResult<{ jobs: { testRunId: string }[] }>(await client.callTool({
      name: 'run_suite',
      arguments: { suiteId }
    }));
    expect(suiteRun.jobs).toHaveLength(1);
    const suiteRunId = suiteRun.jobs[0].testRunId;
    let suiteStatus = '';
    const suiteDeadline = Date.now() + 60_000;
    while (Date.now() < suiteDeadline) {
      const status = parseTextResult<{ status: string }>(await client.callTool({
        name: 'get_run_status',
        arguments: { runId: suiteRunId }
      }));
      suiteStatus = status.status;
      if (suiteStatus === 'PASSED' || suiteStatus === 'FAILED') break;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    expect(suiteStatus).toBe('PASSED');
  } finally {
    await client?.close().catch(() => undefined);
    if (suiteId) await workspace.adminApi.delete(`/suites/${suiteId}`).catch(() => undefined);
    if (checkId) await workspace.adminApi.delete(`/tests/${checkId}`).catch(() => undefined);
    if (projectId) await workspace.adminApi.delete(`/projects/${projectId}`).catch(() => undefined);
    if (tokenId) await workspace.adminApi.delete(`/auth/api-tokens/${tokenId}`).catch(() => undefined);
  }
});
