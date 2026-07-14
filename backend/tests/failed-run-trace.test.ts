import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import { startTestWorker, stopTestWorker } from '../src/queue/worker';
import { testQueue } from '../src/queue/queue';
import redis from '../src/redis';
import { runRoutes } from '../src/routes/runs';

const TRACES_DIR = path.resolve(process.env.TRACES_DIR || '../traces');
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
    };

    assert.equal(payload.status, 'FAILED');
    assert.equal(payload.trace?.available, true);
    assert.match(payload.trace?.downloadUrl ?? '', /\/traces\/.+\.zip$/);
    assert.match(payload.trace?.viewerUrl ?? '', /\/trace-viewer\/\?trace=/);
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
