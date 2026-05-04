import { FastifyInstance } from 'fastify';
import prisma from '../prisma';

type StatusSummary = { passed: number; failed: number; total: number };

function getDayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.get<{
    Querystring: { projectId?: string; days?: string }
  }>('/dashboard', async (req) => {
    const days = Number(req.query.days ?? 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const runs = await prisma.testRun.findMany({
      where: {
        startedAt: { gte: since },
        ...(req.query.projectId ? { test: { projectId: req.query.projectId } } : {})
      },
      select: {
        status: true,
        startedAt: true,
        durationMs: true
      },
      orderBy: { startedAt: 'asc' }
    });

    const byDay = runs.reduce<Record<string, StatusSummary>>((acc, run) => {
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

    return {
      summary: {
        total,
        passed,
        failed,
        passRate: total ? Math.round((passed / total) * 100) : 0,
        avgDurationMs
      },
      chart: Object.entries(byDay).map(([date, counts]) => ({
        date,
        ...counts,
        passRate: counts.total ? Math.round((counts.passed / counts.total) * 100) : 0
      }))
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
