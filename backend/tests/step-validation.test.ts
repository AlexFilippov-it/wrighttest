import assert from 'node:assert/strict';
import test from 'node:test';
import { hasAssertionSteps, validateStepRequirements } from '../src/utils/step-validation';

test('fill step allows an empty string value so data cases can clear inputs', () => {
  assert.equal(
    validateStepRequirements({
      action: 'fill',
      selector: '#email',
      value: ''
    }),
    null
  );
});

test('fill step still requires the value field to be present', () => {
  assert.deepEqual(
    validateStepRequirements({
      action: 'fill',
      selector: '#email'
    }),
    {
      message: 'Value is required.',
      fields: {
        value: 'Value is required.'
      }
    }
  );
});

test('authentication checks can distinguish assertions from browser actions', () => {
  assert.equal(
    hasAssertionSteps([
      { action: 'goto', value: 'https://example.com/login' },
      { action: 'click', selector: 'button[type="submit"]' }
    ]),
    false
  );
  assert.equal(
    hasAssertionSteps([
      { action: 'goto', value: 'https://example.com/login' },
      { action: 'assertURL', expected: '/dashboard' }
    ]),
    true
  );
});
