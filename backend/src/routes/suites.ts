import { FastifyInstance } from 'fastify';
import type { SuiteRunStatus } from '@prisma/client';
import { z } from 'zod';
import prisma from '../prisma';
import { getAuthUser, getProjectAccessStatusCode, requireProjectRole } from '../utils/project-access';
import { createSuiteRun, getSafeSuiteRun, normalizeSuiteConfig, validateSuiteConfiguration, cancelSuiteRun, type SuiteExecutionConfig } from '../services/suite-runner';

const SuiteSchema = z.object({
  name: z.string().min(1).max(100),
  testIds: z.array(z.string()).optional(),
  executionMode: z.enum(['INDEPENDENT', 'SEQUENTIAL']).optional(),
  executionConfig: z.object({
    orderedTestIds: z.array(z.string()).optional(),
    mappings: z.array(z.object({
      sourceTestId: z.string().min(1), outputVariable: z.string().min(1),
      targetTestId: z.string().min(1), targetVariable: z.string().min(1),
      required: z.boolean().default(true),
      expectedType: z.enum(['string', 'number', 'boolean', 'json', 'null']).optional()
    })).optional(),
    dataCaseIndexes: z.record(z.string(), z.number().int().nonnegative()).optional()
  }).optional()
});

const RunSuiteSchema = z.object({
  environmentId: z.string().optional(),
  dataCaseIndexes: z.record(z.string(), z.number().int().nonnegative()).optional()
});

function suiteTestIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

async function validateConfig(projectId: string, testIds: string[], executionMode: 'INDEPENDENT' | 'SEQUENTIAL', config: SuiteExecutionConfig) {
  const tests = await prisma.test.findMany({ where: { id: { in: testIds }, projectId }, select: { id: true, steps: true, testData: true } });
  if (tests.length !== testIds.length) throw new Error('All tests must belong to the project');
  validateSuiteConfiguration({ executionMode, testIds, config, tests });
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
    const testIds = result.data.testIds ?? [];

    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(req.params.projectId, userId, ['OWNER', 'EDITOR']);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    if (testIds.length === 0) {
      return reply.status(400).send({ error: 'Select at least one test' });
    }

    const availableTests = await prisma.test.findMany({
      where: {
        id: { in: testIds },
        projectId: req.params.projectId
      },
      select: { id: true }
    });

    if (availableTests.length !== testIds.length) {
      return reply.status(400).send({ error: 'All tests must belong to the project' });
    }

    const executionMode = result.data.executionMode ?? 'INDEPENDENT';
    const executionConfig: SuiteExecutionConfig = {
      orderedTestIds: result.data.executionConfig?.orderedTestIds ?? testIds,
      mappings: result.data.executionConfig?.mappings ?? [],
      dataCaseIndexes: result.data.executionConfig?.dataCaseIndexes ?? {}
    };
    try {
      await validateConfig(req.params.projectId, testIds, executionMode, executionConfig);
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Invalid suite configuration' });
    }
    const suite = await prisma.suite.create({
      data: { name: result.data.name, testIds, projectId: req.params.projectId, executionMode, executionConfig: executionConfig as never }
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
      const executionMode = result.data.executionMode ?? current.executionMode;
      const currentConfig = normalizeSuiteConfig(current);
      const executionConfig: SuiteExecutionConfig = {
        orderedTestIds: result.data.executionConfig?.orderedTestIds ?? (result.data.testIds ? nextTestIds : currentConfig.orderedTestIds),
        mappings: result.data.executionConfig?.mappings ?? currentConfig.mappings,
        dataCaseIndexes: result.data.executionConfig?.dataCaseIndexes ?? currentConfig.dataCaseIndexes
      };

      if (nextTestIds.length === 0) {
        return reply.status(400).send({ error: 'Select at least one test' });
      }

      await validateConfig(current.projectId, nextTestIds, executionMode, executionConfig);

      const suite = await prisma.suite.update({
        where: { id: req.params.id },
        data: {
          name: nextName,
          testIds: nextTestIds,
          executionMode,
          executionConfig: executionConfig as never
        }
      });

      return suite;
    } catch (error) {
      return reply.status(error instanceof Error && /Forbidden|permission|role/i.test(error.message) ? getProjectAccessStatusCode(error) : 400)
        .send({ error: error instanceof Error ? error.message : 'Invalid suite configuration' });
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
    if (testIds.length === 0) return reply.status(400).send({ error: 'Suite has no tests' });

    if (result.data.environmentId) {
      const environment = await prisma.environment.findUnique({
        where: { id: result.data.environmentId }
      });

      if (!environment || environment.projectId !== suite.projectId) {
        return reply.status(404).send({ error: 'Environment not found' });
      }
    }

    try {
      const run = await createSuiteRun(suite, { ...result.data, triggeredBy: userId });
      return reply.status(202).send({ suiteId: suite.id, suiteRunId: run.suiteRun.id, queued: run.runs.length, jobs: run.runs.map(({ id, testId }) => ({ testRunId: id, testId })) });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : 'Could not start suite' });
    }
  });

  fastify.get<{ Params: { projectId: string } }>('/projects/:projectId/suite-runs', async (req, reply) => {
    const { userId } = getAuthUser(req);
    try { await requireProjectRole(req.params.projectId, userId, ['OWNER', 'EDITOR', 'VIEWER']); }
    catch (error) { return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' }); }
    return prisma.suiteRun.findMany({
      where: { projectId: req.params.projectId },
      orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, suiteId: true, suiteName: true, executionMode: true, status: true, error: true, startedAt: true, finishedAt: true, createdAt: true, environmentId: true }
    });
  });

  fastify.get<{ Params: { id: string } }>('/suite-runs/:id', async (req, reply) => {
    const run = await getSafeSuiteRun(req.params.id);
    if (!run) return reply.status(404).send({ error: 'Suite run not found' });
    const { userId } = getAuthUser(req);
    try { await requireProjectRole(run.projectId, userId, ['OWNER', 'EDITOR', 'VIEWER']); }
    catch (error) { return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' }); }
    return run;
  });

  fastify.post<{ Params: { id: string } }>('/suite-runs/:id/cancel', async (req, reply) => {
    const run = await prisma.suiteRun.findUnique({ where: { id: req.params.id }, select: { projectId: true } });
    if (!run) return reply.status(404).send({ error: 'Suite run not found' });
    const { userId } = getAuthUser(req);
    try { await requireProjectRole(run.projectId, userId, ['OWNER', 'EDITOR']); }
    catch (error) { return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' }); }
    const updated = await cancelSuiteRun(req.params.id);
    if (updated.count === 0) return reply.status(409).send({ error: 'Suite run is already terminal' });
    return { id: req.params.id, status: 'CANCELLED' satisfies SuiteRunStatus };
  });
}
