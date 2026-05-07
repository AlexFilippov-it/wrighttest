import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { CreateTestSchema, StepSchema, UpdateTestSchema } from '../schemas/test.schema';
import { runValidationInSubprocess } from '../services/validation-runner';
import { getAvailableDevices } from '../utils/devices';

const urlOrTemplate = z.string().refine((value) => {
  if (value.includes('{{')) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}, {
  message: 'Enter a valid URL or use {{VARIABLE}} placeholders'
});

const ValidateStepsSchema = z.object({
  url: urlOrTemplate,
  steps: z.array(StepSchema).default([]),
  device: z.string().optional()
});

function normalizeDevice(device?: string) {
  if (device === undefined) return undefined;
  const trimmed = device.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEnvironmentId(environmentId?: string | null) {
  if (environmentId === undefined) return undefined;
  if (environmentId === null) return null;
  const trimmed = environmentId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function testRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { projectId: string } }>('/projects/:projectId/tests', async (req, reply) => {
    const project = await prisma.project.findUnique({
      where: { id: req.params.projectId }
    });

    if (!project) return reply.status(404).send({ error: 'Project not found' });

    return prisma.test.findMany({
      where: { projectId: req.params.projectId },
      include: { _count: { select: { runs: true } } },
      orderBy: { createdAt: 'desc' }
    });
  });

  fastify.get<{ Params: { id: string } }>('/tests/:id', async (req, reply) => {
    const test = await prisma.test.findUnique({
      where: { id: req.params.id },
      include: { runs: { orderBy: { startedAt: 'desc' }, take: 10 } }
    });

    if (!test) return reply.status(404).send({ error: 'Test not found' });
    return test;
  });

  fastify.post<{ Params: { projectId: string } }>('/projects/:projectId/tests', async (req, reply) => {
    const result = CreateTestSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const project = await prisma.project.findUnique({
      where: { id: req.params.projectId }
    });

    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const test = await prisma.test.create({
      data: {
        ...result.data,
        device: normalizeDevice(result.data.device),
        environmentId: normalizeEnvironmentId(result.data.environmentId),
        projectId: req.params.projectId
      }
    });

    return reply.status(201).send(test);
  });

  fastify.patch<{ Params: { id: string } }>('/tests/:id', async (req, reply) => {
    const result = UpdateTestSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    try {
      const test = await prisma.test.update({
        where: { id: req.params.id },
        data: {
          ...result.data,
          device: normalizeDevice(result.data.device),
          environmentId: normalizeEnvironmentId(result.data.environmentId)
        }
      });
      return test;
    } catch {
      return reply.status(404).send({ error: 'Test not found' });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/tests/:id', async (req, reply) => {
    try {
      await prisma.test.delete({ where: { id: req.params.id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: 'Test not found' });
    }
  });

  fastify.post('/tests/validate', async (req, reply) => {
    const result = ValidateStepsSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    try {
      const report = runValidationInSubprocess(result.data.url, result.data.steps, result.data.device);
      return report;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Validation failed';
      return reply.status(500).send({ error: message });
    }
  });

  fastify.get('/devices', async () => getAvailableDevices());
}
