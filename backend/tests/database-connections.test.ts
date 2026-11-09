import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindNamedParameters,
  evaluateDatabaseAssertion,
  openDatabaseConnection,
  validateSqlStatement
} from '../src/services/database-connections';
import type { Step } from '../src/types/step';

test('binds named SQL parameters separately and ignores quoted/commented placeholders', () => {
  const result = bindNamedParameters(
    "SELECT ':ignored', id FROM orders WHERE id = :orderId AND memo = \"literal:alsoIgnored\" -- :commented\nAND status = :status",
    { orderId: '42', status: 'ready' },
    'POSTGRESQL'
  );
  assert.equal(result.sql, "SELECT ':ignored', id FROM orders WHERE id = $1 AND memo = \"literal:alsoIgnored\" -- :commented\nAND status = $2");
  assert.deepEqual(result.values, ['42', 'ready']);
});

test('uses question placeholders for MySQL prepared statements', () => {
  assert.deepEqual(
    bindNamedParameters('SELECT * FROM orders WHERE id = :orderId', { orderId: '7' }, 'MYSQL'),
    { sql: 'SELECT * FROM orders WHERE id = ?', values: ['7'] }
  );
});

test('binds typed SQL scalars without converting them to strings', () => {
  const result = bindNamedParameters('SELECT :count, :enabled, :missing, :text', {
    count: 12,
    enabled: true,
    missing: null,
    text: 'legacy-string'
  }, 'POSTGRESQL');
  assert.equal(result.sql, 'SELECT $1, $2, $3, $4');
  assert.deepEqual(result.values, [12, true, null, 'legacy-string']);
});

test('rejects missing SQL parameter values', () => {
  assert.throws(() => bindNamedParameters('SELECT :required', {}, 'POSTGRESQL'), /has no value/);
});

test('allows only a single supported statement and rejects CTE escape paths', () => {
  assert.equal(validateSqlStatement('SELECT id FROM orders', 'POSTGRESQL', 'READ_ONLY'), 'select');
  assert.throws(() => validateSqlStatement('SELECT 1; SELECT 2', 'POSTGRESQL', 'READ_ONLY'), /one SQL statement/);
  assert.throws(() => validateSqlStatement('WITH changed AS (DELETE FROM orders RETURNING id) SELECT * FROM changed', 'POSTGRESQL', 'READ_WRITE'), /CTEs|SQL syntax/);
});

test('enforces SQL operation allowlists independently of user-selected access mode', () => {
  assert.throws(() => validateSqlStatement('INSERT INTO orders(id) VALUES (1)', 'POSTGRESQL', 'READ_ONLY'), /read-only/);
  assert.equal(validateSqlStatement('UPDATE orders SET status = :status', 'POSTGRESQL', 'READ_WRITE'), 'update');
  assert.equal(validateSqlStatement('DELETE FROM orders WHERE id = :id', 'MYSQL', 'READ_WRITE'), 'delete');
  assert.throws(() => validateSqlStatement('DROP TABLE orders', 'MYSQL', 'READ_WRITE'), /Only SELECT/);
  assert.throws(() => validateSqlStatement('/*!50000 DELETE FROM orders */ SELECT 1', 'MYSQL', 'READ_WRITE'), /executable comments/);
});

test('evaluates supported database assertions against bounded result data', () => {
  const rows = [{ status: 'ready', deletedAt: null }];
  const makeStep = (assertion: NonNullable<Step['assertion']>): Step => ({ action: 'assertDatabaseResult', assertion });
  assert.equal(evaluateDatabaseAssertion(makeStep({ type: 'rowCountEquals', expected: '1' }), rows, 0, false), true);
  assert.equal(evaluateDatabaseAssertion(makeStep({ type: 'columnEquals', column: 'status', expected: 'ready' }), rows, 0, false), true);
  assert.equal(evaluateDatabaseAssertion(makeStep({ type: 'columnNotNull', column: 'deletedAt' }), rows, 0, false), false);
  assert.equal(evaluateDatabaseAssertion(makeStep({ type: 'affectedRowsEquals', expected: '2' }), [], 2, false), true);
  assert.equal(evaluateDatabaseAssertion(makeStep({ type: 'rowCountEquals', expected: '1' }), rows, 0, true), false);
  assert.equal(evaluateDatabaseAssertion(makeStep({ type: 'rowCountGreaterThan', expected: '99' }), rows, 0, true), true);
  assert.equal(evaluateDatabaseAssertion(makeStep({ type: 'rowCountGreaterThan', expected: '100' }), rows, 0, true), false);
});

test('blocks loopback database hosts before resolving or opening a socket', async () => {
  await assert.rejects(openDatabaseConnection({
    id: 'c1', projectId: 'p1', name: 'blocked', provider: 'POSTGRESQL', host: '127.0.0.1', port: 5432,
    database: 'test', username: 'test', encryptedCredentials: 'not-decrypted', ssl: true, accessMode: 'READ_ONLY'
  }), /private, local, or reserved/);
});
