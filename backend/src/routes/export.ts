import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { exportToSpec } from '../services/exporter';
import { parsePlaywrightSpec } from '../services/importer';

const ImportSchema = z.object({
  code: z.string().min(1),
  name: z.string().optional()
});

function sanitizeFilename(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export async function exportRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { id: string }; Querystring: { envId?: string; useEnvVars?: string } }>(
    '/tests/:id/export',
    async (req, reply) => {
      const test = await prisma.test.findUnique({
        where: { id: req.params.id }
      });

      if (!test) return reply.status(404).send({ error: 'Test not found' });

      let variables: Record<string, string> = {};
      if (req.query.envId) {
        const environment = await prisma.environment.findUnique({
          where: { id: req.query.envId }
        });
        variables = (environment?.variables ?? {}) as Record<string, string>;
      }

      const code = exportToSpec(test.steps as never[], {
        testName: test.name,
        variables,
        useEnvVars: req.query.useEnvVars === 'true'
      });

      const filename = sanitizeFilename(test.name || 'test') || 'test';
      reply.header('Content-Type', 'text/plain; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${filename}.spec.ts"`);
      return reply.send(code);
    }
  );

  fastify.post<{ Params: { projectId: string } }>('/projects/:projectId/import', async (req, reply) => {
    const body = ImportSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const project = await prisma.project.findUnique({
      where: { id: req.params.projectId }
    });

    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const { testName, steps } = parsePlaywrightSpec(body.data.code);
    if (steps.length === 0) {
      return reply.status(400).send({ error: 'No steps parsed from the provided code' });
    }

    const firstGoto = steps.find((step) => step.action === 'goto');
    const test = await prisma.test.create({
      data: {
        name: body.data.name ?? testName,
        url: firstGoto?.value ?? 'https://example.com',
        steps: steps as never[],
        projectId: req.params.projectId
      }
    });

    return reply.status(201).send({
      test,
      parsedSteps: steps.length
    });
  });
}
