import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  FileAuthStateStorage,
  hasAuthenticationMaterial,
  parseAuthStorageState,
  resolveAuthStateRootDirectory
} from '../src/services/auth-state-storage';

const populatedState = {
  cookies: [],
  origins: [
    {
      origin: 'https://example.com',
      localStorage: [{ name: 'session', value: 'test-token' }]
    }
  ]
};

test('file auth storage writes versioned private files and reads them back', async (t) => {
  const rootDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'wrighttest-auth-state-'));
  t.after(() => fs.rm(rootDirectory, { recursive: true, force: true }));
  const storage = new FileAuthStateStorage(rootDirectory, 'unit-test-encryption-secret');

  const firstKey = await storage.save('project_1', 'environment_1', populatedState);
  const secondKey = await storage.save('project_1', 'environment_1', populatedState);

  assert.notEqual(firstKey, secondKey);
  assert.deepEqual(await storage.get(firstKey), populatedState);
  assert.equal((await fs.stat(path.join(rootDirectory, firstKey))).mode & 0o777, 0o600);
  assert.doesNotMatch(await fs.readFile(path.join(rootDirectory, firstKey), 'utf8'), /test-token/);

  await storage.delete(firstKey);
  assert.equal(await storage.get(firstKey), null);
  assert.deepEqual(await storage.get(secondKey), populatedState);

  await storage.delete(secondKey);
  await assert.rejects(() => fs.access(path.join(rootDirectory, 'project_1')), { code: 'ENOENT' });
});

test('file auth storage rejects keys outside its private directory', async (t) => {
  const rootDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'wrighttest-auth-state-'));
  t.after(() => fs.rm(rootDirectory, { recursive: true, force: true }));
  const storage = new FileAuthStateStorage(rootDirectory, 'unit-test-encryption-secret');

  await assert.rejects(() => storage.get('../outside.json'), /escapes the private storage directory/);
  await assert.rejects(() => storage.save('../project', 'environment_1', populatedState), /Invalid project ID/);
});

test('authentication material requires cookies, local storage, or IndexedDB entries', () => {
  const emptyState = parseAuthStorageState({ cookies: [], origins: [] });
  const indexedDbState = parseAuthStorageState({
    cookies: [],
    origins: [
      {
        origin: 'https://example.com',
        localStorage: [],
        indexedDB: [{ name: 'firebaseLocalStorageDb', stores: [] }]
      }
    ]
  });

  assert.equal(hasAuthenticationMaterial(emptyState), false);
  assert.equal(hasAuthenticationMaterial(parseAuthStorageState(populatedState)), true);
  assert.equal(hasAuthenticationMaterial(indexedDbState), true);
});

test('relative auth-state directories resolve from the backend package root', () => {
  assert.equal(
    resolveAuthStateRootDirectory('./auth-states-fixture'),
    path.resolve(__dirname, '..', 'auth-states-fixture')
  );
});
