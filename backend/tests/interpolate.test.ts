import assert from 'node:assert/strict';
import test from 'node:test';
import { interpolateStep } from '../src/utils/interpolate';
import type { Step } from '../src/types/step';

test('interpolates scenario variables in assertion expected fields', () => {
  const variables = {
    EXPECTED_MESSAGE: 'Invalid email or password',
    EXPECTED_VALUE: 'admin@test.com',
    EXPECTED_URL: 'https://demo.wrighttest.com/login',
    EXPECTED_TITLE: 'WrightTest',
    EXPECTED_COUNT: '3'
  };
  const steps: Step[] = [
    { action: 'assertText', selector: '#message', expected: '{{EXPECTED_MESSAGE}}' },
    { action: 'assertValue', selector: '#email', expected: '{{EXPECTED_VALUE}}' },
    { action: 'assertURL', expected: '{{EXPECTED_URL}}' },
    { action: 'assertTitle', expected: '{{EXPECTED_TITLE}}' },
    { action: 'assertCount', selector: '.result', expected: '{{EXPECTED_COUNT}}' }
  ];

  assert.deepEqual(
    steps.map((step) => interpolateStep(step, variables).expected),
    [
      'Invalid email or password',
      'admin@test.com',
      'https://demo.wrighttest.com/login',
      'WrightTest',
      '3'
    ]
  );
});

test('interpolates scenario variables in input fields and selectors without special variable types', () => {
  const step = interpolateStep(
    {
      action: 'fill',
      selector: "page.getByLabel('{{FIELD_LABEL}}')",
      value: '{{EMAIL}}'
    },
    {
      FIELD_LABEL: 'Email',
      EMAIL: 'admin@test.com'
    }
  );

  assert.equal(step.selector, "page.getByLabel('Email')");
  assert.equal(step.value, 'admin@test.com');
});
