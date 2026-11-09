import assert from 'node:assert/strict';
import test from 'node:test';
import type { Page } from 'playwright';
import type { Step } from '../src/types/step';
import { captureBrowserValue, selectSqlCaptureValue } from '../src/services/value-capture';
import { executeDatabaseStep } from '../src/services/database-connections';
import { VariableContext } from '../src/utils/variable-context';

function fakePage(options: {
  count?: number;
  text?: string | null;
  input?: string;
  attributes?: Record<string, string | null>;
  url?: string;
}) {
  const locator = {
    count: async () => options.count ?? 1,
    waitFor: async () => undefined,
    textContent: async () => options.text ?? '',
    inputValue: async () => options.input ?? '',
    getAttribute: async (name: string) => options.attributes?.[name] ?? null
  };
  return {
    url: () => options.url ?? 'https://example.test/path',
    locator: () => locator,
    waitForTimeout: async () => undefined
  } as unknown as Page;
}

test('captures text, empty input, attributes, current URL and element count', async () => {
  assert.deepEqual(await captureBrowserValue(fakePage({ text: 'Account 42' }), { action: 'captureValue', captureSource: 'text', selector: '#id' }, 1), { value: 'Account 42', secret: false });
  assert.deepEqual(await captureBrowserValue(fakePage({ input: '', attributes: { type: 'text' } }), { action: 'captureValue', captureSource: 'input', selector: '#name' }, 1), { value: '', secret: false });
  assert.deepEqual(await captureBrowserValue(fakePage({ attributes: { 'data-id': '42' } }), { action: 'captureValue', captureSource: 'attribute', selector: '#id', attributeName: 'data-id' }, 1), { value: '42', secret: false });
  assert.deepEqual(await captureBrowserValue(fakePage({ url: 'https://example.test/account/42' }), { action: 'captureValue', captureSource: 'url' }, 1), { value: 'https://example.test/account/42', secret: false });
  assert.deepEqual(await captureBrowserValue(fakePage({ url: 'https://example.test/callback?auth_code=one-time-secret' }), { action: 'captureValue', captureSource: 'url' }, 1), { value: 'https://example.test/callback?auth_code=one-time-secret', secret: true });
  assert.deepEqual(await captureBrowserValue(fakePage({ count: 3 }), { action: 'captureValue', captureSource: 'count', selector: '.row' }, 1), { value: 3, secret: false });
});

test('marks password input and sensitive attribute values as secret', async () => {
  assert.deepEqual(await captureBrowserValue(fakePage({ input: 'not-returned', attributes: { type: 'password' } }), { action: 'captureValue', captureSource: 'input', selector: '#password' }, 1), { value: 'not-returned', secret: true });
  assert.deepEqual(await captureBrowserValue(fakePage({ attributes: { 'data-token': 'secret-value' } }), { action: 'captureValue', captureSource: 'attribute', selector: '#token', attributeName: 'data-token' }, 1), { value: 'secret-value', secret: true });
});

test('rejects missing, ambiguous, over-limit and unavailable values without rejecting empty strings', async () => {
  await assert.rejects(captureBrowserValue(fakePage({ count: 0 }), { action: 'captureValue', captureSource: 'text', selector: '#missing' }, 1), /not found/);
  await assert.rejects(captureBrowserValue(fakePage({ count: 2 }), { action: 'captureValue', captureSource: 'text', selector: '.many' }, 1), /matched 2 elements/);
  await assert.rejects(captureBrowserValue(fakePage({ text: 'x'.repeat(10_001) }), { action: 'captureValue', captureSource: 'text', selector: '#large' }, 1), /character limit/);
  await assert.rejects(captureBrowserValue(fakePage({ attributes: {} }), { action: 'captureValue', captureSource: 'attribute', selector: '#item', attributeName: 'data-id' }, 1), /attribute .* is missing/);
  await assert.rejects(captureBrowserValue(fakePage({ count: 0 }), { action: 'captureValue', captureSource: 'count', selector: '.missing' }, 1), /not found/);
  await assert.rejects(captureBrowserValue(fakePage({ url: `https://example.test/${'x'.repeat(10_001)}` }), { action: 'captureValue', captureSource: 'url' }, 1), /character limit/);
});

test('SQL capture preserves scalar types and distinguishes NULL from missing row or column', () => {
  const base: Step = { action: 'executeSql', saveResultAs: 'VALUE' };
  assert.deepEqual(selectSqlCaptureValue({ step: base, statementType: 'select', rows: [{ id: 42 }], affectedRows: 0, rowLimitReached: false }), { value: 42, secret: false });
  assert.deepEqual(selectSqlCaptureValue({ step: { ...base, saveColumn: 'optional' }, statementType: 'select', rows: [{ optional: null }], affectedRows: 0, rowLimitReached: false }), { value: null, secret: false });
  assert.deepEqual(selectSqlCaptureValue({ step: { ...base, saveColumn: 'api_token' }, statementType: 'select', rows: [{ api_token: 'synthetic-secret' }], affectedRows: 0, rowLimitReached: false }), { value: 'synthetic-secret', secret: true });
  assert.throws(() => selectSqlCaptureValue({ step: base, statementType: 'select', rows: [], affectedRows: 0, rowLimitReached: false }), /row 0 is missing/);
  assert.throws(() => selectSqlCaptureValue({ step: { ...base, saveColumn: 'missing' }, statementType: 'select', rows: [{ id: 1 }], affectedRows: 0, rowLimitReached: false }), /column .* is missing/);
  assert.deepEqual(selectSqlCaptureValue({ step: { ...base, saveResultType: 'rowCount' }, statementType: 'select', rows: [{ id: 1 }, { id: 2 }], affectedRows: 0, rowLimitReached: false }), { value: 2, secret: false });
  assert.throws(() => selectSqlCaptureValue({ step: { ...base, saveResultType: 'rowCount' }, statementType: 'select', rows: [], affectedRows: 0, rowLimitReached: true }), /safe row limit/);
  assert.deepEqual(selectSqlCaptureValue({ step: { ...base, saveResultType: 'affectedRows' }, statementType: 'update', rows: [], affectedRows: 3, rowLimitReached: false }), { value: 3, secret: false });
  assert.throws(() => selectSqlCaptureValue({ step: { ...base, saveResultType: 'affectedRows' }, statementType: 'select', rows: [], affectedRows: 0, rowLimitReached: false }), /SELECT/);
});

test('a browser capture is passed to SQL as a typed bound parameter', async () => {
  const value = await captureBrowserValue(fakePage({ text: 'user-42' }), {
    action: 'captureValue', captureSource: 'text', selector: '#user-id'
  }, 1);
  const variables = new VariableContext();
  variables.setRuntime('USER_ID', value.value, { source: 'captured', createdByStep: 1 });

  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const session = {
    provider: 'POSTGRESQL',
    client: {
      query: async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        if (/^\s*SELECT/i.test(sql)) return { rows: [{ id: 42 }], rowCount: 1, fields: [{ name: 'id' }] };
        return { rows: [], rowCount: 0, fields: [] };
      }
    }
  };
  await executeDatabaseStep(session as never, 'isolated', 'READ_ONLY', {
    action: 'executeSql',
    sql: 'SELECT id FROM users WHERE id = :id',
    parameters: { id: '{{USER_ID}}' }
  }, variables);

  const dataQuery = queries.find(({ sql }) => /^\s*SELECT/i.test(sql));
  assert.deepEqual(dataQuery?.values, ['user-42']);
  assert.match(dataQuery?.sql ?? '', /WHERE id = \$1/);
});
