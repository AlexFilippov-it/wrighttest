import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import prisma from '../prisma';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8)
});

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/auth/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '5 minutes'
      }
    }
  }, async (req, reply) => {
    const result = LoginSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid credentials' });
    }

    const user = await prisma.user.findUnique({
      where: { email: result.data.email }
    });

    const passwordHash = user?.passwordHash ?? '$2b$12$invalidhashfortiming';
    const valid = await bcrypt.compare(result.data.password, passwordHash);

    if (!user || !valid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const token = fastify.jwt.sign(
      { userId: user.id, email: user.email },
      { expiresIn: process.env.JWT_EXPIRES_IN ?? '24h' }
    );

    return { token, email: user.email };
  });

  fastify.post('/auth/logout', async () => ({ ok: true }));

  fastify.get('/auth/me', async (req) => {
    const payload = req.user as { userId: string; email: string };
    return { userId: payload.userId, email: payload.email };
  });

  fastify.post('/auth/change-password', async (req, reply) => {
    const result = ChangePasswordSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const payload = req.user as { userId: string };
    const user = await prisma.user.findUnique({
      where: { id: payload.userId }
    });

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const valid = await bcrypt.compare(result.data.currentPassword, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({ error: 'Current password is incorrect' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(result.data.newPassword, 12) }
    });

    return { ok: true };
  });
}
