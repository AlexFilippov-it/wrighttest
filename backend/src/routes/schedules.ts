import cron from 'node-cron';
import { parseExpression } from 'cron-parser';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { schedulerService } from '../services/scheduler';

const ScheduleSchema = z.object({
  name: z.string().min(1).max(100),
  cron: z.string().min(1),
  suiteId: z.string().optional(),
  testId: z.string().optional(),
  environmentId: z.string().optional(),
  enabled: z.boolean().default(true)
}).refine((value) => Boolean(value.suiteId) !== Boolean(value.testId), {
  message: 'Either suiteId or testId is required'
});

const UpdateScheduleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  cron: z.string().min(1).optional(),
  suiteId: z.string().optional().nullable(),
  testId: z.string().optional().nullable(),
  environmentId: z.string().optional().nullable(),
  enabled: z.boolean().optional()
});

async function validateScheduleTarget(projectId: string, suiteId?: string | null, testId?: string | null, environmentId?: string | null) {
  if (suiteId) {
    const suite = await prisma.suite.findUnique({ where: { id: suiteId } });
    if (!suite || suite.projectId !== projectId) {
      throw new Error('Suite not found');
    }
  }

  if (testId) {
    const test = await prisma.test.findUnique({ where: { id: testId } });
    if (!test || test.projectId !== projectId) {
      throw new Error('Test not found');
    }
  }

  if (environmentId) {
    const environment = await prisma.environment.findUnique({ where: { id: environmentId } });
    if (!environment || environment.projectId !== projectId) {
      throw new Error('Environment not found');
    }
  }
}

async function loadScheduleOr404(id: string) {
  return prisma.schedule.findUnique({ where: { id } });
}

type RunStatus = 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED';

function groupRunsByTick(runs: Array<{
  id: string;
  status: RunStatus;
  startedAt: Date;
  durationMs: number | null;
  error: string | null;
  test: { name: string };
}>) {
  const buckets = new Map<string, typeof runs>();

  for (const run of runs) {
    const tick = new Date(run.startedAt);
    tick.setSeconds(0, 0);
    const key = tick.toISOString();
    const current = buckets.get(key) ?? [];
    current.push(run);
    buckets.set(key, current);
  }

  return Array.from(buckets.entries()).map(([tick, tickRuns]) => {
    const passed = tickRuns.filter((run) => run.status === 'PASSED').length;
    const failed = tickRuns.filter((run) => run.status === 'FAILED').length;
    const total = tickRuns.length;
    const allDone = tickRuns.every((run) => run.status === 'PASSED' || run.status === 'FAILED');

    return {
      tick,
      status: !allDone ? 'RUNNING' : failed > 0 ? 'FAILED' : 'PASSED',
      summary: `${passed}/${total} passed`,
      durationMs: tickRuns.reduce((sum, run) => sum + (run.durationMs ?? 0), 0),
      runs: tickRuns.map((run) => ({
        id: run.id,
        testName: run.test.name,
        status: run.status,
        durationMs: run.durationMs,
        startedAt: run.startedAt,
        error: run.error
      }))
    };
  });
}

function getNextRunAt(cronExpression: string, referenceDate: Date) {
  try {
    const interval = parseExpression(cronExpression, {
      currentDate: referenceDate
    });
    return interval.next().toDate();
  } catch {
    return null;
  }
}

