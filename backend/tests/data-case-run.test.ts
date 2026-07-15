import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { testQueue } from '../src/queue/queue';
import {
  buildTestRunJobId,
  getTestWorkerConcurrency,
  updateBatchAfterRun
} from '../src/queue/batch-sequencer';
import { runRoutes } from '../src/routes/runs';
import { suiteRoutes } from '../src/routes/suites';
import { DATA_DRIVEN_CASE_REQUIRED_ERROR } from '../src/utils/test-data';
import { mergeRuntimeVariables } from '../src/utils/runtime-variables';

async function buildApp(userId: string, email: string) {
  const app = Fastify();

  app.addHook('preHandler', async (req) => {
    req.user = { userId, email };
  });

  await app.register(runRoutes);
  await app.register(suiteRoutes);
  return app;
}

async function createProjectAccess() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `data-case-run-${suffix}@example.com`,
      passwordHash: 'not-used'
    }
  });

  const project = await prisma.project.create({
    data: { name: `Data case run ${suffix}` }
  });

  await prisma.projectMember.create({
    data: {
      projectId: project.id,
      userId: user.id,
      email: user.email,
      role: 'OWNER',
      status: 'ACTIVE'
    }
  });

  return { user, project };
}

async function cleanup(projectId: string, userId: string) {
  await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
}

function dataCases() {
  return [
    {
      name: 'Invalid email',
      enabled: true,
      variables: {
        EMAIL: 'wrong-email',
        PASSWORD: 'Password123'
      }
    },
    {
      name: 'Disabled case',
      enabled: false,
      variables: {
        EMAIL: 'disabled@example.com'
      }
    }
  ];
}

test('manual run API validates dataCaseIndex and stores selected case snapshot', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email);

  try {
    const ordinaryTest = await prisma.test.create({
      data: {
        name: 'Ordinary check',
        url: 'https://example.com',
        projectId: project.id,
        steps: [{ action: 'goto', value: 'https://example.com' }]
      }
    });

    const ordinaryRunResponse = await app.inject({
      method: 'POST',
      url: `/tests/${ordinaryTest.id}/run`,
      payload: {}
    });
    assert.equal(ordinaryRunResponse.statusCode, 202);
    const ordinaryRun = await prisma.testRun.findUnique({
      where: { id: ordinaryRunResponse.json().testRunId }
    });
    assert.equal(ordinaryRun?.dataCaseName, null);
    assert.equal(ordinaryRun?.dataCaseIndex, null);
    assert.equal(ordinaryRun?.dataCaseVariables, null);

    const ordinaryWithCaseResponse = await app.inject({
      method: 'POST',
      url: `/tests/${ordinaryTest.id}/run`,
      payload: { dataCaseIndex: 0 }
    });
    assert.equal(ordinaryWithCaseResponse.statusCode, 400);
    assert.match(ordinaryWithCaseResponse.json().error, /does not have test data/);

    const dataDrivenTest = await prisma.test.create({
      data: {
        name: 'Data-driven check',
        url: 'https://example.com',
        projectId: project.id,
        steps: [{ action: 'fill', selector: "page.getByLabel('Email')", value: '{{EMAIL}}' }],
        testData: dataCases()
      }
    });

    const missingCaseResponse = await app.inject({
      method: 'POST',
      url: `/tests/${dataDrivenTest.id}/run`,
      payload: {}
    });
    assert.equal(missingCaseResponse.statusCode, 400);
    assert.match(missingCaseResponse.json().error, /Select a test data case/);

    for (const dataCaseIndex of [-1, 1.5, 99]) {
      const response = await app.inject({
        method: 'POST',
        url: `/tests/${dataDrivenTest.id}/run`,
        payload: { dataCaseIndex }
      });
      assert.equal(response.statusCode, 400);
    }

    const disabledResponse = await app.inject({
      method: 'POST',
      url: `/tests/${dataDrivenTest.id}/run`,
      payload: { dataCaseIndex: 1 }
    });
    assert.equal(disabledResponse.statusCode, 400);
    assert.match(disabledResponse.json().error, /disabled/);

    const enabledResponse = await app.inject({
      method: 'POST',
      url: `/tests/${dataDrivenTest.id}/run`,
      payload: { dataCaseIndex: 0 }
    });
    assert.equal(enabledResponse.statusCode, 202);
    const enabledRun = await prisma.testRun.findUnique({
      where: { id: enabledResponse.json().testRunId }
    });
    assert.equal(enabledRun?.dataCaseName, 'Invalid email');
    assert.equal(enabledRun?.dataCaseIndex, 0);
    assert.deepEqual(enabledRun?.dataCaseVariables, {
      EMAIL: 'wrong-email',
      PASSWORD: 'Password123'
    });

    await prisma.test.update({
      where: { id: dataDrivenTest.id },
      data: {
        testData: [{
          name: 'Changed after run',
          enabled: true,
          variables: { EMAIL: 'changed@example.com' }
        }]
      }
    });

    const snapshotAfterEdit = await prisma.testRun.findUnique({
      where: { id: enabledResponse.json().testRunId }
    });
    assert.equal(snapshotAfterEdit?.dataCaseName, 'Invalid email');
    assert.deepEqual(snapshotAfterEdit?.dataCaseVariables, {
      EMAIL: 'wrong-email',
      PASSWORD: 'Password123'
    });
  } finally {
    await app.close();
    await cleanup(project.id, user.id);
    await testQueue.drain().catch(() => undefined);
  }
});

