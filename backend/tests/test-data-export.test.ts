import assert from 'node:assert/strict';
import test from 'node:test';
import { exportToSpec } from '../src/services/exporter';
import { parsePlaywrightSpec } from '../src/services/importer';
import type { Step } from '../src/types/step';

test('export/import preserves runtime generator steps and downstream variable references', () => {
  const source: Step[] = [
    { action: 'generateData', generator: 'password', saveAs: 'PASSWORD', secret: true, replace: true, generatorOptions: { length: 16, uppercase: true } },
    { action: 'generateData', generator: 'username', saveAs: 'USERNAME', generatorOptions: { prefix: 'qa_', length: 16 } },
    { action: 'fill', selector: "page.getByLabel('Password')", value: '{{PASSWORD}}' },
    { action: 'click', selector: 'page.getByRole(\'button\', { name: "Continue as {{USERNAME}}" })' }
  ];
  const spec = exportToSpec(source, { testName: 'generated password' });
  assert.match(spec, /randomInt/);
  assert.match(spec, /__wtGenerate\("password"/);
  assert.match(spec, /String\(__wtRuntime\["PASSWORD"\]\)/);
  assert.ok(spec.includes('__wtTemplate("Continue as {{USERNAME}}")'));
  const parsed = parsePlaywrightSpec(spec);
  assert.deepEqual(parsed.steps, [
    { action: 'generateData', generator: 'password', generatorOptions: { length: 16, uppercase: true }, saveAs: 'PASSWORD', secret: true, replace: true },
    { action: 'generateData', generator: 'username', generatorOptions: { prefix: 'qa_', length: 16 }, saveAs: 'USERNAME', secret: false, replace: false },
    { action: 'fill', selector: "page.getByLabel('Password')", value: '{{PASSWORD}}' },
    { action: 'click', selector: 'page.getByRole(\'button\', { name: "Continue as {{USERNAME}}" })' }
  ]);
});

test('export/import round-trips browser capture and SQL capture configuration without runtime values', () => {
  const source: Step[] = [
    { action: 'captureValue', captureSource: 'attribute', selector: '#account', attributeName: 'data-id', saveAs: 'ACCOUNT_ID', secret: false, replace: true },
    { action: 'executeSql', databaseConnectionId: 'db-1', sql: 'SELECT id FROM accounts WHERE id = :id', parameters: { id: '{{ACCOUNT_ID}}' }, saveResultAs: 'DB_ID', saveResultType: 'column', saveRowIndex: 0, saveColumn: 'id', secret: true }
  ];
  const spec = exportToSpec(source, { testName: 'capture flow' });
  assert.match(spec, /__wtCapture/);
  assert.match(spec, /WRIGHTTEST_STEP/);
  const parsed = parsePlaywrightSpec(spec);
  assert.deepEqual(parsed.steps, source);
  assert.doesNotMatch(spec, /captured runtime value/i);
});

test('export/import round-trips typed Test Data and project/environment references', () => {
  const testData = [{
    name: 'Generated account',
    enabled: true,
    variables: {
      COUNTRY: { kind: 'literal', value: 'Germany' },
      BASE_URL: { kind: 'reference', name: 'BASE_URL', source: 'project' },
      EMAIL: { kind: 'generated', generator: 'email', options: { domain: 'example.test' } }
    }
  }];
  const spec = exportToSpec([{ action: 'goto', value: '{{BASE_URL}}' }], { testName: 'typed test data', testData });
  const parsed = parsePlaywrightSpec(spec);
  assert.deepEqual(parsed.testData, testData);
});
