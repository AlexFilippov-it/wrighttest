import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WrightTestApi } from '../src/api.js';
import { registerWrightTestTools } from '../src/tools.js';
import { registerBrowserTools } from '../src/browser-tools.js';

function firstText(response: unknown) {
  if (!response || typeof response !== 'object' || !('content' in response)) return '';
  const content = response.content;
  if (!Array.isArray(content)) return '';
  const first = content[0];
  return first && typeof first === 'object' && 'text' in first && typeof first.text === 'string' ? first.text : '';
}

async function connectedClient(fetchImpl: typeof fetch) {
  const api = new WrightTestApi('http://wrighttest.test', 'wtm_unit-test-token-not-real', fetchImpl);
  const server = new McpServer({ name: 'wrighttest-test', version: '0.0.0' });
  registerWrightTestTools(server, api);
  registerBrowserTools(server, api);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'wrighttest-test-client', version: '0.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test('MCP initializes and lists project, browser, and safe database metadata tools', async () => {
  const { client, server } = await connectedClient(async () => new Response('[]', { status: 200 }));
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 26);
  assert.deepEqual(new Set(listed.tools.map((tool) => tool.name)), new Set([
    'list_projects', 'get_project', 'create_project', 'update_project',
    'list_checks', 'get_check', 'create_check', 'update_check',
    'list_suites', 'create_suite', 'add_check_to_suite',
    'run_check', 'run_suite', 'get_run_status', 'get_run_results',
    'browser_start', 'browser_navigate', 'browser_snapshot', 'browser_click', 'browser_fill', 'browser_select', 'browser_screenshot', 'browser_wait', 'browser_close',
    'list_database_connections', 'get_database_connection'
  ]));
  await client.close();
  await server.close();
});

test('browser MCP calls are forwarded to the authenticated backend and preserve actual action records', async () => {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const { client, server } = await connectedClient(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, method: init?.method ?? 'GET', body });
    return Response.json({ id: 'session-1', url: 'https://example.test/', title: 'Example', actions: [{ action: 'click', selector: "page.getByRole('link', { name: 'More information' })" }], snapshot: 'page content', untrustedPageContent: true });
  });
  const response = await client.callTool({ name: 'browser_click', arguments: { projectId: 'project-1', sessionId: 'e8123a58-b00b-46cb-862f-e8bde37115a9', selector: "page.getByRole('link', { name: 'More information' })" } });
  assert.equal(response.isError, undefined);
  assert.equal(calls[0].path, '/browser-sessions/e8123a58-b00b-46cb-862f-e8bde37115a9/click');
  assert.equal(calls[0].method, 'POST');
  assert.equal((calls[0].body as Record<string, unknown>).projectId, 'project-1');
  assert.match(firstText(response), /untrustedPageContent/);
  await client.close();
  await server.close();
});

test('list_projects forwards the user API token and returns a safe project summary', async () => {
  let requestUrl = '';
  let authorization = '';
  const { client, server } = await connectedClient(async (input, init) => {
    requestUrl = String(input);
    authorization = new Headers(init?.headers).get('authorization') ?? '';
    return Response.json([{ id: 'p1', name: 'Demo', currentUserRole: 'VIEWER', tests: [{ id: 'secret-check' }], summary: { checksCount: 1 } }]);
  });
  const response = await client.callTool({ name: 'list_projects', arguments: {} });
  assert.equal(requestUrl, 'http://wrighttest.test/projects');
  assert.equal(authorization, 'Bearer wtm_unit-test-token-not-real');
  assert.match(firstText(response), /"id":"p1"/);
  assert.doesNotMatch(firstText(response), /secret-check/);
  await client.close();
  await server.close();
});

