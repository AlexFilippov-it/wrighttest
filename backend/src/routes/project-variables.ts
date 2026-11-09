import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '../prisma';
import { decryptProjectVariableValue, encryptProjectVariableValue, isProjectVariableEncryptionConfigured } from '../services/project-variable-crypto';
import { getAuthUser, getProjectAccessStatusCode, requireProjectRole } from '../utils/project-access';

const NAME = /^[A-Z][A-Z0-9_]{0,99}$/;
const Value = z.union([
  z.string().max(10_000), z.number().finite(), z.boolean(), z.null(),
  z.record(z.string(), z.unknown()), z.array(z.unknown())
]).superRefine((value, ctx) => {
  if (JSON.stringify(value).length > 10_000) ctx.addIssue({ code: 'custom', message: 'Variable values must be 10,000 characters or fewer.' });
});
const Fields = z.object({
  name: z.string().trim().regex(NAME),
  type: z.enum(['string', 'number', 'boolean', 'json', 'null']),
  value: Value.optional(),
  secret: z.boolean().default(false),
  description: z.string().max(500).default('')
}).strict();
const Update = Fields.partial().strict();

function inferredType(value: unknown) {
  if (value === null) return 'null';
  if (Array.isArray(value) || typeof value === 'object') return 'json';
  return typeof value;
}

function serialize(variable: {
  id: string; projectId: string; name: string; type: string; value: string;
  secret: boolean; description: string; createdAt: Date; updatedAt: Date;
}, role: 'OWNER' | 'EDITOR' | 'VIEWER') {
  const maySeePlainValue = role !== 'VIEWER' && !variable.secret;
  return {
    id: variable.id,
    projectId: variable.projectId,
    name: variable.name,
    type: variable.type,
    secret: variable.secret,
    configured: true,
    ...(maySeePlainValue ? { value: JSON.parse(variable.value) as unknown } : {}),
    description: variable.description,
    createdAt: variable.createdAt,
    updatedAt: variable.updatedAt
  };
}

async function access(projectId: string, userId: string, roles: Array<'OWNER' | 'EDITOR' | 'VIEWER'>) {
  return requireProjectRole(projectId, userId, roles);
}

function sendError(reply: FastifyReply, error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
    return reply.status(409).send({ error: 'A project variable with this name already exists.' });
  }
  return reply.status(getProjectAccessStatusCode(error)).send({ error: error instanceof Error ? error.message : 'Forbidden' });
}

export async function projectVariableRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { projectId: string } }>('/projects/:projectId/variables', async (req, reply) => {
    try {
      const { userId } = getAuthUser(req);
      const { member } = await access(req.params.projectId, userId, ['OWNER', 'EDITOR', 'VIEWER']);
      const variables = await prisma.projectVariable.findMany({ where: { projectId: req.params.projectId }, orderBy: { name: 'asc' } });
      return variables.map((variable) => serialize(variable, member.role));
    } catch (error) { return sendError(reply, error); }
  });

  fastify.post<{ Params: { projectId: string } }>('/projects/:projectId/variables', async (req, reply) => {
    const parsed = Fields.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const { userId } = getAuthUser(req);
    try {
      const { member } = await access(req.params.projectId, userId, ['OWNER', 'EDITOR']);
      if (parsed.data.secret && member.role !== 'OWNER') return reply.status(403).send({ error: 'Only project Owners can create secret variables.' });
      if (parsed.data.value === undefined) return reply.status(400).send({ error: 'A value is required when creating a variable.' });
      if (inferredType(parsed.data.value) !== parsed.data.type) return reply.status(400).send({ error: 'The selected type does not match the value.' });
      if (await prisma.projectVariable.count({ where: { projectId: req.params.projectId } }) >= 100) {
        return reply.status(409).send({ error: 'A project can have at most 100 variables.' });
      }
      if (parsed.data.secret && !isProjectVariableEncryptionConfigured()) {
        return reply.status(503).send({ error: 'Project variable encryption is not configured.' });
      }
      const value = parsed.data.secret
        ? encryptProjectVariableValue(parsed.data.value)
        : JSON.stringify(parsed.data.value);
      const variable = await prisma.projectVariable.create({ data: { ...parsed.data, value, projectId: req.params.projectId } });
      return reply.status(201).send(serialize(variable, member.role));
    } catch (error) { return sendError(reply, error); }
  });

  fastify.patch<{ Params: { id: string } }>('/variables/:id', async (req, reply) => {
    const parsed = Update.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const variable = await prisma.projectVariable.findUnique({ where: { id: req.params.id } });
    if (!variable) return reply.status(404).send({ error: 'Project variable not found.' });
    const { userId } = getAuthUser(req);
    try {
      const { member } = await access(variable.projectId, userId, ['OWNER', 'EDITOR']);
      if ((variable.secret || parsed.data.secret) && member.role !== 'OWNER') {
        return reply.status(403).send({ error: 'Only project Owners can update secret variables.' });
      }
      const { value: nextValue, ...fields } = parsed.data;
      const secret = fields.secret ?? variable.secret;
      const type = fields.type ?? variable.type;
      if (secret !== variable.secret && nextValue === undefined) {
        return reply.status(400).send({ error: 'Provide a replacement value when changing whether this variable is secret.' });
      }
      const value = nextValue === undefined
        ? variable.value
        : secret
          ? encryptProjectVariableValue(nextValue)
          : JSON.stringify(nextValue);
      const plainValue = nextValue === undefined ? (variable.secret ? decryptProjectVariableValue(variable.value) : JSON.parse(variable.value) as unknown) : nextValue;
      if (plainValue !== undefined && inferredType(plainValue) !== type) {
        return reply.status(400).send({ error: 'The selected type does not match the value.' });
      }
      const updated = await prisma.projectVariable.update({
        where: { id: variable.id },
        data: { ...fields, type, secret, value }
      });
      return serialize(updated, member.role);
    } catch (error) { return sendError(reply, error); }
  });

  fastify.delete<{ Params: { id: string } }>('/variables/:id', async (req, reply) => {
    const variable = await prisma.projectVariable.findUnique({ where: { id: req.params.id } });
    if (!variable) return reply.status(404).send({ error: 'Project variable not found.' });
    const { userId } = getAuthUser(req);
    try {
      const { member } = await access(variable.projectId, userId, ['OWNER', 'EDITOR']);
      if (variable.secret && member.role !== 'OWNER') return reply.status(403).send({ error: 'Only project Owners can delete secret variables.' });
      await prisma.projectVariable.delete({ where: { id: variable.id } });
      return reply.status(204).send();
    } catch (error) { return sendError(reply, error); }
  });
}