test('runtime variable merge keeps environment-only values and lets case values override environment', () => {
  const runtimeVariables = mergeRuntimeVariables(
    {
      BASE_URL: 'https://example.com',
      EMAIL: 'default@example.com'
    },
    {
      EMAIL: 'wrong-email',
      PASSWORD: 'Password123'
    }
  );

  assert.deepEqual(runtimeVariables, {
    BASE_URL: 'https://example.com',
    EMAIL: 'wrong-email',
    PASSWORD: 'Password123'
  });
});

test('run all enabled cases queues separate runs in case order and skips disabled cases', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email);

  try {
    await testQueue.drain();
    await testQueue.pause();

    const environment = await prisma.environment.create({
      data: {
        name: 'DEV',
        projectId: project.id,
        variables: {
          BASE_URL: 'https://example.com',
          EMAIL: 'environment@example.com'
        }
      }
    });

    const ordinaryTest = await prisma.test.create({
      data: {
        name: 'Ordinary check',
        url: 'https://example.com',
        projectId: project.id,
        steps: []
      }
    });

    const noDataResponse = await app.inject({
      method: 'POST',
      url: `/tests/${ordinaryTest.id}/runs/all-cases`,
      payload: {}
    });
    assert.equal(noDataResponse.statusCode, 400);
    assert.match(noDataResponse.json().error, /does not have test data/);

    const noEnabledTest = await prisma.test.create({
      data: {
        name: 'No enabled cases',
        url: 'https://example.com',
        projectId: project.id,
        steps: [],
        testData: [
          {
            name: 'Disabled only',
            enabled: false,
            variables: { EMAIL: 'disabled@example.com' }
          }
        ]
      }
    });

    const noEnabledResponse = await app.inject({
      method: 'POST',
      url: `/tests/${noEnabledTest.id}/runs/all-cases`,
      payload: {}
    });
    assert.equal(noEnabledResponse.statusCode, 400);
    assert.match(noEnabledResponse.json().error, /enabled test data cases/);

    const dataDrivenTest = await prisma.test.create({
      data: {
        name: 'Data-driven all cases check',
        url: '{{BASE_URL}}/login',
        projectId: project.id,
        steps: [
          { action: 'fill', selector: "page.getByLabel('Email')", value: '{{EMAIL}}' },
          { action: 'fill', selector: "page.getByLabel('Password')", value: '{{PASSWORD}}' },
          { action: 'assertText', selector: "page.getByRole('alert')", expected: '{{EXPECTED_MESSAGE}}' }
        ],
        testData: [
          {
            name: 'Invalid email',
            enabled: true,
            variables: {
              EMAIL: 'invalid-email',
              PASSWORD: 'Password123',
              EXPECTED_MESSAGE: 'Invalid email'
            }
          },
          {
            name: 'Disabled case',
            enabled: false,
            variables: {
              EMAIL: 'disabled@example.com',
              PASSWORD: 'Password123',
              EXPECTED_MESSAGE: 'Should not run'
            }
          },
          {
            name: 'Wrong password',
            enabled: true,
            variables: {
              EMAIL: 'user@example.com',
              PASSWORD: 'wrong-password',
              EXPECTED_MESSAGE: 'Wrong password'
            }
          }
        ]
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: `/tests/${dataDrivenTest.id}/runs/all-cases`,
      payload: { environmentId: environment.id }
    });

    assert.equal(response.statusCode, 202);
    const payload = response.json();
    assert.ok(payload.batchId);
    assert.equal(payload.totalCases, 2);
    assert.equal(payload.queued, 2);
    assert.deepEqual(
      payload.runs.map((run: { dataCaseName: string; dataCaseIndex: number }) => ({
        dataCaseName: run.dataCaseName,
        dataCaseIndex: run.dataCaseIndex
      })),
      [
        { dataCaseName: 'Invalid email', dataCaseIndex: 0 },
        { dataCaseName: 'Wrong password', dataCaseIndex: 2 }
      ]
    );
    assert.deepEqual(
      payload.runs.map((run: { batchOrder: number }) => run.batchOrder),
      [0, 1]
    );

    const batch = await prisma.testRunBatch.findUnique({
      where: { id: payload.batchId }
    });
    assert.equal(batch?.testId, dataDrivenTest.id);
    assert.equal(batch?.environmentId, environment.id);
    assert.equal(batch?.status, 'PENDING');
    assert.equal(batch?.totalCases, 2);
    assert.equal(batch?.completedCases, 0);

    const createdRuns = await Promise.all(
      payload.runs.map((run: { id: string }) =>
        prisma.testRun.findUnique({ where: { id: run.id } })
      )
    );

    assert.equal(createdRuns.length, 2);
    assert.ok(createdRuns[0]);
    assert.ok(createdRuns[1]);
    assert.deepEqual(createdRuns.map((run) => run?.dataCaseName), ['Invalid email', 'Wrong password']);
    assert.deepEqual(createdRuns.map((run) => run?.dataCaseIndex), [0, 2]);
    assert.deepEqual(createdRuns.map((run) => run?.batchId), [payload.batchId, payload.batchId]);
    assert.deepEqual(createdRuns.map((run) => run?.batchOrder), [0, 1]);
    assert.deepEqual(createdRuns.map((run) => run?.environmentId), [environment.id, environment.id]);
    assert.deepEqual(createdRuns[0]?.dataCaseVariables, {
      EMAIL: 'invalid-email',
      PASSWORD: 'Password123',
      EXPECTED_MESSAGE: 'Invalid email'
    });
    assert.deepEqual(createdRuns[1]?.dataCaseVariables, {
      EMAIL: 'user@example.com',
      PASSWORD: 'wrong-password',
      EXPECTED_MESSAGE: 'Wrong password'
    });

    const firstJob = await testQueue.getJob(buildTestRunJobId(payload.runs[0].id));
    const secondJob = await testQueue.getJob(buildTestRunJobId(payload.runs[1].id));
    assert.equal(firstJob?.data.testRunId, payload.runs[0].id);
    assert.equal(secondJob, undefined);
  } finally {
    await testQueue.resume().catch(() => undefined);
    await app.close();
    await cleanup(project.id, user.id);
    await testQueue.drain().catch(() => undefined);
  }
});

