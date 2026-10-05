import path from 'node:path';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import type { BrowserContext } from 'playwright';

export type AuthStorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

export interface AuthStateStorage {
  get(storageKey: string): Promise<AuthStorageState | null>;
  save(projectId: string, environmentId: string, state: AuthStorageState): Promise<string>;
  delete(storageKey: string): Promise<void>;
}

const authStorageStateSchema = z.object({
  cookies: z.array(z.object({
    name: z.string(),
    value: z.string(),
    domain: z.string(),
    path: z.string()
  }).passthrough()),
  origins: z.array(z.object({
    origin: z.string(),
    localStorage: z.array(z.object({
      name: z.string(),
      value: z.string()
    }))
  }).passthrough())
}).passthrough();

const encryptedAuthStateSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal('aes-256-gcm'),
  iv: z.string(),
  authTag: z.string(),
  ciphertext: z.string()
});

const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/;
const ENCRYPTION_CONTEXT = Buffer.from('wrighttest-auth-state:v1');

function findBackendDirectory(startDirectory: string) {
  let current = path.resolve(startDirectory);

  while (true) {
    if (fsSync.existsSync(path.join(current, 'package.json')) && path.basename(current) === 'backend') {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(process.cwd());
    current = parent;
  }
}

export function resolveAuthStateRootDirectory(configuredDirectory?: string) {
  const value = configuredDirectory ?? process.env.AUTH_STATES_DIR ?? './auth-states';
  return path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(findBackendDirectory(__dirname), value);
}

function assertSafeSegment(value: string, label: string) {
  if (!SAFE_SEGMENT.test(value)) {
    throw new Error(`Invalid ${label} for authentication state storage.`);
  }
}

function resolveStoragePath(rootDirectory: string, storageKey: string) {
  if (!storageKey || path.isAbsolute(storageKey)) {
    throw new Error('Invalid authentication state storage key.');
  }

  const resolved = path.resolve(rootDirectory, storageKey);
  if (!resolved.startsWith(`${rootDirectory}${path.sep}`)) {
    throw new Error('Authentication state storage key escapes the private storage directory.');
  }

  return resolved;
}

export function parseAuthStorageState(value: unknown): AuthStorageState {
  return authStorageStateSchema.parse(value) as AuthStorageState;
}

export function hasAuthenticationMaterial(state: AuthStorageState) {
  return state.cookies.length > 0 || state.origins.some((origin) => {
    const indexedDB = (origin as typeof origin & { indexedDB?: unknown[] }).indexedDB;
    return origin.localStorage.length > 0 || Boolean(indexedDB?.length);
  });
}

export class FileAuthStateStorage implements AuthStateStorage {
  constructor(
    private readonly configuredRootDirectory?: string,
    private readonly configuredEncryptionSecret?: string
  ) {}

  private get rootDirectory() {
    return resolveAuthStateRootDirectory(this.configuredRootDirectory);
  }

  private get encryptionKey() {
    const secret =
      this.configuredEncryptionSecret ||
      process.env.AUTH_STATE_ENCRYPTION_KEY ||
      process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('AUTH_STATE_ENCRYPTION_KEY or JWT_SECRET is required for authentication state storage.');
    }
    return Buffer.from(hkdfSync('sha256', secret, ENCRYPTION_CONTEXT, ENCRYPTION_CONTEXT, 32));
  }

  private encrypt(state: AuthStorageState) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    cipher.setAAD(ENCRYPTION_CONTEXT);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(state), 'utf8'),
      cipher.final()
    ]);

    return JSON.stringify({
      version: 1,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    });
  }

  private decrypt(contents: string) {
    const encrypted = encryptedAuthStateSchema.parse(JSON.parse(contents));
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(encrypted.iv, 'base64')
    );
    decipher.setAAD(ENCRYPTION_CONTEXT);
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8');
    return parseAuthStorageState(JSON.parse(plaintext));
  }

  async get(storageKey: string) {
    const filePath = resolveStoragePath(this.rootDirectory, storageKey);

    try {
      const contents = await fs.readFile(filePath, 'utf8');
      return this.decrypt(contents);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(projectId: string, environmentId: string, state: AuthStorageState) {
    assertSafeSegment(projectId, 'project ID');
    assertSafeSegment(environmentId, 'environment ID');
    const validatedState = parseAuthStorageState(state);
    const storageKey = path.posix.join(projectId, environmentId, `${uuidv4()}.json`);
    const filePath = resolveStoragePath(this.rootDirectory, storageKey);
    const directory = path.dirname(filePath);
    const temporaryPath = `${filePath}.${uuidv4()}.tmp`;

    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(temporaryPath, this.encrypt(validatedState), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    });

    try {
      await fs.rename(temporaryPath, filePath);
      await fs.chmod(filePath, 0o600);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }

    return storageKey;
  }

  async delete(storageKey: string) {
    const filePath = resolveStoragePath(this.rootDirectory, storageKey);
    const environmentDirectory = path.dirname(filePath);
    const projectDirectory = path.dirname(environmentDirectory);

    await fs.rm(filePath, { force: true });
    await fs.rmdir(environmentDirectory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error;
    });
    await fs.rmdir(projectDirectory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error;
    });
  }
}

export const authStateStorage: AuthStateStorage = new FileAuthStateStorage();
