import path from 'node:path';
import type { APIRequestContext, APIResponse } from '@playwright/test';

export type AuthSession = {
  email: string;
  password: string;
  token: string;
};

export type E2EWorkspaceState = {
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

export const workspaceStatePath = path.resolve(process.cwd(), 'test-results/e2e-workspace.json');

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

export async function login(api: APIRequestContext, email: string, password: string): Promise<AuthSession> {
  const response = await api.post('/auth/login', { data: { email, password } });
  await requireOk(response, `Login for ${email}`);
  const body = await response.json() as { token: string; email: string };
  return { email: body.email, password, token: body.token };
}

export async function addMember(
  api: APIRequestContext,
  projectId: string,
  email: string,
  password: string,
  role: 'EDITOR' | 'VIEWER'
) {
  const response = await api.post(`/projects/${projectId}/members`, {
    data: { email, password, role }
  });
  await requireOk(response, `Add ${role.toLowerCase()} member`);
}