test('batch sequencer queues cases sequentially and updates counters after pass and failure', async () => {
  const { user, project } = await createProjectAccess();

  try {
    await testQueue.drain();
    await testQueue.pause();

    const dataDrivenTest = await prisma.test.create({
      data: {
        name: 'Sequenced data-driven check',
        url: 'https://example.com',
        projectId: project.id,
        steps: [],
        testData: dataCases()
      }
    });

    const failedBatch = await prisma.testRunBatch.create({
      data: {
        testId: dataDrivenTest.id,
        totalCases: 3,
        status: 'RUNNING'
      }
    });

    const failedBatchRuns = await Promise.all(
      ['First case', 'Second case', 'Third case'].map((dataCaseName, batchOrder) =>
        prisma.testRun.create({
          data: {
            testId: dataDrivenTest.id,
            status: 'PENDING',
            batchId: failedBatch.id,
            batchOrder,
            dataCaseName,
            dataCaseIndex: batchOrder,
            dataCaseVariables: { CASE: dataCaseName }
          }
        })
      )
    );

    await prisma.testRun.update({
      where: { id: failedBatchRuns[0].id },
      data: { status: 'PASSED', finishedAt: new Date() }
    });
    await updateBatchAfterRun(failedBatchRuns[0].id);

    let batch = await prisma.testRunBatch.findUnique({ where: { id: failedBatch.id } });
    assert.equal(batch?.status, 'RUNNING');
    assert.equal(batch?.completedCases, 1);
    assert.equal(batch?.passedCases, 1);
    assert.equal(batch?.failedCases, 0);
    assert.ok(await testQueue.getJob(buildTestRunJobId(failedBatchRuns[1].id)));
    assert.equal(await testQueue.getJob(buildTestRunJobId(failedBatchRuns[2].id)), undefined);

    await prisma.testRun.update({
      where: { id: failedBatchRuns[1].id },
      data: { status: 'FAILED', finishedAt: new Date(), error: 'Expected failure' }
    });
    await updateBatchAfterRun(failedBatchRuns[1].id);

    batch = await prisma.testRunBatch.findUnique({ where: { id: failedBatch.id } });
    assert.equal(batch?.status, 'RUNNING');
    assert.equal(batch?.completedCases, 2);
    assert.equal(batch?.passedCases, 1);
    assert.equal(batch?.failedCases, 1);
    assert.ok(await testQueue.getJob(buildTestRunJobId(failedBatchRuns[2].id)));

    await prisma.testRun.update({
      where: { id: failedBatchRuns[2].id },
      data: { status: 'PASSED', finishedAt: new Date() }
    });
    await updateBatchAfterRun(failedBatchRuns[2].id);

    batch = await prisma.testRunBatch.findUnique({ where: { id: failedBatch.id } });
    assert.equal(batch?.status, 'FAILED');
    assert.equal(batch?.completedCases, 3);
    assert.equal(batch?.passedCases, 2);
    assert.equal(batch?.failedCases, 1);
    assert.ok(batch?.finishedAt);

    const passedBatch = await prisma.testRunBatch.create({
      data: {
        testId: dataDrivenTest.id,
        totalCases: 2,
        status: 'RUNNING'
      }
    });
    const passedBatchRuns = await Promise.all(
      [0, 1].map((batchOrder) =>
        prisma.testRun.create({
          data: {
            testId: dataDrivenTest.id,
            status: 'PENDING',
            batchId: passedBatch.id,
            batchOrder,
            dataCaseName: `Passing case ${batchOrder + 1}`,
            dataCaseIndex: batchOrder,
            dataCaseVariables: {}
          }
        })
      )
    );

    for (const run of passedBatchRuns) {
      await prisma.testRun.update({
        where: { id: run.id },
        data: { status: 'PASSED', finishedAt: new Date() }
      });
      await updateBatchAfterRun(run.id);
    }

    const finalPassedBatch = await prisma.testRunBatch.findUnique({
      where: { id: passedBatch.id }
    });
    assert.equal(finalPassedBatch?.status, 'PASSED');
    assert.equal(finalPassedBatch?.completedCases, 2);
    assert.equal(finalPassedBatch?.passedCases, 2);
    assert.equal(finalPassedBatch?.failedCases, 0);
  } finally {
    await testQueue.resume().catch(() => undefined);
    await cleanup(project.id, user.id);
    await testQueue.drain().catch(() => undefined);
  }
});

