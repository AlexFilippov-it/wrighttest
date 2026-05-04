import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { testQueue } from '../queue/queue';

const WebhookPayloadSchema = z.object({
  testId: z.string().optional(),
  projectId: z.string().optional(),
  environmentId: z.string().optional()
});

function verifySignature(secret: string, body: string, signature: string) {
  if (!signature) return false;
  if (signature === secret) return true;

  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return signature === `sha256=${expected}`;
}

export async function webhookRoutes(fastify: FastifyInstance) {
  fastify.post('/webhooks/trigger', async (req, reply) => {
    const secret = process.env.WEBHOOK_SECRET;
    if (secret) {
      const signatureHeader = req.headers['x-wrighttest-secret'];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});

      if (!signature || !verifySignature(secret, rawBody, signature)) {
        return reply.status(401).send({ error: 'Invalid signature' });
      }
    }

    const result = WebhookPayloadSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const { testId, projectId, environmentId } = result.data;
    const jobs: { testRunId: string; testId: string }[] = [];

    if (testId) {
      const test = await prisma.test.findUnique({ where: { id: testId } });
      if (!test) return reply.status(404).send({ error: 'Test not found' });

      const run = await prisma.testRun.create({
        data: { testId, status: 'PENDING', environmentId }
      });
      await testQueue.add('run', { testRunId: run.id, testId, environmentId });
      jobs.push({ testRunId: run.id, testId });
    } else if (projectId) {
      const tests = await prisma.test.findMany({ where: { projectId } });
      if (tests.length === 0) {
        return reply.status(404).send({ error: 'No tests found for project' });
      }

      for (const test of tests) {
        const run = await prisma.testRun.create({
          data: { testId: test.id, status: 'PENDING', environmentId }
        });
        await testQueue.add('run', {
          testRunId: run.id,
          testId: test.id,
          environmentId
        });
        jobs.push({ testRunId: run.id, testId: test.id });
      }
    } else {
      return reply.status(400).send({ error: 'testId or projectId required' });
    }

    return reply.status(202).send({ queued: jobs.length, jobs });
  });
}
