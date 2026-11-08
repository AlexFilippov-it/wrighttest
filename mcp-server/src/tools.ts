import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jsonBody, redactStrings, WrightTestApi } from './api.js';

const StepSchema = z.object({
  action: z.enum(['goto', 'click', 'fill', 'press', 'keyboardPress', 'selectOption', 'assertVisible', 'assertHidden', 'assertText', 'assertValue', 'assertURL', 'assertTitle', 'assertChecked', 'assertCount', 'waitForSelector', 'executeSql', 'assertDatabaseResult', 'generateData', 'captureValue', 'httpRequest']),
  generator: z.enum(['username', 'email', 'password', 'uuid', 'string', 'number', 'boolean', 'date', 'timestamp', 'pattern']).optional(),
  generatorOptions: z.record(z.string().max(64), z.union([z.string().max(512), z.number().finite(), z.boolean()])).refine((options) => Object.keys(options).length <= 20).optional(),
  saveAs: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).optional(),
  captureSource: z.enum(['text', 'input', 'attribute', 'url', 'count']).optional(),
  attributeName: z.string().max(256).optional(),
  secret: z.boolean().optional(),
  replace: z.boolean().optional(),
  selector: z.string().optional(),
  selectorCandidates: z.array(z.string()).optional(),
  elementText: z.string().optional(),
  elementTag: z.string().optional(),
  value: z.string().optional(),
  expected: z.string().optional(),
  databaseConnectionId: z.string().min(1).optional(),
  sql: z.string().max(20_000).optional(),
  parameters: z.record(z.string(), z.union([z.string().max(10_000), z.number().finite(), z.boolean(), z.null()])).optional(),
  assertion: z.object({ type: z.enum(['rowCountEquals', 'rowCountGreaterThan', 'empty', 'notEmpty', 'columnEquals', 'columnContains', 'columnNotNull', 'affectedRowsEquals']), expected: z.string().optional(), column: z.string().max(256).optional(), rowIndex: z.number().int().nonnegative().max(100).optional() }).optional(),
  waitForResult: z.object({ timeoutMs: z.number().int().min(250).max(30_000), pollIntervalMs: z.number().int().min(250).max(5_000) }).optional(),
  saveResultAs: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).optional(),
  saveResultType: z.enum(['column', 'rowCount', 'affectedRows']).optional(),
  saveRowIndex: z.number().int().nonnegative().max(100).optional(),
  saveColumn: z.string().max(256).optional(),
  captureRows: z.boolean().optional(),
  http: z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']), url: z.string().min(1).max(8192),
    headers: z.array(z.object({ key: z.string().max(256), value: z.string().max(10000), enabled: z.boolean(), secret: z.boolean().optional() })).max(100).optional(),
    queryParams: z.array(z.object({ key: z.string().max(256), value: z.string().max(10000), enabled: z.boolean() })).max(100).optional(),
    body: z.object({ type: z.enum(['none', 'json', 'text', 'form-urlencoded']), value: z.string().max(512000).optional(), fields: z.array(z.object({ key: z.string().max(256), value: z.string().max(10000), enabled: z.boolean() })).max(100).optional() }).optional(),
    timeoutMs: z.number().int().min(100).max(120000).optional(), followRedirects: z.boolean().optional(),
    auth: z.discriminatedUnion('type', [z.object({ type: z.literal('none') }), z.object({ type: z.literal('bearer'), token: z.string().max(10000) }), z.object({ type: z.literal('basic'), username: z.string().max(2000), password: z.string().max(10000) }), z.object({ type: z.literal('apiKey'), apiKeyName: z.string().min(1).max(256), apiKeyValue: z.string().max(10000), apiKeyLocation: z.literal('header') })]).optional(),
    assertions: z.array(z.record(z.string(), z.unknown())).max(100).optional(),
    capture: z.array(z.object({ source: z.enum(['jsonPath', 'responseHeader', 'status', 'responseTime', 'textBody']), path: z.string().max(256).optional(), headerName: z.string().max(256).optional(), saveAs: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/), secret: z.boolean().optional(), replace: z.boolean().optional() })).max(100).optional()
  }).optional(),
  options: z.object({ exact: z.boolean().optional(), timeout: z.number().int().positive().optional(), nth: z.number().int().nonnegative().optional() }).optional()
});

