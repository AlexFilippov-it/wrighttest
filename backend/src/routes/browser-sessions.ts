import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BrowserSessionError, BrowserSessionManager } from '../services/browser-sessions';
import { getAuthUser, getProjectAccessStatusCode, requireProjectRole } from '../utils/project-access';

const StartSchema = z.object({ projectId: z.string().min(1), url: z.string().url().max(2048) });
const NavigateSchema = z.object({ projectId: z.string().min(1), url: z.string().url().max(2048) });
const LocatorSchema = z.object({ projectId: z.string().min(1), selector: z.string().min(1).max(500) });

function sendError(reply: FastifyReply, error: unknown) {
  const statusCode = error instanceof BrowserSessionError
    ? error.statusCode
    : getProjectAccessStatusCode(error);
  return reply.status(statusCode).send({ error: error instanceof Error ? error.message : 'Browser operation failed' });
}

export function createBrowserSessionRoutes(manager = new BrowserSessionManager()) {
  const routes = async (fastify: FastifyInstance) => {
    fastify.addHook('onClose', async () => manager.closeAll());

    fastify.post('/browser-sessions', async (request, reply) => {
      const parsed = StartSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      const { userId } = getAuthUser(request);
      try {
        await requireProjectRole(parsed.data.projectId, userId, ['OWNER', 'EDITOR']);
        return reply.status(201).send(await manager.start(userId, parsed.data.projectId, parsed.data.url));
      } catch (error) { return sendError(reply, error); }
    });

    fastify.post<{ Params: { id: string } }>('/browser-sessions/:id/navigate', async (request, reply) => {
      const parsed = NavigateSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      const { userId } = getAuthUser(request);
      try {
        await requireSessionRole(request.params.id, parsed.data.projectId, userId);
        return reply.send(await manager.navigate(request.params.id, userId, parsed.data.projectId, parsed.data.url));
      } catch (error) { return sendError(reply, error); }
    });

    fastify.get<{ Params: { id: string }; Querystring: { projectId?: string } }>('/browser-sessions/:id/snapshot', async (request, reply) => {
      const projectId = request.query.projectId;
      if (!projectId) return reply.status(400).send({ error: 'projectId is required' });
      const { userId } = getAuthUser(request);
      try {
        await requireSessionRole(request.params.id, projectId, userId);
        return reply.send(await manager.snapshot(request.params.id, userId, projectId));
      } catch (error) { return sendError(reply, error); }
    });

    fastify.post<{ Params: { id: string } }>('/browser-sessions/:id/click', async (request, reply) => {
      const parsed = LocatorSchema.extend({ confirmedSideEffect: z.boolean().optional() }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      const { userId } = getAuthUser(request);
      try {
        await requireSessionRole(request.params.id, parsed.data.projectId, userId);
        return reply.send(await manager.click(request.params.id, userId, parsed.data.projectId, parsed.data.selector, parsed.data.confirmedSideEffect));
      } catch (error) { return sendError(reply, error); }
    });

    fastify.post<{ Params: { id: string } }>('/browser-sessions/:id/fill', async (request, reply) => {
      const parsed = LocatorSchema.extend({ value: z.string().max(10_000) }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      const { userId } = getAuthUser(request);
      try {
        await requireSessionRole(request.params.id, parsed.data.projectId, userId);
        return reply.send(await manager.fill(request.params.id, userId, parsed.data.projectId, parsed.data.selector, parsed.data.value));
      } catch (error) { return sendError(reply, error); }
    });

    fastify.post<{ Params: { id: string } }>('/browser-sessions/:id/select', async (request, reply) => {
      const parsed = LocatorSchema.extend({ value: z.string().max(2000) }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      const { userId } = getAuthUser(request);
      try {
        await requireSessionRole(request.params.id, parsed.data.projectId, userId);
        return reply.send(await manager.select(request.params.id, userId, parsed.data.projectId, parsed.data.selector, parsed.data.value));
      } catch (error) { return sendError(reply, error); }
    });

    fastify.get<{ Params: { id: string }; Querystring: { projectId?: string } }>('/browser-sessions/:id/screenshot', async (request, reply) => {
      const projectId = request.query.projectId;
      if (!projectId) return reply.status(400).send({ error: 'projectId is required' });
      const { userId } = getAuthUser(request);
      try {
        await requireSessionRole(request.params.id, projectId, userId);
        return reply.send(await manager.screenshot(request.params.id, userId, projectId));
      } catch (error) { return sendError(reply, error); }
    });

    fastify.post<{ Params: { id: string } }>('/browser-sessions/:id/wait', async (request, reply) => {
      const parsed = LocatorSchema.extend({ state: z.enum(['visible', 'hidden']).optional(), timeoutMs: z.number().int().optional() }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      const { userId } = getAuthUser(request);
      try {
        await requireSessionRole(request.params.id, parsed.data.projectId, userId);
        return reply.send(await manager.wait(request.params.id, userId, parsed.data.projectId, parsed.data.selector, parsed.data.state, parsed.data.timeoutMs));
      } catch (error) { return sendError(reply, error); }
    });

    fastify.delete<{ Params: { id: string }; Querystring: { projectId?: string } }>('/browser-sessions/:id', async (request, reply) => {
      const projectId = request.query.projectId;
      if (!projectId) return reply.status(400).send({ error: 'projectId is required' });
      const { userId } = getAuthUser(request);
      try {
        await requireSessionRole(request.params.id, projectId, userId);
        return reply.send(await manager.close(request.params.id, userId, projectId));
      } catch (error) { return sendError(reply, error); }
    });
  };

  return { routes, manager };
}

async function requireSessionRole(sessionId: string, projectId: string, userId: string) {
  void sessionId;
  await requireProjectRole(projectId, userId, ['OWNER', 'EDITOR']);
}
