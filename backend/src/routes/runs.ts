import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { testQueue } from '../queue/queue';

const RunSchema = z.object({
  environmentId: z.string().optional()
});

export async function runRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { id: string } }>('/tests/:id/run', async (req, reply) => {
    const body = RunSchema.safeParse(req.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const test = await prisma.test.findUnique({
      where: { id: req.params.id }
    });

    if (!test) return reply.status(404).send({ error: 'Test not found' });

    if (body.data.environmentId) {
      const environment = await prisma.environment.findUnique({
        where: { id: body.data.environmentId }
      });

      if (!environment) {
        return reply.status(404).send({ error: 'Environment not found' });
      }
    }

    const run = await prisma.testRun.create({
      data: {
        testId: test.id,
        status: 'PENDING',
        environmentId: body.data.environmentId
      }
    });

    const job = await testQueue.add('run', {
      testRunId: run.id,
      testId: test.id,
      environmentId: body.data.environmentId
    });

    return reply.status(202).send({
      testRunId: run.id,
      jobId: job.id,
      status: 'PENDING'
    });
  });

  fastify.get<{ Params: { id: string } }>('/runs/:id', async (req, reply) => {
    const run = await prisma.testRun.findUnique({
      where: { id: req.params.id }
    });

    if (!run) return reply.status(404).send({ error: 'Run not found' });
    return run;
  });

  fastify.get<{ Params: { id: string } }>('/tests/:id/runs', async (req, reply) => {
    const test = await prisma.test.findUnique({
      where: { id: req.params.id }
    });

    if (!test) return reply.status(404).send({ error: 'Test not found' });

    return prisma.testRun.findMany({
      where: { testId: req.params.id },
      orderBy: { startedAt: 'desc' },
      take: 20
    });
  });
}