test('ordinary run is not batched and worker concurrency is not globally serial', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email);

  try {
    await testQueue.drain();
    await testQueue.pause();

    const ordinaryTest = await prisma.test.create({
      data: {
        name: 'Independent ordinary check',
        url: 'https://example.com',
        projectId: project.id,
        steps: []
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: `/tests/${ordinaryTest.id}/run`,
      payload: {}
    });

    assert.equal(response.statusCode, 202);
    const run = await prisma.testRun.findUnique({
      where: { id: response.json().testRunId }
    });
    assert.equal(run?.batchId, null);
    assert.equal(run?.batchOrder, null);
    assert.ok(await testQueue.getJob(buildTestRunJobId(response.json().testRunId)));
    assert.ok(getTestWorkerConcurrency() > 1);
  } finally {
    await testQueue.resume().catch(() => undefined);
    await app.close();
    await cleanup(project.id, user.id);
    await testQueue.drain().catch(() => undefined);
  }
});

test('run batch detail API enforces access and returns ordered runs without data case variables', async () => {
  const { user, project } = await createProjectAccess();
  const viewer = await prisma.user.create({
    data: {
      email: `data-case-viewer-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
      passwordHash: 'not-used'
    }
  });
  const outsider = await prisma.user.create({
    data: {
      email: `data-case-outsider-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
      passwordHash: 'not-used'
    }
  });
  await prisma.projectMember.create({
    data: {
      projectId: project.id,
      userId: viewer.id,
      email: viewer.email,
      role: 'VIEWER',
      status: 'ACTIVE'
    }
  });

  const ownerApp = await buildApp(user.id, user.email);
  const viewerApp = await buildApp(viewer.id, viewer.email);
  const outsiderApp = await buildApp(outsider.id, outsider.email);

  try {
    const environment = await prisma.environment.create({
      data: {
        name: 'Staging',
        projectId: project.id,
        variables: {}
      }
    });
    const dataDrivenTest = await prisma.test.create({
      data: {
        name: 'Batch detail check',
        url: 'https://example.com',
        projectId: project.id,
        steps: [],
        testData: dataCases()
      }
    });
    const batch = await prisma.testRunBatch.create({
      data: {
        testId: dataDrivenTest.id,
        environmentId: environment.id,
        status: 'FAILED',
        totalCases: 2,
        completedCases: 2,
        passedCases: 1,
        failedCases: 1,
        finishedAt: new Date()
      }
    });

    const secondRun = await prisma.testRun.create({
      data: {
        testId: dataDrivenTest.id,
        status: 'FAILED',
        batchId: batch.id,
        batchOrder: 1,
        dataCaseName: 'Second case',
        dataCaseIndex: 2,
        dataCaseVariables: { SECRET: 'do-not-return' },
        durationMs: 1200,
        error: 'Expected text was not found',
        currentStep: 2,
        totalSteps: 3,
        finishedAt: new Date()
      }
    });
    const firstRun = await prisma.testRun.create({
      data: {
        testId: dataDrivenTest.id,
        status: 'PASSED',
        batchId: batch.id,
        batchOrder: 0,
        dataCaseName: 'First case',
        dataCaseIndex: 0,
        dataCaseVariables: { SECRET: 'also-do-not-return' },
        durationMs: 800,
        currentStep: 3,
        totalSteps: 3,
        finishedAt: new Date()
      }
    });

    const missingResponse = await ownerApp.inject({
      method: 'GET',
      url: '/run-batches/missing-batch'
    });
    assert.equal(missingResponse.statusCode, 404);

    const outsiderResponse = await outsiderApp.inject({
      method: 'GET',
      url: `/run-batches/${batch.id}`
    });
    assert.equal(outsiderResponse.statusCode, 403);

    for (const app of [ownerApp, viewerApp]) {
      const response = await app.inject({
        method: 'GET',
        url: `/run-batches/${batch.id}`
      });
      assert.equal(response.statusCode, 200);
      const payload = response.json();
      assert.equal(payload.id, batch.id);
      assert.equal(payload.status, 'FAILED');
      assert.equal(payload.totalCases, 2);
      assert.equal(payload.completedCases, 2);
      assert.equal(payload.passedCases, 1);
      assert.equal(payload.failedCases, 1);
      assert.deepEqual(payload.test, {
        id: dataDrivenTest.id,
        name: 'Batch detail check',
        projectId: project.id
      });
      assert.deepEqual(payload.environment, {
        id: environment.id,
        name: 'Staging'
      });
      assert.deepEqual(payload.runs.map((run: { id: string }) => run.id), [firstRun.id, secondRun.id]);
      assert.equal('dataCaseVariables' in payload.runs[0], false);
      assert.equal('dataCaseVariables' in payload.runs[1], false);
    }
  } finally {
    await ownerApp.close();
    await viewerApp.close();
    await outsiderApp.close();
    await cleanup(project.id, user.id);
    await prisma.user.delete({ where: { id: viewer.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: outsider.id } }).catch(() => undefined);
  }
});

test('suite run marks data-driven tests as failed without explicit selected case', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email);

  try {
    const dataDrivenTest = await prisma.test.create({
      data: {
        name: 'Data-driven suite check',
        url: 'https://example.com',
        projectId: project.id,
        steps: [],
        testData: dataCases()
      }
    });
    const suite = await prisma.suite.create({
      data: {
        name: 'Suite with data-driven check',
        projectId: project.id,
        testIds: [dataDrivenTest.id]
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: `/suites/${suite.id}/run`,
      payload: {}
    });

    assert.equal(response.statusCode, 202);
    const run = await prisma.testRun.findFirst({
      where: { testId: dataDrivenTest.id },
      orderBy: { startedAt: 'desc' }
    });
    assert.equal(run?.status, 'FAILED');
    assert.equal(run?.error, DATA_DRIVEN_CASE_REQUIRED_ERROR);
  } finally {
    await app.close();
    await cleanup(project.id, user.id);
    await testQueue.drain().catch(() => undefined);
    await testQueue.close().catch(() => undefined);
    redis.disconnect();
    await prisma.$disconnect().catch(() => undefined);
  }
});
