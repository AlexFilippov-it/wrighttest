import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyJwt from '@fastify/jwt';
import { launchChromium } from '../src/utils/browser';
import prisma from '../src/prisma';
import { startTestWorker, stopTestWorker } from '../src/queue/worker';
import { testQueue } from '../src/queue/queue';
import redis from '../src/redis';
import { runRoutes } from '../src/routes/runs';

const TRACES_DIR = path.resolve(process.env.TRACES_DIR || '../traces');
const require = createRequire(import.meta.url);
const TRACE_TEST_URL = 'data:text/html,%3Ctitle%3EExample%20Domain%3C%2Ftitle%3E%3Ch1%3EExample%20Domain%3C%2Fh1%3E';

async function waitForRunCompletion(runId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (run && (run.status === 'FAILED' || run.status === 'PASSED')) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Timed out waiting for run ${runId}`);
}

test('failed runs keep trace metadata and downloadable trace.zip', async () => {
  await startTestWorker();

  const user = await prisma.user.create({
    data: {
      email: `trace-regression-${Date.now()}@example.com`,
      passwordHash: 'not-used'
    }
  });

  const project = await prisma.project.create({
    data: { name: `Trace Regression ${Date.now()}` }
  });

  await prisma.projectMember.create({
    data: {
      projectId: project.id,
      userId: user.id,
      email: user.email,
      role: 'OWNER',
      status: 'ACTIVE'
    }
  });

  const testRecord = await prisma.test.create({
    data: {
      name: 'Trace regression check',
      url: TRACE_TEST_URL,
      projectId: project.id,
      steps: [
        { action: 'goto', value: TRACE_TEST_URL },
        { action: 'assertTitle', expected: 'Definitely not the real title', options: { exact: true } }
      ]
    }
  });

  const run = await prisma.testRun.create({
    data: {
      testId: testRecord.id,
      status: 'PENDING'
    }
  });

  const app = Fastify();
  await app.register(fastifyJwt, { secret: 'isolated-artifact-route-test-secret' });
  const traceViewerRoot = path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/vite/traceViewer');
  await app.register(fastifyStatic, { root: traceViewerRoot, prefix: '/trace-viewer/', decorateReply: false });
  app.addHook('preHandler', async (req) => {
    req.user = { userId: user.id, email: user.email };
  });
  await app.register(runRoutes);

  try {
    await testQueue.add('run', {
      testRunId: run.id,
      testId: testRecord.id
    });

    const completed = await waitForRunCompletion(run.id);
    assert.equal(completed?.status, 'FAILED');
    assert.ok(completed?.error?.length, 'expected failed run to preserve an error message');
    assert.ok((completed?.screenshots as string[]).length >= 1, 'expected at least one screenshot');
    assert.ok(Array.isArray(completed?.stepResults) && completed.stepResults.length >= 2, 'expected step results for each executed step');
    assert.ok(
      completed?.stepResults?.some((stepResult: { status: string }) => stepResult.status === 'failed'),
      'expected failed step result to be stored'
    );
    assert.ok(completed?.tracePath, 'expected a trace zip path for failed run');
    assert.equal(completed?.traceUnavailableReason, null);

    if (completed?.tracePath) {
      const traceFile = path.join(TRACES_DIR, completed.tracePath);
      await fs.access(traceFile);
    }

    const response = await app.inject({
      method: 'GET',
      url: `/runs/${run.id}`
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json() as {
      trace?: {
        available: boolean;
        downloadUrl?: string;
        viewerUrl?: string;
        reason?: string;
      };
      error?: string | null;
      status: string;
      tracePath?: string;
      screenshots?: string[];
    };

    assert.equal(payload.status, 'FAILED');
    assert.equal(payload.trace?.available, true);
    assert.match(payload.trace?.downloadUrl ?? '', /^\/api\/artifacts\?ticket=/);
    assert.match(payload.trace?.viewerUrl ?? '', /\/trace-viewer\/\?trace=/);
    assert.equal(payload.tracePath, undefined, 'filesystem trace path must not be returned');
    assert.ok(payload.screenshots?.every((url) => url.startsWith('/api/artifacts?ticket=')));
    assert.ok(payload.screenshots?.length, 'expected a secured screenshot preview URL');

    const missingTicket = await app.inject({ method: 'GET', url: '/api/artifacts?ticket=not-a-valid-ticket' });
    assert.equal(missingTicket.statusCode, 401);

    const screenshotResponse = await app.inject({ method: 'GET', url: payload.screenshots![0] });
    assert.equal(screenshotResponse.statusCode, 200, `unexpected screenshot response: ${screenshotResponse.statusCode} ${screenshotResponse.body}`);
    assert.equal(screenshotResponse.headers['content-type'], 'image/png');

    const traceResponse = await app.inject({
      method: 'GET',
      url: payload.trace!.downloadUrl!,
      headers: { range: 'bytes=0-3' }
    });
    assert.equal(traceResponse.statusCode, 206, 'Trace Viewer artifact route should support byte ranges');
    assert.equal(traceResponse.headers['content-type'], 'application/zip');

    const otherProject = await prisma.project.create({ data: { name: `Other project ${Date.now()}` } });
    try {
      const foreignTicket = app.jwt.sign({
        typ: 'wrighttest-artifact', userId: user.id, projectId: otherProject.id,
        kind: 'trace', runId: run.id
      }, { expiresIn: '5m' });
      const foreignResponse = await app.inject({ method: 'GET', url: `/api/artifacts?ticket=${encodeURIComponent(foreignTicket)}` });
      assert.equal(foreignResponse.statusCode, 404, 'cross-project artifact access must be denied');
      assert.doesNotMatch(foreignResponse.body, /PK\u0003\u0004/);
    } finally {
      await prisma.project.delete({ where: { id: otherProject.id } }).catch(() => undefined);
    }

    const legacyPublicTrace = await app.inject({ method: 'GET', url: `/api/traces/${completed.tracePath}` });
    assert.equal(legacyPublicTrace.statusCode, 404, 'legacy public trace route must not serve artifacts');
    const legacyPublicScreenshot = await app.inject({ method: 'GET', url: `/screenshots/${(completed.screenshots as string[])[0]}` });
    assert.equal(legacyPublicScreenshot.statusCode, 404, 'legacy public screenshot route must not serve artifacts');

    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address === 'object');
    const backendOrigin = `http://127.0.0.1:${address.port}`;
    const browser = await launchChromium();
    try {
      const page = await browser.newPage();
      const artifactRequests: string[] = [];
      page.on('requestfailed', (request) => artifactRequests.push(`requestfailed ${request.url()} ${request.failure()?.errorText ?? ''}`));
      page.on('console', (message) => artifactRequests.push(`console ${message.type()} ${message.text()}`));
      page.on('request', (request) => {
        artifactRequests.push(`request ${request.url()}`);
      });
      page.on('response', (browserResponse) => {
        artifactRequests.push(`response ${browserResponse.status()} ${browserResponse.url()}`);
      });
      page.on('pageerror', (error) => artifactRequests.push(`pageerror ${error.message}`));
      const traceLoad = new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timed out waiting for trace artifact. Activity: ${artifactRequests.filter((item) => item.includes('api/artifacts') || item.includes('requestfailed')).join('\n') || '(none)'}`)), 15000);
        page.context().on('response', (browserResponse) => {
          if (!browserResponse.url().includes('/api/artifacts?ticket=')) return;
          clearTimeout(timeout);
          artifactRequests.push(`context response ${browserResponse.status()} ${browserResponse.url()}`);
          resolve(browserResponse.status());
        });
      });
      await page.goto(`${backendOrigin}${payload.trace!.viewerUrl!.replace(
        encodeURIComponent(payload.trace!.downloadUrl!),
        encodeURIComponent(`${backendOrigin}${payload.trace!.downloadUrl}`)
      )}`);
      try {
        const traceStatus = await traceLoad;
        assert.ok([200, 206].includes(traceStatus), `unexpected trace response ${traceStatus}`);
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nTrace viewer URL: ${page.url()}\nViewer text: ${(await page.locator('body').innerText().catch(() => '')).slice(0, 500)}\nArtifact activity: ${artifactRequests.filter((item) => item.includes('api/artifacts') || item.includes('requestfailed') || item.includes('pageerror')).join('\n') || '(none)'}`);
      }
      assert.equal(await page.title(), 'Playwright Trace Viewer');
      await page.waitForFunction(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0);
    } finally {
      await browser.close();
    }
  } finally {
    await app.close();
    await prisma.testRun.delete({ where: { id: run.id } }).catch(() => undefined);
    await prisma.test.delete({ where: { id: testRecord.id } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await stopTestWorker();
    await testQueue.close().catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
