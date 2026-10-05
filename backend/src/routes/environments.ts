import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { getAuthUser, getProjectAccessStatusCode, redactEnvironmentVariables, requireProjectRole } from '../utils/project-access';
import { deleteAuthStateArtifact } from '../services/auth-state';

const EnvironmentSchema = z.object({
  name: z.string().min(1).max(50),
  variables: z.record(z.string())
});

export async function environmentRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { projectId: string } }>('/projects/:projectId/environments', async (req, reply) => {
    const { userId } = getAuthUser(req);
    try {
      const access = await requireProjectRole(req.params.projectId, userId, ['OWNER', 'EDITOR', 'VIEWER']);
      const viewerOnly = access.member.role === 'VIEWER';
      const environments = await prisma.environment.findMany({
        where: { projectId: req.params.projectId },
        orderBy: { createdAt: 'asc' }
      });
      return environments.map((environment) => ({
        ...environment,
        variables: redactEnvironmentVariables(environment.variables as Record<string, string>, viewerOnly)
      }));
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }
  });

  fastify.post<{ Params: { projectId: string } }>('/projects/:projectId/environments', async (req, reply) => {
    const result = EnvironmentSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(req.params.projectId, userId, ['OWNER', 'EDITOR']);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    const environment = await prisma.environment.create({
      data: { ...result.data, projectId: req.params.projectId }
    });
    return reply.status(201).send(environment);
  });

  fastify.patch<{ Params: { id: string } }>('/environments/:id', async (req, reply) => {
    const result = EnvironmentSchema.partial().safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const { userId } = getAuthUser(req);
    const environment = await prisma.environment.findUnique({
      where: { id: req.params.id },
      select: { projectId: true }
    });
    if (!environment) return reply.status(404).send({ error: 'Environment not found' });

    try {
      await requireProjectRole(environment.projectId, userId, ['OWNER', 'EDITOR']);
      return await prisma.environment.update({
        where: { id: req.params.id },
        data: result.data
      });
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/environments/:id', async (req, reply) => {
    try {
      const { userId } = getAuthUser(req);
      const environment = await prisma.environment.findUnique({
        where: { id: req.params.id },
        select: {
          projectId: true,
          authStates: {
            select: { storageKey: true, status: true }
          }
        }
      });
      if (!environment) return reply.status(404).send({ error: 'Environment not found' });
      await requireProjectRole(environment.projectId, userId, ['OWNER', 'EDITOR']);

      if (environment.authStates.some((profile) => profile.status === 'REFRESHING')) {
        return reply.status(409).send({ error: 'This environment is currently refreshing authentication' });
      }
      await prisma.environment.delete({ where: { id: req.params.id } });
      await Promise.all(
        environment.authStates.map((profile) =>
          deleteAuthStateArtifact(profile.storageKey).catch((error) => {
            console.error(`[AuthState] Failed to remove state ${profile.storageKey}:`, error);
          })
        )
      );
      return reply.status(204).send();
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Environment not found' });
    }
  });
}
