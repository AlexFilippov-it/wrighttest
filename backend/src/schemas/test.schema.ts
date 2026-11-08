import { z } from 'zod';
import { GENERATORS, validateGeneratorOptions } from '../services/test-data-generators';

const TEST_DATA_CASE_LIMIT = 100;
const TEST_DATA_VARIABLE_LIMIT = 100;
const TEST_DATA_NAME_LIMIT = 150;
const TEST_DATA_VARIABLE_KEY_LIMIT = 100;
const TEST_DATA_VARIABLE_VALUE_LIMIT = 10_000;
const TEST_DATA_VARIABLE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const SENSITIVE_FIELD_PATTERN = /password|passwd|secret|token|api[-_]?key|credential|authorization|cookie|private[-_]?key/i;
const HttpAssertionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('statusEquals'), expected: z.number().int().min(100).max(599) }),
  z.object({ type: z.literal('statusIn'), expected: z.array(z.number().int().min(100).max(599)).min(1).max(20) }),
  z.object({ type: z.literal('responseTimeLessThan'), expected: z.number().int().positive().max(120_000) }),
  z.object({ type: z.literal('headerExists'), name: z.string().min(1).max(256) }),
  z.object({ type: z.enum(['headerEquals', 'headerContains']), name: z.string().min(1).max(256), expected: z.string().max(2_000) }),
  z.object({ type: z.literal('jsonPathExists'), path: z.string().min(1).max(256) }),
  z.object({ type: z.enum(['jsonPathEquals', 'jsonPathContains']), path: z.string().min(1).max(256), expected: z.union([z.string().max(2_000), z.number().finite(), z.boolean()]) }),
  z.object({ type: z.literal('jsonPathType'), path: z.string().min(1).max(256), expectedType: z.enum(['string', 'number', 'boolean', 'object', 'array', 'null']) }),
  z.object({ type: z.literal('jsonArrayLength'), path: z.string().min(1).max(256), expected: z.number().int().nonnegative() }),
  z.object({ type: z.enum(['textContains', 'textEquals']), expected: z.string().max(2_000) })
]);

const HttpRequestSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
  url: z.string().min(1).max(8_192),
  headers: z.array(z.object({ key: z.string().max(256), value: z.string().max(10_000), enabled: z.boolean(), secret: z.boolean().optional() })).max(100).optional(),
  queryParams: z.array(z.object({ key: z.string().max(256), value: z.string().max(10_000), enabled: z.boolean() })).max(100).optional(),
  body: z.object({
    type: z.enum(['none', 'json', 'text', 'form-urlencoded']),
    value: z.string().max(512_000).optional(),
    fields: z.array(z.object({ key: z.string().max(256), value: z.string().max(10_000), enabled: z.boolean() })).max(100).optional()
  }).optional(),
  timeoutMs: z.number().int().min(100).max(120_000).optional(),
  followRedirects: z.boolean().optional(),
  auth: z.discriminatedUnion('type', [
    z.object({ type: z.literal('none') }),
    z.object({ type: z.literal('bearer'), token: z.string().max(10_000) }),
    z.object({ type: z.literal('basic'), username: z.string().max(2_000), password: z.string().max(10_000) }),
    z.object({ type: z.literal('apiKey'), apiKeyName: z.string().min(1).max(256), apiKeyValue: z.string().max(10_000), apiKeyLocation: z.literal('header') })
  ]).optional(),
  assertions: z.array(HttpAssertionSchema).max(100).optional(),
  capture: z.array(z.object({
    source: z.enum(['jsonPath', 'responseHeader', 'status', 'responseTime', 'textBody']),
    path: z.string().max(256).optional(), headerName: z.string().max(256).optional(),
    saveAs: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/), secret: z.boolean().optional(), replace: z.boolean().optional()
  })).max(100).optional()
}).superRefine((http, ctx) => {
  const urlTemplate = http.url.replace(/\{\{[A-Z][A-Z0-9_]{0,99}\}\}/g, 'wt-variable');
  if (http.url.includes('{{') && /^\{\{[A-Z][A-Z0-9_]{0,99}\}\}(?:$|\/)/.test(http.url)) {
    // A base URL variable is parsed and security-checked by the worker after resolution.
  } else {
  try {
    const url = new URL(urlTemplate);
    if (!['http:', 'https:'].includes(url.protocol)) ctx.addIssue({ code: 'custom', message: 'Only HTTP and HTTPS URLs are supported.', path: ['url'] });
    if (url.username || url.password) ctx.addIssue({ code: 'custom', message: 'Credentials must not be embedded in the URL.', path: ['url'] });
    for (const [key, value] of url.searchParams.entries()) {
      if (SENSITIVE_FIELD_PATTERN.test(key) && !/^\{\{[A-Z][A-Z0-9_]{0,99}\}\}$/.test(value)) {
        ctx.addIssue({ code: 'custom', message: 'Sensitive URL parameters must reference variables.', path: ['url'] });
      }
    }
  } catch { ctx.addIssue({ code: 'custom', message: 'Enter a valid HTTP URL.', path: ['url'] }); }
  }
  const variableReference = (value: string | undefined) => Boolean(value && /^\{\{[A-Z][A-Z0-9_]{0,99}\}\}$/.test(value));
  if (http.auth?.type === 'bearer' && !variableReference(http.auth.token)) {
    ctx.addIssue({ code: 'custom', message: 'Bearer credentials must reference a secret variable.', path: ['auth', 'token'] });
  }
  if (http.auth?.type === 'basic' && (!variableReference(http.auth.username) || !variableReference(http.auth.password))) {
    ctx.addIssue({ code: 'custom', message: 'Basic authentication credentials must reference variables.', path: ['auth'] });
  }
  if (http.auth?.type === 'apiKey' && !variableReference(http.auth.apiKeyValue)) {
    ctx.addIssue({ code: 'custom', message: 'API keys must reference a secret variable.', path: ['auth', 'apiKeyValue'] });
  }
  for (const [index, header] of (http.headers ?? []).entries()) {
    if ((header.secret || /authorization|cookie|token|secret|api[-_]?key|credential|password/i.test(header.key)) && !variableReference(header.value)) {
      ctx.addIssue({ code: 'custom', message: 'Sensitive headers must reference a variable instead of storing a literal value.', path: ['headers', index, 'value'] });
    }
  }
  for (const [index, field] of (http.body?.fields ?? []).entries()) {
    if (SENSITIVE_FIELD_PATTERN.test(field.key) && !variableReference(field.value)) {
      ctx.addIssue({ code: 'custom', message: 'Sensitive form fields must reference a variable instead of storing a literal value.', path: ['body', 'fields', index, 'value'] });
    }
  }
  for (const [index, param] of (http.queryParams ?? []).entries()) {
    if (/authorization|cookie|token|secret|api[-_]?key|credential|password/i.test(param.key) && !variableReference(param.value)) {
      ctx.addIssue({ code: 'custom', message: 'Sensitive query parameters must reference a variable instead of storing a literal value.', path: ['queryParams', index, 'value'] });
    }
  }
  if (http.body?.type === 'json') {
    try {
      const parsed = JSON.parse(http.body.value ?? '{}') as unknown;
      const inspect = (value: unknown, key = ''): boolean => {
        if (SENSITIVE_FIELD_PATTERN.test(key)) return typeof value === 'string' && variableReference(value);
        if (Array.isArray(value)) return value.every((item) => inspect(item));
        if (value && typeof value === 'object') return Object.entries(value).every(([childKey, childValue]) => inspect(childValue, childKey));
        return true;
      };
      if (!inspect(parsed)) ctx.addIssue({ code: 'custom', message: 'Sensitive JSON body fields must reference a variable instead of storing a literal value.', path: ['body', 'value'] });
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Request body is not valid JSON.', path: ['body', 'value'] });
    }
  }
  for (const [index, capture] of (http.capture ?? []).entries()) {
    if (capture.source === 'jsonPath' && !capture.path) ctx.addIssue({ code: 'custom', message: 'JSON path is required for this capture.', path: ['capture', index, 'path'] });
    if (capture.source === 'responseHeader' && !capture.headerName) ctx.addIssue({ code: 'custom', message: 'Header name is required for this capture.', path: ['capture', index, 'headerName'] });
  }
  for (const [index, assertion] of (http.assertions ?? []).entries()) {
    if ('path' in assertion && SENSITIVE_FIELD_PATTERN.test(assertion.path) && 'expected' in assertion && assertion.expected !== undefined && !variableReference(String(assertion.expected))) {
      ctx.addIssue({ code: 'custom', message: 'Sensitive JSON assertions must compare against a variable reference.', path: ['assertions', index, 'expected'] });
    }
  }
});

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

