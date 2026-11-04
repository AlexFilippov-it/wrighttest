import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jsonBody, redactStrings, WrightTestApi } from './api.js';

const StepSchema = z.object({
  action: z.enum(['goto', 'click', 'fill', 'press', 'keyboardPress', 'selectOption', 'assertVisible', 'assertHidden', 'assertText', 'assertValue', 'assertURL', 'assertTitle', 'assertChecked', 'assertCount', 'waitForSelector']),
  selector: z.string().optional(),
  selectorCandidates: z.array(z.string()).optional(),
  elementText: z.string().optional(),
  elementTag: z.string().optional(),
  value: z.string().optional(),
  expected: z.string().optional(),
  options: z.object({ exact: z.boolean().optional(), timeout: z.number().int().positive().optional(), nth: z.number().int().nonnegative().optional() }).optional()
});

const TestDataSchema = z.array(z.object({
  name: z.string().min(1).max(150),
  enabled: z.boolean(),
  variables: z.record(z.string(), z.string())
})).max(100);

const CheckFields = {
  name: z.string().min(1).max(200),
  url: z.string().min(1),
  steps: z.array(StepSchema),
  testData: TestDataSchema,
  device: z.string().nullable(),
  environmentId: z.string().nullable(),
  useProjectAuthentication: z.boolean()
};

const UpdateCheckFields = {
  name: z.string().min(1).max(200).optional(),
  url: z.string().min(1).optional(),
  steps: z.array(StepSchema).optional(),
  testData: TestDataSchema.optional(),
  device: z.string().nullable().optional(),
  environmentId: z.string().nullable().optional(),
  useProjectAuthentication: z.boolean().optional()
};

type ProjectSummary = {
  id: string; name: string; createdAt?: string; updatedAt?: string; currentUserRole?: string;
  checksCount?: number; summary?: unknown; [key: string]: unknown;
};

type RunPayload = {
  id: string;
  status: string;
  startedAt?: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  error?: string | null;
  currentStep?: number | null;
  totalSteps?: number | null;
  screenshots?: unknown;
  stepResults?: unknown;
  trace?: { available?: boolean; reason?: string; downloadUrl?: string; viewerUrl?: string };
  environment?: { variables?: unknown } | null;
  dataCaseVariables?: unknown;
  [key: string]: unknown;
};

const READ_ROLES = 'Owner, Editor, or Viewer';
const WRITE_ROLES = 'Owner or Editor';

function result(value: unknown) {
  const safeValue = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { result: value };
  return { content: [{ type: 'text' as const, text: jsonBody(value) }], structuredContent: safeValue };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : 'WrightTest operation failed';
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

function projectView(project: ProjectSummary) {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    currentUserRole: project.currentUserRole,
    checksCount: project.checksCount,
    summary: project.summary
  };
}

function checkView(check: Record<string, unknown>) {
  return {
    id: check.id,
    projectId: check.projectId,
    name: check.name,
    url: check.url,
    device: check.device,
    environmentId: check.environmentId,
    useProjectAuthentication: check.useProjectAuthentication,
    steps: check.steps,
    createdAt: check.createdAt,
    updatedAt: check.updatedAt
  };
}

async function safeRunPayload(api: WrightTestApi, run: RunPayload) {
  const environmentVariables = run.environment?.variables;
  const dataCaseVariables = run.dataCaseVariables;
  const secrets = [environmentVariables, dataCaseVariables]
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value)))
    .flatMap((variables) => Object.values(variables).filter((value): value is string => typeof value === 'string'));
  const hasShortSecret = secrets.some((secret) => secret.length > 0 && secret.length < 3);
  const rawStepResults = Array.isArray(run.stepResults) ? run.stepResults : [];
  const stepResults = rawStepResults.map((step) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
    const record = step as Record<string, unknown>;
    return {
      index: record.index,
      action: record.action,
      status: record.status,
      durationMs: record.durationMs,
      error: hasShortSecret ? undefined : record.error
    };
  }).filter(Boolean);
  const screenshots = Array.isArray(run.screenshots)
    ? run.screenshots.filter((name): name is string => typeof name === 'string' && name.length > 0 && !name.includes('..'))
      .map((name) => ({ name, url: api.absoluteUrl(`/screenshots/${encodeURIComponent(name)}`) }))
    : [];
  const trace = run.trace?.available
    ? {
        available: true,
        downloadUrl: run.trace.downloadUrl ? api.absoluteUrl(run.trace.downloadUrl) : undefined,
        viewerUrl: run.trace.viewerUrl ? api.absoluteUrl(run.trace.viewerUrl) : undefined
      }
    : { available: false, reason: run.trace?.reason };

  return redactStrings({
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    currentStep: run.currentStep,
    totalSteps: run.totalSteps,
    error: hasShortSecret ? undefined : run.error,
    stepResults,
    screenshots,
    trace
  }, secrets);
}

