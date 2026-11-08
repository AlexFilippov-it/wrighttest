import type { Prisma, SuiteExecutionMode, SuiteRunStatus, Test } from '@prisma/client';
import prisma from '../prisma';
import { encryptRunVariablesSnapshot, decryptRunVariablesSnapshot, isProjectVariableEncryptionConfigured } from './project-variable-crypto';
import { buildDataCaseSnapshot, getTestDataCases } from '../utils/test-data';
import type { VariableEntry } from '../utils/variable-context';
import { enqueueTestRun } from '../queue/batch-sequencer';

const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;

export type SuiteOutputMapping = {
  sourceTestId: string;
  outputVariable: string;
  targetTestId: string;
  targetVariable: string;
  required: boolean;
  expectedType?: VariableEntry['type'];
};

export type SuiteExecutionConfig = {
  orderedTestIds: string[];
  mappings: SuiteOutputMapping[];
  dataCaseIndexes: Record<string, number>;
};

type SuiteLike = {
  id: string;
  name: string;
  projectId: string;
  testIds: unknown;
  executionMode: SuiteExecutionMode;
  executionConfig: unknown;
};

type StoredOutput = Pick<VariableEntry, 'name' | 'value' | 'type' | 'secret' | 'source' | 'createdByStep'>;
type SuiteOutputStore = Record<string, Record<string, StoredOutput>>;
type HandoffMetadata = Array<{
  sourceTestId: string;
  outputVariable: string;
  targetTestId: string;
  targetVariable: string;
  type: string;
  secret: boolean;
}>;

export function normalizeSuiteConfig(suite: Pick<SuiteLike, 'testIds' | 'executionConfig'>): SuiteExecutionConfig {
  const config = suite.executionConfig && typeof suite.executionConfig === 'object' && !Array.isArray(suite.executionConfig)
    ? suite.executionConfig as Partial<SuiteExecutionConfig>
    : {};
  const defaultOrder = Array.isArray(suite.testIds) ? suite.testIds.filter((id): id is string => typeof id === 'string') : [];
  return {
    orderedTestIds: Array.isArray(config.orderedTestIds) ? config.orderedTestIds : defaultOrder,
    mappings: Array.isArray(config.mappings) ? config.mappings : [],
    dataCaseIndexes: config.dataCaseIndexes && typeof config.dataCaseIndexes === 'object' ? config.dataCaseIndexes : {}
  };
}

function declaredOutputs(test: Pick<Test, 'steps'>) {
  const steps = Array.isArray(test.steps) ? test.steps as Array<Record<string, unknown>> : [];
  return new Set(steps.flatMap((step) => {
    const value = step.action === 'executeSql' || step.action === 'assertDatabaseResult'
      ? step.saveResultAs
      : step.action === 'generateData' || step.action === 'captureValue' ? step.saveAs : undefined;
    return typeof value === 'string' ? [value] : [];
  }));
}