const TestDataSchema = z.array(z.object({
  name: z.string().min(1).max(150),
  enabled: z.boolean(),
  variables: z.record(z.string(), z.union([
    z.string(),
    z.object({ kind: z.literal('literal'), value: z.unknown() }).strict(),
    z.object({ kind: z.literal('reference'), name: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/), source: z.enum(['project', 'environment']).optional() }).strict(),
    z.object({ kind: z.literal('generated'), generator: z.enum(['username', 'email', 'password', 'uuid', 'string', 'number', 'boolean', 'date', 'timestamp', 'pattern']), options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(), secret: z.boolean().optional() }).strict()
  ]))
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
  const secretName = /(pass(word)?|secret|token|api[_-]?key|authorization|auth[_-]?code|verification[_-]?code|otp|cookie|credential|private[_-]?key)/i;
  const secrets = [environmentVariables, dataCaseVariables]
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value)))
    .flatMap((variables) => Object.entries(variables)
      .filter(([name]) => secretName.test(name))
      .map(([, value]) => value)
      .filter((value): value is string => typeof value === 'string'));
  const isSensitiveVariableName = (value: unknown) => typeof value === 'string' && secretName.test(value);
  const rawStepResults = Array.isArray(run.stepResults) ? run.stepResults : [];
  const captureArtifactsOmitted = rawStepResults.some((step) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return false;
    return Boolean((step as Record<string, unknown>).captured);
  }) || /omitted/i.test(run.trace?.reason ?? '');
  const hasGeneratedSecrets = rawStepResults.some((step) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return false;
    const generated = (step as Record<string, unknown>).generated;
    const captured = (step as Record<string, unknown>).captured;
    const sensitiveName = (entry: unknown) => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry) &&
      isSensitiveVariableName((entry as Record<string, unknown>).variableName));
    if (generated && typeof generated === 'object' && !Array.isArray(generated)) {
      const entry = generated as Record<string, unknown>;
      if (entry.secret === true || entry.generator === 'password' || sensitiveName(entry)) return true;
    }
    if (captured && typeof captured === 'object' && !Array.isArray(captured)) {
      const entry = captured as Record<string, unknown>;
      return entry.secret === true || sensitiveName(entry);
    }
    return false;
  });
  for (const step of rawStepResults) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) continue;
    const record = step as Record<string, unknown>;
    const generated = record.generated;
    if (generated && typeof generated === 'object' && !Array.isArray(generated)) {
      const entry = generated as Record<string, unknown>;
      if (entry.secret === true && typeof entry.value === 'string' && entry.value.length > 0) secrets.push(entry.value);
    }
    const captured = record.captured;
    if (captured && typeof captured === 'object' && !Array.isArray(captured)) {
      const entry = captured as Record<string, unknown>;
      if ((entry.secret === true || isSensitiveVariableName(entry.variableName)) && typeof entry.value === 'string' && entry.value.length > 0) secrets.push(entry.value);
    }
  }
  const hasShortSecret = secrets.some((secret) => secret.length > 0 && secret.length < 3);
  const stepResults = rawStepResults.map((step) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
    const record = step as Record<string, unknown>;
    const generatedRecord = record.generated && typeof record.generated === 'object' && !Array.isArray(record.generated)
      ? record.generated as Record<string, unknown>
      : undefined;
    const capturedRecord = record.captured && typeof record.captured === 'object' && !Array.isArray(record.captured)
      ? record.captured as Record<string, unknown>
      : undefined;
    const httpRecord = record.http && typeof record.http === 'object' && !Array.isArray(record.http)
      ? record.http as Record<string, unknown>
      : undefined;
    const generatedSecret = generatedRecord && (
      generatedRecord.secret === true || generatedRecord.generator === 'password' ||
      (typeof generatedRecord.variableName === 'string' && /(pass(word)?|secret|token|api[_-]?key|authorization|auth[_-]?code|verification[_-]?code|otp|cookie|credential|private[_-]?key)/i.test(generatedRecord.variableName))
    );
    return {
      index: record.index,
      action: record.action,
      status: record.status,
      durationMs: record.durationMs,
      error: hasShortSecret ? undefined : record.error,
      database: record.database && typeof record.database === 'object' ? record.database : undefined,
      http: httpRecord ? {
        method: httpRecord.method,
        url: httpRecord.url,
        status: httpRecord.status,
        durationMs: httpRecord.durationMs,
        responseBytes: httpRecord.responseBytes,
        requestHeaderNames: httpRecord.requestHeaderNames,
        responseHeaderNames: httpRecord.responseHeaderNames,
        assertions: httpRecord.assertions,
        captures: httpRecord.captures
      } : undefined,
      generated: generatedRecord ? {
        variableName: generatedRecord.variableName,
        generator: generatedRecord.generator,
        secret: Boolean(generatedSecret),
        ...(generatedSecret ? {} : { value: generatedRecord.value })
      } : undefined
      ,captured: capturedRecord ? {
        variableName: capturedRecord.variableName,
        source: capturedRecord.source,
        type: capturedRecord.type,
        createdByStep: capturedRecord.createdByStep,
        secret: Boolean(capturedRecord.secret || (typeof capturedRecord.variableName === 'string' && /(pass(word)?|secret|token|api[_-]?key|authorization|auth[_-]?code|verification[_-]?code|otp|cookie|credential|private[_-]?key)/i.test(capturedRecord.variableName))),
        ...((capturedRecord.secret !== true && typeof capturedRecord.variableName === 'string' && !/(pass(word)?|secret|token|api[_-]?key|authorization|auth[_-]?code|verification[_-]?code|otp|cookie|credential|private[_-]?key)/i.test(capturedRecord.variableName)) ? { value: capturedRecord.value } : {})
      } : undefined
    };
  }).filter(Boolean);
  const safeDataCaseVariables = run.dataCaseVariables && typeof run.dataCaseVariables === 'object' && !Array.isArray(run.dataCaseVariables)
    ? Object.fromEntries(Object.entries(run.dataCaseVariables as Record<string, unknown>).map(([name, value]) => [
        name,
        secretName.test(name) ? '••••••' : value
      ]))
    : undefined;
  const screenshots = !hasGeneratedSecrets && !captureArtifactsOmitted && Array.isArray(run.screenshots)
    ? run.screenshots.filter((name): name is string => typeof name === 'string' && name.length > 0 && !name.includes('..'))
      .map((name) => ({ name, url: api.absoluteUrl(`/screenshots/${encodeURIComponent(name)}`) }))
    : [];
  const trace = hasGeneratedSecrets || captureArtifactsOmitted
    ? { available: false, reason: captureArtifactsOmitted ? 'Trace links are omitted for runs that may capture secret values.' : 'Trace links are omitted for runs containing generated secrets.' }
    : run.trace?.available
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
    dataCaseName: run.dataCaseName,
    dataCaseVariables: safeDataCaseVariables,
    stepResults,
    screenshots,
    trace,
    ...(hasGeneratedSecrets || captureArtifactsOmitted ? { artifactsOmittedForSafety: true } : {})
  }, secrets);
}

