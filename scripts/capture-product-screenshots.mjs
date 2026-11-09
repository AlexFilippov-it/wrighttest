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
const { chromium } = require('playwright');

const loaded = config({ path: path.join(root, '.env') });
if (loaded.error) throw new Error('Root .env is required to create the isolated screenshot database.');
dotenvExpand.expand(loaded);

const sourceDatabaseUrl = process.env.DATABASE_URL;
if (!sourceDatabaseUrl) throw new Error('DATABASE_URL is required.');
const adminUrl = new URL(sourceDatabaseUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(adminUrl.hostname)) {
  throw new Error('Screenshot capture refuses to create databases on non-loopback PostgreSQL hosts.');
}

const screenIds = parseScreenIds(process.argv.slice(2));
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const databaseName = `wrighttest_screenshots_${suffix}`;
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wrighttest-screenshots-'));
const databaseUrl = new URL(sourceDatabaseUrl);
databaseUrl.pathname = `/${databaseName}`;
const dbAdminUrl = new URL(sourceDatabaseUrl);
dbAdminUrl.pathname = '/postgres';
const backendPort = await findFreePort();
const frontendPort = await findFreePort();
const password = randomBytes(24).toString('base64url');
const adminEmail = 'screenshot-demo@example.test';
const outputDir = path.resolve(process.env.WRIGHTTEST_SCREENSHOT_OUTPUT_DIR || path.join(root, 'docs/release/screenshots'));
const siteSource = path.resolve(process.env.WRIGHTTEST_SITE_SOURCE || '/Users/alekfilippov/Documents/project/wrighttest.com-source');
const siteImagesDir = path.join(siteSource, 'public/images/screenshots');
const reportPath = path.join(outputDir, 'capture-report.json');
const manifestPath = path.join(root, 'scripts/screenshot-manifest.json');
const viewport = {
  width: Number(process.env.WRIGHTTEST_SCREENSHOT_WIDTH || 1440),
  height: Number(process.env.WRIGHTTEST_SCREENSHOT_HEIGHT || 900)
};
const quality = Number(process.env.WRIGHTTEST_SCREENSHOT_QUALITY || 84);
const environment = {
  ...process.env,
  DATABASE_URL: databaseUrl.toString(),
  ADMIN_EMAIL: adminEmail,
  ADMIN_PASSWORD: password,
  JWT_SECRET: randomBytes(48).toString('base64url'),
  RATE_LIMIT_MAX: '5000',
  BACKEND_PORT: String(backendPort),
  FRONTEND_PORT: String(frontendPort),
  FRONTEND_URL: `http://127.0.0.1:${frontendPort}`,
  FRONTEND_DEV_URL: `http://127.0.0.1:${frontendPort}`,
  VITE_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
  BULLMQ_PREFIX: `wrighttest-screenshots-${suffix}`,
  SCREENSHOTS_DIR: path.join(tempRoot, 'runtime-screenshots'),
  TRACES_DIR: path.join(tempRoot, 'runtime-traces'),
  AUTH_STATES_DIR: path.join(tempRoot, 'runtime-auth-states'),
  VITE_ENABLE_NOVNC: 'false'
};

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const siteSourceExists = await fs.access(siteSource).then(() => true, () => false);
const adminPrisma = new PrismaClient({ datasources: { db: { url: dbAdminUrl.toString() } } });
const report = { createdAt: new Date().toISOString(), viewport, outputDirectory: path.basename(outputDir), screenshots: [], skipped: [], failed: [] };
let databaseCreated = false;
let backend;
let frontend;
let browser;
let exitCode = 1;