export async function scheduleRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { projectId: string } }>('/projects/:projectId/schedules', async (req, reply) => {
    const project = await prisma.project.findUnique({
      where: { id: req.params.projectId }
    });

    if (!project) return reply.status(404).send({ error: 'Project not found' });

    return prisma.schedule.findMany({
      where: { projectId: req.params.projectId },
      include: {
        suite: true,
        test: true,
        environment: true,
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: { status: true, startedAt: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    }).then((schedules) => schedules.map((schedule) => {
      const lastRun = schedule.runs[0];

      return {
        id: schedule.id,
        name: schedule.name,
        cron: schedule.cron,
        projectId: schedule.projectId,
        suiteId: schedule.suiteId,
        suite: schedule.suite,
        testId: schedule.testId,
        test: schedule.test,
        environmentId: schedule.environmentId,
        environment: schedule.environment,
        enabled: schedule.enabled,
        lastRunAt: lastRun?.startedAt ?? schedule.lastRunAt,
        lastRunStatus: lastRun?.status ?? null,
        nextRunAt: schedule.enabled
          ? getNextRunAt(schedule.cron, lastRun?.startedAt ?? schedule.lastRunAt ?? schedule.createdAt)
          : null,
        createdAt: schedule.createdAt
      };
    }));
  });

  fastify.get<{
    Params: { id: string };
    Querystring: { page?: string; limit?: string };
  }>('/schedules/:id/history', async (req, reply) => {
    const schedule = await prisma.schedule.findUnique({
      where: { id: req.params.id },
      include: { suite: true }
    });

    if (!schedule) {
      return reply.status(404).send({ error: 'Schedule not found' });
    }

    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.max(1, Number(req.query.limit ?? 20));
    const skip = (page - 1) * limit;

    const runs = await prisma.testRun.findMany({
      where: { scheduleId: schedule.id },
      include: {
        test: { select: { name: true } }
      },
      orderBy: { startedAt: 'desc' },
      skip,
      take: limit
    });

    const total = await prisma.testRun.count({
      where: { scheduleId: schedule.id }
    });

    return {
      schedule: {
        id: schedule.id,
        name: schedule.name,
        cron: schedule.cron,
        projectId: schedule.projectId,
        target: schedule.suite?.name ?? schedule.testId,
        lastRunAt: schedule.lastRunAt
      },
      batches: groupRunsByTick(runs),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    };
  });

  fastify.post<{ Params: { projectId: string } }>('/projects/:projectId/schedules', async (req, reply) => {
    const result = ScheduleSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    if (!cron.validate(result.data.cron)) {
      return reply.status(400).send({ error: 'Invalid cron expression' });
    }

    try {
      await validateScheduleTarget(
        req.params.projectId,
        result.data.suiteId ?? undefined,
        result.data.testId ?? undefined,
        result.data.environmentId ?? undefined
      );

      const schedule = await prisma.schedule.create({
        data: {
          ...result.data,
          projectId: req.params.projectId,
          suiteId: result.data.suiteId ?? null,
          testId: result.data.testId ?? null,
          environmentId: result.data.environmentId ?? null
        }
      });

      schedulerService.register(schedule);
      return reply.status(201).send(schedule);
    } catch (error) {
      if (error instanceof Error) {
        return reply.status(404).send({ error: error.message });
      }
      return reply.status(500).send({ error: 'Failed to create schedule' });
    }
  });

  fastify.patch<{ Params: { id: string } }>('/schedules/:id', async (req, reply) => {
    const result = UpdateScheduleSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const current = await loadScheduleOr404(req.params.id);
    if (!current) return reply.status(404).send({ error: 'Schedule not found' });

    const next = {
      name: result.data.name ?? current.name,
      cron: result.data.cron ?? current.cron,
      suiteId: result.data.suiteId === undefined ? current.suiteId : result.data.suiteId,
      testId: result.data.testId === undefined ? current.testId : result.data.testId,
      environmentId: result.data.environmentId === undefined ? current.environmentId : result.data.environmentId,
      enabled: result.data.enabled ?? current.enabled
    };

    if (!cron.validate(next.cron)) {
      return reply.status(400).send({ error: 'Invalid cron expression' });
    }

    if (Boolean(next.suiteId) === Boolean(next.testId)) {
      return reply.status(400).send({ error: 'Either suiteId or testId is required' });
    }

    try {
      await validateScheduleTarget(current.projectId, next.suiteId, next.testId, next.environmentId);

      const schedule = await prisma.schedule.update({
        where: { id: req.params.id },
        data: {
          name: next.name,
          cron: next.cron,
          suiteId: next.suiteId ?? null,
          testId: next.testId ?? null,
          environmentId: next.environmentId ?? null,
          enabled: next.enabled
        }
      });

      schedulerService.register(schedule);
      return schedule;
    } catch (error) {
      if (error instanceof Error) {
        return reply.status(404).send({ error: error.message });
      }
      return reply.status(500).send({ error: 'Failed to update schedule' });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/schedules/:id', async (req, reply) => {
    try {
      schedulerService.unregister(req.params.id);
      await prisma.schedule.delete({ where: { id: req.params.id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: 'Schedule not found' });
    }
  });
}
