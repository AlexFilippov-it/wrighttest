import { FastifyInstance } from 'fastify';
import prisma from '../prisma';
import { CreateProjectSchema, UpdateProjectSchema } from '../schemas/project.schema';
import type { RunStatus } from '@prisma/client';

type ProjectListItem = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  checksCount: number;
  activeSchedulesCount: number;
  alertChannelsCount: number;
  alertChannelTypes: string[];
  lastRunAt: Date | null;
  lastRunStatus: RunStatus | null;
  passRate30d: number | null;
  totalRuns30d: number;
  passedRuns30d: number;
  failedRuns30d: number;
  failedChecks: number;
  flakyChecks: number;
  health: 'passing' | 'failing' | 'flaky' | 'no_runs';
};

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

export async function projectRoutes(fastify: FastifyInstance) {
  fastify.get('/projects', async () => {
    const projects = await prisma.project.findMany({
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        tests: {
          select: {
            id: true
          }
        },
        schedules: {
          where: { enabled: true },
          select: {
            id: true,
            name: true,
            cron: true,
            enabled: true
          }
        },
        channels: {
          select: {
            id: true,
            type: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const allTestIds = projects.flatMap((project) => project.tests.map((test) => test.id));
    const recentWindow = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const allRuns = allTestIds.length
      ? await prisma.testRun.findMany({
          where: {
            testId: { in: allTestIds }
          },
          select: {
            status: true,
            startedAt: true,
            testId: true,
            test: {
              select: {
                projectId: true
              }
            }
          },
          orderBy: { startedAt: 'desc' }
        })
      : [];

    const recentRuns = allTestIds.length
      ? allRuns.filter((run) => run.startedAt >= recentWindow)
      : [];

    const recentRunsByProject = new Map<string, (typeof recentRuns)[number][]>();
    const latestRunsByProject = new Map<string, (typeof allRuns)[number][]>();

    for (const run of recentRuns) {
      const projectId = run.test.projectId;
      const list = recentRunsByProject.get(projectId) ?? [];
      list.push(run);
      recentRunsByProject.set(projectId, list);
    }

    for (const run of allRuns) {
      const projectId = run.test.projectId;
      const list = latestRunsByProject.get(projectId) ?? [];
      if (!list.some((item) => item.testId === run.testId)) {
        list.push(run);
        latestRunsByProject.set(projectId, list);
      }
    }

    const result: ProjectListItem[] = projects.map((project) => {
      const projectRecentRuns = recentRunsByProject.get(project.id) ?? [];
      const projectLatestRuns = latestRunsByProject.get(project.id) ?? [];
      const projectLatestRun = projectLatestRuns[0] ?? null;
      const totalRuns30d = projectRecentRuns.length;
      const passedRuns30d = projectRecentRuns.filter((run) => run.status === 'PASSED').length;
      const failedRuns30d = projectRecentRuns.filter((run) => run.status === 'FAILED').length;
      const passRate30d = totalRuns30d > 0 ? Math.round((passedRuns30d / totalRuns30d) * 100) : null;
      const failedChecks = projectLatestRuns.filter((run) => run.status === 'FAILED').length;
      const flakyChecks = project.tests.filter((test) => {
        const runs = recentRuns.filter((run) => run.testId === test.id).map((run) => run.status);
        return runs.includes('PASSED') && runs.includes('FAILED');
      }).length;

      let health: ProjectListItem['health'] = 'no_runs';
      if (totalRuns30d > 0) {
        if (flakyChecks > 0) {
          health = 'flaky';
        } else if (failedChecks > 0) {
          health = 'failing';
        } else {
          health = 'passing';
        }
      }

      return {
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        checksCount: project.tests.length,
        activeSchedulesCount: project.schedules.length,
        alertChannelsCount: project.channels.length,
        alertChannelTypes: unique(project.channels.map((channel) => channel.type)),
        lastRunAt: projectLatestRun?.startedAt ?? null,
        lastRunStatus: projectLatestRun?.status ?? null,
        passRate30d,
        totalRuns30d,
        passedRuns30d,
        failedRuns30d,
        failedChecks,
        flakyChecks,
        health
      };
    });

    return result;
  });

  fastify.get<{ Params: { id: string } }>('/projects/:id', async (req, reply) => {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
      tests: {
        include: {
          _count: { select: { runs: true } },
          schedules: {
            where: { enabled: true },
              select: {
                id: true,
                name: true,
                cron: true,
                enabled: true
              }
            },
            runs: {
              orderBy: { startedAt: 'desc' },
              take: 1,
              select: {
                id: true,
                status: true,
                startedAt: true,
                durationMs: true,
                error: true,
                tracePath: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        suites: {
          select: {
            id: true,
            testIds: true,
            schedules: {
              where: { enabled: true },
              select: {
                id: true,
                name: true,
                cron: true,
                enabled: true
              }
            }
          }
        },
        schedules: {
          where: { enabled: true },
          select: {
            id: true,
            name: true,
            cron: true,
            enabled: true
          }
        },
        channels: {
          select: {
            id: true
          }
        }
      }
    });

    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const testIds = project.tests.map((test) => test.id);
    const suiteSchedulesByTestId = new Map<string, { id: string; name: string; cron: string; enabled: boolean }[]>();
    for (const suite of project.suites) {
      const suiteTestIds = Array.isArray(suite.testIds) ? (suite.testIds as string[]) : [];
      for (const testId of suiteTestIds) {
        const list = suiteSchedulesByTestId.get(testId) ?? [];
        list.push(...suite.schedules);
        suiteSchedulesByTestId.set(testId, list);
      }
    }

    const recentWindow = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const runs = testIds.length
      ? await prisma.testRun.findMany({
          where: {
            testId: { in: testIds }
          },
          select: {
            id: true,
            status: true,
            startedAt: true,
            durationMs: true,
            testId: true,
            test: {
              select: {
                projectId: true
              }
            }
          },
          orderBy: { startedAt: 'desc' }
        })
      : [];

    const recentRuns = runs.filter((run) => run.startedAt >= recentWindow);
    const latestRunsByTest = new Map<string, (typeof runs)[number][]>();

    for (const run of runs) {
      const list = latestRunsByTest.get(run.testId) ?? [];
      if (!list.some((item) => item.testId === run.testId)) {
        list.push(run);
        latestRunsByTest.set(run.testId, list);
      }
    }

    const latestProjectRun = runs[0] ?? null;
    const totalRuns30d = recentRuns.length;
    const passedRuns30d = recentRuns.filter((run) => run.status === 'PASSED').length;
    const failedRuns30d = recentRuns.filter((run) => run.status === 'FAILED').length;
    const passRate30d = totalRuns30d > 0 ? Math.round((passedRuns30d / totalRuns30d) * 100) : null;
    const avgDurationSamples = recentRuns.filter((run) => typeof run.durationMs === 'number');
    const avgDurationMs =
      avgDurationSamples.length > 0
        ? Math.round(
            avgDurationSamples.reduce((sum, run) => sum + (run.durationMs ?? 0), 0) /
              avgDurationSamples.length
          )
        : null;
    const failedChecks = project.tests.filter((test) => {
      const latestRun = latestRunsByTest.get(test.id)?.[0];
      return latestRun?.status === 'FAILED';
    }).length;
    const flakyChecks = project.tests.filter((test) => {
      const statuses = recentRuns.filter((run) => run.testId === test.id).map((run) => run.status);
      return statuses.includes('PASSED') && statuses.includes('FAILED');
    }).length;
    const activeSchedules = new Map<string, { id: string; name: string; cron: string; enabled: boolean }>();
    for (const schedule of project.schedules) {
      activeSchedules.set(schedule.id, schedule);
    }
    for (const suite of project.suites) {
      for (const schedule of suite.schedules) {
        activeSchedules.set(schedule.id, schedule);
      }
    }

    return {
      ...project,
      summary: {
        checksCount: project.tests.length,
        lastResult: latestProjectRun?.status ?? null,
        lastRunAt: latestProjectRun?.startedAt ?? null,
        passRate30d,
        totalRuns30d,
        passedRuns30d,
        failedRuns30d,
        activeSchedulesCount: activeSchedules.size,
        alertChannelsCount: project.channels.length,
        avgDurationMs,
        failedChecks,
        flakyChecks
      },
      tests: project.tests.map((test) => {
        const latestRun = test.runs[0] ?? null;
        const mergedSchedules = new Map<string, { id: string; name: string; cron: string; enabled: boolean }>();
        for (const schedule of test.schedules) {
          mergedSchedules.set(schedule.id, schedule);
        }
        for (const schedule of suiteSchedulesByTestId.get(test.id) ?? []) {
          mergedSchedules.set(schedule.id, schedule);
        }
        return {
          ...test,
          runCount: test._count.runs,
          lastRunAt: latestRun?.startedAt ?? null,
          lastRunStatus: latestRun?.status ?? null,
          lastRunDurationMs: latestRun?.durationMs ?? null,
          latestRun,
          scheduleCount: mergedSchedules.size,
          schedules: Array.from(mergedSchedules.values())
        };
      })
    };
  });

  fastify.post('/projects', async (req, reply) => {
    const result = CreateProjectSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const project = await prisma.project.create({ data: result.data });
    return reply.status(201).send(project);
  });

  fastify.patch<{ Params: { id: string } }>('/projects/:id', async (req, reply) => {
    const result = UpdateProjectSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    try {
      const project = await prisma.project.update({
        where: { id: req.params.id },
        data: result.data
      });
      return project;
    } catch {
      return reply.status(404).send({ error: 'Project not found' });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/projects/:id', async (req, reply) => {
    try {
      await prisma.project.delete({ where: { id: req.params.id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: 'Project not found' });
    }
  });
}
