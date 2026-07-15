import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTemplateVariablesDiagnostics,
  extractTemplateVariableUsages,
  getBlockingTemplateVariableErrorsForCase
} from '../src/utils/templateVariables';
import type { Step, TestDataCase } from '../src/types';

function testCase(name: string, variables: Record<string, string>, enabled = true): TestDataCase {
  return { name, variables, enabled };
}

test('extracts variables from URL, step value and expected', () => {
  const usages = extractTemplateVariableUsages('{{BASE_URL}}/login', [
    { action: 'fill', selector: "page.getByLabel('Email')", value: '{{EMAIL}}' },
    { action: 'assertText', selector: "page.getByRole('alert')", expected: '{{EXPECTED_MESSAGE}}' }
  ]);

  assert.deepEqual(usages, [
    { variable: 'BASE_URL', locations: ['Test URL'] },
    { variable: 'EMAIL', locations: ['Step 1 value'] },
    { variable: 'EXPECTED_MESSAGE', locations: ['Step 2 expected'] }
  ]);
});

test('returns repeated variables once with all usage locations', () => {
  const usages = extractTemplateVariableUsages('{{EMAIL}}', [
    { action: 'fill', selector: '{{EMAIL}}', value: '{{EMAIL}}' }
  ]);

  assert.deepEqual(usages, [
    { variable: 'EMAIL', locations: ['Test URL', 'Step 1 selector', 'Step 1 value'] }
  ]);
});

test('empty string case variable is a defined value', () => {
  const diagnostics = buildTemplateVariablesDiagnostics({
    useTestData: true,
    url: '{{BASE_URL}}',
    steps: [{ action: 'fill', selector: '#password', value: '{{PASSWORD}}' }],
    testData: [testCase('Empty password', { BASE_URL: 'https://example.com', PASSWORD: '' })]
  });

  assert.deepEqual(diagnostics.errors, []);
});

test('case variable satisfies requirement and can override environment without error', () => {
  const diagnostics = buildTemplateVariablesDiagnostics({
    useTestData: true,
    url: '{{BASE_URL}}',
    steps: [{ action: 'fill', selector: '#email', value: '{{EMAIL}}' }],
    selectedEnvironment: { variables: { BASE_URL: 'https://env.example', EMAIL: 'env@example.com' } },
    testData: [testCase('Case override', { EMAIL: 'case@example.com' })]
  });

  assert.deepEqual(diagnostics.errors, []);
});

test('environment variable satisfies requirement', () => {
  const diagnostics = buildTemplateVariablesDiagnostics({
    useTestData: true,
    url: '{{BASE_URL}}',
    steps: [{ action: 'assertTitle', expected: '{{TITLE}}' }],
    selectedEnvironment: { variables: { BASE_URL: 'https://example.com', TITLE: 'Home' } },
    testData: [testCase('No local vars', {})]
  });

  assert.deepEqual(diagnostics.errors, []);
});

test('diagnostics treats expected result variables as regular scenario variables', () => {
  const diagnostics = buildTemplateVariablesDiagnostics({
    useTestData: true,
    url: '{{EXPECTED_URL}}',
    steps: [
      { action: 'fill', selector: '#email', value: '{{EMAIL}}' },
      { action: 'assertText', selector: '#message', expected: '{{EXPECTED_MESSAGE}}' },
      { action: 'assertURL', expected: '{{EXPECTED_URL}}' }
    ],
    testData: [
      testCase('Wrong password', {
        EMAIL: 'admin@test.com',
        EXPECTED_MESSAGE: 'Invalid email or password',
        EXPECTED_URL: 'https://demo.wrighttest.com/login'
      })
    ]
  });

  assert.deepEqual(diagnostics.errors, []);
  assert.deepEqual(diagnostics.usedVariables, ['EMAIL', 'EXPECTED_MESSAGE', 'EXPECTED_URL']);
});

test('missing variable creates blocking error for enabled case', () => {
  const diagnostics = buildTemplateVariablesDiagnostics({
    useTestData: true,
    url: 'https://example.com',
    steps: [{ action: 'fill', selector: '#email', value: '{{EMAIL}}' }],
    testData: [testCase('Missing email', {})]
  });

  assert.deepEqual(diagnostics.errors, ['Variable EMAIL is missing in all enabled cases.']);
  assert.deepEqual(getBlockingTemplateVariableErrorsForCase(diagnostics, 0), ['Case "Missing email" is missing variable EMAIL.']);
});

test('disabled case does not create blocking error', () => {
  const diagnostics = buildTemplateVariablesDiagnostics({
    useTestData: true,
    url: 'https://example.com',
    steps: [{ action: 'fill', selector: '#email', value: '{{EMAIL}}' }],
    testData: [
      testCase('Enabled', { EMAIL: 'user@example.com' }),
      testCase('Disabled missing', {}, false)
    ]
  });

  assert.deepEqual(diagnostics.errors, []);
});

test('missing variable in one enabled case creates case-specific blocking error', () => {
  const diagnostics = buildTemplateVariablesDiagnostics({
    useTestData: true,
    url: 'https://example.com',
    steps: [{ action: 'fill', selector: '#email', value: '{{EMAIL}}' }],
    testData: [
      testCase('Valid', { EMAIL: 'user@example.com' }),
      testCase('Missing', {})
    ]
  });

  assert.deepEqual(diagnostics.errors, ['Case "Missing" is missing variable EMAIL.']);
  assert.deepEqual(getBlockingTemplateVariableErrorsForCase(diagnostics, 0), []);
  assert.deepEqual(getBlockingTemplateVariableErrorsForCase(diagnostics, 1), ['Case "Missing" is missing variable EMAIL.']);
});

test('unused variable, missing assertions and different key sets create warnings', () => {
  const diagnostics = buildTemplateVariablesDiagnostics({
    useTestData: true,
    url: 'https://example.com',
    steps: [{ action: 'fill', selector: '#email', value: '{{EMAIL}}' }],
    testData: [
      testCase('First', { EMAIL: 'user@example.com', UNUSED: 'x' }),
      testCase('Second', { EMAIL: 'admin@example.com' })
    ]
  });

  assert.ok(diagnostics.warnings.includes('Variable UNUSED exists in test data but is not used.'));
  assert.ok(diagnostics.warnings.includes('Enabled cases use different variable key sets.'));
  assert.ok(diagnostics.warnings.includes('This data-driven check does not contain assertions.'));
});

test('test data enabled with no template variables creates warning', () => {
  const diagnostics = buildTemplateVariablesDiagnostics({
    useTestData: true,
    url: 'https://example.com',
    steps: [{ action: 'assertTitle', expected: 'Home' }],
    testData: [testCase('Case', { EMAIL: 'user@example.com' })]
  });

  assert.ok(diagnostics.warnings.includes('Test data is enabled, but this check does not use template variables.'));
});

test('use test data off does not block regular test', () => {
  const diagnostics = buildTemplateVariablesDiagnostics({
    useTestData: false,
    url: '{{BASE_URL}}',
    steps: [{ action: 'fill', selector: '#email', value: '{{EMAIL}}' } as Step],
    testData: [testCase('Missing', {})]
  });

  assert.deepEqual(diagnostics.errors, []);
  assert.deepEqual(diagnostics.warnings, []);
});
