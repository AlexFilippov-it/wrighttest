import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRuntimeConfiguration } from '../src/services/runtime-config';

const validProductionEnv = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(40),
  DATABASE_CREDENTIALS_ENCRYPTION_KEY: 'b'.repeat(64),
  ADMIN_PASSWORD: 'valid-production-password'
};

test('production config rejects placeholder or weak authentication secrets', () => {
  assert.throws(() => validateRuntimeConfiguration({ ...validProductionEnv, JWT_SECRET: 'replace-this-with-a-long-random-string' }), /JWT_SECRET/);
  assert.throws(() => validateRuntimeConfiguration({ ...validProductionEnv, ADMIN_PASSWORD: 'changeme' }), /ADMIN_PASSWORD/);
});

test('production config requires a valid credential encryption key', () => {
  assert.throws(() => validateRuntimeConfiguration({ ...validProductionEnv, DATABASE_CREDENTIALS_ENCRYPTION_KEY: 'short' }), /DATABASE_CREDENTIALS_ENCRYPTION_KEY/);
});

test('valid production configuration and non-production defaults are accepted', () => {
  assert.doesNotThrow(() => validateRuntimeConfiguration(validProductionEnv));
  assert.doesNotThrow(() => validateRuntimeConfiguration({ NODE_ENV: 'development' }));
});