test('create_check delegates to the API and returns its sanitized check payload', async () => {
  let received: unknown;
  const databaseStep = {
    action: 'executeSql', databaseConnectionId: 'db-1',
    sql: 'SELECT status FROM orders WHERE id = :id', parameters: { id: '{{ORDER_ID}}' },
    assertion: { type: 'columnEquals', column: 'status', expected: 'pending' }
  };
  const { client, server } = await connectedClient(async (_input, init) => {
    received = JSON.parse(String(init?.body));
    return Response.json({ id: 'check-1', projectId: 'project-1', name: 'Landing', url: 'https://example.test', steps: [databaseStep] }, { status: 201 });
  });
  const response = await client.callTool({
    name: 'create_check',
    arguments: { projectId: 'project-1', name: 'Landing', url: 'https://example.test', steps: [databaseStep] }
  });
  assert.deepEqual(received, { name: 'Landing', url: 'https://example.test', steps: [databaseStep] });
  assert.equal(response.isError, undefined);
  await client.close();
  await server.close();
});

test('update_check accepts and forwards a partial patch', async () => {
  let requestPath = '';
  let requestMethod = '';
  let requestBody: unknown;
  const { client, server } = await connectedClient(async (input, init) => {
    requestPath = new URL(String(input)).pathname;
    requestMethod = init?.method ?? 'GET';
    requestBody = JSON.parse(String(init?.body));
    return Response.json({ id: 'check-1', projectId: 'project-1', name: 'Renamed check', url: 'https://example.test', steps: [] });
  });
  const response = await client.callTool({
    name: 'update_check',
    arguments: { checkId: 'check-1', name: 'Renamed check' }
  });
  assert.equal(response.isError, undefined);
  assert.equal(requestPath, '/tests/check-1');
  assert.equal(requestMethod, 'PATCH');
  assert.deepEqual(requestBody, { name: 'Renamed check' });
  await client.close();
  await server.close();
});

test('permission failures are returned as MCP tool errors', async () => {
  const { client, server } = await connectedClient(async () => Response.json({ error: 'Forbidden' }, { status: 403 }));
  const response = await client.callTool({ name: 'create_project', arguments: { name: 'Not allowed for this user' } });
  assert.equal(response.isError, true);
  assert.match(firstText(response), /403/);
  await client.close();
  await server.close();
});

test('invalid tool arguments are rejected before reaching the backend', async () => {
  let called = false;
  const { client, server } = await connectedClient(async () => {
    called = true;
    return Response.json({ id: 'unexpected' });
  });
  const response = await client.callTool({ name: 'create_project', arguments: { name: '' } });
  assert.equal(response.isError, true);
  assert.equal(called, false);
  await client.close();
  await server.close();
});

test('run results omit environment data and redact known environment and test-data secrets', async () => {
  const { client, server } = await connectedClient(async () => Response.json({
    id: 'run-1', status: 'FAILED', durationMs: 400, error: 'Login rejected for secret-value',
    environment: { variables: { PASSWORD: 'secret-value' } },
    dataCaseVariables: { AUTH_CODE: 'code-12345' },
    stepResults: [{ index: 0, target: 'secret-value', status: 'failed', error: 'Unexpected code-12345' }],
    screenshots: ['run-1_step1_failed.png'], trace: { available: false, reason: 'No trace' }
  }));
  const response = await client.callTool({ name: 'get_run_results', arguments: { runId: 'run-1' } });
  const text = firstText(response);
  assert.doesNotMatch(text, /secret-value|code-12345|PASSWORD|AUTH_CODE|environment|dataCaseVariables/);
  assert.match(text, /\[REDACTED\]/);
  await client.close();
  await server.close();
});

test('backend connection failures do not expose the configured API token', async () => {
  const { client, server } = await connectedClient(async () => { throw new Error('fetch failed'); });
  const response = await client.callTool({ name: 'list_projects', arguments: {} });
  const text = firstText(response);
  assert.equal(response.isError, true);
  assert.doesNotMatch(text, /unit-test-token/);
  await client.close();
  await server.close();
});
