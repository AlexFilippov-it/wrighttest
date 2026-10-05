import type { FastifyInstance } from 'fastify';
import type { Environment, ProjectAuthState, Test } from '@prisma/client';
import { z } from 'zod';
import prisma from '../prisma';
import { enqueueTestRun } from '../queue/batch-sequencer';
import { deleteAuthStateArtifact, failAuthRefresh } from '../services/auth-state';
import type { Step } from '../types/step';
import {
  getAuthUser,
  getProjectAccessStatusCode,
  requireProjectRole
} from '../utils/project-access';
import { hasAssertionSteps } from '../utils/step-validation';

const ConfigureAuthStateSchema = z.object({
  authCheckId: z.string().min(1),
  enabled: z.boolean()
});

type AuthProfileWithRelations = ProjectAuthState & {
  environment: Pick<Environment, 'id' | 'name'>;
  authCheck: Pick<Test, 'id' | 'name'>;
};

class AuthProfileConflictError extends Error {}

function serializeAuthProfile(profile: AuthProfileWithRelations) {
  const { storageKey: _storageKey, ...metadata } = profile;
  return {
    ...metadata,
    hasUsableState: Boolean(profile.storageKey)
  };
}

async function findProfile(projectId: string, environmentId: string) {
  return prisma.projectAuthState.findUnique({
    where: {
      projectId_environmentId: { projectId, environmentId }
    },
    include: {
      environment: { select: { id: true, name: true } },
      authCheck: { select: { id: true, name: true } }
    }
  });
}