export const StepSchema = z.object({
  action: z.enum([
    'goto',
    'click',
    'fill',
    'press',
    'keyboardPress',
    'selectOption',
    'assertVisible',
    'assertHidden',
    'assertText',
    'assertValue',
    'assertURL',
    'assertTitle',
    'assertChecked',
    'assertCount',
    'waitForSelector',
    'executeSql',
    'assertDatabaseResult',
    'generateData',
    'captureValue'
    ,'httpRequest'
  ]),
  generator: z.enum(GENERATORS).optional(),
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
  assertion: z.object({
    type: z.enum(['rowCountEquals', 'rowCountGreaterThan', 'empty', 'notEmpty', 'columnEquals', 'columnContains', 'columnNotNull', 'affectedRowsEquals']),
    expected: z.string().optional(),
    column: z.string().max(256).optional(),
    rowIndex: z.number().int().nonnegative().max(100).optional()
  }).optional(),
  waitForResult: z.object({
    timeoutMs: z.number().int().min(250).max(30_000),
    pollIntervalMs: z.number().int().min(250).max(5_000)
  }).optional(),
  saveResultAs: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).optional(),
  saveResultType: z.enum(['column', 'rowCount', 'affectedRows']).optional(),
  saveRowIndex: z.number().int().nonnegative().max(100).optional(),
  saveColumn: z.string().max(256).optional(),
  captureRows: z.boolean().optional(),
  http: HttpRequestSchema.optional(),
  options: z
    .object({
      exact: z.boolean().optional(),
      timeout: z.number().int().positive().optional(),
      nth: z.number().int().nonnegative().optional()
    })
    .optional()
}).superRefine((step, ctx) => {
  if (step.action === 'generateData') {
    if (!step.generator) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Generator is required', path: ['generator'] });
    if (!step.saveAs) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Runtime variable name is required', path: ['saveAs'] });
    try {
      validateGeneratorOptions(step.generator, step.generatorOptions);
    } catch (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : 'Generator settings are invalid', path: ['generatorOptions'] });
    }
  }
  if (step.action === 'httpRequest' && !step.http) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'HTTP request configuration is required', path: ['http'] });
  }
  if (step.action === 'captureValue') {
    if (!step.captureSource) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Capture source is required', path: ['captureSource'] });
    if (!step.saveAs) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Runtime variable name is required', path: ['saveAs'] });
    if (step.captureSource !== 'url' && !step.selector?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Target selector is required', path: ['selector'] });
    }
    if (step.captureSource === 'attribute' && !step.attributeName?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Attribute name is required', path: ['attributeName'] });
    }
  }
  if (step.action === 'executeSql' || step.action === 'assertDatabaseResult') {
    if (!step.databaseConnectionId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Database connection is required', path: ['databaseConnectionId'] });
    if (!step.sql?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SQL query is required', path: ['sql'] });
    if (step.action === 'assertDatabaseResult' && !step.assertion) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Database assertion is required', path: ['assertion'] });
    if (step.assertion) {
      const assertionNeedsColumn = ['columnEquals', 'columnContains', 'columnNotNull'].includes(step.assertion.type);
      const assertionNeedsExpected = ['rowCountEquals', 'rowCountGreaterThan', 'columnEquals', 'columnContains', 'affectedRowsEquals'].includes(step.assertion.type);
      if (assertionNeedsColumn && !step.assertion.column?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Database assertion column is required', path: ['assertion', 'column'] });
      }
      if (assertionNeedsExpected && step.assertion.expected === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Database assertion expected value is required', path: ['assertion', 'expected'] });
      }
      if (['rowCountEquals', 'rowCountGreaterThan', 'affectedRowsEquals'].includes(step.assertion.type)) {
        const expectedCount = Number(step.assertion.expected);
        if (!/^(0|[1-9]\d*)$/.test(step.assertion.expected ?? '') || !Number.isSafeInteger(expectedCount) || expectedCount < 0) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected row or affected-row count must be a non-negative integer', path: ['assertion', 'expected'] });
        }
      }
    }
    if (step.waitForResult && !step.assertion) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Wait for Result requires an assertion', path: ['waitForResult'] });
    if (step.saveResultAs && step.saveColumn !== undefined && !step.saveColumn.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose a non-empty result column or use the first-column default', path: ['saveColumn'] });
    }
  }
});

