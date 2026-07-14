import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { testQueue } from '../queue/queue';
import { getAuthUser, getProjectAccessStatusCode, requireProjectRole } from '../utils/project-access';
import { DATA_DRIVEN_CASE_REQUIRED_ERROR, hasTestDataCases } from '../utils/test-data';

const SuiteSchema = z.object({
  name: z.string().min(1).max(100),
  testIds: z.array(z.string()).default([])
});

const RunSuiteSchema = z.object({
  environmentId: z.string().optional()
});

function suiteTestIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export async function suiteRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { projectId: string } }>('/projects/:projectId/suites', async (req, reply) => {
    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(req.params.projectId, userId, ['OWNER', 'EDITOR', 'VIEWER']);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    return prisma.suite.findMany({
      where: { projectId: req.params.projectId },
      include: { _count: { select: { schedules: true } } },
      orderBy: { createdAt: 'desc' }
    });
  });

  fastify.post<{ Params: { projectId: string } }>('/projects/:projectId/suites', async (req, reply) => {
    const result = SuiteSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(req.params.projectId, userId, ['OWNER', 'EDITOR']);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    if (result.data.testIds.length === 0) {
      return reply.status(400).send({ error: 'Select at least one test' });
    }

    const availableTests = await prisma.test.findMany({
      where: {
        id: { in: result.data.testIds },
        projectId: req.params.projectId
      },
      select: { id: true }
    });

    if (availableTests.length !== result.data.testIds.length) {
      return reply.status(400).send({ error: 'All tests must belong to the project' });
    }

    const suite = await prisma.suite.create({
      data: { ...result.data, projectId: req.params.projectId }
    });

    return reply.status(201).send(suite);
  });

  fastify.patch<{ Params: { id: string } }>('/suites/:id', async (req, reply) => {
    const result = SuiteSchema.partial().safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    try {
      const current = await prisma.suite.findUnique({
        where: { id: req.params.id }
      });

      if (!current) return reply.status(404).send({ error: 'Suite not found' });

      const { userId } = getAuthUser(req);
      await requireProjectRole(current.projectId, userId, ['OWNER', 'EDITOR']);

      const nextName = result.data.name ?? current.name;
      const nextTestIds = result.data.testIds ? suiteTestIds(result.data.testIds) : suiteTestIds(current.testIds);

      if (nextTestIds.length === 0) {
        return reply.status(400).send({ error: 'Select at least one test' });
      }

      const availableTests = await prisma.test.findMany({
        where: {
          id: { in: nextTestIds },
          projectId: current.projectId
        },
        select: { id: true }
      });

      if (availableTests.length !== nextTestIds.length) {
        return reply.status(400).send({ error: 'All tests must belong to the project' });
      }

      const suite = await prisma.suite.update({
        where: { id: req.params.id },
        data: {
          name: nextName,
          testIds: nextTestIds
        }
      });

      return suite;
    } catch {
      return reply.status(404).send({ error: 'Suite not found' });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/suites/:id', async (req, reply) => {
    try {
      const current = await prisma.suite.findUnique({
        where: { id: req.params.id },
        select: { projectId: true }
      });
      if (!current) return reply.status(404).send({ error: 'Suite not found' });

      const { userId } = getAuthUser(req);
      await requireProjectRole(current.projectId, userId, ['OWNER', 'EDITOR']);

      await prisma.suite.delete({ where: { id: req.params.id } });
      return reply.status(204).send();
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Suite not found' });
    }
  });

  fastify.post<{ Params: { id: string } }>('/suites/:id/run', async (req, reply) => {
    const result = RunSuiteSchema.safeParse(req.body ?? {});
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const suite = await prisma.suite.findUnique({
      where: { id: req.params.id }
    });

    if (!suite) return reply.status(404).send({ error: 'Suite not found' });

    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(suite.projectId, userId, ['OWNER', 'EDITOR']);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    const testIds = suiteTestIds(suite.testIds);
    if (testIds.length === 0) {
      return reply.status(400).send({ error: 'Suite has no tests' });
    }

    if (result.data.environmentId) {
      const environment = await prisma.environment.findUnique({
        where: { id: result.data.environmentId }
      });

      if (!environment || environment.projectId !== suite.projectId) {
        return reply.status(404).send({ error: 'Environment not found' });
      }
    }

    const jobs: { testRunId: string; testId: string }[] = [];

    for (const testId of testIds) {
      const test = await prisma.test.findUnique({ where: { id: testId } });
      if (!test || test.projectId !== suite.projectId) continue;

      if (hasTestDataCases(test.testData)) {
        const run = await prisma.testRun.create({
          data: {
            testId: test.id,
            status: 'FAILED',
            environmentId: result.data.environmentId,
            finishedAt: new Date(),
            durationMs: 0,
            error: DATA_DRIVEN_CASE_REQUIRED_ERROR
          }
        });

        jobs.push({ testRunId: run.id, testId: test.id });
        console.log(`[Suite] Skipped data-driven test "${test.name}" without explicit case`);
        continue;
      }

      const run = await prisma.testRun.create({
        data: {
          testId: test.id,
          status: 'PENDING',
          environmentId: result.data.environmentId
        }
      });

      const job = await testQueue.add('run', {
        testRunId: run.id,
        testId: test.id,
        environmentId: result.data.environmentId
      });

      jobs.push({ testRunId: run.id, testId: test.id });
      console.log(`[Suite] Queued ${job.id} for suite "${suite.name}"`);
    }

    return reply.status(202).send({
      suiteId: suite.id,
      queued: jobs.length,
      jobs
    });
  });
}
