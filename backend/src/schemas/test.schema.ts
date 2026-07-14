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
    'waitForSelector'
  ]),
  selector: z.string().optional(),
  selectorCandidates: z.array(z.string()).optional(),
  elementText: z.string().optional(),
  elementTag: z.string().optional(),
  value: z.string().optional()
  ,
  expected: z.string().optional(),
  options: z
    .object({
      exact: z.boolean().optional(),
      timeout: z.number().int().positive().optional(),
      nth: z.number().int().nonnegative().optional()
    })
    .optional()
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
  device: z.string().optional(),
  environmentId: z.string().optional().nullable()
});

export const UpdateTestSchema = CreateTestSchema.partial();

export type StepDto = z.infer<typeof StepSchema>;
export type TestDataCaseDto = z.infer<typeof TestDataCaseSchema>;
export type CreateTestDto = z.infer<typeof CreateTestSchema>;
export type UpdateTestDto = z.infer<typeof UpdateTestSchema>;