export async function projectAuthRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/authentication',
    async (req, reply) => {
      const { userId } = getAuthUser(req);
      try {
        await requireProjectRole(req.params.projectId, userId, ['OWNER', 'EDITOR', 'VIEWER']);
      } catch (error) {
        return reply.status(getProjectAccessStatusCode(error)).send({
          error: error instanceof Error ? error.message : 'Forbidden'
        });
      }

      const profiles = await prisma.projectAuthState.findMany({
        where: { projectId: req.params.projectId },
        include: {
          environment: { select: { id: true, name: true } },
          authCheck: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'asc' }
      });

      return profiles.map(serializeAuthProfile);
    }
  );

  fastify.put<{ Params: { projectId: string; environmentId: string } }>(
    '/projects/:projectId/authentication/:environmentId',
    async (req, reply) => {
      const body = ConfigureAuthStateSchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.flatten() });
      }

      const { userId } = getAuthUser(req);
      try {
        await requireProjectRole(req.params.projectId, userId, ['OWNER', 'EDITOR']);
      } catch (error) {
        return reply.status(getProjectAccessStatusCode(error)).send({
          error: error instanceof Error ? error.message : 'Forbidden'
        });
      }

      const [environment, authCheck, existing] = await Promise.all([
        prisma.environment.findUnique({ where: { id: req.params.environmentId } }),
        prisma.test.findUnique({ where: { id: body.data.authCheckId } }),
        prisma.projectAuthState.findUnique({
          where: {
            projectId_environmentId: {
              projectId: req.params.projectId,
              environmentId: req.params.environmentId
            }
          }
        })
      ]);

      if (!environment || environment.projectId !== req.params.projectId) {
        return reply.status(404).send({ error: 'Environment not found' });
      }
      if (!authCheck || authCheck.projectId !== req.params.projectId) {
        return reply.status(404).send({ error: 'Authentication check not found' });
      }
      const authCheckChanged = Boolean(existing && existing.authCheckId !== body.data.authCheckId);
      let profileId: string;
      if (existing) {
        const updated = await prisma.projectAuthState.updateMany({
          where: {
            id: existing.id,
            status: { not: 'REFRESHING' }
          },
          data: {
            authCheckId: body.data.authCheckId,
            enabled: body.data.enabled,
            ...(authCheckChanged
              ? {
                  status: 'UNAVAILABLE' as const,
                  storageKey: null,
                  refreshedAt: null,
                  refreshedRunId: null,
                  lastError: null
                }
              : {})
          }
        });
        if (updated.count !== 1) {
          return reply.status(409).send({
            error: 'Authentication settings cannot be changed while a refresh is running'
          });
        }
        profileId = existing.id;
      } else {
        const profile = await prisma.projectAuthState.create({
          data: {
            projectId: req.params.projectId,
            environmentId: req.params.environmentId,
            authCheckId: body.data.authCheckId,
            enabled: body.data.enabled
          }
        });
        profileId = profile.id;
      }

      if (authCheckChanged && existing?.storageKey) {
        await deleteAuthStateArtifact(existing.storageKey).catch((error) => {
          console.error(`[AuthState] Failed to remove state ${existing.storageKey}:`, error);
        });
      }

      const response = await prisma.projectAuthState.findUnique({
        where: { id: profileId },
        include: {
          environment: { select: { id: true, name: true } },
          authCheck: { select: { id: true, name: true } }
        }
      });
      return response ? serializeAuthProfile(response) : reply.status(500).send({ error: 'Authentication profile was not saved' });
    }
  );

  fastify.post<{ Params: { projectId: string; environmentId: string } }>(
    '/projects/:projectId/authentication/:environmentId/refresh',
    async (req, reply) => {
      const { userId } = getAuthUser(req);
      try {
        await requireProjectRole(req.params.projectId, userId, ['OWNER', 'EDITOR']);
      } catch (error) {
        return reply.status(getProjectAccessStatusCode(error)).send({
          error: error instanceof Error ? error.message : 'Forbidden'
        });
      }

      const profile = await findProfile(req.params.projectId, req.params.environmentId);
      if (!profile) {
        return reply.status(404).send({ error: 'Authentication profile is not configured for this environment' });
      }

      const authCheck = await prisma.test.findUnique({
        where: { id: profile.authCheckId },
        select: { steps: true }
      });
      if (!authCheck || !hasAssertionSteps(authCheck.steps as unknown as Step[])) {
        return reply.status(400).send({
          error:
            'Authentication check must contain at least one assertion that confirms login succeeded, such as Assert URL or Assert visible.'
        });
      }

      let run;
      try {
        run = await prisma.$transaction(async (tx) => {
          const locked = await tx.projectAuthState.updateMany({
            where: {
              id: profile.id,
              authCheckId: profile.authCheckId,
              status: { not: 'REFRESHING' }
            },
            data: {
              status: 'REFRESHING',
              lastError: null
            }
          });
          if (locked.count !== 1) {
            throw new AuthProfileConflictError(
              'Authentication configuration changed or a refresh is already running'
            );
          }

          return tx.testRun.create({
            data: {
              testId: profile.authCheckId,
              environmentId: profile.environmentId,
              authStateId: profile.id,
              runMode: 'AUTH_REFRESH',
              status: 'PENDING'
            }
          });
        });
      } catch (error) {
        if (error instanceof AuthProfileConflictError) {
          return reply.status(409).send({ error: error.message });
        }
        throw error;
      }

      try {
        const job = await enqueueTestRun(run);
        return reply.status(202).send({
          authStateId: profile.id,
          testRunId: run.id,
          jobId: job.id,
          status: 'REFRESHING'
        });
      } catch (error) {
        await prisma.testRun.update({
          where: { id: run.id },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            error: error instanceof Error ? error.message : String(error)
          }
        });
        await failAuthRefresh(profile.id, error);
        throw error;
      }
    }
  );

  fastify.delete<{ Params: { projectId: string; environmentId: string } }>(
    '/projects/:projectId/authentication/:environmentId',
    async (req, reply) => {
      const { userId } = getAuthUser(req);
      try {
        await requireProjectRole(req.params.projectId, userId, ['OWNER', 'EDITOR']);
      } catch (error) {
        return reply.status(getProjectAccessStatusCode(error)).send({
          error: error instanceof Error ? error.message : 'Forbidden'
        });
      }

      const profile = await prisma.projectAuthState.findUnique({
        where: {
          projectId_environmentId: {
            projectId: req.params.projectId,
            environmentId: req.params.environmentId
          }
        }
      });
      if (!profile) return reply.status(204).send();
      if (profile.status === 'REFRESHING') {
        return reply.status(409).send({ error: 'Authentication refresh is currently running' });
      }

      await prisma.projectAuthState.delete({ where: { id: profile.id } });
      await deleteAuthStateArtifact(profile.storageKey).catch((error) => {
        console.error(`[AuthState] Failed to remove state ${profile.storageKey}:`, error);
      });
      return reply.status(204).send();
    }
  );
}
