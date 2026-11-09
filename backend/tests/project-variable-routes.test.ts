import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import { projectVariableRoutes } from '../src/routes/project-variables';
import { decryptProjectVariableValue } from '../src/services/project-variable-crypto';

async function buildApp(userId: string, email: string) {
  const app = Fastify();
  app.addHook('preHandler', async (request) => { request.user = { userId, email }; });
  await app.register(projectVariableRoutes);
  return app;
}

test('project variables encrypt secrets, hide them from every API role, and enforce Owner-only secret writes', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const previousKey = process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY;
  process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  const users = await Promise.all(['owner', 'editor', 'viewer'].map((role) => prisma.user.create({ data: { email: `variables-${role}-${suffix}@example.com`, passwordHash: 'not-used' } })));
  const project = await prisma.project.create({ data: { name: `Variables ${suffix}` } });
  await prisma.projectMember.createMany({ data: users.map((user, index) => ({
    projectId: project.id, userId: user.id, email: user.email, role: ['OWNER', 'EDITOR', 'VIEWER'][index] as 'OWNER' | 'EDITOR' | 'VIEWER', status: 'ACTIVE'
  })) });
  const apps = users.map((user) => buildApp(user.id, user.email));
  const [owner, editor, viewer] = await Promise.all(apps);

  try {
    const plain = await owner.inject({ method: 'POST', url: `/projects/${project.id}/variables`, payload: { name: 'BASE_URL', type: 'string', value: 'https://example.test', secret: false, description: 'Target' } });
    assert.equal(plain.statusCode, 201, plain.body);
    const secret = await owner.inject({ method: 'POST', url: `/projects/${project.id}/variables`, payload: { name: 'API_TOKEN', type: 'string', value: 'synthetic-secret-token', secret: true } });
    assert.equal(secret.statusCode, 201, secret.body);
    assert.equal(JSON.stringify(secret.json()).includes('synthetic-secret-token'), false);
    const created = secret.json() as { id: string; value?: unknown };
    assert.equal(created.value, undefined);
    const stored = await prisma.projectVariable.findUniqueOrThrow({ where: { id: created.id } });
    assert.notEqual(stored.value, 'synthetic-secret-token');
    assert.equal(decryptProjectVariableValue(stored.value), 'synthetic-secret-token');

    const ownerList = await owner.inject({ method: 'GET', url: `/projects/${project.id}/variables` });
    assert.equal(ownerList.statusCode, 200);
    assert.equal(JSON.stringify(ownerList.json()).includes('synthetic-secret-token'), false);
    assert.equal(JSON.stringify(ownerList.json()).includes('encrypted'), false);
    const viewerList = await viewer.inject({ method: 'GET', url: `/projects/${project.id}/variables` });
    assert.equal(viewerList.statusCode, 200);
    assert.equal(JSON.stringify(viewerList.json()).includes('https://example.test'), false);
    assert.equal(JSON.stringify(viewerList.json()).includes('synthetic-secret-token'), false);

    const editorCreateSecret = await editor.inject({ method: 'POST', url: `/projects/${project.id}/variables`, payload: { name: 'EDITOR_SECRET', type: 'string', value: 'x', secret: true } });
    assert.equal(editorCreateSecret.statusCode, 403);
    const editorUpdateSecret = await editor.inject({ method: 'PATCH', url: `/variables/${created.id}`, payload: { value: 'replacement' } });
    assert.equal(editorUpdateSecret.statusCode, 403);
    const editorDeleteSecret = await editor.inject({ method: 'DELETE', url: `/variables/${created.id}` });
    assert.equal(editorDeleteSecret.statusCode, 403);
    const viewerWrite = await viewer.inject({ method: 'POST', url: `/projects/${project.id}/variables`, payload: { name: 'FORBIDDEN', type: 'string', value: 'x' } });
    assert.equal(viewerWrite.statusCode, 403);
    const duplicate = await owner.inject({ method: 'POST', url: `/projects/${project.id}/variables`, payload: { name: 'BASE_URL', type: 'string', value: 'https://duplicate.test' } });
    assert.equal(duplicate.statusCode, 409);
  } finally {
    await Promise.all([owner.close(), editor.close(), viewer.close()]);
    await prisma.project.delete({ where: { id: project.id } });
    await Promise.all(users.map((user) => prisma.user.delete({ where: { id: user.id } })));
    if (previousKey === undefined) delete process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});
