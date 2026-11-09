import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import prisma from '../src/prisma';
import { exportRoutes } from '../src/routes/export';

const importableSpec = `import { test } from '@playwright/test';
test('imported check', async ({ page }) => {
  await page.goto('https://example.test');
});`;

test('check import enforces project membership and editor-level write permission', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const users = await Promise.all(['owner', 'editor', 'viewer', 'outsider'].map((role) =>
    prisma.user.create({ data: { email: `rbac-import-${role}-${suffix}@example.test`, passwordHash: 'not-used' } })
  ));
  const [owner, editor, viewer, outsider] = users;
  const projectA = await prisma.project.create({ data: { name: `RBAC import A ${suffix}` } });
  const projectB = await prisma.project.create({ data: { name: `RBAC import B ${suffix}` } });
  await prisma.projectMember.createMany({ data: [
    { projectId: projectA.id, userId: owner.id, email: owner.email, role: 'OWNER', status: 'ACTIVE' },
    { projectId: projectA.id, userId: editor.id, email: editor.email, role: 'EDITOR', status: 'ACTIVE' },
    { projectId: projectA.id, userId: viewer.id, email: viewer.email, role: 'VIEWER', status: 'ACTIVE' },
    { projectId: projectB.id, userId: outsider.id, email: outsider.email, role: 'OWNER', status: 'ACTIVE' }
  ] });

  const app = Fastify();
  app.addHook('preHandler', async (request, reply) => {
    const authenticatedUser = (request.headers['x-test-user-id'] as string | undefined);
    const user = users.find(({ id }) => id === authenticatedUser);
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    request.user = { userId: user.id, email: user.email };
  });
  await app.register(exportRoutes);

  const importAs = (userId: string, projectId = projectA.id) => app.inject({
    method: 'POST',
    url: `/projects/${projectId}/import`,
    headers: { 'x-test-user-id': userId },
    payload: { code: importableSpec, name: `import-${suffix}` }
  });

  try {
    const editorImport = await importAs(editor.id);
    assert.equal(editorImport.statusCode, 201, editorImport.body);
    const importedTestId = (editorImport.json() as { test: { id: string } }).test.id;

    const viewerImport = await importAs(viewer.id);
    assert.equal(viewerImport.statusCode, 403, `Viewer import unexpectedly succeeded: ${viewerImport.body}`);

    const crossProjectImport = await importAs(outsider.id);
    assert.equal(crossProjectImport.statusCode, 403, `Cross-project import unexpectedly succeeded: ${crossProjectImport.body}`);

    await prisma.projectMember.deleteMany({ where: { projectId: projectA.id, userId: editor.id } });
    const revokedImport = await importAs(editor.id);
    assert.equal(revokedImport.statusCode, 403, `Import succeeded after membership removal: ${revokedImport.body}`);

    const importedCount = await prisma.test.count({ where: { projectId: projectA.id } });
    assert.equal(importedCount, 1, 'Denied imports must not create checks');
    await prisma.test.delete({ where: { id: importedTestId } });
  } finally {
    await app.close();
    await prisma.project.deleteMany({ where: { id: { in: [projectA.id, projectB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
  }
});
