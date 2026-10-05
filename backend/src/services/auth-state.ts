import prisma from '../prisma';
import {
  authStateStorage,
  hasAuthenticationMaterial,
  type AuthStorageState
} from './auth-state-storage';

const AUTH_STATE_EMPTY_ERROR =
  'Authentication check passed, but no browser authentication state was captured.';
const AUTH_STATE_MISSING_ERROR =
  'Reusable authentication is enabled, but no saved browser state is available. Refresh authentication in Project Settings.';

export async function resolveAuthStateForExecution(input: {
  projectId: string;
  environmentId?: string | null;
  useProjectAuthentication: boolean;
  isAuthRefresh?: boolean;
}) {
  if (input.isAuthRefresh || !input.useProjectAuthentication || !input.environmentId) {
    return undefined;
  }

  const profile = await prisma.projectAuthState.findUnique({
    where: {
      projectId_environmentId: {
        projectId: input.projectId,
        environmentId: input.environmentId
      }
    }
  });

  if (!profile?.enabled) return undefined;
  if (!profile.storageKey) throw new Error(AUTH_STATE_MISSING_ERROR);

  try {
    const state = await authStateStorage.get(profile.storageKey);
    if (!state) {
      await prisma.projectAuthState.updateMany({
        where: { id: profile.id, storageKey: profile.storageKey },
        data: {
          status: 'UNAVAILABLE',
          lastError: AUTH_STATE_MISSING_ERROR
        }
      });
      throw new Error(AUTH_STATE_MISSING_ERROR);
    }
    return state;
  } catch (error) {
    if (error instanceof Error && error.message === AUTH_STATE_MISSING_ERROR) throw error;
    const message = `Saved authentication state could not be loaded. Refresh authentication in Project Settings. ${
      error instanceof Error ? error.message : String(error)
    }`;
    await prisma.projectAuthState.updateMany({
      where: { id: profile.id, storageKey: profile.storageKey },
      data: {
        status: 'UNAVAILABLE',
        lastError: message.slice(0, 10_000)
      }
    });
    throw new Error(message);
  }
}

export async function completeAuthRefresh(input: {
  profileId: string;
  authCheckId: string;
  runId: string;
  state: AuthStorageState;
}) {
  if (!hasAuthenticationMaterial(input.state)) {
    throw new Error(AUTH_STATE_EMPTY_ERROR);
  }

  const profile = await prisma.projectAuthState.findUnique({
    where: { id: input.profileId }
  });
  if (!profile || profile.authCheckId !== input.authCheckId || profile.status !== 'REFRESHING') {
    throw new Error('Authentication configuration changed while the refresh was running.');
  }

  const nextStorageKey = await authStateStorage.save(
    profile.projectId,
    profile.environmentId,
    input.state
  );

  try {
    const updated = await prisma.projectAuthState.updateMany({
      where: {
        id: profile.id,
        authCheckId: input.authCheckId,
        status: 'REFRESHING'
      },
      data: {
        status: 'AVAILABLE',
        storageKey: nextStorageKey,
        refreshedAt: new Date(),
        refreshedRunId: input.runId,
        lastError: null
      }
    });

    if (updated.count !== 1) {
      throw new Error('Authentication configuration changed while the refresh was running.');
    }
  } catch (error) {
    await authStateStorage.delete(nextStorageKey).catch(() => undefined);
    throw error;
  }

  if (profile.storageKey && profile.storageKey !== nextStorageKey) {
    await authStateStorage.delete(profile.storageKey).catch((error) => {
      console.error(`[AuthState] Failed to remove superseded state ${profile.storageKey}:`, error);
    });
  }
}

export async function failAuthRefresh(profileId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await prisma.projectAuthState.updateMany({
    where: { id: profileId, status: 'REFRESHING' },
    data: {
      status: 'REFRESH_FAILED',
      lastError: message.slice(0, 10_000)
    }
  });
}

export async function deleteAuthStateArtifact(storageKey?: string | null) {
  if (!storageKey) return;
  await authStateStorage.delete(storageKey);
}
