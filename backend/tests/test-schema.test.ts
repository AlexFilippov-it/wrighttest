import assert from 'node:assert/strict';
import test from 'node:test';
import { CreateTestSchema, StepSchema, UpdateTestSchema } from '../src/schemas/test.schema';

const baseCheck = {
  name: 'Desktop check',
  url: 'https://example.com',
  steps: []
};

test('create check accepts a cleared device as the desktop default', () => {
  const result = CreateTestSchema.safeParse({
    ...baseCheck,
    device: null
  });

  assert.equal(result.success, true);
});

test('update check accepts clearing a previously selected device', () => {
  const result = UpdateTestSchema.safeParse({ device: null });

  assert.equal(result.success, true);
});

test('database steps require a valid query and complete result assertion fields', () => {
  const base = { action: 'assertDatabaseResult', databaseConnectionId: 'connection-1', sql: 'SELECT status FROM orders', assertion: { type: 'columnEquals' } };
  assert.equal(StepSchema.safeParse(base).success, false);
  assert.equal(StepSchema.safeParse({ ...base, assertion: { type: 'columnEquals', column: 'status', expected: 'ready' } }).success, true);
  assert.equal(StepSchema.safeParse({ ...base, assertion: { type: 'rowCountEquals', expected: '-1' } }).success, false);
  assert.equal(StepSchema.safeParse({ ...base, assertion: { type: 'rowCountEquals', expected: '1.5' } }).success, false);
});

test('database steps accept typed SQL parameter scalars and legacy strings', () => {
  const base = { action: 'executeSql', databaseConnectionId: 'connection-1', sql: 'SELECT :id, :enabled, :empty, :legacy' };
  assert.equal(StepSchema.safeParse({ ...base, parameters: { id: 12, enabled: true, empty: null, legacy: '12' } }).success, true);
  assert.equal(StepSchema.safeParse({ ...base, parameters: { nested: { value: 1 } } }).success, false);
});

test('database result can save the first returned column or an explicitly selected column', () => {
  const base = { action: 'executeSql', databaseConnectionId: 'connection-1', sql: 'SELECT id FROM orders' };
  assert.equal(StepSchema.safeParse({ ...base, saveResultAs: 'ORDER_ID' }).success, true);
  assert.equal(StepSchema.safeParse({ ...base, saveResultAs: 'ORDER_ID', saveColumn: 'id' }).success, true);
  assert.equal(StepSchema.safeParse({ ...base, saveResultAs: 'ORDER_ID', saveColumn: '' }).success, false);
});

test('capture value validates source, selector, attribute and runtime variable name', () => {
  assert.equal(StepSchema.safeParse({ action: 'captureValue', captureSource: 'url', saveAs: 'CURRENT_URL' }).success, true);
  assert.equal(StepSchema.safeParse({ action: 'captureValue', captureSource: 'text', selector: '#order-id', saveAs: 'ORDER_ID' }).success, true);
  assert.equal(StepSchema.safeParse({ action: 'captureValue', captureSource: 'attribute', selector: '#order', saveAs: 'ORDER_ID' }).success, false);
  assert.equal(StepSchema.safeParse({ action: 'captureValue', captureSource: 'text', saveAs: 'bad-name' }).success, false);
});

test('SQL save modes accept row count and affected rows while preserving legacy fields', () => {
  const base = { action: 'executeSql', databaseConnectionId: 'connection-1', sql: 'SELECT id FROM orders' };
  assert.equal(StepSchema.safeParse({ ...base, saveResultAs: 'ROW_COUNT', saveResultType: 'rowCount' }).success, true);
  assert.equal(StepSchema.safeParse({ ...base, saveResultAs: 'CHANGED', saveResultType: 'affectedRows' }).success, true);
  assert.equal(StepSchema.safeParse({ ...base, saveResultAs: 'ORDER_ID', saveColumn: 'id', saveRowIndex: 2 }).success, true);
});
