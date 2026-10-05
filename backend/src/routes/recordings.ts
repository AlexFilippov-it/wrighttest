import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { interpolate } from '../utils/interpolate';
import { getRecordingStatus, startRecording, stopRecording } from '../services/recorder';
import { resolveAuthStateForExecution } from '../services/auth-state';
import { getAuthUser, getProjectAccessStatusCode, requireProjectRole } from '../utils/project-access';

const StartSchema = z.object({
  projectId: z.string().min(1),
  url: z.string().min(1),
  environmentId: z.string().optional(),
  device: z.string().optional(),
  useProjectAuthentication: z.boolean().default(false)
});

export async function recordingRoutes(fastify: FastifyInstance) {
  fastify.post('/recordings/start', async (req, reply) => {
    const result = StartSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const { userId } = getAuthUser(req);

    try {
      await requireProjectRole(result.data.projectId, userId, ['OWNER', 'EDITOR']);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    try {
      let resolvedUrl = result.data.url;

      if (result.data.environmentId) {
        const environment = await prisma.environment.findUnique({
          where: { id: result.data.environmentId }
        });

        if (!environment || environment.projectId !== result.data.projectId) {
          return reply.status(404).send({ error: 'Environment not found' });
        }

        resolvedUrl = interpolate(result.data.url, (environment.variables ?? {}) as Record<string, string>);

        if (/\{\{\w+\}\}/.test(resolvedUrl)) {
          return reply.status(400).send({
            error: 'Unresolved variables remain in recording URL'
          });
        }
      } else if (/\{\{\w+\}\}/.test(result.data.url)) {
        return reply.status(400).send({
          error: 'Recording URL contains variables. Select an environment first.'
        });
      }

      const storageState = await resolveAuthStateForExecution({
        projectId: result.data.projectId,
        environmentId: result.data.environmentId,
        useProjectAuthentication: result.data.useProjectAuthentication
      });
      const sessionId = await startRecording(
        resolvedUrl,
        result.data.device,
        result.data.projectId,
        userId,
        storageState
      );
      return reply.status(201).send({ sessionId, status: 'active' });
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Failed to start recording'
      });
    }
  });

  fastify.post<{ Params: { id: string } }>('/recordings/:id/stop', async (req, reply) => {
    const { userId } = getAuthUser(req);
    const status = getRecordingStatus(req.params.id);
    if (!status) return reply.status(404).send({ error: 'Session not found' });

    try {
      await requireProjectRole(status.projectId, userId, ['OWNER', 'EDITOR']);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    try {
      const steps = await stopRecording(req.params.id);
      return { steps };
    } catch (err) {
      return reply.status(404).send({
        error: err instanceof Error ? err.message : 'Session not found'
      });
    }
  });

  fastify.get<{ Params: { id: string } }>('/recordings/:id', async (req, reply) => {
    const status = getRecordingStatus(req.params.id);
    if (!status) return reply.status(404).send({ error: 'Session not found' });

    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(status.projectId, userId, ['OWNER', 'EDITOR']);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }
    return status;
  });
}
