import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDeviceForPayload } from '../src/utils/testPayload';

test('device payload preserves selected device values', () => {
  assert.equal(normalizeDeviceForPayload('iPhone 14'), 'iPhone 14');
});

test('device payload sends null when device is cleared', () => {
  assert.equal(normalizeDeviceForPayload(undefined), null);
  assert.equal(normalizeDeviceForPayload(null), null);
  assert.equal(normalizeDeviceForPayload(''), null);
  assert.equal(normalizeDeviceForPayload('   '), null);
});
