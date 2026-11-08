import prisma from '../prisma';
import { decryptProjectVariableValue, encryptRunVariablesSnapshot } from '../services/project-variable-crypto';
import { generateTestDataValue } from '../services/test-data-generators';
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

function secretName(name: string) {
  return /(pass(word)?|secret|token|api[_-]?key|authorization|credential|private[_-]?key)/i.test(name);
}

export async function prepareRunVariableSnapshot(runId: string) {
  const run = await prisma.testRun.findUnique({
    where: { id: runId },
    include: { test: { include: { project: { include: { variables: true } } } }, environment: true }
  });
  if (!run) throw new Error(`TestRun ${runId} not found.`);
  if (run.variablesSnapshot) return;

  const projectVariables: Record<string, unknown> = {};
  const secretNames: string[] = [];
  for (const variable of run.test.project.variables) {
    projectVariables[variable.name] = variable.secret ? decryptProjectVariableValue(variable.value) : JSON.parse(variable.value) as unknown;
    if (variable.secret || secretName(variable.name)) secretNames.push(variable.name);
  }
  const environmentVariables = (run.environment?.variables ?? {}) as Record<string, unknown>;
  for (const name of Object.keys(environmentVariables)) if (secretName(name)) secretNames.push(name);

  const testDataVariables: Record<string, unknown> = {};
  const sources: Record<string, 'project' | 'environment' | 'testData' | 'generated'> = {};
  for (const [name, cell] of Object.entries((run.dataCaseVariables ?? {}) as Record<string, unknown>)) {
    if (typeof cell === 'string') {
      testDataVariables[name] = cell;
      sources[name] = 'testData';
      continue;
    }
    if (!cell || typeof cell !== 'object' || !('kind' in cell)) {
      testDataVariables[name] = cell;
      sources[name] = 'testData';
      continue;
    }
    const typed = cell as { kind: string; value?: unknown; name?: string; source?: 'project' | 'environment'; generator?: string; options?: Record<string, string | number | boolean>; secret?: boolean };
    if (typed.kind === 'literal') {
      testDataVariables[name] = typed.value;
      sources[name] = 'testData';
    } else if (typed.kind === 'generated') {
      testDataVariables[name] = generateTestDataValue(typed.generator, typed.options ?? {});
      sources[name] = 'generated';
      if (typed.secret || typed.generator === 'password' || secretName(name)) secretNames.push(name);
    } else if (typed.kind === 'reference' && typed.name) {
      const source = typed.source;
      const resolvedSource = source ?? (Object.hasOwn(environmentVariables, typed.name) ? 'environment' : 'project');
      const sourceValues = resolvedSource === 'environment' ? environmentVariables : projectVariables;
      if (!Object.hasOwn(sourceValues, typed.name)) throw new Error(`Test Data variable "${name}" references missing ${resolvedSource} variable "${typed.name}".`);
      testDataVariables[name] = sourceValues[typed.name];
      sources[name] = resolvedSource;
      if (secretNames.includes(typed.name) || secretName(typed.name) || secretName(name)) secretNames.push(name);
    } else {
      throw new Error(`Test Data variable "${name}" has an unsupported cell type.`);
    }
  }

  const safeDataCaseVariables = Object.fromEntries(Object.entries(testDataVariables).map(([name, value]) => [
    name,
    secretNames.includes(name) || secretName(name) ? '••••••' : value
  ]));
  const snapshot = encryptRunVariablesSnapshot({ projectVariables, environmentVariables, testDataVariables, secretNames: [...new Set(secretNames)], sources });
  await prisma.testRun.update({
    where: { id: run.id },
    data: {
      variablesSnapshot: snapshot,
      ...(run.dataCaseVariables === null ? {} : { dataCaseVariables: safeDataCaseVariables as object })
    }
  });
}

export async function enqueueTestRun(run: QueueableRun) {
  try {
    await prepareRunVariableSnapshot(run.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not prepare run variables.';
    await prisma.testRun.updateMany({
      where: { id: run.id, status: 'PENDING' },
      data: {
        status: 'FAILED',
        error: `Variable snapshot preparation failed: ${message}`.slice(0, 4000),
        durationMs: 0,
        finishedAt: new Date()
      }
    });
    throw error;
  }

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
