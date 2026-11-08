import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { validateSuiteConfiguration, type SuiteExecutionConfig } from '../src/services/suite-runner';
import { VariableContext } from '../src/utils/variable-context';
import { testQueue } from '../src/queue/queue';
import redis from '../src/redis';

after(async () => {
  await testQueue.close().catch(() => undefined);
  redis.disconnect();
});

const checks = [
  { id: 'create', steps: [{ action: 'captureValue', saveAs: 'USER_ID' }], testData: [] },
  { id: 'verify', steps: [{ action: 'captureValue', saveAs: 'USER_ID' }], testData: [] },
  { id: 'delete', steps: [{ action: 'executeSql', saveResultAs: 'AFFECTED' }], testData: [] }
];
const base: SuiteExecutionConfig = {
  orderedTestIds: ['create', 'verify', 'delete'],
  mappings: [
    { sourceTestId: 'create', outputVariable: 'USER_ID', targetTestId: 'verify', targetVariable: 'USER_ID', required: true, expectedType: 'string' },
    { sourceTestId: 'verify', outputVariable: 'USER_ID', targetTestId: 'delete', targetVariable: 'USER_ID', required: true }
  ],
  dataCaseIndexes: {}
};

test('validates ordered handoff mappings and declared step outputs', () => {
  assert.doesNotThrow(() => validateSuiteConfiguration({ executionMode: 'SEQUENTIAL', testIds: base.orderedTestIds, config: base, tests: checks }));
  assert.throws(() => validateSuiteConfiguration({
    executionMode: 'SEQUENTIAL', testIds: base.orderedTestIds,
    config: { ...base, mappings: [{ ...base.mappings[0], sourceTestId: 'verify', targetTestId: 'create' }] }, tests: checks
  }), /earlier selected check/);
  assert.throws(() => validateSuiteConfiguration({
    executionMode: 'SEQUENTIAL', testIds: base.orderedTestIds,
    config: { ...base, mappings: [{ ...base.mappings[0], outputVariable: 'MISSING' }] }, tests: checks
  }), /is not produced/);
});

test('rejects duplicate target inputs and mappings in independent mode', () => {
  const duplicate = { ...base, mappings: [...base.mappings, { ...base.mappings[0], targetTestId: 'delete' }] };
  assert.throws(() => validateSuiteConfiguration({ executionMode: 'SEQUENTIAL', testIds: base.orderedTestIds, config: duplicate, tests: checks }), /more than one mapping/);
  assert.throws(() => validateSuiteConfiguration({ executionMode: 'INDEPENDENT', testIds: base.orderedTestIds, config: base, tests: checks }), /only available in Sequential/);
});

test('requires one enabled Test Data case and rejects disabled selections', () => {
  const dataChecks = [
    { ...checks[0], testData: [{ name: 'disabled', enabled: false, variables: {} }, { name: 'ready', enabled: true, variables: {} }] },
    ...checks.slice(1)
  ];
  assert.throws(() => validateSuiteConfiguration({ executionMode: 'INDEPENDENT', testIds: base.orderedTestIds, config: { ...base, mappings: [], dataCaseIndexes: {} }, tests: dataChecks }), /Choose an enabled Test Data case/);
  assert.throws(() => validateSuiteConfiguration({ executionMode: 'INDEPENDENT', testIds: base.orderedTestIds, config: { ...base, mappings: [], dataCaseIndexes: { create: 0 } }, tests: dataChecks }), /disabled/);
  assert.doesNotThrow(() => validateSuiteConfiguration({ executionMode: 'INDEPENDENT', testIds: base.orderedTestIds, config: { ...base, mappings: [], dataCaseIndexes: { create: 1 } }, tests: dataChecks }));
});

test('run inputs retain scalar types and inherited secret metadata without exposing values in metadata', () => {
  const source = new VariableContext();
  source.setRuntime('USER_ID', 42, { source: 'captured', secret: true, createdByStep: 2 });
  const output = source.getRuntimeEntries()[0];
  const target = new VariableContext({ runInputs: { USER_ID: output.value }, secretNames: [output.name] });
  assert.equal(target.resolveTyped('{{USER_ID}}'), 42);
  assert.deepEqual(target.getMetadata(), [{ name: 'USER_ID', type: 'number', secret: true, source: 'runInput' }]);
  assert.equal(JSON.stringify(target.getMetadata()).includes('42'), false);
});
