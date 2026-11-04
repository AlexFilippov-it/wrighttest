import type { FastifyInstance, FastifyRequest } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import prisma from '../prisma';
import { canCreateProject, isProtectedAdminEmail } from '../utils/project-access';

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1)
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8)
});

const UserLookupSchema = z.object({
  email: z.string().trim().toLowerCase().email()
});

const CreateApiTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  expiresInDays: z.number().int().min(1).max(365).optional()
});

function isApiTokenRequest(request: FastifyRequest) {
  const payload = request.user as { authMethod?: string } | undefined;
  return payload?.authMethod === 'apiToken';
}

export async function authRoutes(fastify: FastifyInstance) {
  fastify.get('/auth/api-tokens', async (req, reply) => {
    if (isApiTokenRequest(req)) return reply.status(403).send({ error: 'API tokens cannot manage API tokens' });
    const { userId } = req.user as { userId: string };
    return prisma.apiToken.findMany({
      where: { userId },
        select: {
          id: true,
          name: true,
          tokenPrefix: true,
          createdAt: true,
          lastUsedAt: true,
          expiresAt: true,
          revokedAt: true
        },
      orderBy: { createdAt: 'desc' }
    });
  });

  fastify.post('/auth/api-tokens', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
  }, async (req, reply) => {
    if (isApiTokenRequest(req)) return reply.status(403).send({ error: 'API tokens cannot manage API tokens' });
    const result = CreateApiTokenSchema.safeParse(req.body);
    if (!result.success) return reply.status(400).send({ error: result.error.flatten() });

    const { userId } = req.user as { userId: string };
    const count = await prisma.apiToken.count({ where: { userId, revokedAt: null } });
    if (count >= 25) return reply.status(409).send({ error: 'Maximum number of active API tokens reached' });

    const token = `wtm_${randomBytes(32).toString('base64url')}`;
    const tokenPrefix = token.slice(0, 12);
    const expiresAt = result.data.expiresInDays
      ? new Date(Date.now() + result.data.expiresInDays * 24 * 60 * 60 * 1000)
      : null;
    const saved = await prisma.apiToken.create({
      data: {
        userId,
        name: result.data.name,
        tokenPrefix,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt
      },
      select: { id: true, name: true, tokenPrefix: true, createdAt: true, expiresAt: true }
    });

    return reply.status(201).send({ ...saved, token });
  });

  fastify.delete<{ Params: { id: string } }>('/auth/api-tokens/:id', async (req, reply) => {
    if (isApiTokenRequest(req)) return reply.status(403).send({ error: 'API tokens cannot manage API tokens' });
    const { userId } = req.user as { userId: string };
    const result = await prisma.apiToken.updateMany({
      where: { id: req.params.id, userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    if (result.count === 0) return reply.status(404).send({ error: 'API token not found' });
    return reply.status(204).send();
  });

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

    return {
      token,
      email: user.email,
      canCreateProject: await canCreateProject(user.id, user.email),
      isSystemAdmin: isProtectedAdminEmail(user.email)
    };
  });

  fastify.post('/auth/logout', async () => ({ ok: true }));

  fastify.get('/auth/me', async (req) => {
    const payload = req.user as { userId: string; email: string };
    return {
      userId: payload.userId,
      email: payload.email,
      canCreateProject: await canCreateProject(payload.userId, payload.email),
      isSystemAdmin: isProtectedAdminEmail(payload.email)
    };
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

  fastify.get('/users/exists', async (req, reply) => {
    const result = UserLookupSchema.safeParse(req.query);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const user = await prisma.user.findUnique({
      where: { email: result.data.email },
      select: { id: true }
    });

    return { exists: Boolean(user) };
  });
}
