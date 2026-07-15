import prisma from '../prisma';
import { testQueue } from './queue';

type QueueableRun = {
  id: string;
  testId: string;
  environmentId?: string | null;
};

export const DEFAULT_TEST_WORKER_CONCURRENCY = 3;

export function getTestWorkerConcurrency() {
  const configured = Number(process.env.TEST_WORKER_CONCURRENCY ?? DEFAULT_TEST_WORKER_CONCURRENCY);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_TEST_WORKER_CONCURRENCY;
}

export function buildTestRunJobId(testRunId: string) {
  return `test-run-${testRunId}`;
}

export async function enqueueTestRun(run: QueueableRun) {
  return testQueue.add(
    'run',
    {
      testRunId: run.id,
      testId: run.testId,
      environmentId: run.environmentId ?? undefined
    },
    {
      jobId: buildTestRunJobId(run.id)
    }
  );
}

export async function markBatchRunning(testRunId: string) {
  const run = await prisma.testRun.findUnique({
    where: { id: testRunId },
    select: { batchId: true }
  });

  if (!run?.batchId) return;

  await prisma.testRunBatch.updateMany({
    where: {
      id: run.batchId,
      status: 'PENDING'
    },
    data: {
      status: 'RUNNING',
      startedAt: new Date()
    }
  });
}

export async function updateBatchAfterRun(testRunId: string) {
  const run = await prisma.testRun.findUnique({
    where: { id: testRunId },
    select: {
      batchId: true,
      batchOrder: true
    }
  });

  if (!run?.batchId || run.batchOrder === null) {
    return null;
  }

  const [batch, completedCases, passedCases, failedCases] = await Promise.all([
    prisma.testRunBatch.findUnique({
      where: { id: run.batchId },
      select: { id: true, totalCases: true }
    }),
    prisma.testRun.count({
      where: {
        batchId: run.batchId,
        status: { in: ['PASSED', 'FAILED'] }
      }
    }),
    prisma.testRun.count({
      where: {
        batchId: run.batchId,
        status: 'PASSED'
      }
    }),
    prisma.testRun.count({
      where: {
        batchId: run.batchId,
        status: 'FAILED'
      }
    })
  ]);

  if (!batch) {
    return null;
  }

  const isComplete = completedCases >= batch.totalCases;
  await prisma.testRunBatch.update({
    where: { id: batch.id },
    data: {
      status: isComplete ? (failedCases > 0 ? 'FAILED' : 'PASSED') : 'RUNNING',
      completedCases,
      passedCases,
      failedCases,
      finishedAt: isComplete ? new Date() : null
    }
  });

  if (isComplete) {
    return { queuedNext: false, completedCases, passedCases, failedCases };
  }

  const nextRun = await prisma.testRun.findFirst({
    where: {
      batchId: batch.id,
      batchOrder: { gt: run.batchOrder },
      status: 'PENDING'
    },
    orderBy: { batchOrder: 'asc' }
  });

  if (!nextRun) {
    return { queuedNext: false, completedCases, passedCases, failedCases };
  }

  const job = await enqueueTestRun(nextRun);
  return {
    queuedNext: true,
    nextRunId: nextRun.id,
    nextJobId: job.id,
    completedCases,
    passedCases,
    failedCases
  };
}
