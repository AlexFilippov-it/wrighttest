import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decryptProjectVariableValue,
  decryptRunVariablesSnapshot,
  encryptProjectVariableValue,
  encryptRunVariablesSnapshot
} from '../src/services/project-variable-crypto';

const KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

test('project variable secrets use authenticated encryption and reject tampering', () => {
  const previousKey = process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY;
  process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY = KEY;
  try {
    const encrypted = encryptProjectVariableValue('private-value');
    assert.match(encrypted, /^v1\./);
    assert.equal(encrypted.includes('private-value'), false);
    assert.equal(decryptProjectVariableValue(encrypted), 'private-value');
    const parts = encrypted.split('.');
    parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
    assert.throws(() => decryptProjectVariableValue(parts.join('.')), /cannot be decrypted/);
  } finally {
    if (previousKey === undefined) delete process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});

test('run snapshots allow non-secret data without a key but require encryption for secrets', () => {
  const previousKey = process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY;
  delete process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY;
  try {
    const publicSnapshot = { projectVariables: { BASE_URL: 'https://example.test' }, secretNames: [] };
    const encoded = encryptRunVariablesSnapshot(publicSnapshot);
    assert.match(encoded, /^p1\./);
    assert.deepEqual(decryptRunVariablesSnapshot(encoded), publicSnapshot);
    assert.throws(() => encryptRunVariablesSnapshot({ secretNames: ['PASSWORD'] }), /DATABASE_CREDENTIALS_ENCRYPTION_KEY/);
  } finally {
    if (previousKey === undefined) delete process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});

test('run snapshots encrypt secret-bearing values when the key is configured', () => {
  const previousKey = process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY;
  process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY = KEY;
  try {
    const snapshot = { environmentVariables: { PASSWORD: 'private-value' }, secretNames: ['PASSWORD'] };
    const encoded = encryptRunVariablesSnapshot(snapshot);
    assert.match(encoded, /^v1\./);
    assert.equal(encoded.includes('private-value'), false);
    assert.deepEqual(decryptRunVariablesSnapshot(encoded), snapshot);
  } finally {
    if (previousKey === undefined) delete process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});
