import assert from 'node:assert/strict';
import test from 'node:test';
import { validateStepRequirements } from '../src/utils/step-validation';

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
