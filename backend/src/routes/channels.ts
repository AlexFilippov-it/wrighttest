import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { sendSlack, sendTelegram } from '../services/notifier';

const TelegramConfigSchema = z.object({
  botToken: z.string().min(1),
  chatId: z.string().min(1)
});

const SlackConfigSchema = z.object({
  webhookUrl: z.string().url()
});

const ChannelSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('telegram'),
    name: z.string().min(1),
    config: TelegramConfigSchema,
    onFailed: z.boolean().default(true),
    onPassed: z.boolean().default(false)
  }),
  z.object({
    type: z.literal('slack'),
    name: z.string().min(1),
    config: SlackConfigSchema,
    onFailed: z.boolean().default(true),
    onPassed: z.boolean().default(false)
  })
]);

function buildTestMessage(name: string, type: string): string {
  return `🔔 <b>WrightTest notification test</b>\nChannel: ${name}\nType: ${type}\nStatus: OK`;
}

export async function channelRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { projectId: string } }>('/projects/:projectId/channels', async (req, reply) => {
    const project = await prisma.project.findUnique({
      where: { id: req.params.projectId }
    });

    if (!project) return reply.status(404).send({ error: 'Project not found' });

    return prisma.notificationChannel.findMany({
      where: { projectId: req.params.projectId },
      orderBy: { createdAt: 'asc' }
    });
  });

  fastify.post<{ Params: { projectId: string } }>('/projects/:projectId/channels', async (req, reply) => {
    const result = ChannelSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const project = await prisma.project.findUnique({
      where: { id: req.params.projectId }
    });

    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const channel = await prisma.notificationChannel.create({
      data: { ...result.data, projectId: req.params.projectId }
    });

    return reply.status(201).send(channel);
  });

  fastify.post<{ Params: { id: string } }>('/channels/:id/test', async (req, reply) => {
    const channel = await prisma.notificationChannel.findUnique({
      where: { id: req.params.id }
    });

    if (!channel) return reply.status(404).send({ error: 'Channel not found' });

    try {
      const text = buildTestMessage(channel.name, channel.type);

      if (channel.type === 'telegram') {
        await sendTelegram(channel.config as { botToken: string; chatId: string }, text);
      } else if (channel.type === 'slack') {
        await sendSlack(channel.config as { webhookUrl: string }, text);
      } else {
        return reply.status(400).send({ error: `Unsupported channel type: ${channel.type}` });
      }

      return { ok: true };
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Send failed'
      });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/channels/:id', async (req, reply) => {
    try {
      await prisma.notificationChannel.delete({ where: { id: req.params.id } });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: 'Not found' });
    }
  });
}
