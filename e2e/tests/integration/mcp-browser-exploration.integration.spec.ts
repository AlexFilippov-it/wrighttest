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
  if ('isError' in response && response.isError === true) throw new Error(first.text);
  return JSON.parse(first.text) as T;
}

test('MCP browser actions become runnable check steps after an observed safe form submission', async ({ workspace }, testInfo) => {
  testInfo.setTimeout(150_000);
  const suffix = Date.now();
  let tokenId: string | undefined;
  let checkId: string | undefined;
  let client: Client | undefined;
  let browserSessionId: string | undefined;

  try {
    const tokenResponse = await workspace.adminApi.post('/auth/api-tokens', {
      data: { name: `E2E browser MCP ${suffix}`, expiresInDays: 1 }
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
    client = new Client({ name: 'wrighttest-browser-e2e', version: '1.0.0' });
    await client.connect(transport);

    const page = parseTextResult<{ id: string; url: string; actions: { action: string; value?: string }[] }>(
      await client.callTool({
        name: 'browser_start',
        arguments: { projectId: workspace.projectId, url: 'https://httpbin.org/forms/post' }
      })
    );
    browserSessionId = page.id;
    expect(page.url).toContain('httpbin.org/forms/post');

    const initial = parseTextResult<{ snapshot: string }>(await client.callTool({
      name: 'browser_snapshot',
      arguments: { projectId: workspace.projectId, sessionId: browserSessionId }
    }));
    expect(initial.snapshot).toContain('Customer name');
    expect(initial.snapshot).toContain('Submit');

    const fill = parseTextResult<{ actions: { action: string; selector?: string; value?: string }[] }>(
      await client.callTool({
        name: 'browser_fill',
        arguments: {
          projectId: workspace.projectId,
          sessionId: browserSessionId,
          selector: "page.getByLabel('Customer name:')",
          value: 'wrighttest-safe-smoke'
        }
      })
    );
    expect(fill.actions.at(-1)).toMatchObject({ action: 'fill', value: 'wrighttest-safe-smoke' });

    const submit = parseTextResult<{ actions: { action: string; selector?: string }[] }>(
      await client.callTool({
        name: 'browser_click',
        arguments: {
          projectId: workspace.projectId,
          sessionId: browserSessionId,
          selector: "page.getByRole('button', { name: 'Submit order' })",
          confirmedSideEffect: true
        }
      })
    );
    expect(submit.actions.at(-1)).toMatchObject({ action: 'click' });

    const submitted = parseTextResult<{ url: string; snapshot: string; actions: { action: string; value?: string }[] }>(
      await client.callTool({
        name: 'browser_snapshot',
        arguments: { projectId: workspace.projectId, sessionId: browserSessionId }
      })
    );
    expect(submitted.url).toContain('/post');
    expect(submitted.snapshot).toContain('wrighttest-safe-smoke');

    const steps = [
      ...submitted.actions,
      { action: 'assertText', selector: 'page.locator(\'body\')', expected: 'wrighttest-safe-smoke' }
    ];
    const created = parseTextResult<{ id: string }>(await client.callTool({
      name: 'create_check',
      arguments: {
        projectId: workspace.projectId,
        name: `MCP observed form submit ${suffix}`,
        url: 'https://httpbin.org/forms/post',
        steps,
        useProjectAuthentication: false
      }
    }));
    checkId = created.id;

    const run = parseTextResult<{ testRunId: string }>(await client.callTool({
      name: 'run_check',
      arguments: { checkId }
    }));
    const deadline = Date.now() + 90_000;
    let status = '';
    while (Date.now() < deadline) {
      const current = parseTextResult<{ status: string }>(await client.callTool({
        name: 'get_run_status',
        arguments: { runId: run.testRunId }
      }));
      status = current.status;
      if (status === 'PASSED' || status === 'FAILED') break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    const results = parseTextResult<{ status: string; stepResults: { action: string; status: string }[] }>(
      await client.callTool({ name: 'get_run_results', arguments: { runId: run.testRunId } })
    );
    expect(status, JSON.stringify(results)).toBe('PASSED');
    expect(results.status).toBe('PASSED');
    expect(results.stepResults).toHaveLength(4);
    expect(results.stepResults.every((step) => step.status === 'passed')).toBe(true);
  } finally {
    if (client && browserSessionId) {
      await client.callTool({
        name: 'browser_close',
        arguments: { projectId: workspace.projectId, sessionId: browserSessionId }
      }).catch(() => undefined);
    }
    await client?.close().catch(() => undefined);
    if (checkId) await workspace.adminApi.delete(`/tests/${checkId}`).catch(() => undefined);
    if (tokenId) await workspace.adminApi.delete(`/auth/api-tokens/${tokenId}`).catch(() => undefined);
  }
});
