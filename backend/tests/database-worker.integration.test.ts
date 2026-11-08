import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import prisma from '../src/prisma';
import { encryptDatabasePassword } from '../src/services/database-connections';

test('isolated worker run interleaves browser and SQL steps and stores safe results', {
  skip: process.env.WRIGHTTEST_DATABASE_WORKER_INTEGRATION !== '1'
}, async () => {
  const [{ default: redis }, { testQueue }, { startTestWorker, stopTestWorker }] = await Promise.all([
    import('../src/redis'),
    import('../src/queue/queue'),
    import('../src/queue/worker')
  ]);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const fixtureTable = `wrighttest_db_worker_${suffix.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  const previousKey = process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY;
  process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  const host = process.env.WRIGHTTEST_PG_TEST_HOST ?? '127.0.0.1';
  const port = Number(process.env.WRIGHTTEST_PG_TEST_PORT);
  const database = process.env.WRIGHTTEST_PG_TEST_DATABASE;
  const username = process.env.WRIGHTTEST_PG_TEST_USERNAME;
  const password = process.env.WRIGHTTEST_PG_TEST_PASSWORD;
  assert.ok(port && database && username && password, 'Missing isolated PostgreSQL worker integration settings');
  const fixtureClient = new Client({ host, port, database, user: username, password });

  const user = await prisma.user.create({ data: { email: `database-worker-${suffix}@example.com`, passwordHash: 'not-used' } });
  const project = await prisma.project.create({ data: { name: `Database worker ${suffix}` } });
  let testRunId: string | undefined;
  let testId: string | undefined;
  let connectionId: string | undefined;

  try {
    await fixtureClient.connect();
    await fixtureClient.query(`CREATE TABLE ${fixtureTable}(id integer primary key, status text, api_token text)`);
    await fixtureClient.query(`INSERT INTO ${fixtureTable}(id, status, api_token) VALUES (1, 'ready', 'synthetic-secret')`);

    const connection = await prisma.databaseConnection.create({
      data: {
        projectId: project.id,
        name: 'Isolated worker database',
        provider: 'POSTGRESQL',
        host,
        port,
        database,
        username,
        encryptedCredentials: encryptDatabasePassword(password),
        ssl: false,
        accessMode: 'READ_WRITE'
      }
    });
    connectionId = connection.id;

    const url = 'data:text/html,%3Ctitle%3EDatabase%20Worker%20Integration%3C%2Ftitle%3E%3Ch1%3EReady%3C%2Fh1%3E%3Cinput%20id%3D%22order-id%22%3E';
    const check = await prisma.test.create({
      data: {
        projectId: project.id,
        name: 'Browser and database workflow',
        url,
        steps: [
          { action: 'goto', value: url },
          { action: 'assertTitle', expected: 'Database Worker Integration', options: { exact: true } },
          { action: 'generateData', generator: 'number', generatorOptions: { min: 1, max: 1, integer: true }, saveAs: 'USER_ID' },
          { action: 'fill', selector: "page.locator('#order-id')", value: '{{USER_ID}}' },
          { action: 'captureValue', captureSource: 'input', selector: "page.locator('#order-id')", saveAs: 'FORM_USER_ID' },
          {
            action: 'executeSql', databaseConnectionId: connection.id,
            sql: `SELECT id, status, api_token FROM ${fixtureTable} WHERE id = :id`,
            parameters: { id: '{{FORM_USER_ID}}' }, captureRows: true,
            assertion: { type: 'columnEquals', column: 'status', expected: 'ready' },
            saveResultAs: 'ORDER_ID', saveColumn: 'id'
          },
          { action: 'fill', selector: "page.locator('#order-id')", value: '{{ORDER_ID}}' },
          { action: 'assertValue', selector: "page.locator('#order-id')", expected: '{{ORDER_ID}}' },
          {
            action: 'executeSql', databaseConnectionId: connection.id,
            sql: `UPDATE ${fixtureTable} SET status = :status WHERE id = :id`,
            parameters: { status: 'verified', id: '{{ORDER_ID}}' }
          },
          {
            action: 'assertDatabaseResult', databaseConnectionId: connection.id,
            sql: `SELECT status FROM ${fixtureTable} WHERE id = :id`,
            parameters: { id: '{{ORDER_ID}}' },
            assertion: { type: 'columnEquals', column: 'status', expected: 'verified' },
            waitForResult: { timeoutMs: 1_000, pollIntervalMs: 250 }
          },
          {
            action: 'executeSql', databaseConnectionId: connection.id,
            sql: `SELECT api_token FROM ${fixtureTable} WHERE id = :id`,
            parameters: { id: '{{ORDER_ID}}' },
            saveResultAs: 'QUERY_RESULT', saveColumn: 'api_token'
          },
          { action: 'assertTitle', expected: 'Database Worker Integration', options: { exact: true } }
        ]
      }
    });
    testId = check.id;
    const run = await prisma.testRun.create({ data: { testId: check.id, status: 'PENDING' } });
    testRunId = run.id;

    await startTestWorker();
    await testQueue.add('run', { testRunId: run.id, testId: check.id });
    const startedAt = Date.now();
    let completed = null as Awaited<ReturnType<typeof prisma.testRun.findUnique>>;
    while (Date.now() - startedAt < 90_000) {
      completed = await prisma.testRun.findUnique({ where: { id: run.id } });
      if (completed?.status === 'PASSED' || completed?.status === 'FAILED') break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(completed?.status, 'PASSED', completed?.error ?? 'Worker run did not reach a terminal state');
    const results = completed?.stepResults as Array<{ status: string; action: string; screenshot?: string | null; generated?: { variableName: string; value?: string | number | boolean }; captured?: { variableName: string; value?: string | number | boolean; secret: boolean }; database?: { rows?: Array<Record<string, unknown>>; assertion?: { passed: boolean } } }>;
    assert.equal(results.length, 12);
    assert.equal(results[5].database?.rows?.[0]?.api_token, '[REDACTED]');
    assert.equal(results[9].database?.assertion?.passed, true);
    assert.equal(results[10].captured?.variableName, 'QUERY_RESULT');
    assert.equal(results[10].captured?.secret, true);
    assert.equal('value' in results[10].captured!, false);
    assert.equal(completed?.tracePath, null);
    assert.equal(results[5].screenshot, null);
    assert.equal(results[2].generated?.variableName, 'USER_ID');
    assert.equal(results[2].generated?.value, 1);
    assert.equal(results[4].captured?.variableName, 'FORM_USER_ID');
    assert.equal(results[4].captured?.value, '1');
    assert.equal(results[0].status, 'passed');
    assert.equal(results[3].status, 'passed');
    assert.equal(results[5].status, 'passed');
    assert.equal(results[7].status, 'passed');
    assert.equal(results[9].status, 'passed');
  } finally {
    await stopTestWorker();
    if (testRunId) await prisma.testRun.delete({ where: { id: testRunId } }).catch(() => undefined);
    if (testId) await prisma.test.delete({ where: { id: testId } }).catch(() => undefined);
    if (connectionId) await prisma.databaseConnection.delete({ where: { id: connectionId } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await fixtureClient.query(`DROP TABLE IF EXISTS ${fixtureTable}`).catch(() => undefined);
    await fixtureClient.end().catch(() => undefined);
    await testQueue.close().catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
    if (previousKey === undefined) delete process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});
