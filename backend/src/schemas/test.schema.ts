import { z } from 'zod';

const TEST_DATA_CASE_LIMIT = 100;
const TEST_DATA_VARIABLE_LIMIT = 100;
const TEST_DATA_NAME_LIMIT = 150;
const TEST_DATA_VARIABLE_KEY_LIMIT = 100;
const TEST_DATA_VARIABLE_VALUE_LIMIT = 10_000;
const TEST_DATA_VARIABLE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

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
    'assertDatabaseResult'
  ]),
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
  saveRowIndex: z.number().int().nonnegative().max(100).optional(),
  saveColumn: z.string().max(256).optional(),
  captureRows: z.boolean().optional(),
  options: z
    .object({
      exact: z.boolean().optional(),
      timeout: z.number().int().positive().optional(),
      nth: z.number().int().nonnegative().optional()
    })
    .optional()
}).superRefine((step, ctx) => {
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

export const TestDataCaseSchema = z.object({
  name: z.string().transform((value) => value.trim()).pipe(z.string().min(1).max(TEST_DATA_NAME_LIMIT)),
  enabled: z.boolean(),
  variables: z.record(
    z.string()
      .max(TEST_DATA_VARIABLE_KEY_LIMIT)
      .regex(TEST_DATA_VARIABLE_KEY_PATTERN, 'Variable key must match ^[A-Z][A-Z0-9_]*$'),
    z.string().max(TEST_DATA_VARIABLE_VALUE_LIMIT)
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
