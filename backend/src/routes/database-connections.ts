import { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { getAuthUser, getProjectAccessStatusCode, requireProjectRole } from '../utils/project-access';
import { encryptDatabasePassword, publicDatabaseConnection, testDatabaseConnection } from '../services/database-connections';

const ConnectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  provider: z.enum(['POSTGRESQL', 'MYSQL', 'SUPABASE']),
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  database: z.string().trim().min(1).max(128),
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(2048),
  ssl: z.boolean().default(true),
  accessMode: z.enum(['READ_ONLY', 'READ_WRITE']).default('READ_ONLY')
});
const UpdateConnectionSchema = ConnectionSchema.omit({ password: true }).partial().extend({
  password: z.string().max(2048).optional()
});

function sendAccessError(reply: FastifyReply, error: unknown) {
  return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
}

export async function databaseConnectionRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { projectId: string } }>('/projects/:projectId/connections', async (req, reply) => {
    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(req.params.projectId, userId, ['OWNER', 'EDITOR', 'VIEWER']);
      const connections = await prisma.databaseConnection.findMany({ where: { projectId: req.params.projectId }, orderBy: { createdAt: 'asc' } });
      return connections.map(publicDatabaseConnection);
    } catch (error) { return sendAccessError(reply, error); }
  });

  fastify.post<{ Params: { projectId: string } }>('/projects/:projectId/connections', async (req, reply) => {
    const parsed = ConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const { userId } = getAuthUser(req);
    try { await requireProjectRole(req.params.projectId, userId, ['OWNER', 'EDITOR']); }
    catch (error) { return sendAccessError(reply, error); }
    if (!process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY) return reply.status(503).send({ error: 'Database credential encryption is not configured.' });
    if (await prisma.databaseConnection.count({ where: { projectId: req.params.projectId } }) >= 30) {
      return reply.status(409).send({ error: 'A project can have at most 30 database connections.' });
    }
    const { password, ...data } = parsed.data;
    const connection = await prisma.databaseConnection.create({ data: { ...data, encryptedCredentials: encryptDatabasePassword(password), projectId: req.params.projectId } });
    return reply.status(201).send(publicDatabaseConnection(connection));
  });

  fastify.get<{ Params: { id: string } }>('/connections/:id', async (req, reply) => {
    const { userId } = getAuthUser(req);
    const connection = await prisma.databaseConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return reply.status(404).send({ error: 'Database connection not found.' });
    try { await requireProjectRole(connection.projectId, userId, ['OWNER', 'EDITOR', 'VIEWER']); }
    catch (error) { return sendAccessError(reply, error); }
    return publicDatabaseConnection(connection);
  });

  fastify.patch<{ Params: { id: string } }>('/connections/:id', async (req, reply) => {
    const parsed = UpdateConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const { userId } = getAuthUser(req);
    const current = await prisma.databaseConnection.findUnique({ where: { id: req.params.id } });
    if (!current) return reply.status(404).send({ error: 'Database connection not found.' });
    try { await requireProjectRole(current.projectId, userId, ['OWNER', 'EDITOR']); }
    catch (error) { return sendAccessError(reply, error); }
    const { password, ...fields } = parsed.data;
    const connection = await prisma.databaseConnection.update({
      where: { id: current.id },
      data: { ...fields, ...(password ? { encryptedCredentials: encryptDatabasePassword(password) } : {}) }
    });
    return publicDatabaseConnection(connection);
  });

  fastify.delete<{ Params: { id: string } }>('/connections/:id', async (req, reply) => {
    const { userId } = getAuthUser(req);
    const connection = await prisma.databaseConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return reply.status(404).send({ error: 'Database connection not found.' });
    try { await requireProjectRole(connection.projectId, userId, ['OWNER', 'EDITOR']); }
    catch (error) { return sendAccessError(reply, error); }
    const tests = await prisma.test.findMany({ where: { projectId: connection.projectId }, select: { steps: true } });
    const inUse = tests.some(({ steps }) => Array.isArray(steps) && steps.some((step) =>
      typeof step === 'object' && step !== null && 'databaseConnectionId' in step && step.databaseConnectionId === connection.id
    ));
    if (inUse) return reply.status(409).send({ error: 'This connection is used by one or more Checks. Update those Checks before deleting it.' });
    await prisma.databaseConnection.delete({ where: { id: connection.id } });
    return reply.status(204).send();
  });

  fastify.post<{ Params: { id: string } }>('/connections/:id/test', async (req, reply) => {
    const { userId } = getAuthUser(req);
    const connection = await prisma.databaseConnection.findUnique({ where: { id: req.params.id } });
    if (!connection) return reply.status(404).send({ error: 'Database connection not found.' });
    try { await requireProjectRole(connection.projectId, userId, ['OWNER', 'EDITOR']); }
    catch (error) { return sendAccessError(reply, error); }
    let errorMessage: string | undefined;
    try { await testDatabaseConnection(connection); }
    catch (error) { errorMessage = error instanceof Error ? error.message : 'Database connection failed.'; }
    const now = new Date();
    await prisma.databaseConnection.update({
      where: { id: connection.id },
      data: {
        lastCheckedAt: now,
        lastCheckStatus: errorMessage ? 'FAILED' : 'CONNECTED',
        ...(errorMessage ? {} : { lastSuccessfulCheckAt: now })
      }
    });
    return reply.send({ status: errorMessage ? 'FAILED' : 'CONNECTED', checkedAt: now, ...(errorMessage ? { error: errorMessage } : {}) });
  });
}
