import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import prisma from '../prisma';
import { CreateProjectSchema, UpdateProjectSchema } from '../schemas/project.schema';
import type { ProjectRole, RunStatus } from '@prisma/client';
import {
  getAuthUser,
  getProjectAccessStatusCode,
  getProjectOwnersCount,
  isProtectedAdminEmail,
  requireProjectRole,
} from '../utils/project-access';
import { deleteAuthStateArtifact } from '../services/auth-state';

type ProjectListItem = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  currentUserRole: ProjectRole | null;
  checksCount: number;
  activeSchedulesCount: number;
  alertChannelsCount: number;
  alertChannelTypes: string[];
  lastRunAt: Date | null;
  lastRunStatus: RunStatus | null;
  passRate30d: number | null;
  totalRuns30d: number;
  passedRuns30d: number;
  failedRuns30d: number;
  failedChecks: number;
  flakyChecks: number;
  health: 'passing' | 'failing' | 'flaky' | 'no_runs';
};

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

const PROJECT_READ_ROLES: ProjectRole[] = ['OWNER', 'EDITOR', 'VIEWER'];
const PROJECT_OWNER_ROLES: ProjectRole[] = ['OWNER'];

const ProjectMemberCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().optional(),
  role: z.enum(['OWNER', 'EDITOR', 'VIEWER'])
});

const ProjectMemberUpdateSchema = z.object({
  role: z.enum(['OWNER', 'EDITOR', 'VIEWER'])
});

function serializeProjectMember(member: {
  id: string;
  projectId: string;
  userId: string | null;
  email: string;
  role: ProjectRole;
  status: 'ACTIVE' | 'PENDING';
  createdAt: Date;
  updatedAt: Date;
  user?: { email: string } | null;
}) {
  return {
    ...member,
    isSystemAdmin: isProtectedAdminEmail(member.email)
  };
}