export function registerWrightTestTools(server: McpServer, api: WrightTestApi) {
  server.registerTool('list_database_connections', {
    description: `List safe database connection metadata in a project. Passwords and encrypted credentials are never returned. Requires ${READ_ROLES}.`,
    inputSchema: { projectId: z.string().min(1) }
  }, async ({ projectId }) => {
    try { return result(await api.request(`/projects/${encodeURIComponent(projectId)}/connections`)); }
    catch (error) { return fail(error); }
  });

  server.registerTool('get_database_connection', {
    description: `Get safe metadata for a database connection. Passwords and encrypted credentials are never returned. Requires ${READ_ROLES}.`,
    inputSchema: { connectionId: z.string().min(1) }
  }, async ({ connectionId }) => {
    try { return result(await api.request(`/connections/${encodeURIComponent(connectionId)}`)); }
    catch (error) { return fail(error); }
  });

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

  server.registerTool('list_project_variables', {
    description: `List project variable metadata. Secret values are never returned. Requires ${READ_ROLES}.`,
    inputSchema: { projectId: z.string().min(1) }
  }, async ({ projectId }) => {
    try { return result(await api.request(`/projects/${encodeURIComponent(projectId)}/variables`)); }
    catch (error) { return fail(error); }
  });

  server.registerTool('create_project_variable', {
    description: `Create a project variable. Secret values are write-only and only Owners can create them. Requires ${WRITE_ROLES}.`,
    inputSchema: {
      projectId: z.string().min(1),
      name: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/),
      type: z.enum(['string', 'number', 'boolean', 'json', 'null']),
      value: z.unknown(), secret: z.boolean().optional(), description: z.string().max(500).optional()
    }
  }, async ({ projectId, ...payload }) => {
    try { return result(await api.request(`/projects/${encodeURIComponent(projectId)}/variables`, { method: 'POST', body: jsonBody(payload) })); }
    catch (error) { return fail(error); }
  });

  server.registerTool('update_project_variable', {
    description: `Update variable metadata/value. Existing secrets are never returned; only Owners can change secret values. Requires ${WRITE_ROLES}.`,
    inputSchema: {
      variableId: z.string().min(1),
      name: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).optional(),
      type: z.enum(['string', 'number', 'boolean', 'json', 'null']).optional(),
      value: z.unknown().optional(), secret: z.boolean().optional(), description: z.string().max(500).optional()
    }
  }, async ({ variableId, ...payload }) => {
    try { return result(await api.request(`/variables/${encodeURIComponent(variableId)}`, { method: 'PATCH', body: jsonBody(payload) })); }
    catch (error) { return fail(error); }
  });

  server.registerTool('delete_project_variable', {
    description: `Delete a project variable. Only Owners can delete secret variables. Requires ${WRITE_ROLES}.`,
    inputSchema: { variableId: z.string().min(1) }
  }, async ({ variableId }) => {
    try { await api.request(`/variables/${encodeURIComponent(variableId)}`, { method: 'DELETE' }); return result({ deleted: true, variableId }); }
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
    description: `Create a suite with ordered checks, execution mode, explicit output mappings, and optional Test Data case selections. Requires ${WRITE_ROLES}.`,
    inputSchema: {
      projectId: z.string().min(1), name: z.string().min(1).max(100), checkIds: z.array(z.string().min(1)).min(1),
      executionMode: z.enum(['INDEPENDENT', 'SEQUENTIAL']).optional(),
      orderedCheckIds: z.array(z.string().min(1)).optional(),
      dataCaseIndexes: z.record(z.string(), z.number().int().nonnegative()).optional(),
      mappings: z.array(z.object({
        sourceTestId: z.string().min(1), outputVariable: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/),
        targetTestId: z.string().min(1), targetVariable: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/),
        required: z.boolean().default(true), expectedType: z.enum(['string', 'number', 'boolean', 'json', 'null']).optional()
      })).optional()
    }
  }, async ({ projectId, name, checkIds, executionMode, orderedCheckIds, dataCaseIndexes, mappings }) => {
    try {
      const testIds = orderedCheckIds ?? checkIds;
      return result(await api.request(`/projects/${encodeURIComponent(projectId)}/suites`, {
        method: 'POST', body: jsonBody({ name, testIds, executionMode: executionMode ?? 'INDEPENDENT', executionConfig: { orderedTestIds: testIds, mappings: mappings ?? [], dataCaseIndexes: dataCaseIndexes ?? {} } })
      }));
    }
    catch (error) { return fail(error); }
  });

  server.registerTool('add_check_to_suite', {
    description: `Add a check to an existing suite. Requires ${WRITE_ROLES}.`,
    inputSchema: { projectId: z.string().min(1), suiteId: z.string().min(1), checkId: z.string().min(1) }
  }, async ({ projectId, suiteId, checkId }) => {
    try {
      const suites = await api.request<{ id: string; testIds: unknown; executionConfig?: { orderedTestIds?: string[]; mappings?: unknown[]; dataCaseIndexes?: Record<string, number> } }[]>(`/projects/${encodeURIComponent(projectId)}/suites`);
      const suite = suites.find((item) => item.id === suiteId);
      if (!suite) throw new Error('Suite not found in project');
      const testIds = Array.isArray(suite.testIds) ? suite.testIds.filter((id): id is string => typeof id === 'string') : [];
      const orderedTestIds = [...new Set([...(suite.executionConfig?.orderedTestIds ?? testIds), checkId])];
      const updated = await api.request(`/suites/${encodeURIComponent(suiteId)}`, { method: 'PATCH', body: jsonBody({
        testIds: orderedTestIds,
        executionConfig: { orderedTestIds, mappings: suite.executionConfig?.mappings ?? [], dataCaseIndexes: suite.executionConfig?.dataCaseIndexes ?? {} }
      }) });
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
    description: `Queue a suite run and return its suiteRunId immediately. Sequential suites use their saved explicit variable mappings and data case selections. Requires ${WRITE_ROLES}.`,
    inputSchema: { suiteId: z.string().min(1), environmentId: z.string().optional(), dataCaseIndexes: z.record(z.string(), z.number().int().nonnegative()).optional() }
  }, async ({ suiteId, environmentId, dataCaseIndexes }) => {
    try { return result(await api.request(`/suites/${encodeURIComponent(suiteId)}/run`, { method: 'POST', body: jsonBody({ environmentId, dataCaseIndexes }) })); }
    catch (error) { return fail(error); }
  });

  server.registerTool('get_suite_run', {
    description: `Get suite run state, ordered child check runs, safe handoff metadata, and errors. Variable values, including secrets, are never returned. Requires ${READ_ROLES}.`,
    inputSchema: { suiteRunId: z.string().min(1) }
  }, async ({ suiteRunId }) => {
    try { return result(await api.request(`/suite-runs/${encodeURIComponent(suiteRunId)}`)); }
    catch (error) { return fail(error); }
  });

  server.registerTool('cancel_suite_run', {
    description: `Cancel a pending or running suite. An already-running check may finish, but no subsequent sequential check will be started. Requires ${WRITE_ROLES}.`,
    inputSchema: { suiteRunId: z.string().min(1) }
  }, async ({ suiteRunId }) => {
    try { return result(await api.request(`/suite-runs/${encodeURIComponent(suiteRunId)}/cancel`, { method: 'POST', body: jsonBody({}) })); }
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
