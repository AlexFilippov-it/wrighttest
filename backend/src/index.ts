import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyHelmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { config as loadEnv } from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import fs from 'node:fs';
import path from 'node:path';
import prisma from './prisma';
import { authRoutes } from './routes/auth';
import { startTestWorker } from './queue/worker';
import { dashboardRoutes } from './routes/dashboard';
import { channelRoutes } from './routes/channels';
import { exportRoutes } from './routes/export';
import { recordingRoutes } from './routes/recordings';
import { environmentRoutes } from './routes/environments';
import { scheduleRoutes } from './routes/schedules';
import { suiteRoutes } from './routes/suites';
import { runRoutes } from './routes/runs';
import { projectRoutes } from './routes/projects';
import { webhookRoutes } from './routes/webhooks';
import { testRoutes } from './routes/tests';
import { projectAuthRoutes } from './routes/project-auth';
import { databaseConnectionRoutes } from './routes/database-connections';
import { projectVariableRoutes } from './routes/project-variables';
import { localizationRoutes } from './routes/localization';
import { createBrowserSessionRoutes } from './routes/browser-sessions';
import { createHash } from 'node:crypto';
import { schedulerService } from './services/scheduler';
import { validateRuntimeConfiguration } from './services/runtime-config';

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '..', '.env')
];
const screenshotsDir = path.resolve(process.env.SCREENSHOTS_DIR || './screenshots');
const tracesDir = path.resolve(process.env.TRACES_DIR || './traces');
const defaultFrontendOrigins = [
  'http://localhost:5173',
  'http://localhost:80',
  'http://127.0.0.1:5173'
];

function collectFrontendOrigins() {
  const origins = new Set<string>(defaultFrontendOrigins);

  for (const candidate of [process.env.FRONTEND_URL, process.env.FRONTEND_DEV_URL]) {
    if (!candidate) continue;

    try {
      origins.add(new URL(candidate).origin);
    } catch {
      // Ignore invalid URLs and keep the safe defaults.
    }
  }

  return [...origins];
}

const traceViewerRoot = path.join(
  path.dirname(require.resolve('playwright-core/package.json')),
  'lib/vite/traceViewer'
);

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    const loaded = loadEnv({ path: envPath });
    dotenvExpand.expand(loaded);
    break;
  }
}

fs.mkdirSync(screenshotsDir, { recursive: true });
fs.mkdirSync(tracesDir, { recursive: true });

async function start() {
  validateRuntimeConfiguration();
  const fastify = Fastify({
    logger: {
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        censor: '[REDACTED]'
      }
    }
  });
  const port = Number(process.env.BACKEND_PORT) || 3000;
  const frontendOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    process.env.FRONTEND_DEV_URL || 'http://localhost:5173',
    'http://127.0.0.1:5173'
  ];

  await fastify.register(cors, {
    origin: frontendOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  });

  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: false,
    frameguard: false
  });

  const configuredRateLimitMax = Number(process.env.RATE_LIMIT_MAX);
  await fastify.register(rateLimit, {
    max: Number.isSafeInteger(configuredRateLimitMax) && configuredRateLimitMax > 0 ? configuredRateLimitMax : 100,
    timeWindow: '1 minute'
  });

  await fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET ?? 'development-only-jwt-secret-change-me'
  });

  fastify.addHook('preHandler', async (req, reply) => {
    const publicRoutes = [
      { method: 'POST', url: '/auth/login' },
      { method: 'POST', url: '/auth/logout' },
      { method: 'GET', url: '/localization/public' },
      { method: 'GET', url: '/health' },
      { method: 'GET', url: '/health/db' },
      { method: 'POST', url: '/webhooks/trigger' },
      { method: 'GET', url: '/api/artifacts' },
      { method: 'GET', url: '/trace-viewer/' },
      { method: 'GET', url: '/api/trace-viewer/' },
      { method: 'GET', url: '/trace-viewer' }
    ];

    const isPublic = publicRoutes.some((route) =>
      req.url.startsWith(route.url) &&
      (route.method === req.method || (req.method === 'HEAD' && route.method === 'GET'))
    );

    if (isPublic) return;

    try {
      const authorization = req.headers.authorization;
      const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

      if (bearer?.startsWith('wtm_')) {
        const tokenHash = createHash('sha256').update(bearer).digest('hex');
        const now = new Date();
        const apiToken = await prisma.apiToken.findUnique({
          where: { tokenHash },
          include: { user: { select: { id: true, email: true } } }
        });

        if (!apiToken || apiToken.revokedAt || (apiToken.expiresAt && apiToken.expiresAt <= now)) {
          return reply.status(401).send({ error: 'Unauthorized' });
        }

        const updated = await prisma.apiToken.updateMany({
          where: {
            id: apiToken.id,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
          },
          data: { lastUsedAt: now }
        });
        if (updated.count !== 1) return reply.status(401).send({ error: 'Unauthorized' });
        req.user = { userId: apiToken.user.id, email: apiToken.user.email, authMethod: 'apiToken' };
      } else {
        await req.jwtVerify();
      }
      const payload = req.user as { userId?: string; email?: string } | undefined;
      if (!payload?.userId || !payload.email) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { email: true }
      });

      if (!user || user.email !== payload.email) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  await fastify.register(authRoutes);
  await fastify.register(localizationRoutes);
  await fastify.register(createBrowserSessionRoutes().routes);

  await fastify.register(fastifyStatic, {
    root: traceViewerRoot,
    prefix: '/trace-viewer/',
    decorateReply: false,
    setHeaders: (res) => {
      const frameAncestors = ["'self'", ...collectFrontendOrigins()].join(' ');
      res.raw.setHeader('Content-Security-Policy', `frame-ancestors ${frameAncestors}`);
    }
  });

  await fastify.register(fastifyStatic, {
    root: traceViewerRoot,
    prefix: '/api/trace-viewer/',
    decorateReply: false,
    setHeaders: (res) => {
      const frameAncestors = ["'self'", ...collectFrontendOrigins()].join(' ');
      res.raw.setHeader('Content-Security-Policy', `frame-ancestors ${frameAncestors}`);
    }
  });

  await fastify.register(projectRoutes);
  await fastify.register(environmentRoutes);
  await fastify.register(databaseConnectionRoutes);
  await fastify.register(projectVariableRoutes);
  await fastify.register(channelRoutes);
  await fastify.register(exportRoutes);
  await fastify.register(dashboardRoutes);
  await fastify.register(suiteRoutes);
  await fastify.register(scheduleRoutes);
  await fastify.register(testRoutes);
  await fastify.register(projectAuthRoutes);
  await fastify.register(runRoutes);
  await fastify.register(webhookRoutes);
  await fastify.register(recordingRoutes);
  if (process.env.DISABLE_TEST_WORKER !== '1') {
    await startTestWorker();
  }
  await schedulerService.loadAll();

  fastify.get('/health', async () => ({ status: 'ok', port }));

  fastify.get('/health/db', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'connected' };
  });

  fastify.get('/trace-viewer', async (_, reply) => {
    return reply.redirect('/trace-viewer/', 302);
  });

  fastify.get('/api/trace-viewer', async (_, reply) => {
    return reply.redirect('/api/trace-viewer/', 302);
  });

  await fastify.listen({ port, host: '0.0.0.0' });
}

void start().catch((error) => {
  // Keep startup failures visible and exit non-zero.
  console.error(error);
  process.exit(1);
});
