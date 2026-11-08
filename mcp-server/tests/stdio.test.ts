import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function firstText(response: unknown) {
  if (!response || typeof response !== 'object' || !('content' in response)) return '';
  const content = response.content;
  if (!Array.isArray(content)) return '';
  const first = content[0];
  return first && typeof first === 'object' && 'text' in first && typeof first.text === 'string' ? first.text : '';
}

test('stdio client lists projects, creates a check, queues it, and reads its result', async () => {
  const fakeBackend = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer wtm_stdio-test-token');
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/projects') {
      response.end(JSON.stringify([{ id: 'project-1', name: 'Isolated MCP project', currentUserRole: 'OWNER' }]));
      return;
    }
    if (request.method === 'POST' && request.url === '/projects/project-1/tests') {
      response.statusCode = 201;
      response.end(JSON.stringify({ id: 'check-1', projectId: 'project-1', name: 'MCP check', url: 'data:text/html,<title>Ready</title>', steps: [] }));
      return;
    }
    if (request.method === 'POST' && request.url === '/tests/check-1/run') {
      response.statusCode = 202;
      response.end(JSON.stringify({ testRunId: 'run-1', jobId: 'job-1', status: 'PENDING' }));
      return;
    }
    if (request.method === 'GET' && request.url === '/runs/run-1') {
      response.end(JSON.stringify({
        id: 'run-1', status: 'PASSED', durationMs: 321, currentStep: 1, totalSteps: 1,
        stepResults: [{ index: 0, action: 'assertTitle', target: 'Ready', status: 'passed', durationMs: 321 }],
        screenshots: [], trace: { available: false, reason: 'No trace in isolated smoke' }
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise<void>((resolve) => fakeBackend.listen(0, '127.0.0.1', resolve));
  const address = fakeBackend.address();
  assert.ok(address && typeof address === 'object');
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const tsxCli = path.join(repositoryRoot, 'node_modules/tsx/dist/cli.mjs');
  const serverEntry = path.join(repositoryRoot, 'mcp-server/src/index.ts');
  const env = Object.fromEntries(Object.entries({
    ...process.env,
    WRIGHTTEST_URL: `http://127.0.0.1:${address.port}`,
    WRIGHTTEST_API_TOKEN: 'wtm_stdio-test-token'
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const transport = new StdioClientTransport({ command: process.execPath, args: [tsxCli, serverEntry], env, stderr: 'pipe', cwd: repositoryRoot });
  const client = new Client({ name: 'wrighttest-stdio-smoke', version: '1.0.0' });

  try {
    await client.connect(transport);
    const listedTools = await client.listTools();
    assert.equal(listedTools.tools.length, 32);

    const projects = await client.callTool({ name: 'list_projects', arguments: {} });
    assert.match(firstText(projects), /Isolated MCP project/);

    const check = await client.callTool({ name: 'create_check', arguments: {
      projectId: 'project-1', name: 'MCP check', url: 'data:text/html,<title>Ready</title>', steps: []
    } });
    assert.match(firstText(check), /"id":"check-1"/);

    const queued = await client.callTool({ name: 'run_check', arguments: { checkId: 'check-1' } });
    assert.match(firstText(queued), /"testRunId":"run-1"/);

    const status = await client.callTool({ name: 'get_run_status', arguments: { runId: 'run-1' } });
    assert.match(firstText(status), /"status":"PASSED"/);
    const results = await client.callTool({ name: 'get_run_results', arguments: { runId: 'run-1' } });
    assert.match(firstText(results), /"action":"assertTitle"/);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => fakeBackend.close((error) => error ? reject(error) : resolve()));
  }
});
