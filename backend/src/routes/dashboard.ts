import { FastifyInstance } from 'fastify';
import { Prisma, type RunStatus } from '@prisma/client';
import prisma from '../prisma';

type DashboardRun = {
  id: string;
  testId: string;
  status: RunStatus;
  startedAt: Date;
  durationMs: number | null;
  error: string | null;
  test: {
    id: string;
    name: string;
    project: {
      id: string;
      name: string;
    };
  };
  schedule: {
    id: string;
    name: string;
  } | null;
  environmentId: string | null;
};

type RunHistoryTriggerFilter = 'all' | 'manual' | 'schedule';
type RunHistoryStatusFilter = 'all' | 'passed' | 'failed';

function getDayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function summarizeError(error?: string | null) {
  if (!error) return null;
  const firstLine = error.replace(/\r/g, '').split('\n').map((line) => line.trim()).find(Boolean);
  return firstLine ?? error.trim();
}

function getTriggerLabel(run: DashboardRun) {
  return run.schedule ? 'Schedule' : 'Manual';
}

async function loadRuns(params: {
  projectId?: string;
  days: number;
  limit: number;
}) {
  const since = new Date(Date.now() - params.days * 24 * 60 * 60 * 1000);

  const runs = await prisma.testRun.findMany({
    where: {
      startedAt: { gte: since },
      ...(params.projectId ? { test: { projectId: params.projectId } } : {})
    },
    select: {
      id: true,
      testId: true,
      status: true,
      startedAt: true,
      durationMs: true,
      error: true,
      environmentId: true,
      schedule: {
        select: {
          id: true,
          name: true
        }
      },
      test: {
        select: {
          id: true,
          name: true,
          project: {
            select: {
              id: true,
              name: true
            }
          }
        }
      }
    },
    orderBy: { startedAt: 'desc' },
    take: params.limit
  }) as DashboardRun[];

  return runs;
}

function buildRunHistoryWhere(params: {
  projectId?: string;
  days: number;
  status: RunHistoryStatusFilter;
  trigger: RunHistoryTriggerFilter;
}) {
  const where: Prisma.TestRunWhereInput = {};

  if (params.days > 0) {
    where.startedAt = { gte: new Date(Date.now() - params.days * 24 * 60 * 60 * 1000) };
  }

  if (params.projectId) {
    where.test = { projectId: params.projectId };
  }

  if (params.status !== 'all') {
    where.status = params.status === 'passed' ? 'PASSED' : 'FAILED';
  }

  if (params.trigger === 'manual') {
    where.scheduleId = null;
  } else if (params.trigger === 'schedule') {
    where.scheduleId = { not: null };
  }

  return where;
}

