import { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../prisma';
import { CreateTestSchema, StepSchema, UpdateTestSchema } from '../schemas/test.schema';
import { runValidationInSubprocess } from '../services/validation-runner';
import { getAvailableDevices } from '../utils/devices';
import { getAuthUser, getProjectAccessStatusCode, requireProjectRole } from '../utils/project-access';
import { deleteAuthStateArtifact, resolveAuthStateForExecution } from '../services/auth-state';
import path from 'node:path';
import { resolveArtifactPath } from '../services/artifact-path';

const urlOrTemplate = z.string().refine((value) => {
  if (value.includes('{{')) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}, {
  message: 'Enter a valid URL or use {{VARIABLE}} placeholders'
});

const ValidateStepsSchema = z.object({
  projectId: z.string().min(1),
  url: urlOrTemplate,
  steps: z.array(StepSchema).default([]),
  device: z.string().optional(),
  environmentId: z.string().optional(),
  useProjectAuthentication: z.boolean().default(true)
});

function normalizeDevice(device?: string | null) {
  if (device === undefined) return undefined;
  if (device === null) return null;
  const trimmed = device.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEnvironmentId(environmentId?: string | null) {
  if (environmentId === undefined) return undefined;
  if (environmentId === null) return null;
  const trimmed = environmentId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function validateConnectionReferences(projectId: string, steps: Array<{ databaseConnectionId?: string }>) {
  const ids = [...new Set(steps.map((step) => step.databaseConnectionId).filter((id): id is string => Boolean(id)))];
  if (!ids.length) return true;
  const count = await prisma.databaseConnection.count({ where: { projectId, id: { in: ids } } });
  return count === ids.length;
}

export async function testRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { projectId: string } }>('/projects/:projectId/tests', async (req, reply) => {
    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(req.params.projectId, userId, ['OWNER', 'EDITOR', 'VIEWER']);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    return prisma.test.findMany({
      where: { projectId: req.params.projectId },
      include: { _count: { select: { runs: true } } },
      orderBy: { createdAt: 'desc' }
    });
  });

  fastify.get<{ Params: { id: string } }>('/tests/:id', async (req, reply) => {
    const test = await prisma.test.findUnique({
      where: { id: req.params.id },
      include: {
        runs: {
          select: {
            id: true, status: true, startedAt: true, finishedAt: true, durationMs: true,
            error: true, currentStep: true, totalSteps: true
          },
          orderBy: { startedAt: 'desc' },
          take: 10
        }
      }
    });

    if (!test) return reply.status(404).send({ error: 'Test not found' });
    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(test.projectId, userId, ['OWNER', 'EDITOR', 'VIEWER']);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }
    return test;
  });

  fastify.post<{ Params: { projectId: string } }>('/projects/:projectId/tests', async (req, reply) => {
    const result = CreateTestSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const project = await prisma.project.findUnique({
      where: { id: req.params.projectId }
    });

    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(req.params.projectId, userId, ['OWNER', 'EDITOR']);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    if (!(await validateConnectionReferences(req.params.projectId, result.data.steps))) {
      return reply.status(400).send({ error: 'A database connection referenced by this Check does not belong to this project.' });
    }

    const test = await prisma.test.create({
      data: {
        ...result.data,
        testData: result.data.testData as Prisma.InputJsonValue,
        device: normalizeDevice(result.data.device),
        environmentId: normalizeEnvironmentId(result.data.environmentId),
        projectId: req.params.projectId
      }
    });

    return reply.status(201).send(test);
  });

  fastify.patch<{ Params: { id: string } }>('/tests/:id', async (req, reply) => {
    const result = UpdateTestSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const existingTest = await prisma.test.findUnique({
      where: { id: req.params.id },
      select: { projectId: true }
    });
    if (!existingTest) return reply.status(404).send({ error: 'Test not found' });

    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(existingTest.projectId, userId, ['OWNER', 'EDITOR']);
      if (result.data.steps && !(await validateConnectionReferences(existingTest.projectId, result.data.steps))) {
        return reply.status(400).send({ error: 'A database connection referenced by this Check does not belong to this project.' });
      }
      const test = await prisma.test.update({
        where: { id: req.params.id },
        data: {
          ...result.data,
          ...(result.data.testData ? { testData: result.data.testData as Prisma.InputJsonValue } : {}),
          device: normalizeDevice(result.data.device),
          environmentId: normalizeEnvironmentId(result.data.environmentId)
        } as Prisma.TestUncheckedUpdateInput
      });
      return test;
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Test not found' });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/tests/:id', async (req, reply) => {
    try {
      const test = await prisma.test.findUnique({
        where: { id: req.params.id },
        select: {
          projectId: true,
          authProfiles: {
            select: { id: true, storageKey: true, status: true }
          }
        }
      });
      if (!test) return reply.status(404).send({ error: 'Test not found' });

      const { userId } = getAuthUser(req);
      await requireProjectRole(test.projectId, userId, ['OWNER', 'EDITOR']);

      if (test.authProfiles.some((profile) => profile.status === 'REFRESHING')) {
        return reply.status(409).send({ error: 'This check is currently refreshing authentication' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.projectAuthState.deleteMany({ where: { authCheckId: req.params.id } });
        await tx.test.delete({ where: { id: req.params.id } });
      });
      await Promise.all(
        test.authProfiles.map((profile) =>
          deleteAuthStateArtifact(profile.storageKey).catch((error) => {
            console.error(`[AuthState] Failed to remove state ${profile.storageKey}:`, error);
          })
        )
      );
      return reply.status(204).send();
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Test not found' });
    }
  });

  fastify.post('/tests/validate', async (req, reply) => {
    const result = ValidateStepsSchema.safeParse(req.body);
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
      const storageState = await resolveAuthStateForExecution({
        projectId: result.data.projectId,
        environmentId: result.data.environmentId,
        useProjectAuthentication: result.data.useProjectAuthentication
      });
      const report = await runValidationInSubprocess(
        result.data.url,
        result.data.steps,
        result.data.device,
        storageState
      );
      const { tracePath, ...safeReport } = report;
      let traceUrl: string | undefined;
      let traceViewerUrl: string | undefined;
      if (tracePath) {
        const filename = path.basename(tracePath);
        const tracesDir = path.resolve(process.env.TRACES_DIR || './traces');
        try {
          await resolveArtifactPath(tracesDir, filename);
          const ticket = fastify.jwt.sign({
            typ: 'wrighttest-artifact',
            userId,
            projectId: result.data.projectId,
            kind: 'validationTrace',
            filename
          }, { expiresIn: '5m' });
          traceUrl = `/api/artifacts?ticket=${encodeURIComponent(ticket)}`;
          traceViewerUrl = `/trace-viewer/?trace=${encodeURIComponent(traceUrl)}`;
        } catch {
          // Do not expose an unverified filesystem path when the artifact is unavailable.
        }
      }
      return { ...safeReport, traceUrl, traceViewerUrl };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Validation failed';
      return reply.status(500).send({ error: message });
    }
  });

  fastify.get('/devices', async () => getAvailableDevices());
}
