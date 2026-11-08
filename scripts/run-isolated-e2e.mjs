import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { config } = require('dotenv');
const dotenvExpand = require('dotenv-expand');
const { PrismaClient } = require('@prisma/client');
const envPath = path.join(root, '.env');
const loaded = config({ path: envPath });
if (loaded.error) throw new Error('Root .env is required for isolated E2E database connection settings.');
dotenvExpand.expand(loaded);

const sourceDatabaseUrl = process.env.DATABASE_URL;
if (!sourceDatabaseUrl) throw new Error('DATABASE_URL is required in the root .env.');
const adminUrl = new URL(sourceDatabaseUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(adminUrl.hostname)) {
  throw new Error('Isolated E2E refuses to create databases on non-loopback PostgreSQL hosts.');
}

const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const databaseName = `wrighttest_e2e_${suffix}`;
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wrighttest-e2e-'));
const databaseUrl = new URL(sourceDatabaseUrl);
databaseUrl.pathname = `/${databaseName}`;
const dbAdminUrl = new URL(sourceDatabaseUrl);
dbAdminUrl.pathname = '/postgres';
const backendPort = await findFreePort();
const frontendPort = await findFreePort();
const adminEmail = `e2e-admin-${suffix}@example.test`;
const adminPassword = randomBytes(24).toString('base64url');
const jwtSecret = randomBytes(48).toString('base64url');
const environment = {
  ...process.env,
  DATABASE_URL: databaseUrl.toString(),
  ADMIN_EMAIL: adminEmail,
  ADMIN_PASSWORD: adminPassword,
  JWT_SECRET: jwtSecret,
  DATABASE_CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  BACKEND_PORT: String(backendPort),
  FRONTEND_PORT: String(frontendPort),
  FRONTEND_URL: `http://127.0.0.1:${frontendPort}`,
  FRONTEND_DEV_URL: `http://127.0.0.1:${frontendPort}`,
  VITE_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
  E2E_API_URL: `http://127.0.0.1:${backendPort}`,
  E2E_BASE_URL: `http://127.0.0.1:${frontendPort}`,
  E2E_FRONTEND_PORT: String(frontendPort),
  E2E_STATE_DIR: path.join(tempRoot, 'state'),
  E2E_OUTPUT_DIR: path.join(tempRoot, 'results'),
  E2E_REPORT_DIR: path.join(tempRoot, 'report'),
  PHASE5_SCREENSHOT_DIR: path.join(root, 'output', 'phase5-screenshots'),
  SCREENSHOTS_DIR: path.join(tempRoot, 'screenshots'),
  TRACES_DIR: path.join(tempRoot, 'traces'),
  AUTH_STATES_DIR: path.join(tempRoot, 'auth-states'),
  BULLMQ_PREFIX: `wrighttest-e2e-${suffix}`
};

let backend;
let databaseCreated = false;
let exitCode = 1;
const adminPrisma = new PrismaClient({ datasources: { db: { url: dbAdminUrl.toString() } } });

try {
  await adminPrisma.$connect();
  await adminPrisma.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  await adminPrisma.$disconnect();

  run('npm', ['run', 'prisma:deploy', '-w', 'backend'], { cwd: root, env: environment });
  run('npm', ['run', 'prisma:seed', '-w', 'backend'], { cwd: root, env: environment });

  backend = spawn(process.execPath, [
    path.join(root, 'node_modules/tsx/dist/cli.mjs'),
    'src/index.ts'
  ], { cwd: path.join(root, 'backend'), env: environment, stdio: 'inherit' });

  await waitForHealth(`http://127.0.0.1:${backendPort}/health/db`, backend);
  const playwrightCli = require.resolve('@playwright/test/cli');
  const e2eResult = run(process.execPath, [playwrightCli, 'test', '--config=e2e/playwright.config.ts', ...process.argv.slice(2)], {
    cwd: root,
    env: environment,
    allowFailure: true
  });
  exitCode = e2eResult.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  if (backend && backend.exitCode === null) {
    backend.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => backend.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 10_000))
    ]);
    if (backend.exitCode === null) backend.kill('SIGKILL');
  }

  if (databaseCreated) {
    const cleanupPrisma = new PrismaClient({ datasources: { db: { url: dbAdminUrl.toString() } } });
    try {
      await cleanupPrisma.$connect();
      await cleanupPrisma.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    } catch (error) {
      console.error(`Could not remove isolated database ${databaseName}: ${error instanceof Error ? error.message : String(error)}`);
      exitCode = 1;
    } finally {
      await cleanupPrisma.$disconnect().catch(() => undefined);
    }
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
}

process.exitCode = exitCode;

function run(command, args, { cwd, env, allowFailure = false }) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (!allowFailure && result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
  return result;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not allocate a local test port'));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated backend exited with status ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Wait for the owned backend process to finish starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Isolated backend did not become healthy within 60 seconds.');
}