const TestDataCellSchema = z.union([
  z.string().max(TEST_DATA_VARIABLE_VALUE_LIMIT),
  z.object({ kind: z.literal('literal'), value: z.unknown() }).strict(),
  z.object({
    kind: z.literal('reference'),
    name: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/),
    source: z.enum(['project', 'environment']).optional()
  }).strict(),
  z.object({
    kind: z.literal('generated'),
    generator: z.enum(['username', 'email', 'password', 'uuid', 'string', 'number', 'boolean', 'date', 'timestamp', 'pattern']),
    options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    secret: z.boolean().optional()
  }).strict().superRefine((cell, ctx) => {
    try { validateGeneratorOptions(cell.generator, cell.options); }
    catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Invalid generator configuration.' }); }
  })
]);

export const TestDataCaseSchema = z.object({
  name: z.string().transform((value) => value.trim()).pipe(z.string().min(1).max(TEST_DATA_NAME_LIMIT)),
  enabled: z.boolean(),
  variables: z.record(
    z.string()
      .max(TEST_DATA_VARIABLE_KEY_LIMIT)
      .regex(TEST_DATA_VARIABLE_KEY_PATTERN, 'Variable key must match ^[A-Z][A-Z0-9_]*$'),
    TestDataCellSchema
  ).superRefine((variables, ctx) => {
    if (Object.keys(variables).length > TEST_DATA_VARIABLE_LIMIT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Variables must contain at most ${TEST_DATA_VARIABLE_LIMIT} keys`
      });
    }
  })
});

export const TestDataSchema = z.array(TestDataCaseSchema)
  .max(TEST_DATA_CASE_LIMIT)
  .superRefine((cases, ctx) => {
    const seen = new Set<string>();

    cases.forEach((testCase, index) => {
      if (seen.has(testCase.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Case names must be unique',
          path: [index, 'name']
        });
        return;
      }

      seen.add(testCase.name);
    });
  });

export const CreateTestSchema = z.object({
  name: z.string().min(1).max(200),
  url: urlOrTemplate,
  steps: z.array(StepSchema).default([]),
  testData: TestDataSchema.default([]),
  device: z.string().optional().nullable(),
  environmentId: z.string().optional().nullable(),
  useProjectAuthentication: z.boolean().default(true)
});

export const UpdateTestSchema = z.object({
  name: CreateTestSchema.shape.name.optional(),
  url: CreateTestSchema.shape.url.optional(),
  steps: z.array(StepSchema).optional(),
  testData: TestDataSchema.optional(),
  device: z.string().optional().nullable(),
  environmentId: z.string().optional().nullable(),
  useProjectAuthentication: z.boolean().optional()
});

export type StepDto = z.infer<typeof StepSchema>;
export type TestDataCaseDto = z.infer<typeof TestDataCaseSchema>;
export type CreateTestDto = z.infer<typeof CreateTestSchema>;
export type UpdateTestDto = z.infer<typeof UpdateTestSchema>;
