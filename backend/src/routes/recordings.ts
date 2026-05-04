import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { interpolate } from '../utils/interpolate';
import { getRecordingStatus, startRecording, stopRecording } from '../services/recorder';

const StartSchema = z.object({
  url: z.string().min(1),
  environmentId: z.string().optional(),
  device: z.string().optional()
});

export async function recordingRoutes(fastify: FastifyInstance) {
  fastify.post('/recordings/start', async (req, reply) => {
    const result = StartSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    try {
      let resolvedUrl = result.data.url;

      if (result.data.environmentId) {
        const environment = await prisma.environment.findUnique({
          where: { id: result.data.environmentId }
        });

        if (!environment) {
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

      const sessionId = await startRecording(resolvedUrl, result.data.device);
      return reply.status(201).send({ sessionId, status: 'active' });
    } catch (err) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Failed to start recording'
      });
    }
  });

  fastify.post<{ Params: { id: string } }>('/recordings/:id/stop', async (req, reply) => {
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
    return status;
  });
}
