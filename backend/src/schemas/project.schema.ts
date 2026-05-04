import { z } from 'zod';

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(100)
});

export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(100)
});

export type CreateProjectDto = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectDto = z.infer<typeof UpdateProjectSchema>;
