import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseByteRange, resolveArtifactPath } from '../src/services/artifact-path';

test('resolveArtifactPath accepts files rooted in the artifact directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wrighttest-artifacts-'));
  try {
    await writeFile(path.join(root, 'run.png'), 'image');
    const resolved = await resolveArtifactPath(root, 'run.png');
    assert.equal(resolved.path, await realpath(path.join(root, 'run.png')));
    assert.equal(resolved.size, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('resolveArtifactPath rejects traversal and symlinks leaving the root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wrighttest-artifacts-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'wrighttest-outside-'));
  try {
    await writeFile(path.join(outside, 'secret.zip'), 'secret');
    await symlink(path.join(outside, 'secret.zip'), path.join(root, 'linked.zip'));
    await assert.rejects(resolveArtifactPath(root, '../secret.zip'));
    await assert.rejects(resolveArtifactPath(root, 'linked.zip'));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('parseByteRange supports bounded, open-ended, and suffix byte ranges', () => {
  assert.deepEqual(parseByteRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(parseByteRange('bytes=7-', 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.equal(parseByteRange('bytes=10-', 10), false);
  assert.equal(parseByteRange('bytes=0-1,4-5', 10), false);
  assert.equal(parseByteRange(undefined, 10), null);
});
