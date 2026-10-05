import assert from 'node:assert/strict';
import test from 'node:test';
import { CreateTestSchema, UpdateTestSchema } from '../src/schemas/test.schema';

const baseCheck = {
  name: 'Desktop check',
  url: 'https://example.com',
  steps: []
};

test('create check accepts a cleared device as the desktop default', () => {
  const result = CreateTestSchema.safeParse({
    ...baseCheck,
    device: null
  });

  assert.equal(result.success, true);
});

test('update check accepts clearing a previously selected device', () => {
  const result = UpdateTestSchema.safeParse({ device: null });

  assert.equal(result.success, true);
});
