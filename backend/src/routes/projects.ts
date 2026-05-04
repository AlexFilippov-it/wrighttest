import { FastifyInstance } from 'fastify';
import prisma from '../prisma';
import { CreateProjectSchema, UpdateProjectSchema } from '../schemas/project.schema';

export async function projectRoutes(fastify: FastifyInstance) {
  fastify.get('/projects', async () => {
    return prisma.project.findMany({
      include: { _count: { select: { tests: true } } },
      orderBy: { createdAt: 'desc' }
    });
  });

  fastify.get<{ Params: { id: string } }>('/projects/:id', async (req, reply) => {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        tests: {
          include: { _count: { select: { runs: true } } },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!project) return reply.status(404).send({ error: 'Project not found' });
    return project;
  });

  fastify.post('/projects', async (req, reply) => {
    const result = CreateProjectSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const project = await prisma.project.create({ data: result.data });
    return reply.status(201).send(project);
  });

  fastify.patch<{ Params: { id: string } }>('/projects/:id', async (req, reply) => {
    const result = UpdateProjectSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    try {
      const project = await prisma.project.update({
        where: { id: req.params.id },
        data: result.data
      });
      return project;
    } catch {
      return reply.status(404).send({ error: 'Project not found' });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/projects/:id', async (req, reply) => {
    try {
      await prisma.project.delete({ where: { id: req.params.id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: 'Project not found' });
    }
  });
}