export function validateSuiteConfiguration(input: {
  executionMode: SuiteExecutionMode;
  testIds: string[];
  config: SuiteExecutionConfig;
  tests: Array<Pick<Test, 'id' | 'steps' | 'testData'>>;
}) {
  const { executionMode, config, tests } = input;
  if (config.orderedTestIds.length === 0 || new Set(config.orderedTestIds).size !== config.orderedTestIds.length) {
    throw new Error('Suite must contain each selected check exactly once.');
  }
  if (config.orderedTestIds.length !== input.testIds.length || config.orderedTestIds.some((id) => !input.testIds.includes(id))) {
    throw new Error('Execution order must contain exactly the selected checks.');
  }
  for (const [testId, index] of Object.entries(config.dataCaseIndexes)) {
    const test = tests.find((entry) => entry.id === testId);
    if (!test || !Number.isInteger(index) || index < 0) throw new Error('A selected data case references an unavailable check.');
    const selected = getTestDataCases(test.testData)[index];
    if (!selected) throw new Error('Selected test data case was not found.');
    if (!selected.enabled) throw new Error('Selected test data case is disabled.');
  }
  for (const test of tests) {
    if (getTestDataCases(test.testData).length > 0 && config.dataCaseIndexes[test.id] === undefined) {
      throw new Error(`Choose an enabled Test Data case for check "${test.id}".`);
    }
  }
  if (executionMode === 'INDEPENDENT' && config.mappings.length > 0) {
    throw new Error('Variable mappings are only available in Sequential mode.');
  }
  const order = new Map(config.orderedTestIds.map((id, index) => [id, index]));
  const targetNames = new Set<string>();
  for (const mapping of config.mappings) {
    const sourceOrder = order.get(mapping.sourceTestId);
    const targetOrder = order.get(mapping.targetTestId);
    if (sourceOrder === undefined || targetOrder === undefined || sourceOrder >= targetOrder) {
      throw new Error('Each mapping must pass an output from an earlier selected check to a later selected check.');
    }
    if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(mapping.outputVariable) || !/^[A-Z][A-Z0-9_]{0,99}$/.test(mapping.targetVariable)) {
      throw new Error('Mapped variable names must use uppercase letters, digits, and underscores.');
    }
    const source = tests.find((test) => test.id === mapping.sourceTestId);
    if (!source || !declaredOutputs(source).has(mapping.outputVariable)) {
      throw new Error(`Output "${mapping.outputVariable}" is not produced by source check "${mapping.sourceTestId}".`);
    }
    const targetKey = `${mapping.targetTestId}:${mapping.targetVariable}`;
    if (targetNames.has(targetKey)) throw new Error(`Target variable "${mapping.targetVariable}" has more than one mapping.`);
    targetNames.add(targetKey);
  }
}

function safeSuiteRun(run: Record<string, unknown>) {
  const { outputSnapshot: _secret, ...safe } = run;
  return safe;
}

export async function createSuiteRun(suite: SuiteLike, options: {
  environmentId?: string;
  scheduleId?: string;
  triggeredBy?: string;
  dataCaseIndexes?: Record<string, number>;
}) {
  const config = normalizeSuiteConfig(suite);
  if (options.dataCaseIndexes) config.dataCaseIndexes = { ...config.dataCaseIndexes, ...options.dataCaseIndexes };
  const tests = await prisma.test.findMany({
    where: { id: { in: config.orderedTestIds }, projectId: suite.projectId },
    select: { id: true, steps: true, testData: true }
  });
  if (tests.length !== config.orderedTestIds.length) throw new Error('All suite checks must exist in the same project.');
  validateSuiteConfiguration({ executionMode: suite.executionMode, testIds: config.orderedTestIds, config, tests });

  const ids = suite.executionMode === 'SEQUENTIAL' ? config.orderedTestIds.slice(0, 1) : config.orderedTestIds;
  const created = await prisma.$transaction(async (tx) => {
    const suiteRun = await tx.suiteRun.create({
      data: {
        suiteId: suite.id,
        projectId: suite.projectId,
        suiteName: suite.name,
        environmentId: options.environmentId,
        scheduleId: options.scheduleId,
        triggeredBy: options.triggeredBy,
        executionMode: suite.executionMode,
        status: 'RUNNING',
        currentOrder: suite.executionMode === 'SEQUENTIAL' ? 0 : config.orderedTestIds.length - 1,
        configSnapshot: config as unknown as Prisma.InputJsonValue,
        startedAt: new Date()
      }
    });
    const created: Array<{ id: string; testId: string; suiteOrder: number }> = [];
    for (const testId of ids) {
      const order = config.orderedTestIds.indexOf(testId);
      const test = tests.find((entry) => entry.id === testId)!;
      const dataCaseIndex = config.dataCaseIndexes[testId];
      const dataCase = dataCaseIndex === undefined ? undefined : buildDataCaseSnapshot(test.testData, dataCaseIndex);
      const run = await tx.testRun.create({
        data: {
          testId,
          status: 'PENDING',
          environmentId: options.environmentId,
          scheduleId: options.scheduleId,
          suiteRunId: suiteRun.id,
          suiteOrder: order,
          ...(dataCase ? {
            dataCaseName: dataCase.dataCaseName,
            dataCaseIndex: dataCase.dataCaseIndex,
            dataCaseVariables: dataCase.dataCaseVariables as Prisma.InputJsonValue
          } : {})
        },
        select: { id: true }
      });
      created.push({ id: run.id, testId, suiteOrder: order });
    }
    return { suiteRun, created };
  });

  try {
    for (const run of created.created) await enqueueTestRun({ id: run.id, testId: run.testId, environmentId: options.environmentId });
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      await tx.testRun.updateMany({
        where: { suiteRunId: created.suiteRun.id, status: 'PENDING' },
        data: { status: 'FAILED', error: 'Suite queue submission failed.', finishedAt: new Date(), durationMs: 0 }
      });
      await tx.suiteRun.updateMany({
        where: { id: created.suiteRun.id, status: 'RUNNING' },
        data: { status: 'FAILED', error: 'Suite queue submission failed.', finishedAt: new Date(), outputSnapshot: null }
      });
    });
    throw error;
  }
  return { suiteRun: safeSuiteRun(created.suiteRun as unknown as Record<string, unknown>), runs: created.created };
}