export async function projectRoutes(fastify: FastifyInstance) {
  fastify.get('/projects', async (req, reply) => {
    const { userId } = getAuthUser(req);
    const accessibleProjects = await prisma.project.findMany({
      where: {
        members: {
          some: {
            userId,
            status: 'ACTIVE'
          }
        }
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        members: {
          where: {
            userId,
            status: 'ACTIVE'
          },
          select: {
            role: true
          }
        },
        tests: {
          select: {
            id: true
          }
        },
        schedules: {
          where: { enabled: true },
          select: {
            id: true,
            name: true,
            cron: true,
            enabled: true
          }
        },
        channels: {
          select: {
            id: true,
            type: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const allTestIds = accessibleProjects.flatMap((project) => project.tests.map((test) => test.id));
    const recentWindow = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const allRuns = allTestIds.length
      ? await prisma.testRun.findMany({
          where: {
            testId: { in: allTestIds }
          },
          select: {
            status: true,
            startedAt: true,
            testId: true,
            test: {
              select: {
                projectId: true
              }
            }
          },
          orderBy: { startedAt: 'desc' }
        })
      : [];

    const recentRuns = allTestIds.length
      ? allRuns.filter((run) => run.startedAt >= recentWindow)
      : [];

    const recentRunsByProject = new Map<string, (typeof recentRuns)[number][]>();
    const latestRunsByProject = new Map<string, (typeof allRuns)[number][]>();

    for (const run of recentRuns) {
      const projectId = run.test.projectId;
      const list = recentRunsByProject.get(projectId) ?? [];
      list.push(run);
      recentRunsByProject.set(projectId, list);
    }

    for (const run of allRuns) {
      const projectId = run.test.projectId;
      const list = latestRunsByProject.get(projectId) ?? [];
      if (!list.some((item) => item.testId === run.testId)) {
        list.push(run);
        latestRunsByProject.set(projectId, list);
      }
    }

    const result: ProjectListItem[] = accessibleProjects.map((project) => {
      const projectRecentRuns = recentRunsByProject.get(project.id) ?? [];
      const projectLatestRuns = latestRunsByProject.get(project.id) ?? [];
      const projectLatestRun = projectLatestRuns[0] ?? null;
      const totalRuns30d = projectRecentRuns.length;
      const passedRuns30d = projectRecentRuns.filter((run) => run.status === 'PASSED').length;
      const failedRuns30d = projectRecentRuns.filter((run) => run.status === 'FAILED').length;
      const passRate30d = totalRuns30d > 0 ? Math.round((passedRuns30d / totalRuns30d) * 100) : null;
      const failedChecks = projectLatestRuns.filter((run) => run.status === 'FAILED').length;
      const flakyChecks = project.tests.filter((test) => {
        const runs = recentRuns.filter((run) => run.testId === test.id).map((run) => run.status);
        return runs.includes('PASSED') && runs.includes('FAILED');
      }).length;

      let health: ProjectListItem['health'] = 'no_runs';
      if (totalRuns30d > 0) {
        if (flakyChecks > 0) {
          health = 'flaky';
        } else if (failedChecks > 0) {
          health = 'failing';
        } else {
          health = 'passing';
        }
      }

      return {
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        currentUserRole: project.members[0]?.role ?? null,
        checksCount: project.tests.length,
        activeSchedulesCount: project.schedules.length,
        alertChannelsCount: project.channels.length,
        alertChannelTypes: unique(project.channels.map((channel) => channel.type)),
        lastRunAt: projectLatestRun?.startedAt ?? null,
        lastRunStatus: projectLatestRun?.status ?? null,
        passRate30d,
        totalRuns30d,
        passedRuns30d,
        failedRuns30d,
        failedChecks,
        flakyChecks,
        health
      };
    });

    return result;
  });

  fastify.get<{ Params: { id: string } }>('/projects/:id', async (req, reply) => {
    const { userId } = getAuthUser(req);
    let access;
    try {
      access = await requireProjectRole(req.params.id, userId, PROJECT_READ_ROLES);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
      tests: {
        include: {
          _count: { select: { runs: true } },
          schedules: {
            where: { enabled: true },
              select: {
                id: true,
                name: true,
                cron: true,
                enabled: true
              }
            },
            runs: {
              orderBy: { startedAt: 'desc' },
              take: 1,
              select: {
                id: true,
                status: true,
                startedAt: true,
                durationMs: true,
                error: true,
                tracePath: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        suites: {
          select: {
            id: true,
            testIds: true,
            schedules: {
              where: { enabled: true },
              select: {
                id: true,
                name: true,
                cron: true,
                enabled: true
              }
            }
          }
        },
        schedules: {
          where: { enabled: true },
          select: {
            id: true,
            name: true,
            cron: true,
            enabled: true
          }
        },
        channels: {
          select: {
            id: true
          }
        }
      }
    });

    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const testIds = project.tests.map((test) => test.id);
    const suiteSchedulesByTestId = new Map<string, { id: string; name: string; cron: string; enabled: boolean }[]>();
    for (const suite of project.suites) {
      const suiteTestIds = Array.isArray(suite.testIds) ? (suite.testIds as string[]) : [];
      for (const testId of suiteTestIds) {
        const list = suiteSchedulesByTestId.get(testId) ?? [];
        list.push(...suite.schedules);
        suiteSchedulesByTestId.set(testId, list);
      }
    }

    const recentWindow = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const runs = testIds.length
      ? await prisma.testRun.findMany({
          where: {
            testId: { in: testIds }
          },
          select: {
            id: true,
            status: true,
            startedAt: true,
            durationMs: true,
            testId: true,
            test: {
              select: {
                projectId: true
              }
            }
          },
          orderBy: { startedAt: 'desc' }
        })
      : [];

    const recentRuns = runs.filter((run) => run.startedAt >= recentWindow);
    const latestRunsByTest = new Map<string, (typeof runs)[number][]>();

    for (const run of runs) {
      const list = latestRunsByTest.get(run.testId) ?? [];
      if (!list.some((item) => item.testId === run.testId)) {
        list.push(run);
        latestRunsByTest.set(run.testId, list);
      }
    }

    const latestProjectRun = runs[0] ?? null;
    const totalRuns30d = recentRuns.length;
    const passedRuns30d = recentRuns.filter((run) => run.status === 'PASSED').length;
    const failedRuns30d = recentRuns.filter((run) => run.status === 'FAILED').length;
    const passRate30d = totalRuns30d > 0 ? Math.round((passedRuns30d / totalRuns30d) * 100) : null;
    const avgDurationSamples = recentRuns.filter((run) => typeof run.durationMs === 'number');
    const avgDurationMs =
      avgDurationSamples.length > 0
        ? Math.round(
            avgDurationSamples.reduce((sum, run) => sum + (run.durationMs ?? 0), 0) /
              avgDurationSamples.length
          )
        : null;
    const failedChecks = project.tests.filter((test) => {
      const latestRun = latestRunsByTest.get(test.id)?.[0];
      return latestRun?.status === 'FAILED';
    }).length;
    const flakyChecks = project.tests.filter((test) => {
      const statuses = recentRuns.filter((run) => run.testId === test.id).map((run) => run.status);
      return statuses.includes('PASSED') && statuses.includes('FAILED');
    }).length;
    const activeSchedules = new Map<string, { id: string; name: string; cron: string; enabled: boolean }>();
    for (const schedule of project.schedules) {
      activeSchedules.set(schedule.id, schedule);
    }
    for (const suite of project.suites) {
      for (const schedule of suite.schedules) {
        activeSchedules.set(schedule.id, schedule);
      }
    }

    return {
      ...project,
      currentUserRole: access.member.role,
      summary: {
        checksCount: project.tests.length,
        lastResult: latestProjectRun?.status ?? null,
        lastRunAt: latestProjectRun?.startedAt ?? null,
        passRate30d,
        totalRuns30d,
        passedRuns30d,
        failedRuns30d,
        activeSchedulesCount: activeSchedules.size,
        alertChannelsCount: project.channels.length,
        avgDurationMs,
        failedChecks,
        flakyChecks
      },
      tests: project.tests.map((test) => {
        const latestRun = test.runs[0] ?? null;
        const mergedSchedules = new Map<string, { id: string; name: string; cron: string; enabled: boolean }>();
        for (const schedule of test.schedules) {
          mergedSchedules.set(schedule.id, schedule);
        }
        for (const schedule of suiteSchedulesByTestId.get(test.id) ?? []) {
          mergedSchedules.set(schedule.id, schedule);
        }
        return {
          ...test,
          runCount: test._count.runs,
          lastRunAt: latestRun?.startedAt ?? null,
          lastRunStatus: latestRun?.status ?? null,
          lastRunDurationMs: latestRun?.durationMs ?? null,
          latestRun,
          scheduleCount: mergedSchedules.size,
          schedules: Array.from(mergedSchedules.values())
        };
      })
    };
  });

  fastify.post('/projects', async (req, reply) => {
    const result = CreateProjectSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const { userId, email } = getAuthUser(req);
    if (!isProtectedAdminEmail(email)) {
      return reply.status(403).send({ error: 'Project creation is restricted to the system admin' });
    }

    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({ data: result.data });
      await tx.projectMember.create({
        data: {
          projectId: created.id,
          userId,
          email,
          role: 'OWNER',
          status: 'ACTIVE'
        }
      });
      return created;
    });

    return reply.status(201).send(project);
  });

  fastify.patch<{ Params: { id: string } }>('/projects/:id', async (req, reply) => {
    const result = UpdateProjectSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(req.params.id, userId, PROJECT_OWNER_ROLES);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    try {
      const project = await prisma.project.update({
        where: { id: req.params.id },
        data: result.data
      });
      return project;
    } catch {
      return reply.status(404).send({ error: 'Project not found' });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/projects/:id', async (req, reply) => {
    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(req.params.id, userId, PROJECT_OWNER_ROLES);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    try {
      const authStates = await prisma.projectAuthState.findMany({
        where: { projectId: req.params.id },
        select: { storageKey: true, status: true }
      });
      if (authStates.some((profile) => profile.status === 'REFRESHING')) {
        return reply.status(409).send({ error: 'This project is currently refreshing authentication' });
      }
      await prisma.project.delete({ where: { id: req.params.id } });
      await Promise.all(
        authStates.map((profile) =>
          deleteAuthStateArtifact(profile.storageKey).catch((error) => {
            console.error(`[AuthState] Failed to remove state ${profile.storageKey}:`, error);
          })
        )
      );
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: 'Project not found' });
    }
  });

  fastify.get<{ Params: { id: string } }>('/projects/:id/members', async (req, reply) => {
    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(req.params.id, userId, PROJECT_OWNER_ROLES);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      select: { id: true }
    });

    if (!project) return reply.status(404).send({ error: 'Project not found' });

    return prisma.projectMember.findMany({
      where: { projectId: req.params.id },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      include: {
        user: {
          select: {
            email: true
          }
        }
      }
    }).then((members) =>
      members.map((member) => serializeProjectMember({
        id: member.id,
        projectId: member.projectId,
        userId: member.userId,
        email: member.email,
        role: member.role,
        status: member.status,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt,
        user: member.user ? { email: member.user.email } : null
      }))
    );
  });

  fastify.post<{ Params: { id: string } }>('/projects/:id/members', async (req, reply) => {
    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(req.params.id, userId, PROJECT_OWNER_ROLES);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    const result = ProjectMemberCreateSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      select: { id: true }
    });

    if (!project) return reply.status(404).send({ error: 'Project not found' });

    if (isProtectedAdminEmail(result.data.email) && result.data.role !== 'OWNER') {
      return reply.status(400).send({ error: 'This admin member must be added as an owner' });
    }

    const memberResult = await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { email: result.data.email },
        select: { id: true }
      });

      const password = result.data.password?.trim();
      if (!existingUser && !password) {
        return { error: 'Password is required when creating a new user' as const };
      }

      const user = existingUser
        ? { id: existingUser.id }
        : await tx.user.upsert({
          where: { email: result.data.email },
          create: {
            email: result.data.email,
            passwordHash: await bcrypt.hash(password ?? '', 12)
          },
          update: {},
          select: {
            id: true
          }
        });

      return tx.projectMember.upsert({
        where: {
          projectId_email: {
            projectId: project.id,
            email: result.data.email
          }
        },
        update: {
          userId: user.id,
          role: result.data.role,
          status: 'ACTIVE'
        },
        create: {
          projectId: project.id,
          email: result.data.email,
          userId: user.id,
          role: result.data.role,
          status: 'ACTIVE'
        }
      });
    });

    if ('error' in memberResult) {
      return reply.status(400).send({ error: memberResult.error });
    }

    return reply.status(201).send(serializeProjectMember(memberResult));
  });

  fastify.patch<{ Params: { id: string; memberId: string } }>('/projects/:id/members/:memberId', async (req, reply) => {
    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(req.params.id, userId, PROJECT_OWNER_ROLES);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    const result = ProjectMemberUpdateSchema.safeParse(req.body);
    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() });
    }

    const member = await prisma.projectMember.findFirst({
      where: {
        id: req.params.memberId,
        projectId: req.params.id
      }
    });

    if (!member) return reply.status(404).send({ error: 'Member not found' });
    if (isProtectedAdminEmail(member.email) && result.data.role !== 'OWNER') {
      return reply.status(400).send({ error: 'This admin member must stay an owner' });
    }

    const ownerCount = await getProjectOwnersCount(req.params.id);
    if (member.role === 'OWNER' && result.data.role !== 'OWNER' && ownerCount <= 1) {
      return reply.status(400).send({ error: 'Project must have at least one owner' });
    }

    const updated = await prisma.projectMember.update({
      where: { id: member.id },
      data: {
        role: result.data.role
      }
    });

    return serializeProjectMember(updated);
  });

  fastify.delete<{ Params: { id: string; memberId: string } }>('/projects/:id/members/:memberId', async (req, reply) => {
    const { userId } = getAuthUser(req);
    try {
      await requireProjectRole(req.params.id, userId, PROJECT_OWNER_ROLES);
    } catch (error) {
      return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
    }

    const member = await prisma.projectMember.findFirst({
      where: {
        id: req.params.memberId,
        projectId: req.params.id
      }
    });

    if (!member) return reply.status(404).send({ error: 'Member not found' });
    if (isProtectedAdminEmail(member.email)) {
      return reply.status(400).send({ error: 'This admin member cannot be removed' });
    }

    const ownerCount = await getProjectOwnersCount(req.params.id);
    if (member.role === 'OWNER' && ownerCount <= 1) {
      return reply.status(400).send({ error: 'Project must have at least one owner' });
    }

    await prisma.projectMember.delete({
      where: {
        id: member.id
      }
    });

    return reply.status(204).send();
  });
}
