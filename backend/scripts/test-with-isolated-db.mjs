import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(backendRoot, '..');
const require = createRequire(import.meta.url);
const { config } = require('dotenv');
const dotenvExpand = require('dotenv-expand');
const loaded = config({ path: path.join(root, '.env') });
if (loaded.error) throw new Error('The root .env is required for local PostgreSQL connection settings.');
dotenvExpand.expand(loaded);

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in the root .env.');
const sourceUrl = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '::1'].includes(sourceUrl.hostname)) {
  throw new Error('Backend tests refuse to create or migrate databases on non-loopback PostgreSQL hosts.');
}

const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const databaseName = `wrighttest_unit_${suffix}`;
const dbUrl = new URL(sourceUrl);
dbUrl.pathname = `/${databaseName}`;
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = '/postgres';
const temporaryDirectory = await fsMkdtemp();
const environment = {
  ...process.env,
  DATABASE_URL: dbUrl.toString(),
  ADMIN_EMAIL: `unit-admin-${suffix}@example.test`,
  ADMIN_PASSWORD: randomBytes(24).toString('base64url'),
  JWT_SECRET: randomBytes(48).toString('base64url'),
  DATABASE_CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  NODE_ENV: 'test',
  OUTPUT_DIR: path.join(temporaryDirectory, 'output'),
  TRACES_DIR: path.join(temporaryDirectory, 'traces'),
  SCREENSHOTS_DIR: path.join(temporaryDirectory, 'screenshots'),
  AUTH_STATES_DIR: path.join(temporaryDirectory, 'auth-states')
};
const { PrismaClient } = require('@prisma/client');
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
let databaseCreated = false;
let exitCode = 1;

try {
  await admin.$connect();
  await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  await admin.$disconnect();
  run('npm', ['run', 'prisma:deploy', '-w', 'backend'], environment);
  run('npm', ['run', 'prisma:seed', '-w', 'backend'], environment);
  const tests = run('npm', ['run', 'test:unit:isolated', '-w', 'backend'], environment, true);
  exitCode = tests.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  if (databaseCreated) {
    const cleanup = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    try {
      await cleanup.$connect();
      await cleanup.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    } catch (error) {
      console.error(`Could not drop the isolated test database ${databaseName}: ${error instanceof Error ? error.message : String(error)}`);
      exitCode = 1;
    } finally {
      await cleanup.$disconnect().catch(() => undefined);
    }
  }
  await fsRm(temporaryDirectory);
}

process.exitCode = exitCode;

function run(command, args, env, allowFailure = false) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (!allowFailure && result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
  return result;
}

async function fsMkdtemp() {
  const fs = await import('node:fs/promises');
  return fs.mkdtemp(path.join(os.tmpdir(), 'wrighttest-unit-'));
}

async function fsRm(directory) {
  const fs = await import('node:fs/promises');
  await fs.rm(directory, { recursive: true, force: true });
}