export async function finalizeSuiteChild(tx: Prisma.TransactionClient, testRunId: string, status: 'PASSED' | 'FAILED', entries: VariableEntry[]) {
  const run = await tx.testRun.findUnique({ where: { id: testRunId }, select: { suiteRunId: true, suiteOrder: true } });
  if (!run?.suiteRunId || run.suiteOrder === null) return null;
  await tx.$queryRaw`SELECT "id" FROM "SuiteRun" WHERE "id" = ${run.suiteRunId} FOR UPDATE`;
  const suiteRun = await tx.suiteRun.findUnique({ where: { id: run.suiteRunId } });
  if (!suiteRun || suiteRun.status !== 'RUNNING') return null;
  const config = suiteRun.configSnapshot as unknown as SuiteExecutionConfig;
  const currentTestId = config.orderedTestIds[run.suiteOrder];
  if (!currentTestId) return null;

  if (suiteRun.executionMode === 'INDEPENDENT') {
    const children = await tx.testRun.findMany({ where: { suiteRunId: suiteRun.id }, select: { status: true } });
    const allTerminal = children.every((child) => child.status === 'PASSED' || child.status === 'FAILED');
    const anyFailed = children.some((child) => child.status === 'FAILED');
    if (allTerminal) await tx.suiteRun.update({ where: { id: suiteRun.id }, data: {
      status: anyFailed ? 'FAILED' : 'PASSED', finishedAt: new Date(),
      handoffExpiresAt: new Date(Date.now() + HANDOFF_TTL_MS)
    } });
    return null;
  }
  if (run.suiteOrder !== suiteRun.currentOrder) return null;

  let outputs: SuiteOutputStore = {};
  if (suiteRun.outputSnapshot) outputs = decryptRunVariablesSnapshot(suiteRun.outputSnapshot) as SuiteOutputStore;
  const metadata = Array.isArray(suiteRun.outputMetadata) ? suiteRun.outputMetadata as HandoffMetadata : [];
  if (status === 'PASSED') {
    const selectedOutputs = new Set(config.mappings.filter((mapping) => mapping.sourceTestId === currentTestId).map((mapping) => mapping.outputVariable));
    outputs[currentTestId] = Object.fromEntries(entries.filter((entry) => selectedOutputs.has(entry.name)).map((entry) => [entry.name, entry]));
  }

  const nextOrder = run.suiteOrder + 1;
  if (status === 'FAILED') {
    await tx.suiteRun.update({
      where: { id: suiteRun.id },
      data: { status: 'FAILED', error: 'Stopped because a check in the sequential suite failed.', finishedAt: new Date(), outputSnapshot: null, handoffExpiresAt: null }
    });
    return null;
  }
  if (nextOrder >= config.orderedTestIds.length) {
    await tx.suiteRun.update({
      where: { id: suiteRun.id },
      data: {
        status: 'PASSED', finishedAt: new Date(),
        outputSnapshot: encryptRunVariablesSnapshot(outputs),
        outputMetadata: metadata as unknown as Prisma.InputJsonValue,
        handoffExpiresAt: new Date(Date.now() + HANDOFF_TTL_MS)
      }
    });
    return null;
  }

  const targetTestId = config.orderedTestIds[nextOrder];
  const runInputs: Record<string, unknown> = {};
  const secretNames: string[] = [];
  for (const mapping of config.mappings.filter((item) => item.targetTestId === targetTestId)) {
    const output = outputs[mapping.sourceTestId]?.[mapping.outputVariable];
    if (!output) {
      if (mapping.required) {
        await tx.suiteRun.update({
          where: { id: suiteRun.id },
          data: { status: 'FAILED', error: `Required output "${mapping.outputVariable}" is missing for the next check.`, finishedAt: new Date(), outputSnapshot: null, handoffExpiresAt: null }
        });
        return null;
      }
      continue;
    }
    if (mapping.expectedType && mapping.expectedType !== output.type) {
      await tx.suiteRun.update({
        where: { id: suiteRun.id },
        data: { status: 'FAILED', error: `Output "${mapping.outputVariable}" has an incompatible type.`, finishedAt: new Date(), outputSnapshot: null, handoffExpiresAt: null }
      });
      return null;
    }
    runInputs[mapping.targetVariable] = output.value;
    if (output.secret && !isProjectVariableEncryptionConfigured()) {
      await tx.suiteRun.update({
        where: { id: suiteRun.id },
        data: { status: 'FAILED', error: 'Cannot hand off a secret output because server-side encryption is not configured.', finishedAt: new Date(), outputSnapshot: null, handoffExpiresAt: null }
      });
      return null;
    }
    if (output.secret) secretNames.push(mapping.targetVariable);
    metadata.push({ sourceTestId: mapping.sourceTestId, outputVariable: mapping.outputVariable, targetTestId, targetVariable: mapping.targetVariable, type: output.type, secret: output.secret });
  }

  const target = await tx.test.findFirst({ where: { id: targetTestId, projectId: suiteRun.projectId }, select: { id: true, testData: true } });
  if (!target) {
    await tx.suiteRun.update({ where: { id: suiteRun.id }, data: { status: 'FAILED', error: 'A configured check is no longer available in this project.', finishedAt: new Date(), outputSnapshot: null, handoffExpiresAt: null } });
    return null;
  }
  const dataCaseIndex = config.dataCaseIndexes[targetTestId];
  const dataCase = dataCaseIndex === undefined ? undefined : buildDataCaseSnapshot(target.testData, dataCaseIndex);
  const nextRun = await tx.testRun.create({
    data: {
      testId: targetTestId,
      status: 'PENDING',
      environmentId: suiteRun.environmentId,
      scheduleId: suiteRun.scheduleId,
      suiteRunId: suiteRun.id,
      suiteOrder: nextOrder,
      ...(dataCase ? {
        dataCaseName: dataCase.dataCaseName,
        dataCaseIndex: dataCase.dataCaseIndex,
        dataCaseVariables: dataCase.dataCaseVariables as Prisma.InputJsonValue
      } : {}),
      runInputsSnapshot: encryptRunVariablesSnapshot({ runInputs, secretNames })
    },
    select: { id: true, testId: true }
  });
  await tx.suiteRun.update({
    where: { id: suiteRun.id },
    data: {
      currentOrder: nextOrder,
      outputSnapshot: encryptRunVariablesSnapshot(outputs),
      outputMetadata: metadata as unknown as Prisma.InputJsonValue,
      handoffExpiresAt: new Date(Date.now() + HANDOFF_TTL_MS)
    }
  });
  return { ...nextRun, environmentId: suiteRun.environmentId };
}

