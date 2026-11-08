import assert from 'node:assert/strict';
import test from 'node:test';
import { generateTestDataValue, isSecretGeneratorStep, validateGeneratorOptions } from '../src/services/test-data-generators';
import { VariableContext, VariableEngineError } from '../src/utils/variable-context';
import { StepSchema } from '../src/schemas/test.schema';

test('every generator returns its promised value type and bounded format', () => {
  assert.match(String(generateTestDataValue('username', { prefix: 'test_', length: 18 })), /^test_[a-z0-9]{13}$/);
  assert.match(String(generateTestDataValue('email')), /^user_[a-z0-9]{12}@example\.test$/);
  assert.match(String(generateTestDataValue('password', { length: 20, symbols: true })), /[A-Z]/);
  assert.match(String(generateTestDataValue('uuid')), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(String(generateTestDataValue('string', { length: 20, charset: 'hex' })), /^[0-9a-f]{20}$/);
  assert.equal(typeof generateTestDataValue('number', { min: -10, max: -2 }), 'number');
  assert.equal(typeof generateTestDataValue('boolean'), 'boolean');
  assert.match(String(generateTestDataValue('date', { start: '2024-01-01', end: '2024-01-01' })), /^2024-01-01$/);
  assert.match(String(generateTestDataValue('timestamp', { format: 'iso' })), /^\d{4}-\d\d-\d\dT/);
  assert.match(String(generateTestDataValue('pattern', { pattern: 'user_XXXX_####' })), /^user_[a-z0-9]{4}_\d{4}$/);
});

test('password generation enforces selected groups and always identifies as secret', () => {
  const password = String(generateTestDataValue('password', { length: 12, uppercase: true, lowercase: true, digits: true, symbols: true }));
  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /\d/);
  assert.match(password, /[!@#$%^&*_=+-]/);
  assert.equal(isSecretGeneratorStep({ generator: 'password', saveAs: 'PASSWORD' }), true);
  assert.equal(isSecretGeneratorStep({ generator: 'string', saveAs: 'API_TOKEN', secret: false }), true);
});

test('generator configuration rejects invalid ranges, lengths, domains, and patterns without generating values', () => {
  for (const [generator, options] of [
    ['string', { length: 513 }],
    ['password', { length: 7 }],
    ['number', { min: 3, max: -3 }],
    ['number', { min: 0, max: 1, integer: false, precision: 9 }],
    ['email', { domain: 'not a domain' }],
    ['username', { length: 'sixteen' }],
    ['pattern', { pattern: '{{UNKNOWN}}' }],
    ['pattern', { pattern: '\\q' }],
    ['username', { length: 8, prefix: 'prefix-', suffix: 'suffix' }]
  ] as const) {
    assert.throws(() => validateGeneratorOptions(generator, options), /Generate Test Data:/);
  }
  assert.throws(() => generateTestDataValue('pattern', { pattern: 'X'.repeat(513) }), /pattern must contain 1 to 256 characters/);
  assert.equal(generateTestDataValue('number', { min: -2, max: -2, integer: true }), -2);
});

test('runtime generation is isolated, collision-safe, replaceable only by opt-in, and secret metadata has no value', () => {
  const first = new VariableContext({ testDataVariables: { BASE: 'unchanged' } });
  const second = new VariableContext({ testDataVariables: { BASE: 'unchanged' } });
  const value = generateTestDataValue('username', { length: 16 });
  first.assertRuntimeWritable('USERNAME', false, 0);
  first.setRuntime('USERNAME', value, { source: 'generated', createdByStep: 1 });
  first.setRuntime('PASSWORD', 'synthetic-secret', { source: 'generated', secret: true, createdByStep: 2 });
  assert.equal(first.interpolate('{{USERNAME}}'), value);
  assert.equal(first.redact('synthetic-secret'), '••••••');
  assert.equal(second.has('USERNAME'), false);
  assert.equal(first.resolve('BASE')?.value, 'unchanged');
  assert.throws(() => first.assertRuntimeWritable('USERNAME', false, 2), (error: unknown) => error instanceof VariableEngineError && error.code === 'VARIABLE_COLLISION');
  first.assertRuntimeWritable('USERNAME', true, 2);
  assert.deepEqual(first.getMetadata().find((entry) => entry.name === 'PASSWORD'), {
    name: 'PASSWORD', type: 'string', secret: true, source: 'generated', createdByStep: 2
  });
  assert.equal(JSON.stringify(first.getMetadata()).includes('synthetic-secret'), false);
});

test('API step schema accepts safe Generate Test Data definitions and rejects malformed ones', () => {
  assert.equal(StepSchema.safeParse({ action: 'generateData', generator: 'username', saveAs: 'USERNAME', generatorOptions: { prefix: 'test_', length: 16 } }).success, true);
  assert.equal(StepSchema.safeParse({ action: 'generateData', generator: 'password', saveAs: 'PASSWORD', generatorOptions: { length: 12 } }).success, true);
  assert.equal(StepSchema.safeParse({ action: 'generateData', generator: 'password', saveAs: 'password', generatorOptions: { length: 12 } }).success, false);
  assert.equal(StepSchema.safeParse({ action: 'generateData', generator: 'pattern', saveAs: 'ID', generatorOptions: { pattern: '{{EVAL}}' } }).success, false);
});
