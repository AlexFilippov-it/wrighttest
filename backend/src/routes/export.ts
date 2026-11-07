import { FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import type { Step } from '../types/step';
import { exportToSpec } from '../services/exporter';
import { buildPlaywrightProjectZip } from '../services/project-export';
import { parsePlaywrightSpec } from '../services/importer';
import { getAuthUser, getProjectAccessStatusCode, requireProjectRole } from '../utils/project-access';

const ImportSchema = z.object({
  code: z.string().min(1),
  name: z.string().optional()
});

const ExportProjectSchema = z.object({
  envId: z.string().optional(),
  useEnvVars: z.boolean().optional()
});

type ExportProjectRoute = {
  Params: { id: string };
  Body: { envId?: string; useEnvVars?: boolean };
  Querystring: { envId?: string; useEnvVars?: string };
};

type ExportProjectRequest = FastifyRequest<ExportProjectRoute>;

function sanitizeFilename(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function hasDatabaseSteps(steps: unknown): boolean {
  return Array.isArray(steps) && steps.some((step) =>
    typeof step === 'object' && step !== null && 'action' in step &&
    ['executeSql', 'assertDatabaseResult'].includes(String(step.action))
  );
}

export async function exportRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { id: string }; Querystring: { envId?: string; useEnvVars?: string } }>(
    '/tests/:id/export',
    async (req, reply) => {
      const test = await prisma.test.findUnique({
        where: { id: req.params.id }
      });

      if (!test) return reply.status(404).send({ error: 'Test not found' });

      const { userId } = getAuthUser(req);
      try {
        await requireProjectRole(test.projectId, userId, ['OWNER', 'EDITOR']);
      } catch (error) {
        return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
      }

      if (hasDatabaseSteps(test.steps)) {
        return reply.status(409).send({ error: 'Standalone Playwright exports do not support WrightTest database connections yet.' });
      }

      let variables: Record<string, string> = {};
      if (req.query.envId) {
        const environment = await prisma.environment.findUnique({
          where: { id: req.query.envId }
        });
        if (!environment || environment.projectId !== test.projectId) {
          return reply.status(404).send({ error: 'Environment not found' });
        }
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

  const exportProjectHandler = async (req: ExportProjectRequest, reply: FastifyReply) => {
    const payload = {
      envId: req.body?.envId ?? req.query.envId,
      useEnvVars:
        req.body?.useEnvVars ??
        (req.query.useEnvVars === undefined ? undefined : req.query.useEnvVars === 'true')
    };

    const body = ExportProjectSchema.safeParse(payload);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const test = await prisma.test.findUnique({
      where: { id: req.params.id }
    });

    if (!test) {
      return reply.status(404).send({ error: 'Test not found' });
    }

    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(test.projectId, userId, ['OWNER', 'EDITOR']);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    if (hasDatabaseSteps(test.steps)) {
      return reply.status(409).send({ error: 'Standalone Playwright exports do not support WrightTest database connections yet.' });
    }

    let variables: Record<string, string> = {};
    if (body.data.envId) {
      const environment = await prisma.environment.findUnique({
        where: { id: body.data.envId }
      });
      if (!environment || environment.projectId !== test.projectId) {
        return reply.status(404).send({ error: 'Environment not found' });
      }
      variables = (environment?.variables ?? {}) as Record<string, string>;
    }

    const { buffer, filename } = await buildPlaywrightProjectZip({
      testName: test.name,
      testUrl: test.url,
      steps: test.steps as unknown as Step[],
      variables,
      useEnvVars: body.data.useEnvVars ?? false
    });

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(buffer);
  };

  fastify.post<ExportProjectRoute>('/tests/:id/export-project', exportProjectHandler);
  fastify.post<ExportProjectRoute>('/checks/:id/export-project', exportProjectHandler);

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