export async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.get<{
    Querystring: { projectId?: string; days?: string }
  }>('/dashboard', async (req) => {
    const days = Number(req.query.days ?? 30);
    const runs = await loadRuns({
      projectId: req.query.projectId,
      days,
      limit: 8
    });

    const byDay = runs.reduce<Record<string, { passed: number; failed: number; total: number }>>((acc, run) => {
      const day = getDayKey(run.startedAt);
      if (!acc[day]) acc[day] = { passed: 0, failed: 0, total: 0 };
      acc[day].total += 1;
      if (run.status === 'PASSED') acc[day].passed += 1;
      if (run.status === 'FAILED') acc[day].failed += 1;
      return acc;
    }, {});

    const total = runs.length;
    const passed = runs.filter((run) => run.status === 'PASSED').length;
    const failed = runs.filter((run) => run.status === 'FAILED').length;
    const avgDurationMs = total
      ? Math.round(runs.reduce((sum, run) => sum + (run.durationMs ?? 0), 0) / total)
      : 0;

    const groupedByTest = new Map<string, DashboardRun[]>();
    for (const run of runs) {
      const list = groupedByTest.get(run.testId) ?? [];
      list.push(run);
      groupedByTest.set(run.testId, list);
    }

    const activeIssues = Array.from(groupedByTest.values())
      .map((list) => {
        const latest = list[0];
        const passedCount = list.filter((run) => run.status === 'PASSED').length;
        const failedCount = list.filter((run) => run.status === 'FAILED').length;
        const latestFailed = list.find((run) => run.status === 'FAILED') ?? null;
        const flaky = passedCount > 0 && failedCount > 0;
        const failingRepeatedly = latest.status === 'FAILED' && failedCount >= 2;

        if (!flaky && latest.status !== 'FAILED') {
          return null;
        }

        return {
          testId: latest.testId,
          checkName: latest.test.name,
          projectId: latest.test.project.id,
          projectName: latest.test.project.name,
          status: failingRepeatedly ? 'Failing repeatedly' : flaky ? 'Flaky' : 'Failed',
          latestRunId: latest.id,
          latestRunAt: latest.startedAt,
          latestFailedRunId: latestFailed?.id ?? latest.id,
          latestFailedAt: latestFailed?.startedAt ?? latest.startedAt,
          latestRunStatus: latest.status,
          errorSummary: summarizeError(latestFailed?.error ?? latest.error),
          environmentId: latest.environmentId,
          passedRuns: passedCount,
          failedRuns: failedCount,
          totalRuns: list.length
        };
      })
      .filter(Boolean)
      .sort((a, b) => Number(b!.latestRunAt) - Number(a!.latestRunAt)) as Array<{
      testId: string;
      checkName: string;
      projectId: string;
      projectName: string;
      status: string;
      latestRunId: string;
      latestRunAt: Date;
      latestFailedRunId: string;
      latestFailedAt: Date;
      latestRunStatus: RunStatus;
      errorSummary: string | null;
      environmentId: string | null;
      passedRuns: number;
      failedRuns: number;
      totalRuns: number;
    }>;

    const recentRuns = runs.map((run) => ({
      runId: run.id,
      testId: run.testId,
      checkName: run.test.name,
      projectId: run.test.project.id,
      projectName: run.test.project.name,
      status: run.status,
      durationMs: run.durationMs,
      startedAt: run.startedAt,
      trigger: getTriggerLabel(run),
      scheduleName: run.schedule?.name ?? null,
      environmentId: run.environmentId
    }));

    const flakyChecks = Array.from(groupedByTest.values())
      .map((list) => {
        const passedCount = list.filter((run) => run.status === 'PASSED').length;
        const failedCount = list.filter((run) => run.status === 'FAILED').length;
        if (!(passedCount > 0 && failedCount > 0)) return null;

        const latest = list[0];
        const latestFailed = list.find((run) => run.status === 'FAILED') ?? null;

        return {
          testId: latest.testId,
          checkName: latest.test.name,
          projectId: latest.test.project.id,
          projectName: latest.test.project.name,
          totalRuns: list.length,
          passed: passedCount,
          failed: failedCount,
          passRate: list.length ? Math.round((passedCount / list.length) * 100) : 0,
          lastFailure: latestFailed?.startedAt ?? latest.startedAt,
          latestFailedRunId: latestFailed?.id ?? latest.id,
          errorSummary: summarizeError(latestFailed?.error),
          latestRunId: latest.id
        };
      })
      .filter(Boolean)
      .sort((a, b) => b!.totalRuns - a!.totalRuns)
      .slice(0, 10) as Array<{
      testId: string;
      checkName: string;
      projectId: string;
      projectName: string;
      totalRuns: number;
      passed: number;
      failed: number;
      passRate: number;
      lastFailure: Date | null;
      latestFailedRunId: string;
      errorSummary: string | null;
      latestRunId: string;
    }>;

    return {
      summary: {
        total,
        passed,
        failed,
        passRate: total ? Math.round((passed / total) * 100) : 0,
        avgDurationMs,
        activeFailures: activeIssues.filter((issue) => issue.latestRunStatus === 'FAILED').length,
      flakyChecks: flakyChecks.length
      },
      recentRuns,
      activeIssues,
      flakyChecks,
      chart: Object.entries(byDay)
        .map(([date, counts]) => ({
          date,
          ...counts,
          passRate: counts.total ? Math.round((counts.passed / counts.total) * 100) : 0
        }))
        .sort((a, b) => a.date.localeCompare(b.date))
    };
  });

  fastify.get<{
    Querystring: { projectId?: string; days?: string; limit?: string; status?: string; trigger?: string }
  }>('/runs', async (req) => {
    const days = Number(req.query.days ?? 30);
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const status = (req.query.status === 'passed' || req.query.status === 'failed' ? req.query.status : 'all') as RunHistoryStatusFilter;
    const trigger = (req.query.trigger === 'manual' || req.query.trigger === 'schedule' ? req.query.trigger : 'all') as RunHistoryTriggerFilter;
    const where = buildRunHistoryWhere({
      projectId: req.query.projectId,
      days,
      status,
      trigger
    });

    const allRuns = await prisma.testRun.findMany({
      where,
      select: {
        id: true,
        testId: true,
        status: true,
        startedAt: true,
        durationMs: true,
        error: true,
        environmentId: true,
        schedule: {
          select: {
            id: true,
            name: true
          }
        },
        test: {
          select: {
            id: true,
            name: true,
            project: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      },
      orderBy: { startedAt: 'desc' }
    }) as DashboardRun[];

    const runs = allRuns.slice(0, limit);
    const total = allRuns.length;
    const passed = total ? allRuns.filter((run) => run.status === 'PASSED').length : 0;
    const failed = total ? allRuns.filter((run) => run.status === 'FAILED').length : 0;
    const avgDurationSamples = allRuns.filter((run) => typeof run.durationMs === 'number');
    const avgDurationMs =
      avgDurationSamples.length > 0
        ? Math.round(avgDurationSamples.reduce((sum, run) => sum + (run.durationMs ?? 0), 0) / avgDurationSamples.length)
        : null;
    const slowestRun = allRuns
      .filter((run) => typeof run.durationMs === 'number')
      .slice()
      .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))[0] ?? null;

    return {
      runs: runs.map((run) => ({
        runId: run.id,
        testId: run.testId,
        checkName: run.test.name,
        projectId: run.test.project.id,
        projectName: run.test.project.name,
        status: run.status,
        durationMs: run.durationMs,
        startedAt: run.startedAt,
        trigger: getTriggerLabel(run),
        scheduleName: run.schedule?.name ?? null,
        environmentId: run.environmentId
      })),
      summary: {
        total,
        passed,
        failed,
        passRate: total ? Math.round((passed / total) * 100) : 0,
        avgDurationMs,
        slowestRun: slowestRun
          ? {
              runId: slowestRun.id,
              testId: slowestRun.testId,
              checkName: slowestRun.test.name,
              projectId: slowestRun.test.project.id,
              projectName: slowestRun.test.project.name,
              durationMs: slowestRun.durationMs
            }
          : null
      },
      total,
      days,
      limit
    };
  });

  fastify.get<{
    Querystring: { projectId?: string }
  }>('/dashboard/flaky', async (req) => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const runs = await prisma.testRun.findMany({
      where: {
        startedAt: { gte: since },
        ...(req.query.projectId ? { test: { projectId: req.query.projectId } } : {})
      },
      select: {
        testId: true,
        status: true
      }
    });

    const grouped = runs.reduce<Record<string, { passed: number; failed: number; totalRuns: number }>>((acc, run) => {
      if (!acc[run.testId]) acc[run.testId] = { passed: 0, failed: 0, totalRuns: 0 };
      acc[run.testId].totalRuns += 1;
      if (run.status === 'PASSED') acc[run.testId].passed += 1;
      if (run.status === 'FAILED') acc[run.testId].failed += 1;
      return acc;
    }, {});

    const tests = await prisma.test.findMany({
      where: { id: { in: Object.keys(grouped) } },
      select: { id: true, name: true }
    });

    const testMap = Object.fromEntries(tests.map((test) => [test.id, test.name]));

    return Object.entries(grouped)
      .filter(([, counts]) => counts.passed > 0 && counts.failed > 0)
      .map(([testId, counts]) => ({
        testId,
        testName: testMap[testId] ?? 'Unknown',
        totalRuns: counts.totalRuns,
        passed: counts.passed,
        failed: counts.failed
      }))
      .sort((a, b) => b.totalRuns - a.totalRuns)
      .slice(0, 10);
  });
}
