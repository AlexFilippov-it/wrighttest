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
import { schedulerService } from './services/scheduler';

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '..', '.env')
];
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

async function start() {
  const fastify = Fastify({ logger: true });
  const port = Number(process.env.BACKEND_PORT) || 3000;
  const frontendOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:80',
    process.env.FRONTEND_DEV_URL || 'http://localhost:5173'
  ];

  await fastify.register(cors, {
    origin: frontendOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']
  });

  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: false,
    frameguard: false
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute'
  });

  await fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET ?? 'replace-this-with-a-long-random-string'
  });

  fastify.addHook('preHandler', async (req, reply) => {
    const publicRoutes = [
      { method: 'POST', url: '/auth/login' },
      { method: 'POST', url: '/auth/logout' },
      { method: 'GET', url: '/health' },
      { method: 'GET', url: '/health/db' },
      { method: 'POST', url: '/webhooks/trigger' },
      { method: 'GET', url: '/screenshots/' },
      { method: 'GET', url: '/traces/' },
      { method: 'GET', url: '/trace-viewer/' },
      { method: 'GET', url: '/trace-viewer' }
    ];

    const isPublic = publicRoutes.some((route) =>
      route.method === req.method && req.url.startsWith(route.url)
    );

    if (isPublic) return;

    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  await fastify.register(authRoutes);

  await fastify.register(fastifyStatic, {
    root: path.resolve(process.env.SCREENSHOTS_DIR || './screenshots'),
    prefix: '/screenshots/',
    decorateReply: false,
    setHeaders: (res) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }
  });

  await fastify.register(fastifyStatic, {
    root: path.resolve(process.env.TRACES_DIR || './traces'),
    prefix: '/traces/',
    decorateReply: false,
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', 'https://trace.playwright.dev');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }
  });

  await fastify.register(fastifyStatic, {
    root: traceViewerRoot,
    prefix: '/trace-viewer/',
    decorateReply: false,
    setHeaders: (res) => {
      res.setHeader('Content-Security-Policy', "frame-ancestors 'self' http://localhost:5173 http://localhost:80");
    }
  });

  await fastify.register(projectRoutes);
  await fastify.register(environmentRoutes);
  await fastify.register(channelRoutes);
  await fastify.register(exportRoutes);
  await fastify.register(dashboardRoutes);
  await fastify.register(suiteRoutes);
  await fastify.register(scheduleRoutes);
  await fastify.register(testRoutes);
  await fastify.register(runRoutes);
  await fastify.register(webhookRoutes);
  await fastify.register(recordingRoutes);
  await startTestWorker();
  await schedulerService.loadAll();

  fastify.get('/health', async () => ({ status: 'ok', port }));

  fastify.get('/health/db', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'connected' };
  });

  fastify.get('/trace-viewer', async (_, reply) => {
    return reply.redirect('/trace-viewer/', 302);
  });

  await fastify.listen({ port, host: '0.0.0.0' });
}

void start().catch((error) => {
  // Keep startup failures visible and exit non-zero.
  console.error(error);
  process.exit(1);
});
