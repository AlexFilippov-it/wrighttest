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
