import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import { testRoutes } from '../src/routes/tests';

type TestDataCase = {
  name: string;
  enabled: boolean;
  variables: Record<string, string>;
};

async function buildApp(userId: string, email: string) {
  const app = Fastify();

  app.addHook('preHandler', async (req) => {
    req.user = { userId, email };
  });

  await app.register(testRoutes);
  return app;
}

async function createProjectAccess() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `test-data-${suffix}@example.com`,
      passwordHash: 'not-used'
    }
  });

  const project = await prisma.project.create({
    data: { name: `Test data ${suffix}` }
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

function basePayload(extra: Record<string, unknown> = {}) {
  return {
    name: 'Login check',
    url: 'https://example.com/login',
    steps: [
      { action: 'goto', value: 'https://example.com/login' }
    ],
    ...extra
  };
}

function validTestData(): TestDataCase[] {
  return [
    {
      name: 'Invalid email',
      enabled: true,
      variables: {
        EMAIL: 'wrong-email',
        PASSWORD: 'Password123',
        EXPECTED_MESSAGE: 'Enter a valid email'
      }
    },
    {
      name: 'Short password',
      enabled: false,
      variables: {
        EMAIL: 'user@example.com',
        PASSWORD: '123',
        EXPECTED_MESSAGE: 'Password is too short'
      }
    }
  ];
}

test('creates a test without testData and returns an empty array', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email);

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/tests`,
      payload: basePayload()
    });

    assert.equal(response.statusCode, 201);
    const payload = response.json() as { id: string; testData: unknown };
    assert.deepEqual(payload.testData, []);
  } finally {
    await app.close();
    await cleanup(project.id, user.id);
  }
});

test('creates a test with valid testData and returns it from list/detail APIs', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email);

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/tests`,
      payload: basePayload({
        testData: validTestData()
      })
    });

    assert.equal(response.statusCode, 201);
    const created = response.json() as { id: string; testData: TestDataCase[] };
    assert.deepEqual(created.testData, validTestData());
    assert.equal(created.testData[1].enabled, false);

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/tests/${created.id}`
    });
    assert.equal(detailResponse.statusCode, 200);
    assert.deepEqual((detailResponse.json() as { testData: TestDataCase[] }).testData, validTestData());

    const listResponse = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}/tests`
    });
    assert.equal(listResponse.statusCode, 200);
    const listed = listResponse.json() as Array<{ id: string; testData: TestDataCase[] }>;
    assert.deepEqual(listed.find((item) => item.id === created.id)?.testData, validTestData());
  } finally {
    await app.close();
    await cleanup(project.id, user.id);
  }
});

test('updates testData on an existing test', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email);

  try {
    const testRecord = await prisma.test.create({
      data: {
        name: 'Login check',
        url: 'https://example.com/login',
        projectId: project.id,
        steps: []
      }
    });

    const nextData = validTestData();
    const response = await app.inject({
      method: 'PATCH',
      url: `/tests/${testRecord.id}`,
      payload: {
        testData: nextData
      }
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual((response.json() as { testData: TestDataCase[] }).testData, nextData);
  } finally {
    await app.close();
    await cleanup(project.id, user.id);
  }
});

test('rejects empty case names', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email);

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/tests`,
      payload: basePayload({
        testData: [{ name: '   ', enabled: true, variables: { EMAIL: 'user@example.com' } }]
      })
    });

    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
    await cleanup(project.id, user.id);
  }
});

test('rejects invalid variable keys', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email);

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/tests`,
      payload: basePayload({
        testData: [{ name: 'Invalid key', enabled: true, variables: { email: 'user@example.com' } }]
      })
    });

    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
    await cleanup(project.id, user.id);
  }
});

test('rejects duplicate case names after trim', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email);

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/tests`,
      payload: basePayload({
        testData: [
          { name: 'Duplicate', enabled: true, variables: { EMAIL: 'one@example.com' } },
          { name: ' Duplicate ', enabled: true, variables: { EMAIL: 'two@example.com' } }
        ]
      })
    });

    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
    await cleanup(project.id, user.id);
  }
});

test('rejects more than 100 cases', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email);

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/tests`,
      payload: basePayload({
        testData: Array.from({ length: 101 }, (_, index) => ({
          name: `Case ${index + 1}`,
          enabled: true,
          variables: { EMAIL: `user${index}@example.com` }
        }))
      })
    });

    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
    await cleanup(project.id, user.id);
  }
});

test('preserves leading and trailing spaces in variable values', async () => {
  const { user, project } = await createProjectAccess();
  const app = await buildApp(user.id, user.email);

  try {
    const response = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/tests`,
      payload: basePayload({
        testData: [
          {
            name: 'Whitespace value',
            enabled: true,
            variables: {
              MESSAGE: '  keep spaces  '
            }
          }
        ]
      })
    });

    assert.equal(response.statusCode, 201);
    const payload = response.json() as { testData: TestDataCase[] };
    assert.equal(payload.testData[0].variables.MESSAGE, '  keep spaces  ');
  } finally {
    await app.close();
    await cleanup(project.id, user.id);
  }
});
