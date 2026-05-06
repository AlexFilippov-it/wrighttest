import { Prisma } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { sendSlack, sendTelegram } from '../services/notifier';

const TelegramConfigSchema = z.object({
  botToken: z.string().min(1),
  chatId: z.string().min(1)
});

const SlackConfigSchema = z.object({
  webhookUrl: z
    .string()
    .url()
    .refine((value) => value.startsWith('https://hooks.slack.com/services/'), {
      message: 'Webhook URL must start with https://hooks.slack.com/services/'
    })
});

const ChannelUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  config: z.union([TelegramConfigSchema, SlackConfigSchema]).optional(),
  onFailed: z.boolean().optional(),
  onRecovered: z.boolean().optional(),
  onPassed: z.boolean().optional(),
  enabled: z.boolean().optional()
});

const ChannelSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('telegram'),
    name: z.string().min(1),
    config: TelegramConfigSchema,
    onFailed: z.boolean().default(true),
    onRecovered: z.boolean().default(true),
    onPassed: z.boolean().default(false),
    enabled: z.boolean().default(true)
  }),
  z.object({
    type: z.literal('slack'),
    name: z.string().min(1),
    config: SlackConfigSchema,
    onFailed: z.boolean().default(true),
    onRecovered: z.boolean().default(true),
    onPassed: z.boolean().default(false),
    enabled: z.boolean().default(true)
  })
]);

const ChannelDraftTestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('telegram'),
    name: z.string().min(1),
    config: TelegramConfigSchema
  }),
  z.object({
    type: z.literal('slack'),
    name: z.string().min(1),
    config: SlackConfigSchema
  })
]);

function buildTestMessage(name: string, type: string): string {
  return `WrightTest notification test\nChannel: ${name}\nType: ${type}\nStatus: OK`;
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

      await prisma.notificationChannel.update({
        where: { id: channel.id },
        data: {
          lastTestAt: new Date(),
          lastTestStatus: 'PASSED'
        }
      });

      return { ok: true };
    } catch (error) {
      await prisma.notificationChannel.update({
        where: { id: channel.id },
        data: {
          lastTestAt: new Date(),
          lastTestStatus: 'FAILED'
        }
      }).catch(() => undefined);

      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Send failed'
      });
    }
  });

  fastify.post<{ Params: { projectId: string } }>('/projects/:projectId/channels/test', async (req, reply) => {
    const result = ChannelDraftTestSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const project = await prisma.project.findUnique({
      where: { id: req.params.projectId }
    });

    if (!project) return reply.status(404).send({ error: 'Project not found' });

    try {
      const text = buildTestMessage(result.data.name, result.data.type);

      if (result.data.type === 'telegram') {
        await sendTelegram(result.data.config, text);
      } else {
        await sendSlack(result.data.config, text);
      }

      return { ok: true };
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Send failed'
      });
    }
  });

  fastify.patch<{ Params: { id: string } }>('/channels/:id', async (req, reply) => {
    const result = ChannelUpdateSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const existing = await prisma.notificationChannel.findUnique({
      where: { id: req.params.id }
    });

    if (!existing) {
      return reply.status(404).send({ error: 'Channel not found' });
    }

    const channel = await prisma.notificationChannel.update({
      where: { id: req.params.id },
      data: {
        name: result.data.name ?? existing.name,
        config: (result.data.config ?? existing.config) as Prisma.InputJsonValue,
        onFailed: result.data.onFailed ?? existing.onFailed,
        onRecovered: result.data.onRecovered ?? existing.onRecovered,
        onPassed: result.data.onPassed ?? existing.onPassed,
        enabled: result.data.enabled ?? existing.enabled
      }
    });

    return channel;
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
