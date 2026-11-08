import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, openAuthenticatedPage, test } from '../support/workspace';

test('HTTP steps execute in the worker, preserve captured types, and render safe run details', async ({ page, workspace }, testInfo) => {
  testInfo.setTimeout(120_000);
  const records = new Map<string, { name: string; active: boolean }>();
  const server: Server = createServer(async (request, response) => {
    if (request.headers.authorization !== 'Bearer e2e-token') {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (request.method === 'POST' && request.url === '/users') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { name: string; active: boolean };
      if (typeof body.name !== 'string' || typeof body.active !== 'boolean') {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'invalid payload' }));
        return;
      }
      const id = 'api-e2e-42';
      records.set(id, body);
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id, ...body, access_token: 'response-secret' }));
      return;
    }
    const match = request.url?.match(/^\/users\/([^/?]+)$/);
    if (request.method === 'GET' && match) {
      const body = records.get(decodeURIComponent(match[1]));
      response.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body ? { id: match[1], ...body } : { error: 'not found' }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not found' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const name = `HTTP API E2E ${Date.now()}`;
  let checkId: string | undefined;
  let successorCheckId: string | undefined;
  let suiteId: string | undefined;
  let environmentId: string | undefined;
  let databaseConnectionId: string | undefined;

  try {
    const testDatabaseUrl = new URL(process.env.DATABASE_URL ?? '');
    expect(['localhost', '127.0.0.1', '[::1]', '::1']).toContain(testDatabaseUrl.hostname);
    const dbConnectionResponse = await workspace.adminApi.post(`/projects/${workspace.projectId}/connections`, {
      data: {
        name: `HTTP API disposable DB ${Date.now()}`,
        provider: 'POSTGRESQL',
        host: '127.0.0.1',
        port: Number(testDatabaseUrl.port || 5432),
        database: decodeURIComponent(testDatabaseUrl.pathname.slice(1)),
        username: decodeURIComponent(testDatabaseUrl.username),
        password: decodeURIComponent(testDatabaseUrl.password),
        ssl: false,
        accessMode: 'READ_ONLY'
      }
    });
    expect(dbConnectionResponse.status()).toBe(201);
    databaseConnectionId = (await dbConnectionResponse.json() as { id: string }).id;
    const environmentResponse = await workspace.adminApi.post(`/projects/${workspace.projectId}/environments`, {
      data: { name: `HTTP API ${Date.now()}`, variables: { API_TOKEN: 'e2e-token' } }
    });
    expect(environmentResponse.status()).toBe(201);
    environmentId = (await environmentResponse.json() as { id: string }).id;
    const create = await workspace.adminApi.post(`/projects/${workspace.projectId}/tests`, {
      data: {
        name,
        url: 'data:text/html,<title>WrightTest API</title>',
        steps: [
          { action: 'generateData', generator: 'string', generatorOptions: { length: 12 }, saveAs: 'TEST_NAME' },
          { action: 'generateData', generator: 'boolean', saveAs: 'IS_ACTIVE' },
          { action: 'goto', value: 'data:text/html,<title>WrightTest API</title>' },
          {
            action: 'httpRequest',
            http: {
              method: 'POST', url: `${baseUrl}/users`,
              auth: { type: 'bearer', token: '{{API_TOKEN}}' },
              body: { type: 'json', value: '{"name":"{{TEST_NAME}}","active":"{{IS_ACTIVE}}"}' },
              assertions: [{ type: 'statusEquals', expected: 201 }, { type: 'jsonPathType', path: '$.id', expectedType: 'string' }],
              capture: [{ source: 'jsonPath', path: '$.id', saveAs: 'USER_ID' }]
            }
          },
          {
            action: 'executeSql',
            databaseConnectionId,
            sql: 'SELECT :userId::text AS id',
            parameters: { userId: '{{USER_ID}}' },
            assertion: { type: 'columnEquals', column: 'id', expected: 'api-e2e-42' },
            saveResultAs: 'SQL_USER_ID',
            saveResultType: 'column',
            saveColumn: 'id',
            captureRows: true
          },
          {
            action: 'httpRequest',
            http: {
              method: 'GET', url: `${baseUrl}/users/{{SQL_USER_ID}}`,
              auth: { type: 'bearer', token: '{{API_TOKEN}}' },
              assertions: [{ type: 'statusEquals', expected: 200 }, { type: 'jsonPathEquals', path: '$.active', expected: '{{IS_ACTIVE}}' }]
            }
          },
          {
            action: 'httpRequest',
            http: {
              method: 'GET', url: `${baseUrl}/users/not-created`,
              auth: { type: 'bearer', token: '{{API_TOKEN}}' },
              assertions: [{ type: 'statusEquals', expected: 404 }, { type: 'jsonPathEquals', path: '$.error', expected: 'not found' }]
            }
          }
        ],
        environmentId,
        testData: [],
        useProjectAuthentication: false
      }
    });
    expect(create.status()).toBe(201);
    checkId = (await create.json() as { id: string }).id;

    const queue = await workspace.adminApi.post(`/tests/${checkId}/run`, { data: { environmentId } });
    expect(queue.ok()).toBeTruthy();
    const { testRunId } = await queue.json() as { testRunId: string };
    let run: { status: string; stepResults?: Array<{ status: string; http?: { status: number; url: string; captures?: Array<{ variableName: string; type: string; secret: boolean }> }; captured?: { variableName: string; type: string; secret: boolean; value?: unknown } }> } | undefined;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const result = await workspace.adminApi.get(`/runs/${testRunId}`);
      expect(result.ok()).toBeTruthy();
      run = await result.json() as typeof run;
      if (run?.status === 'PASSED' || run?.status === 'FAILED') break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(run?.status, JSON.stringify(run?.stepResults?.map((step, index) => ({
      index,
      status: step.status,
      error: (step as { error?: string }).error,
      database: (step as { database?: unknown }).database,
      httpStatus: step.http?.status
    })))).toBe('PASSED');
    expect(run?.stepResults?.map((step) => step.status)).toEqual(['passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed']);
    expect(records.get('api-e2e-42')).toMatchObject({ name: expect.any(String), active: expect.any(Boolean) });
    expect(run?.stepResults?.[3].http?.captures).toContainEqual({ variableName: 'USER_ID', type: 'string', secret: true });
    expect(JSON.stringify(run)).not.toContain('response-secret');
    expect(run?.stepResults?.[5].http?.url).not.toContain('api-e2e-42');

    const successor = await workspace.adminApi.post(`/projects/${workspace.projectId}/tests`, {
      data: {
        name: `${name} handoff`,
        url: 'data:text/html,<main>api-e2e-42</main>',
        steps: [
          { action: 'goto', value: 'data:text/html,<main>api-e2e-42</main>' },
          { action: 'assertText', selector: "page.locator('main')", expected: '{{USER_ID}}' }
        ],
        environmentId,
        testData: [],
        useProjectAuthentication: false
      }
    });
    expect(successor.status()).toBe(201);
    successorCheckId = (await successor.json() as { id: string }).id;
    const suite = await workspace.adminApi.post(`/projects/${workspace.projectId}/suites`, {
      data: {
        name: `${name} sequential handoff`,
        testIds: [checkId, successorCheckId],
        executionMode: 'SEQUENTIAL',
        executionConfig: {
          orderedTestIds: [checkId, successorCheckId],
          mappings: [{ sourceTestId: checkId, outputVariable: 'USER_ID', targetTestId: successorCheckId, targetVariable: 'USER_ID', required: true, expectedType: 'string' }],
          dataCaseIndexes: {}
        }
      }
    });
    expect(suite.status()).toBe(201);
    suiteId = (await suite.json() as { id: string }).id;
    const suiteStart = await workspace.adminApi.post(`/suites/${suiteId}/run`, { data: { environmentId } });
    expect(suiteStart.status()).toBe(202);
    const { suiteRunId } = await suiteStart.json() as { suiteRunId: string };
    let suiteRun: { status: string; testRuns: Array<{ testId: string; status: string }>; outputMetadata: Array<{ name: string; secret: boolean }> } | undefined;
    const suiteDeadline = Date.now() + 60_000;
    while (Date.now() < suiteDeadline) {
      const result = await workspace.adminApi.get(`/suite-runs/${suiteRunId}`);
      expect(result.ok()).toBeTruthy();
      suiteRun = await result.json() as typeof suiteRun;
      if (suiteRun?.status === 'PASSED' || suiteRun?.status === 'FAILED') break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(suiteRun?.status).toBe('PASSED');
    expect(suiteRun?.testRuns.map((item) => item.testId)).toEqual([checkId, successorCheckId]);
    expect(suiteRun?.testRuns.map((item) => item.status)).toEqual(['PASSED', 'PASSED']);
    expect(suiteRun?.outputMetadata).toContainEqual(expect.objectContaining({ outputVariable: 'USER_ID', secret: true }));
    expect(JSON.stringify(suiteRun)).not.toContain('api-e2e-42');

    const outputDir = process.env.PHASE6_SCREENSHOT_DIR ?? path.join(testInfo.outputDir, 'phase6');
    await fs.mkdir(outputDir, { recursive: true });
    await openAuthenticatedPage(page, workspace.owner, `/tests/${checkId}/edit`);
    await expect(page.getByText('HTTP Request', { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel('Method').first()).toBeVisible();
    await expect(page.locator('.wt-http-request-line input:not([readonly])').first()).toHaveValue(new RegExp(`127\\.0\\.0\\.1:${address.port}/users`));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(outputDir, 'api-editor-desktop.png'), fullPage: true });
    for (const width of [320, 375, 390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth > window.innerWidth,
        elements: [...document.querySelectorAll('body *')].map((element) => {
          const rect = element.getBoundingClientRect();
          return { tag: element.tagName, className: typeof element.className === 'string' ? element.className : '', right: Math.round(rect.right), width: Math.round(rect.width) };
        }).filter((element) => element.right > window.innerWidth + 1).slice(0, 8)
      }));
      expect(overflow.page, `Editor overflows at ${width}px: ${JSON.stringify(overflow)}`).toBe(false);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(outputDir, 'api-editor-mobile.png'), fullPage: true });
    await page.getByLabel('Check name', { exact: true }).fill(`${name} UI Edited`);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(async () => {
      const response = await workspace.adminApi.get(`/tests/${checkId}`);
      return (await response.json() as { name: string }).name;
    }).toBe(`${name} UI Edited`);

    await openAuthenticatedPage(page, workspace.owner, `/runs/${testRunId}`);
    await expect(page.getByRole('heading', { name: 'Run details' })).toBeVisible();
    const httpResultRow = page.getByRole('row').filter({ hasText: 'HTTP Request' }).first();
    await httpResultRow.getByRole('button').first().click();
    await expect(page.getByText('201', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(outputDir, 'api-run-desktop.png'), fullPage: true });
    for (const width of [320, 375, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.getByRole('heading', { name: 'Run details' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), `Run results overflows at ${width}px`).toBe(false);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(outputDir, 'api-run-mobile.png'), fullPage: true });
  } finally {
    if (suiteId) await workspace.adminApi.delete(`/suites/${suiteId}`).catch(() => undefined);
    if (successorCheckId) await workspace.adminApi.delete(`/tests/${successorCheckId}`).catch(() => undefined);
    if (checkId) await workspace.adminApi.delete(`/tests/${checkId}`).catch(() => undefined);
    if (environmentId) await workspace.adminApi.delete(`/environments/${environmentId}`).catch(() => undefined);
    if (databaseConnectionId) await workspace.adminApi.delete(`/connections/${databaseConnectionId}`).catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
