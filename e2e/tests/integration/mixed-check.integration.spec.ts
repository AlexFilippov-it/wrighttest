import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { Client } from 'pg';
import { expect, test } from '../support/workspace';

test('Mixed Check runs Generate, HTTP, SQL, Browser, and cleanup in sequence', async ({ workspace }) => {
  test.setTimeout(120_000);
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const tableName = `mixed_check_${suffix}`;
  const rows = new Map<string, string>();
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(`CREATE TABLE "${tableName}" (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name TEXT NOT NULL)`);

  const server: Server = createServer(async (request, response) => {
    if (request.headers.authorization !== 'Bearer mixed-check-test-token') {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    const match = request.url?.match(/^\/users\/([a-zA-Z0-9_-]+)$/);
    if (request.method === 'POST' && request.url === '/users') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { name?: unknown };
      if (typeof body.name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(body.name)) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'invalid name' }));
        return;
      }
      const inserted = await db.query<{ id: string }>(`INSERT INTO "${tableName}" (name) VALUES ($1) RETURNING id`, [body.name]);
      const id = inserted.rows[0].id;
      rows.set(id, body.name);
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id }));
      return;
    }

    if (match && request.method === 'DELETE') {
      const id = match[1];
      const deleted = await db.query(`DELETE FROM "${tableName}" WHERE id = $1`, [id]);
      rows.delete(id);
      response.writeHead(deleted.rowCount ? 204 : 404);
      response.end();
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not found' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  let environmentId: string | undefined;
  let databaseConnectionId: string | undefined;
  let checkId: string | undefined;
  try {
    const testDatabaseUrl = new URL(process.env.DATABASE_URL ?? '');
    expect(['localhost', '127.0.0.1', '[::1]', '::1']).toContain(testDatabaseUrl.hostname);
    const connection = await workspace.adminApi.post(`/projects/${workspace.projectId}/connections`, {
      data: {
        name: `Mixed Check disposable PostgreSQL ${suffix}`,
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
    expect(connection.status()).toBe(201);
    databaseConnectionId = (await connection.json() as { id: string }).id;

    const environment = await workspace.adminApi.post(`/projects/${workspace.projectId}/environments`, {
      data: { name: `Mixed Check ${suffix}`, variables: { MIXED_CHECK_TOKEN: 'mixed-check-test-token' } }
    });
    expect(environment.status()).toBe(201);
    environmentId = (await environment.json() as { id: string }).id;

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const create = await workspace.adminApi.post(`/projects/${workspace.projectId}/tests`, {
      data: {
        name: `Mixed Check ${suffix}`,
        url: 'about:blank',
        environmentId,
        testData: [],
        useProjectAuthentication: false,
        steps: [
          { action: 'generateData', generator: 'username', saveAs: 'TEST_USERNAME' },
          { action: 'httpRequest', http: {
            method: 'POST', url: `${baseUrl}/users`,
            auth: { type: 'bearer', token: '{{MIXED_CHECK_TOKEN}}' },
            body: { type: 'json', value: '{"name":"{{TEST_USERNAME}}"}' },
            assertions: [{ type: 'statusEquals', expected: 201 }],
            capture: [{ source: 'jsonPath', path: '$.id', saveAs: 'USER_ID' }]
          } },
          {
            action: 'executeSql', databaseConnectionId,
            sql: `SELECT name FROM "${tableName}" WHERE id = :userId`,
            parameters: { userId: '{{USER_ID}}' },
            assertion: { type: 'columnEquals', column: 'name', expected: '{{TEST_USERNAME}}' },
            saveResultAs: 'SQL_NAME', saveResultType: 'column', saveColumn: 'name'
          },
          { action: 'goto', value: 'data:text/html,<title>Mixed Check</title><main>{{TEST_USERNAME}}|{{USER_ID}}</main>' },
          { action: 'assertText', selector: "page.locator('main')", expected: '{{TEST_USERNAME}}|{{USER_ID}}' },
          { action: 'httpRequest', http: {
            method: 'DELETE', url: `${baseUrl}/users/{{USER_ID}}`,
            auth: { type: 'bearer', token: '{{MIXED_CHECK_TOKEN}}' },
            assertions: [{ type: 'statusEquals', expected: 204 }]
          } },
          {
            action: 'executeSql', databaseConnectionId,
            sql: `SELECT COUNT(*)::text AS count FROM "${tableName}" WHERE id = :userId`,
            parameters: { userId: '{{USER_ID}}' },
            assertion: { type: 'columnEquals', column: 'count', expected: '0' }
          }
        ]
      }
    });
    expect(create.status()).toBe(201);
    checkId = (await create.json() as { id: string }).id;

    const start = await workspace.adminApi.post(`/tests/${checkId}/run`, { data: { environmentId } });
    expect(start.ok()).toBeTruthy();
    const { testRunId } = await start.json() as { testRunId: string };
    let run: { status: string; stepResults?: Array<{ status: string; error?: string; http?: { status?: number }; database?: { rowsReturned?: number } }> } | undefined;
    const deadline = Date.now() + 75_000;
    while (Date.now() < deadline) {
      const result = await workspace.adminApi.get(`/runs/${testRunId}`);
      expect(result.ok()).toBeTruthy();
      run = await result.json() as typeof run;
      if (run?.status === 'PASSED' || run?.status === 'FAILED') break;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    expect(run?.status, JSON.stringify(run?.stepResults?.map(({ status, error, http, database }) => ({ status, error, http, database }))).slice(0, 3000)).toBe('PASSED');
    expect(run?.stepResults?.map((step) => step.status)).toEqual(Array(7).fill('passed'));
    expect(run?.stepResults?.[1].http?.status).toBe(201);
    expect(run?.stepResults?.[5].http?.status).toBe(204);
    expect(rows.size).toBe(0);
    expect(JSON.stringify(run)).not.toContain('mixed-check-test-token');
  } finally {
    if (checkId) await workspace.adminApi.delete(`/tests/${checkId}`).catch(() => undefined);
    if (environmentId) await workspace.adminApi.delete(`/environments/${environmentId}`).catch(() => undefined);
    if (databaseConnectionId) await workspace.adminApi.delete(`/connections/${databaseConnectionId}`).catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query(`DROP TABLE IF EXISTS "${tableName}"`).catch(() => undefined);
    await db.end();
  }
});
