import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import { databaseConnectionRoutes } from '../src/routes/database-connections';

async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => { req.user = { userId, email }; });
  await app.register(databaseConnectionRoutes);
  return app;
}

test('database connections enforce project roles and never expose credentials', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const previousKey = process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY;
  process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

  const owner = await prisma.user.create({ data: { email: `db-owner-${suffix}@example.com`, passwordHash: 'not-used' } });
  const viewer = await prisma.user.create({ data: { email: `db-viewer-${suffix}@example.com`, passwordHash: 'not-used' } });
  const outsider = await prisma.user.create({ data: { email: `db-outsider-${suffix}@example.com`, passwordHash: 'not-used' } });
  const project = await prisma.project.create({ data: { name: `Database routes ${suffix}` } });
  const otherProject = await prisma.project.create({ data: { name: `Other database routes ${suffix}` } });

  await prisma.projectMember.createMany({ data: [
    { projectId: project.id, userId: owner.id, email: owner.email, role: 'OWNER', status: 'ACTIVE' },
    { projectId: project.id, userId: viewer.id, email: viewer.email, role: 'VIEWER', status: 'ACTIVE' },
    { projectId: otherProject.id, userId: outsider.id, email: outsider.email, role: 'OWNER', status: 'ACTIVE' }
  ] });

  const ownerApp = await buildApp(owner.id, owner.email);
  const viewerApp = await buildApp(viewer.id, viewer.email);
  const outsiderApp = await buildApp(outsider.id, outsider.email);
  let connectionId: string | undefined;

  try {
    const createResponse = await ownerApp.inject({
      method: 'POST',
      url: `/projects/${project.id}/connections`,
      payload: {
        name: 'Integration metadata only', provider: 'POSTGRESQL', host: 'db.example.com', port: 5432,
        database: 'sample', username: 'tester', password: 'synthetic-password', ssl: true, accessMode: 'READ_ONLY'
      }
    });
    assert.equal(createResponse.statusCode, 201, createResponse.body);
    const created = createResponse.json() as { id: string; encryptedCredentials?: string; password?: string };
    connectionId = created.id;
    assert.equal(created.password, undefined);
    assert.equal(created.encryptedCredentials, undefined);

    const encryptedBefore = (await prisma.databaseConnection.findUniqueOrThrow({ where: { id: connectionId } })).encryptedCredentials;
    const updateResponse = await ownerApp.inject({ method: 'PATCH', url: `/connections/${connectionId}`, payload: { name: 'Renamed, password kept', password: '' } });
    assert.equal(updateResponse.statusCode, 200);
    assert.equal((await prisma.databaseConnection.findUniqueOrThrow({ where: { id: connectionId } })).encryptedCredentials, encryptedBefore);

    const viewerList = await viewerApp.inject({ method: 'GET', url: `/projects/${project.id}/connections` });
    assert.equal(viewerList.statusCode, 200);
    assert.equal(JSON.stringify(viewerList.json()).includes('synthetic-password'), false);
    assert.equal(JSON.stringify(viewerList.json()).includes('encryptedCredentials'), false);

    const viewerCreate = await viewerApp.inject({
      method: 'POST', url: `/projects/${project.id}/connections`,
      payload: { name: 'Forbidden', provider: 'POSTGRESQL', host: 'db.example.com', port: 5432, database: 'sample', username: 'tester', password: 'x' }
    });
    assert.equal(viewerCreate.statusCode, 403);

    const outsiderRead = await outsiderApp.inject({ method: 'GET', url: `/connections/${connectionId}` });
    assert.equal(outsiderRead.statusCode, 403);

    const check = await prisma.test.create({
      data: { name: 'Uses database connection', url: 'https://example.com', projectId: project.id, steps: [{ action: 'executeSql', databaseConnectionId: connectionId, sql: 'SELECT 1' }] }
    });
    const deleteInUse = await ownerApp.inject({ method: 'DELETE', url: `/connections/${connectionId}` });
    assert.equal(deleteInUse.statusCode, 409);
    await prisma.test.delete({ where: { id: check.id } });

    const deleteResponse = await ownerApp.inject({ method: 'DELETE', url: `/connections/${connectionId}` });
    assert.equal(deleteResponse.statusCode, 204);
    connectionId = undefined;
  } finally {
    await ownerApp.close();
    await viewerApp.close();
    await outsiderApp.close();
    if (connectionId) await prisma.databaseConnection.delete({ where: { id: connectionId } }).catch(() => undefined);
    await prisma.project.deleteMany({ where: { id: { in: [project.id, otherProject.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, viewer.id, outsider.id] } } });
    if (previousKey === undefined) delete process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});
