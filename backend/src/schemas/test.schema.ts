import { z } from 'zod';

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

export const CreateTestSchema = z.object({
  name: z.string().min(1).max(200),
  url: urlOrTemplate,
  steps: z.array(StepSchema).default([]),
  device: z.string().optional()
});

export const UpdateTestSchema = CreateTestSchema.partial();

export type StepDto = z.infer<typeof StepSchema>;
export type CreateTestDto = z.infer<typeof CreateTestSchema>;
export type UpdateTestDto = z.infer<typeof UpdateTestSchema>;
