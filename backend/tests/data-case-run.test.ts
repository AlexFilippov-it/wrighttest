import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import redis from '../src/redis';
import { testQueue } from '../src/queue/queue';
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
