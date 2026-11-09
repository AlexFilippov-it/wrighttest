import fs from 'node:fs/promises';
import path from 'node:path';
import type { APIRequestContext, APIResponse } from '@playwright/test';

export type AuthSession = {
  email: string;
  password: string;
  token: string;
};

export type E2EWorkspaceState = {
  originalActiveLocale: string;
  projectId: string;
  projectName: string;
  checkId: string;
  checkName: string;
  owner: AuthSession;
  editor: AuthSession;
  viewer: AuthSession;
};

export const apiBaseUrl = (
  process.env.E2E_API_URL
  ?? process.env.VITE_BACKEND_URL
  ?? `http://localhost:${process.env.BACKEND_PORT ?? '3000'}`
).replace(/\/$/, '');

const e2eStateDir = path.resolve(process.env.E2E_STATE_DIR ?? path.join(process.cwd(), 'test-results'));
export const workspaceStatePath = path.join(e2eStateDir, 'e2e-workspace.json');
const authCachePath = path.join(e2eStateDir, 'e2e-auth-sessions.json');

const e2eApiRequestWindowMs = 60_000;
// Keep browser/API smoke traffic below Fastify's unchanged 100 requests/minute limit.
const configuredE2eApiRequestLimit = Number(process.env.E2E_API_REQUEST_LIMIT);
const e2eApiRequestLimit = Number.isSafeInteger(configuredE2eApiRequestLimit) && configuredE2eApiRequestLimit > 0
  ? configuredE2eApiRequestLimit
  : 50;
const e2eApiRequestTimestamps: number[] = [];
let e2eApiRequestQueue: Promise<void> = Promise.resolve();

export function waitForE2eApiRequestSlot() {
  const scheduled = e2eApiRequestQueue.then(async () => {
    while (true) {
      const now = Date.now();
      while (e2eApiRequestTimestamps[0] <= now - e2eApiRequestWindowMs) {
        e2eApiRequestTimestamps.shift();
      }

      if (e2eApiRequestTimestamps.length < e2eApiRequestLimit) {
        e2eApiRequestTimestamps.push(Date.now());
        return;
      }

      const delay = Math.max(1, e2eApiRequestTimestamps[0] + e2eApiRequestWindowMs - now);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  });
  e2eApiRequestQueue = scheduled.catch(() => undefined);
  return scheduled;
}

type CachedAuthSession = { email: string; token: string };

async function readAuthCache(): Promise<CachedAuthSession[]> {
  try {
    const cached = JSON.parse(await fs.readFile(authCachePath, 'utf8')) as unknown;
    return Array.isArray(cached)
      ? cached.filter((item): item is CachedAuthSession =>
          !!item && typeof item === 'object' && typeof (item as CachedAuthSession).email === 'string' &&
          typeof (item as CachedAuthSession).token === 'string')
      : [];
  } catch {
    return [];
  }
}

export function requiredEnvironmentVariable(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set in the root .env before running E2E tests`);
  }
  return value;
}

async function responseBody(response: APIResponse) {
  const text = await response.text();
  return text || '<empty response>';
}

export async function requireOk(response: APIResponse, operation: string) {
  if (!response.ok()) {
    throw new Error(`${operation} failed with ${response.status()}: ${await responseBody(response)}`);
  }
}

export async function withRateLimitRetry(
  operation: () => Promise<APIResponse>,
  description: string,
  retries = 1,
  onRateLimited?: () => void
) {
  for (let attempt = 0; ; attempt += 1) {
    await waitForE2eApiRequestSlot();
    const response = await operation();
    if (response.status() !== 429) return response;

    const body = await response.text();
    onRateLimited?.();
    if (attempt >= retries) {
      throw new Error(`${description} remained rate limited after ${attempt} retry: HTTP 429 ${body}`);
    }

    const headerDelay = Number(response.headers()['retry-after']);
    const bodyDelay = Number(body.match(/retry in\s+(\d+(?:\.\d+)?)\s+seconds/i)?.[1]);
    const waitSeconds = Number.isFinite(headerDelay) && headerDelay > 0 ? headerDelay : bodyDelay;
    if (!Number.isFinite(waitSeconds) || waitSeconds <= 0 || waitSeconds > 90) {
      throw new Error(`${description} was rate limited, but no safe retry window was available: HTTP 429 ${body}`);
    }

    await new Promise((resolve) => setTimeout(resolve, Math.ceil(waitSeconds * 1000)));
  }
}

export function withRateLimitRetries(api: APIRequestContext, onRateLimited?: () => void): APIRequestContext {
  const retryableMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'fetch']);
  return new Proxy(api, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof property === 'string' && retryableMethods.has(property) && typeof value === 'function') {
        return (...args: unknown[]) => withRateLimitRetry(
          () => (value as (...requestArgs: unknown[]) => Promise<APIResponse>).apply(target, args),
          `${property.toUpperCase()} ${String(args[0] ?? '')}`,
          1,
          onRateLimited
        );
      }
      return typeof value === 'function' ? value.bind(target) : value;
    }
  }) as APIRequestContext;
}

export async function login(api: APIRequestContext, email: string, password: string): Promise<AuthSession> {
  const cachedSessions = await readAuthCache();
  const cached = cachedSessions.find((session) => session.email.toLowerCase() === email.toLowerCase());
  if (cached) {
    const validation = await withRateLimitRetry(
      () => api.get('/auth/me', { headers: { Authorization: `Bearer ${cached.token}` } }),
      `Validate cached login for ${email}`
    );
    if (validation?.ok()) {
      const body = await validation.json() as { email?: string };
      if (!body.email || body.email.toLowerCase() === email.toLowerCase()) {
        return { email, password, token: cached.token };
      }
    }
  }

  const response = await withRateLimitRetry(
    () => api.post('/auth/login', { data: { email, password } }),
    `Login for ${email}`
  );
  if (response.status() === 429) {
    const retryAfter = response.headers()['retry-after'];
    const retryHint = retryAfter ? ` Retry-After: ${retryAfter}.` : '';
    throw new Error(`Login for ${email} was rate limited by ${apiBaseUrl}/auth/login (HTTP 429).${retryHint} Reuse or wait for the application auth limit to reset; the test setup does not bypass it.`);
  }
  await requireOk(response, `Login for ${email}`);
  const body = await response.json() as { token: string; email: string };
  const nextCache = cachedSessions.filter((session) => session.email.toLowerCase() !== body.email.toLowerCase());
  nextCache.push({ email: body.email, token: body.token });
  await fs.mkdir(path.dirname(authCachePath), { recursive: true });
  const temporaryPath = `${authCachePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(nextCache), { mode: 0o600 });
  await fs.rename(temporaryPath, authCachePath);
  await fs.chmod(authCachePath, 0o600);
  return { email: body.email, password, token: body.token };
}

export async function addMember(
  api: APIRequestContext,
  projectId: string,
  email: string,
  password: string,
  role: 'EDITOR' | 'VIEWER'
) {
  const response = await withRateLimitRetry(
    () => api.post(`/projects/${projectId}/members`, { data: { email, password, role } }),
    `Add ${role.toLowerCase()} member`
  );
  await requireOk(response, `Add ${role.toLowerCase()} member`);
}
