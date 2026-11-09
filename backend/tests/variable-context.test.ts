import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VariableContext,
  VariableEngineError
} from '../src/utils/variable-context';
import type { Step } from '../src/types/step';

test('resolves variables by runtime, run input, test data, environment, then project precedence', () => {
  const context = new VariableContext({
    projectVariables: { SHARED: 'project' },
    environmentVariables: { SHARED: 'environment' },
    testDataVariables: { SHARED: 'case' },
    runInputs: { SHARED: 'input' }
  });
  assert.equal(context.resolve('SHARED')?.value, 'input');
  context.setRuntime('SHARED', 'captured', { source: 'captured', createdByStep: 2 });
  assert.equal(context.resolve('SHARED')?.value, 'captured');
  assert.equal(context.getMetadata().find(({ name }) => name === 'SHARED')?.source, 'captured');

  const legacyScopes = new VariableContext({
    projectVariables: { SHARED: 'project' },
    environmentVariables: { SHARED: 'environment' },
    testDataVariables: { SHARED: 'case' }
  });
  assert.equal(legacyScopes.resolve('SHARED')?.value, 'case');
});

test('interpolates scalar values and preserves typed exact SQL parameter references', () => {
  const context = new VariableContext({
    testDataVariables: { USER_ID: 42, ENABLED: false, OPTIONAL: null, LABEL: 'ready' }
  });
  assert.equal(context.interpolate('Hello {{LABEL}}'), 'Hello ready');
  assert.equal(context.resolveSqlParameter('{{USER_ID}}'), 42);
  assert.equal(context.resolveSqlParameter('{{ENABLED}}'), false);
  assert.equal(context.resolveSqlParameter('{{OPTIONAL}}'), null);
  assert.equal(context.resolveSqlParameter('id={{USER_ID}}'), 'id=42');
});

test('keeps JSON typed for exact references and rejects implicit text coercion', () => {
  const context = new VariableContext({ runInputs: { PROFILE: { id: 7 }, ITEMS: ['a', 'b'] } });
  assert.deepEqual(context.resolveTyped('{{PROFILE}}'), { id: 7 });
  assert.deepEqual(context.resolveTyped('{{ITEMS}}'), ['a', 'b']);
  assert.throws(() => context.interpolate('profile={{PROFILE}}'), (error: unknown) =>
    error instanceof VariableEngineError && error.code === 'VARIABLE_TYPE_MISMATCH'
  );
});

test('resolves all supported step fields without interpolating SQL statement text', () => {
  const context = new VariableContext({ testDataVariables: { ID: 17, EXPECTED: 'ready', LABEL: 'Order' } });
  const rawStep: Step = {
    action: 'executeSql',
    sql: 'SELECT * FROM orders WHERE id = :id',
    selector: 'page.getByLabel(\'{{LABEL}}\')',
    expected: '{{EXPECTED}}',
    parameters: { id: '{{ID}}' },
    assertion: { type: 'columnEquals', expected: '{{EXPECTED}}' }
  };
  const resolved = context.resolveStep(rawStep, 2);
  assert.equal(resolved.selector, "page.getByLabel('Order')");
  assert.equal(resolved.expected, 'ready');
  assert.equal(resolved.sql, rawStep.sql);
  assert.equal(resolved.parameters?.id, 17);
  assert.equal(resolved.assertion?.expected, 'ready');
});

test('supports escaped literal template syntax and reports missing variables structurally', () => {
  const context = new VariableContext();
  assert.equal(context.interpolate('Use \\{{NAME}} literally'), 'Use {{NAME}} literally');
  assert.throws(() => context.interpolate('{{MISSING}}', { stepIndex: 3 }), (error: unknown) => {
    assert.ok(error instanceof VariableEngineError);
    assert.equal(error.code, 'VARIABLE_NOT_FOUND');
    assert.equal(error.variableName, 'MISSING');
    assert.equal(error.stepIndex, 3);
    return true;
  });
});

test('retains legacy word-character variable names', () => {
  const context = new VariableContext({ runInputs: { '1ST_VALUE': 'legacy' } });
  assert.equal(context.interpolate('{{1ST_VALUE}}'), 'legacy');
});

test('requires explicit replacement for repeated run-local writes', () => {
  const context = new VariableContext({ testDataVariables: { VALUE: 'input' } });
  context.setRuntime('VALUE', 1, { source: 'captured', createdByStep: 1 });
  assert.equal(context.resolve('VALUE')?.value, 1);
  assert.throws(() => context.assertRuntimeWritable('VALUE', false, 2), (error: unknown) =>
    error instanceof VariableEngineError && error.code === 'VARIABLE_COLLISION'
  );
  context.setRuntime('VALUE', 2, { source: 'captured', createdByStep: 2, replace: true });
  assert.equal(context.resolve('VALUE')?.value, 2);
});

test('validates variable names and value size and keeps metadata value-free', () => {
  assert.throws(() => new VariableContext({ runInputs: { 'bad name': 'x' } }), (error: unknown) =>
    error instanceof VariableEngineError && error.code === 'VARIABLE_INVALID_NAME'
  );
  assert.throws(() => new VariableContext({ runInputs: { VALUE: 'x'.repeat(10_001) } }), (error: unknown) =>
    error instanceof VariableEngineError && error.code === 'VARIABLE_VALUE_TOO_LARGE'
  );
  const context = new VariableContext({ environmentVariables: { API_TOKEN: 'secret-token' } });
  assert.deepEqual(context.getMetadata(), [{ name: 'API_TOKEN', type: 'string', secret: true, source: 'environment' }]);
  assert.equal(context.redact('failed with secret-token'), 'failed with ••••••');
});

test('keeps independent run contexts isolated', () => {
  const firstRun = new VariableContext({ testDataVariables: { CASE_ID: 'first' } });
  const secondRun = new VariableContext({ testDataVariables: { CASE_ID: 'second' } });
  firstRun.setRuntime('CAPTURED', 10, { source: 'captured', createdByStep: 1 });
  assert.equal(firstRun.resolve('CASE_ID')?.value, 'first');
  assert.equal(secondRun.resolve('CASE_ID')?.value, 'second');
  assert.equal(secondRun.has('CAPTURED'), false);
});