export async function completeSuiteChild(testRunId: string, status: 'PASSED' | 'FAILED', entries: VariableEntry[], data: Prisma.TestRunUpdateInput) {
  const next = await prisma.$transaction(async (tx) => {
    const current = await tx.testRun.findUnique({ where: { id: testRunId }, select: { suiteRunId: true } });
    const run = await tx.testRun.update({ where: { id: testRunId }, data });
    const nextRun = await finalizeSuiteChild(tx, testRunId, status, entries);
    if (current?.suiteRunId) {
      const parent = await tx.suiteRun.findUnique({ where: { id: current.suiteRunId }, select: { status: true } });
      if (parent && ['FAILED', 'CANCELLED'].includes(parent.status)) {
        await tx.testRun.updateMany({ where: { suiteRunId: current.suiteRunId }, data: { variablesSnapshot: null, runInputsSnapshot: null } });
      }
    }
    return { run, nextRun };
  });
  if (next.nextRun) {
    try {
      await enqueueTestRun(next.nextRun);
    } catch {
      await prisma.$transaction(async (tx) => {
        const suiteRunId = next.run.suiteRunId;
        if (!suiteRunId) return;
        await tx.suiteRun.updateMany({
          where: { id: suiteRunId, status: 'RUNNING' },
          data: { status: 'FAILED', error: 'Could not queue the next configured check.', finishedAt: new Date(), outputSnapshot: null, handoffExpiresAt: null }
        });
        await tx.testRun.updateMany({ where: { suiteRunId }, data: { variablesSnapshot: null, runInputsSnapshot: null } });
      });
      throw new Error('Could not queue the next check in the Suite Run.');
    }
  }
  return next.run;
}

