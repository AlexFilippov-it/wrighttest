import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';

export async function resolveArtifactPath(root: string, filename: string) {
  if (!filename || filename !== path.basename(filename) || filename === '.' || filename === '..') {
    throw new Error('Invalid artifact path');
  }

  const [realRoot, realFile] = await Promise.all([
    fs.realpath(root),
    fs.realpath(path.join(root, filename))
  ]);
  const relative = path.relative(realRoot, realFile);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Artifact path is outside the configured directory');
  }

  const stat = await fs.stat(realFile);
  if (!stat.isFile()) throw new Error('Artifact is not a file');
  return { path: realFile, size: stat.size };
}

export async function openArtifact(root: string, filename: string) {
  const resolved = await resolveArtifactPath(root, filename);
  const handle = await fs.open(resolved.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const stat = await handle.stat();
  if (!stat.isFile()) {
    await handle.close();
    throw new Error('Artifact is not a file');
  }
  return { handle, size: stat.size };
}

export function parseByteRange(header: string | undefined, size: number) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return false;

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return false;
  return { start, end: Math.min(end, size - 1) };
}
