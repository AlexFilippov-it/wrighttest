import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptDatabasePassword, executeDatabaseStep, openDatabaseConnection } from '../src/services/database-connections';
import type { Step } from '../src/types/step';

const integrationEnabled = process.env.WRIGHTTEST_DATABASE_INTEGRATION === '1';

async function verifyProvider(provider: 'POSTGRESQL' | 'MYSQL', envPrefix: string) {
  const host = process.env[`${envPrefix}_HOST`];
  const port = Number(process.env[`${envPrefix}_PORT`]);
  const database = process.env[`${envPrefix}_DATABASE`];
  const username = process.env[`${envPrefix}_USERNAME`];
  const password = process.env[`${envPrefix}_PASSWORD`];
  assert.ok(host && port && database && username && password, `Missing ${envPrefix} integration settings`);

  const connection = {
    id: `integration-${provider.toLowerCase()}`,
    projectId: 'integration-project',
    name: `${provider} isolated integration database`,
    provider,
    host,
    port,
    database,
    username,
    encryptedCredentials: encryptDatabasePassword(password),
    ssl: false,
    accessMode: 'READ_WRITE' as const
  };
  const session = await openDatabaseConnection(connection);

  try {
    await executeDatabaseStep(session, connection.name, 'READ_WRITE', {
      action: 'executeSql',
      sql: 'DELETE FROM wrighttest_fixture WHERE id = :id',
      parameters: { id: 2 }
    }, {});
    await executeDatabaseStep(session, connection.name, 'READ_WRITE', {
      action: 'executeSql',
      sql: 'UPDATE wrighttest_fixture SET status = :status WHERE id = :id',
      parameters: { status: 'ready', id: 1 }
    }, {});

    const selectStep: Step = {
      action: 'executeSql',
      sql: 'SELECT status, api_token FROM wrighttest_fixture WHERE id = :id',
      parameters: { id: 1 },
      captureRows: true,
      assertion: { type: 'columnEquals', column: 'status', expected: 'ready' },
      saveResultAs: 'CURRENT_STATUS',
      saveColumn: 'status'
    };
    const selected = await executeDatabaseStep(session, connection.name, 'READ_WRITE', selectStep, {});
    assert.equal(selected.summary.assertion?.passed, true);
    assert.equal(selected.savedValue, 'ready');
    assert.equal(selected.summary.rows?.[0]?.api_token, '[REDACTED]');

    const firstColumnValue = await executeDatabaseStep(session, connection.name, 'READ_WRITE', {
      action: 'executeSql',
      sql: 'SELECT status FROM wrighttest_fixture WHERE id = :id',
      parameters: { id: '1' },
      saveResultAs: 'FIRST_COLUMN'
    }, {});
    assert.equal(firstColumnValue.savedValue, 'ready');

    const updateStep: Step = {
      action: 'executeSql',
      sql: 'UPDATE wrighttest_fixture SET status = :status WHERE id = :id',
      parameters: { status: '{{TARGET_STATUS}}', id: '1' }
    };
    const updated = await executeDatabaseStep(session, connection.name, 'READ_WRITE', updateStep, { TARGET_STATUS: 'verified' });
    assert.equal(updated.summary.affectedRows, 1);

    const waited = await executeDatabaseStep(session, connection.name, 'READ_WRITE', {
      action: 'executeSql',
      sql: 'SELECT status FROM wrighttest_fixture WHERE id = :id',
      parameters: { id: '1' },
      assertion: { type: 'columnEquals', column: 'status', expected: '{{TARGET_STATUS}}' },
      waitForResult: { timeoutMs: 1_000, pollIntervalMs: 250 }
    }, { TARGET_STATUS: 'verified' });
    assert.equal(waited.summary.assertion?.passed, true);

    const inserted = await executeDatabaseStep(session, connection.name, 'READ_WRITE', {
      action: 'executeSql',
      sql: 'INSERT INTO wrighttest_fixture(id, status, api_token) VALUES (:id, :status, :token)',
      parameters: { id: '2', status: 'created', token: 'synthetic-secret' }
    }, {});
    assert.equal(inserted.summary.affectedRows, 1);

    const deleted = await executeDatabaseStep(session, connection.name, 'READ_WRITE', {
      action: 'executeSql', sql: 'DELETE FROM wrighttest_fixture WHERE id = :id', parameters: { id: '2' }
    }, {});
    assert.equal(deleted.summary.affectedRows, 1);

    await assert.rejects(openDatabaseConnection({
      ...connection,
      encryptedCredentials: encryptDatabasePassword('intentionally-wrong-password')
    }), /authentication failed/i);

    await assert.rejects(openDatabaseConnection({ ...connection, ssl: true }), /TLS\/SSL connection failed/i);

    const sleepSql = provider === 'MYSQL' ? 'SELECT SLEEP(6)' : 'SELECT pg_sleep(6)';
    await assert.rejects(executeDatabaseStep(session, connection.name, 'READ_WRITE', {
      action: 'executeSql', sql: sleepSql
    }, {}), /timed out/i);

    await assert.rejects(
      executeDatabaseStep(session, connection.name, 'READ_ONLY', updateStep, {}),
      /read-only/
    );
  } finally {
    await executeDatabaseStep(session, connection.name, 'READ_WRITE', {
      action: 'executeSql',
      sql: 'DELETE FROM wrighttest_fixture WHERE id = :id',
      parameters: { id: 2 }
    }, {}).catch(() => undefined);
    await executeDatabaseStep(session, connection.name, 'READ_WRITE', {
      action: 'executeSql',
      sql: 'UPDATE wrighttest_fixture SET status = :status WHERE id = :id',
      parameters: { status: 'ready', id: 1 }
    }, {}).catch(() => undefined);
    await session.close();
  }
}

test('isolated PostgreSQL: prepared SELECT, masked results, save variable, UPDATE and read-only enforcement', {
  skip: !integrationEnabled
}, async () => verifyProvider('POSTGRESQL', 'WRIGHTTEST_PG_TEST'));

test('isolated MySQL: prepared SELECT, masked results, save variable, UPDATE and read-only enforcement', {
  skip: !integrationEnabled
}, async () => verifyProvider('MYSQL', 'WRIGHTTEST_MYSQL_TEST'));
