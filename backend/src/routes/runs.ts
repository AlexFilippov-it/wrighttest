import { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import prisma from '../prisma';
import { enqueueTestRun } from '../queue/batch-sequencer';
import { getAccessibleProjectIds, getAuthUser, getProjectAccessStatusCode, requireProjectRole } from '../utils/project-access';
import { buildDataCaseSnapshot, getTestDataCases } from '../utils/test-data';

const TRACES_DIR = path.resolve(process.env.TRACES_DIR || './traces');

const RunSchema = z.object({
  environmentId: z.string().optional(),
  dataCaseIndex: z.number().int().nonnegative().optional()
});

export async function runRoutes(fastify: FastifyInstance) {
  async function buildTraceMetadata(run: {
    id: string;
    tracePath: string | null;
    traceUnavailableReason: string | null;
  }) {
    if (!run.tracePath) {
      return {
        available: false,
        reason:
          run.traceUnavailableReason ??
          'Trace was not created because browser context failed before tracing started.'
      };
    }

    try {
      await fs.access(path.join(TRACES_DIR, run.tracePath));
      return {
        available: true,
        downloadUrl: `/api/traces/${run.tracePath}`,
        viewerUrl: `/trace-viewer/?trace=${encodeURIComponent(`/api/traces/${run.tracePath}`)}`
      };
    } catch {
      return {
        available: false,
        reason: run.traceUnavailableReason ?? 'Trace file is missing or could not be read.'
      };
    }
  }

  fastify.post<{ Params: { id: string } }>('/tests/:id/run', async (req, reply) => {
    const body = RunSchema.safeParse(req.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const test = await prisma.test.findUnique({
      where: { id: req.params.id }
    });

    if (!test) return reply.status(404).send({ error: 'Test not found' });

    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(test.projectId, userId, ['OWNER', 'EDITOR']);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    const testDataCases = getTestDataCases(test.testData);
    let dataCaseSnapshot: ReturnType<typeof buildDataCaseSnapshot> | null = null;

    if (testDataCases.length === 0) {
      if (body.data.dataCaseIndex !== undefined) {
        return reply.status(400).send({ error: 'This test does not have test data cases.' });
      }
    } else {
      if (body.data.dataCaseIndex === undefined) {
        return reply.status(400).send({ error: 'Select a test data case before running this test.' });
      }

      try {
        dataCaseSnapshot = buildDataCaseSnapshot(test.testData, body.data.dataCaseIndex);
      } catch (error) {
        return reply.status(400).send({ error: error instanceof Error ? error.message : 'Invalid test data case.' });
      }
    }

    if (body.data.environmentId) {
      const environment = await prisma.environment.findUnique({
        where: { id: body.data.environmentId }
      });

      if (!environment || environment.projectId !== test.projectId) {
        return reply.status(404).send({ error: 'Environment not found' });
      }
    }

    const run = await prisma.testRun.create({
      data: {
        testId: test.id,
        status: 'PENDING',
        environmentId: body.data.environmentId,
        ...(dataCaseSnapshot ?? {})
      }
    });

    const job = await enqueueTestRun(run);

    return reply.status(202).send({
      testRunId: run.id,
      jobId: job.id,
      status: 'PENDING'
    });
  });

  fastify.post<{ Params: { id: string } }>('/tests/:id/runs/all-cases', async (req, reply) => {
    const body = RunSchema.pick({ environmentId: true }).safeParse(req.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const test = await prisma.test.findUnique({
      where: { id: req.params.id }
    });

    if (!test) return reply.status(404).send({ error: 'Test not found' });

    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(test.projectId, userId, ['OWNER', 'EDITOR']);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    if (body.data.environmentId) {
      const environment = await prisma.environment.findUnique({
        where: { id: body.data.environmentId }
      });

      if (!environment || environment.projectId !== test.projectId) {
        return reply.status(404).send({ error: 'Environment not found' });
      }
    }

    const testDataCases = getTestDataCases(test.testData);
    if (testDataCases.length === 0) {
      return reply.status(400).send({ error: 'This test does not have test data cases.' });
    }

    const enabledCases = testDataCases
      .map((testCase, dataCaseIndex) => ({ testCase, dataCaseIndex }))
      .filter(({ testCase }) => testCase.enabled);

    if (enabledCases.length === 0) {
      return reply.status(400).send({ error: 'This test does not have enabled test data cases.' });
    }

    const { batch, runs } = await prisma.$transaction(async (tx) => {
      const batch = await tx.testRunBatch.create({
        data: {
          testId: test.id,
          environmentId: body.data.environmentId,
          totalCases: enabledCases.length
        }
      });

      const runs = [];
      for (const [batchOrder, { dataCaseIndex }] of enabledCases.entries()) {
        const dataCaseSnapshot = buildDataCaseSnapshot(test.testData, dataCaseIndex);
        const run = await tx.testRun.create({
          data: {
            testId: test.id,
            status: 'PENDING',
            environmentId: body.data.environmentId,
            batchId: batch.id,
            batchOrder,
            ...dataCaseSnapshot
          }
        });

        runs.push({
          id: run.id,
          testId: run.testId,
          environmentId: run.environmentId,
          batchOrder: run.batchOrder,
          dataCaseName: dataCaseSnapshot.dataCaseName,
          dataCaseIndex: dataCaseSnapshot.dataCaseIndex
        });
      }

      return { batch, runs };
    });

    const firstRun = runs[0];
    const firstJob = firstRun ? await enqueueTestRun(firstRun) : null;
    const queuedRuns = runs.map((run) => ({
      id: run.id,
      testRunId: run.id,
      jobId: run.batchOrder === 0 ? firstJob?.id : undefined,
      dataCaseName: run.dataCaseName,
      dataCaseIndex: run.dataCaseIndex,
      batchOrder: run.batchOrder
    }));

    return reply.status(202).send({
      batchId: batch.id,
      testId: test.id,
      totalCases: queuedRuns.length,
      queued: queuedRuns.length,
      runs: queuedRuns
    });
  });

  fastify.get<{ Params: { id: string } }>('/runs/:id', async (req, reply) => {
    const run = await prisma.testRun.findUnique({
      where: { id: req.params.id },
      include: {
        test: {
          include: {
            project: true
          }
        },
        environment: true,
        schedule: true
      }
    });

    if (!run) return reply.status(404).send({ error: 'Run not found' });
    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(run.test.project.id, userId, ['OWNER', 'EDITOR', 'VIEWER']);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }
    return {
      ...run,
      trace: await buildTraceMetadata(run)
    };
  });

  fastify.get<{ Params: { id: string } }>('/run-batches/:id', async (req, reply) => {
    const batch = await prisma.testRunBatch.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        status: true,
        totalCases: true,
        completedCases: true,
        passedCases: true,
        failedCases: true,
        startedAt: true,
        finishedAt: true,
        environmentId: true,
        test: {
          select: {
            id: true,
            name: true,
            projectId: true
          }
        },
        runs: {
          select: {
            id: true,
            status: true,
            dataCaseName: true,
            dataCaseIndex: true,
            batchOrder: true,
            durationMs: true,
            error: true,
            startedAt: true,
            finishedAt: true,
            currentStep: true,
            totalSteps: true
          },
          orderBy: { batchOrder: 'asc' }
        }
      }
    });

    if (!batch) {
      return reply.status(404).send({ error: 'Run batch not found' });
    }

    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(batch.test.projectId, userId, ['OWNER', 'EDITOR', 'VIEWER']);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    const environment = batch.environmentId
      ? await prisma.environment.findUnique({
          where: { id: batch.environmentId },
          select: { id: true, name: true }
        })
      : null;

    return {
      id: batch.id,
      status: batch.status,
      totalCases: batch.totalCases,
      completedCases: batch.completedCases,
      passedCases: batch.passedCases,
      failedCases: batch.failedCases,
      startedAt: batch.startedAt,
      finishedAt: batch.finishedAt,
      test: batch.test,
      environment,
      runs: batch.runs
    };
  });

  fastify.get<{ Params: { id: string } }>('/tests/:id/runs', async (req, reply) => {
    const test = await prisma.test.findUnique({
      where: { id: req.params.id }
    });

    if (!test) return reply.status(404).send({ error: 'Test not found' });

    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(test.projectId, userId, ['OWNER', 'EDITOR', 'VIEWER']);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    return prisma.testRun.findMany({
      where: { testId: req.params.id },
      orderBy: { startedAt: 'desc' },
      take: 20
    });
  });
}