export function registerWrightTestTools(server: McpServer, api: WrightTestApi) {
  server.registerTool('list_projects', {
    description: `List projects the authenticated user can access (${READ_ROLES}).`,
    inputSchema: {}
  }, async () => {
    try {
      const projects = await api.request<ProjectSummary[]>('/projects');
      return result(projects.map(projectView));
    } catch (error) { return fail(error); }
  });

  server.registerTool('get_project', {
    description: `Get a project summary. Requires ${READ_ROLES}.`,
    inputSchema: { projectId: z.string().min(1) }
  }, async ({ projectId }) => {
    try { return result(projectView(await api.request<ProjectSummary>(`/projects/${encodeURIComponent(projectId)}`))); }
    catch (error) { return fail(error); }
  });

  server.registerTool('create_project', {
    description: 'Create a project. WrightTest restricts this operation to the configured system administrator.',
    inputSchema: { name: z.string().min(1).max(100) }
  }, async ({ name }) => {
    try { return result(await api.request('/projects', { method: 'POST', body: jsonBody({ name }) })); }
    catch (error) { return fail(error); }
  });

  server.registerTool('update_project', {
    description: 'Rename a project. Requires project Owner role.',
    inputSchema: { projectId: z.string().min(1), name: z.string().min(1).max(100) }
  }, async ({ projectId, name }) => {
    try { return result(await api.request(`/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: jsonBody({ name }) })); }
    catch (error) { return fail(error); }
  });

  server.registerTool('list_checks', {
    description: `List checks in a project. Requires ${READ_ROLES}.`,
    inputSchema: { projectId: z.string().min(1) }
  }, async ({ projectId }) => {
    try {
      const checks = await api.request<Record<string, unknown>[]>(`/projects/${encodeURIComponent(projectId)}/tests`);
      return result(checks.map((check) => ({ id: check.id, projectId: check.projectId, name: check.name, url: check.url, device: check.device, environmentId: check.environmentId, stepsCount: Array.isArray(check.steps) ? check.steps.length : 0, runCount: check._count && typeof check._count === 'object' ? (check._count as Record<string, unknown>).runs : undefined })));
    } catch (error) { return fail(error); }
  });

  server.registerTool('get_check', {
    description: `Get a check and its browser-flow steps. Requires ${READ_ROLES}.`,
    inputSchema: { checkId: z.string().min(1) }
  }, async ({ checkId }) => {
    try { return result(checkView(await api.request<Record<string, unknown>>(`/tests/${encodeURIComponent(checkId)}`))); }
    catch (error) { return fail(error); }
  });

  server.registerTool('create_check', {
    description: `Create a browser check. Requires ${WRITE_ROLES}.`,
    inputSchema: { projectId: z.string().min(1), ...CheckFields, steps: z.array(StepSchema).optional(), testData: TestDataSchema.optional(), device: z.string().nullable().optional(), environmentId: z.string().nullable().optional(), useProjectAuthentication: z.boolean().optional() }
  }, async ({ projectId, ...payload }) => {
    try { return result(checkView(await api.request<Record<string, unknown>>(`/projects/${encodeURIComponent(projectId)}/tests`, { method: 'POST', body: jsonBody(payload) }))); }
    catch (error) { return fail(error); }
  });

  server.registerTool('update_check', {
    description: `Update a browser check. Requires ${WRITE_ROLES}.`,
    inputSchema: { checkId: z.string().min(1), ...UpdateCheckFields }
  }, async ({ checkId, ...payload }) => {
    try { return result(checkView(await api.request<Record<string, unknown>>(`/tests/${encodeURIComponent(checkId)}`, { method: 'PATCH', body: jsonBody(payload) }))); }
    catch (error) { return fail(error); }
  });

  server.registerTool('list_suites', {
    description: `List suites in a project. Requires ${READ_ROLES}.`,
    inputSchema: { projectId: z.string().min(1) }
  }, async ({ projectId }) => {
    try { return result(await api.request(`/projects/${encodeURIComponent(projectId)}/suites`)); }
    catch (error) { return fail(error); }
  });

  server.registerTool('create_suite', {
    description: `Create a suite with one or more project check IDs. Requires ${WRITE_ROLES}.`,
    inputSchema: { projectId: z.string().min(1), name: z.string().min(1).max(100), checkIds: z.array(z.string().min(1)).min(1) }
  }, async ({ projectId, name, checkIds }) => {
    try { return result(await api.request(`/projects/${encodeURIComponent(projectId)}/suites`, { method: 'POST', body: jsonBody({ name, testIds: checkIds }) })); }
    catch (error) { return fail(error); }
  });

  server.registerTool('add_check_to_suite', {
    description: `Add a check to an existing suite. Requires ${WRITE_ROLES}.`,
    inputSchema: { projectId: z.string().min(1), suiteId: z.string().min(1), checkId: z.string().min(1) }
  }, async ({ projectId, suiteId, checkId }) => {
    try {
      const suites = await api.request<{ id: string; testIds: unknown }[]>(`/projects/${encodeURIComponent(projectId)}/suites`);
      const suite = suites.find((item) => item.id === suiteId);
      if (!suite) throw new Error('Suite not found in project');
      const testIds = Array.isArray(suite.testIds) ? suite.testIds.filter((id): id is string => typeof id === 'string') : [];
      const updated = await api.request(`/suites/${encodeURIComponent(suiteId)}`, { method: 'PATCH', body: jsonBody({ testIds: [...new Set([...testIds, checkId])] }) });
      return result(updated);
    } catch (error) { return fail(error); }
  });

  server.registerTool('run_check', {
    description: `Queue a check run and return immediately with its run ID. Requires ${WRITE_ROLES}. A data-driven check requires dataCaseIndex.`,
    inputSchema: { checkId: z.string().min(1), environmentId: z.string().optional(), dataCaseIndex: z.number().int().nonnegative().optional() }
  }, async ({ checkId, environmentId, dataCaseIndex }) => {
    try { return result(await api.request(`/tests/${encodeURIComponent(checkId)}/run`, { method: 'POST', body: jsonBody({ environmentId, dataCaseIndex }) })); }
    catch (error) { return fail(error); }
  });

  server.registerTool('run_suite', {
    description: `Queue a suite run and return immediately with run IDs. Requires ${WRITE_ROLES}.`,
    inputSchema: { suiteId: z.string().min(1), environmentId: z.string().optional() }
  }, async ({ suiteId, environmentId }) => {
    try { return result(await api.request(`/suites/${encodeURIComponent(suiteId)}/run`, { method: 'POST', body: jsonBody({ environmentId }) })); }
    catch (error) { return fail(error); }
  });

  server.registerTool('get_run_status', {
    description: `Get execution status without waiting for the browser run to finish. Requires ${READ_ROLES}.`,
    inputSchema: { runId: z.string().min(1) }
  }, async ({ runId }) => {
    try {
      const run = await api.request<RunPayload>(`/runs/${encodeURIComponent(runId)}`);
      const safeRun = await safeRunPayload(api, run);
      return result({ id: safeRun.id, status: safeRun.status, startedAt: safeRun.startedAt, finishedAt: safeRun.finishedAt, durationMs: safeRun.durationMs, currentStep: safeRun.currentStep, totalSteps: safeRun.totalSteps, error: safeRun.error });
    } catch (error) { return fail(error); }
  });

  server.registerTool('get_run_results', {
    description: `Get completed or in-progress step results and safe artifact links. Environment and authentication secrets are never included. Requires ${READ_ROLES}.`,
    inputSchema: { runId: z.string().min(1) }
  }, async ({ runId }) => {
    try { return result(await safeRunPayload(api, await api.request<RunPayload>(`/runs/${encodeURIComponent(runId)}`))); }
    catch (error) { return fail(error); }
  });
}