export async function cancelSuiteRun(id: string) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.suiteRun.updateMany({
      where: { id, status: { in: ['PENDING', 'RUNNING'] } },
      data: { status: 'CANCELLED', error: 'Cancelled by project user.', finishedAt: new Date(), outputSnapshot: null, handoffExpiresAt: null }
    });
    if (result.count > 0) await tx.testRun.updateMany({ where: { suiteRunId: id, status: 'PENDING' }, data: { status: 'FAILED', error: 'Not started because the Suite Run was cancelled.', finishedAt: new Date(), durationMs: 0, variablesSnapshot: null, runInputsSnapshot: null } });
    return result;
  });
}

export async function recoverSuiteRuns() {
  await expireSuiteHandoffs();
  const pending = await prisma.testRun.findMany({
    where: { suiteRunId: { not: null }, status: 'PENDING', suiteRun: { status: 'RUNNING' } },
    select: { id: true, testId: true, environmentId: true }
  });
  for (const run of pending) await enqueueTestRun(run);
}

export async function expireSuiteHandoffs() {
  const expired = await prisma.suiteRun.findMany({
    where: { handoffExpiresAt: { lt: new Date() } },
    select: { id: true, status: true }
  });
  for (const run of expired) {
    await prisma.$transaction(async (tx) => {
      if (run.status === 'RUNNING') {
        await tx.testRun.updateMany({
          where: { suiteRunId: run.id, status: 'PENDING' },
          data: { status: 'FAILED', error: 'Not started because the suite handoff expired.', finishedAt: new Date(), durationMs: 0, variablesSnapshot: null, runInputsSnapshot: null }
        });
        await tx.suiteRun.updateMany({
          where: { id: run.id, status: 'RUNNING', handoffExpiresAt: { lt: new Date() } },
          data: { status: 'FAILED', error: 'Sequential variable handoff expired before the suite finished.', finishedAt: new Date(), outputSnapshot: null, handoffExpiresAt: null }
        });
      } else {
        await tx.testRun.updateMany({ where: { suiteRunId: run.id }, data: { variablesSnapshot: null, runInputsSnapshot: null } });
        await tx.suiteRun.updateMany({ where: { id: run.id, handoffExpiresAt: { lt: new Date() } }, data: { outputSnapshot: null, handoffExpiresAt: null } });
      }
    });
  }
}

export async function getSafeSuiteRun(id: string) {
  const run = await prisma.suiteRun.findUnique({
    where: { id },
    select: {
      id: true, suiteId: true, projectId: true, suiteName: true, environmentId: true,
      triggeredBy: true, executionMode: true, status: true, configSnapshot: true,
      outputMetadata: true, currentOrder: true, error: true, startedAt: true,
      finishedAt: true, createdAt: true,
      testRuns: {
        orderBy: { suiteOrder: 'asc' },
        select: { id: true, testId: true, suiteOrder: true, status: true, startedAt: true, finishedAt: true, durationMs: true, error: true, dataCaseName: true, dataCaseIndex: true, currentStep: true, totalSteps: true, test: { select: { name: true } } }
      }
    }
  });
  if (!run) return null;
  const config = run.configSnapshot as unknown as SuiteExecutionConfig;
  const configuredTests = await prisma.test.findMany({
    where: { id: { in: config.orderedTestIds }, projectId: run.projectId },
    select: { id: true, name: true }
  });
  const testNames = new Map(configuredTests.map((test) => [test.id, test.name]));
  return {
    ...run,
    orderedChecks: config.orderedTestIds.map((testId, order) => ({
      testId,
      name: testNames.get(testId) ?? testId,
      order
    }))
  };
}
