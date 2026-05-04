import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';

const EnvironmentSchema = z.object({
  name: z.string().min(1).max(50),
  variables: z.record(z.string())
});

export async function environmentRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { projectId: string } }>('/projects/:projectId/environments', async (req) => {
    return prisma.environment.findMany({
      where: { projectId: req.params.projectId },
      orderBy: { createdAt: 'asc' }
    });
  });

  fastify.post<{ Params: { projectId: string } }>('/projects/:projectId/environments', async (req, reply) => {
    const result = EnvironmentSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
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

    try {
      return await prisma.environment.update({
        where: { id: req.params.id },
        data: result.data
      });
    } catch {
      return reply.status(404).send({ error: 'Environment not found' });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/environments/:id', async (req, reply) => {
    try {
      await prisma.environment.delete({ where: { id: req.params.id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: 'Environment not found' });
    }
  });
}