try {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(path.join(tempRoot, 'runtime-screenshots'), { recursive: true });
  await fs.mkdir(path.join(tempRoot, 'runtime-traces'), { recursive: true });
  await fs.mkdir(path.join(tempRoot, 'runtime-auth-states'), { recursive: true });
  await adminPrisma.$connect();
  await adminPrisma.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;

  run('npm', ['run', 'prisma:deploy', '-w', 'backend'], { env: environment });
  run(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'backend/scripts/seed-screenshot-demo.ts'], { env: environment });

  backend = spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
    cwd: path.join(root, 'backend'), env: environment, stdio: 'inherit'
  });
  await waitForHealth(`http://127.0.0.1:${backendPort}/health/db`, backend);

  frontend = spawn('npm', ['run', 'dev', '-w', 'frontend', '--', '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], {
    cwd: root,
    env: { ...environment, VITE_BACKEND_URL: `http://127.0.0.1:${backendPort}` },
    stdio: 'inherit'
  });
  const baseUrl = `http://127.0.0.1:${frontendPort}`;
  await waitForHttp(baseUrl, frontend);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-US' });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(`${baseUrl}/dashboard`, { timeout: 20_000 });
  await page.getByRole('main').first().waitFor({ state: 'visible' });

  const project = await apiJson(page, `http://127.0.0.1:${backendPort}`, '/projects');
  const demoProject = project.find((item) => item.name === 'WrightTest Demo Workspace');
  const projectId = demoProject?.id;
  const checks = await apiJson(page, `http://127.0.0.1:${backendPort}`, `/projects/${projectId}/tests`);
  const primaryCheck = checks.find((item) => item.name === 'Cart updates after adding an item');
  const failingCheck = checks.find((item) => item.name === 'Cart displays the expected quantity');
  if (!projectId || !primaryCheck || !failingCheck) throw new Error('Screenshot fixture data was not seeded correctly.');

  const resultContext = await runAndWait(page, backendPort, primaryCheck.id);
  const failedResult = await runAndWait(page, backendPort, failingCheck.id);
  if (resultContext.status !== 'PASSED' || failedResult.status !== 'FAILED') {
    throw new Error(`Expected initial check outcomes PASSED/FAILED, received ${resultContext.status}/${failedResult.status}.`);
  }
  await apiJson(page, `http://127.0.0.1:${backendPort}`, `/tests/${failingCheck.id}`, {
    method: 'PATCH', body: { steps: expectedSteps('Cart: 1') }
  });
  const repairedResult = await runAndWait(page, backendPort, failingCheck.id);
  if (repairedResult.status !== 'PASSED') {
    throw new Error(`Expected repaired check to pass, received ${repairedResult.status}.`);
  }

  const captures = {
    dashboard: '/dashboard',
    projects: '/projects',
    overview: `/projects/${projectId}/overview`,
    checks: `/projects/${projectId}/checks`,
    'check-editor': `/tests/${primaryCheck.id}/edit`,
    suites: `/projects/${projectId}/suites`,
    'run-results': `/runs/${resultContext.testRunId}`,
    'run-failure': `/runs/${failedResult.testRunId}`,
    'run-repaired': `/runs/${repairedResult.testRunId}`,
    schedules: `/projects/${projectId}/schedules`,
    environments: `/projects/${projectId}/environments`,
    localization: '/instance/language'
  };

  for (const item of manifest.screenshots) {
    if (screenIds.size > 0 && !screenIds.has(item.id)) continue;
    if (item.id === 'visual-recorder') {
      report.skipped.push({ id: item.id, reason: 'Live recorder requires an interactive headed session/noVNC service; it was not started by the safe screenshot runner.' });
      continue;
    }
    try {
    if (item.id === 'api-tokens') {
      await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
      const userMenu = page.getByText(adminEmail, { exact: true }).first();
      await userMenu.click();
      await page.getByText('API tokens', { exact: true }).click();
      const tokenDialog = page.getByRole('dialog').filter({ hasText: 'API tokens' });
      await tokenDialog.getByText('API tokens', { exact: true }).waitFor({ state: 'visible' });
      await tokenDialog.getByRole('textbox').first().waitFor({ state: 'visible' });
      await tokenDialog.getByRole('button', { name: 'Create token' }).waitFor({ state: 'visible' });
      await tokenDialog.getByText('No active API tokens', { exact: true }).waitFor({ state: 'visible' });
      const tokenDialogElement = await tokenDialog.elementHandle();
      if (!tokenDialogElement) throw new Error('API token dialog did not attach to the page.');
      await page.waitForFunction((element) => getComputedStyle(element).opacity === '1', tokenDialogElement);
      const tokenDialogBounds = await tokenDialog.boundingBox();
      if (!tokenDialogBounds || tokenDialogBounds.width < 500 || tokenDialogBounds.height < 300) {
        throw new Error('API token dialog did not render at its expected size.');
      }
    } else if (item.id === 'trace-viewer') {
      await page.goto(`${baseUrl}/runs/${resultContext.testRunId}`, { waitUntil: 'domcontentloaded' });
      const traceFrame = page.locator('iframe').last();
      await traceFrame.waitFor({ state: 'visible', timeout: 15_000 });
      await traceFrame.scrollIntoViewIfNeeded();
      const frame = await traceFrame.contentFrame();
      if (!frame) throw new Error('Trace viewer iframe did not attach.');
      await frame.locator('body').waitFor({ state: 'visible', timeout: 15_000 });
    } else {
      const route = captures[item.id];
      if (!route) {
        report.skipped.push({ id: item.id, reason: 'No product route is configured for this screenshot.' });
        continue;
      }
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
    }

    await page.getByRole('main').first().waitFor({ state: 'visible', timeout: 15_000 });
    await waitForScreenData(page, item.id, primaryCheck.name);
    if (item.id === 'check-editor') {
      await page.locator('.wt-editor-steps-card').scrollIntoViewIfNeeded();
    }
    await page.evaluate(() => document.fonts.ready);
    await maskDemoAccount(page, adminEmail);
    await page.screenshot({ path: path.join(outputDir, `${item.id}.png`), animations: 'disabled' });
    const webpPath = path.join(siteImagesDir, `${item.file}.webp`);
    if (siteSourceExists) {
      await optimizePngToWebp(page, path.join(outputDir, `${item.id}.png`), webpPath, quality);
    }
    report.screenshots.push({
      id: item.id,
      title: item.title,
      source: `${item.id}.png`,
      webp: siteSourceExists ? `${item.file}.webp` : null,
      width: viewport.width,
      height: viewport.height
    });
    } catch (error) {
      report.failed.push({ id: item.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  exitCode = report.screenshots.length > 0 && report.failed.length === 0 ? 0 : 1;
  console.log(`Screenshot report: ${reportPath}`);
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(report.error);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  await stopChild(frontend);
  await stopChild(backend);
  await adminPrisma.$disconnect().catch(() => undefined);

  if (databaseCreated) {
    const cleanupPrisma = new PrismaClient({ datasources: { db: { url: dbAdminUrl.toString() } } });
    try {
      await cleanupPrisma.$connect();
      await cleanupPrisma.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    } catch (error) {
      console.error(`Could not remove isolated screenshot database ${databaseName}: ${error instanceof Error ? error.message : String(error)}`);
      exitCode = 1;
    } finally {
      await cleanupPrisma.$disconnect();
    }
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
}

process.exitCode = exitCode;

function parseScreenIds(args) {
  const selected = args.find((arg) => arg.startsWith('--screens='))?.slice('--screens='.length);
  return new Set(selected ? selected.split(',').map((value) => value.trim()) : []);
}

async function waitForScreenData(page, screenId, primaryCheckName) {
  const expectedText = {
    dashboard: 'Total runs',
    projects: 'WrightTest Demo Workspace',
    overview: 'WrightTest Demo Workspace',
    checks: primaryCheckName,
    'check-editor': primaryCheckName,
    suites: 'Demo Store smoke suite',
    'run-results': primaryCheckName,
    'run-failure': 'Cart displays the expected quantity',
    'run-repaired': 'Cart displays the expected quantity',
    schedules: 'Daily demo smoke',
    environments: 'BASE_URL',
    localization: 'Interface language'
  }[screenId];
  if (expectedText) await page.getByText(expectedText, { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 });
}

async function maskDemoAccount(page, email) {
  await page.getByText(email, { exact: true }).evaluateAll((elements) => {
    for (const element of elements) element.textContent = 'Demo account';
  }).catch(() => undefined);
}

function run(command, args, { env }) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not allocate a local port.'));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Backend exited with status ${child.exitCode}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Isolated backend did not become healthy within 60 seconds.');
}

async function waitForHttp(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Frontend exited with status ${child.exitCode}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Isolated frontend did not become ready within 60 seconds.');
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 8_000))
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function apiJson(page, origin, route, options = {}) {
  const token = await page.evaluate(() => localStorage.getItem('wt_token'));
  const response = await fetch(`${origin}${route}`, {
    method: options.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) throw new Error(`WrightTest API ${options.method || 'GET'} ${route} returned ${response.status}.`);
  return response.status === 204 ? null : response.json();
}

async function runAndWait(page, backendPortValue, testId) {
  const started = await apiJson(page, `http://127.0.0.1:${backendPortValue}`, `/tests/${testId}/run`, { method: 'POST', body: {} });
  const deadline = Date.now() + 60_000;
  let run;
  while (Date.now() < deadline) {
    run = await apiJson(page, `http://127.0.0.1:${backendPortValue}`, `/runs/${started.testRunId}`);
    if (run.status === 'PASSED' || run.status === 'FAILED') return { ...run, testRunId: started.testRunId };
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`Run ${started.testRunId} did not finish within 60 seconds (last status: ${run?.status ?? 'unknown'}).`);
}

async function optimizePngToWebp(page, pngPath, webpPath, outputQuality) {
  await fs.mkdir(path.dirname(webpPath), { recursive: true });
  const input = await fs.readFile(pngPath);
  const buffer = await page.evaluate(async ({ data, qualityValue }) => {
    const binary = atob(data);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', qualityValue / 100));
    if (!blob) throw new Error('Browser cannot encode WebP.');
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, { data: input.toString('base64'), qualityValue: outputQuality });
  await fs.writeFile(webpPath, Buffer.from(buffer));
}

function expectedSteps(expected) {
  const html = '<title>WrightTest Demo Store</title><main><h1>Demo Store</h1><button id="add">Add to cart</button><p id="cart">Cart: 0</p><script>document.querySelector("#add").onclick=()=>document.querySelector("#cart").textContent="Cart: 1"</script></main>';
  return [
    { action: 'goto', value: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` },
    { action: 'click', selector: "page.getByRole('button', { name: 'Add to cart' })" },
    { action: 'assertText', selector: "page.locator('#cart')", expected }
  ];
}
