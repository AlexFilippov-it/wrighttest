import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../prisma';
import { getAuthUser, isProtectedAdminEmail } from '../utils/project-access';

const MAX_LANGUAGE_FILE_BYTES = 1024 * 1024;
const messageSchema = z.object({
  source: z.string().max(20_000),
  translation: z.string().max(20_000),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/).optional()
}).strict();

const packageSchema = z.object({
  format: z.literal('wrighttest-locale'),
  version: z.literal(1),
  locale: z.string().min(2).max(64),
  messages: z.record(z.string().min(1).max(160), messageSchema).refine(
    (messages) => Object.keys(messages).length <= 5000,
    'A language pack cannot contain more than 5000 messages'
  )
}).strict();

type TranslationEntry = { translation: string; sourceHash: string };
type TranslationMap = Record<string, TranslationEntry>;
type LocaleFile = z.infer<typeof packageSchema>;

const sourceCandidates = [
  path.resolve(process.cwd(), '../shared/locales/en.json'),
  path.resolve(process.cwd(), 'shared/locales/en.json'),
  path.resolve(__dirname, '../../../../shared/locales/en.json'),
  path.resolve(__dirname, '../../../shared/locales/en.json')
];
function readSharedCatalog(filename: string) {
  const candidates = sourceCandidates.map((candidate) => path.join(path.dirname(candidate), filename));
  const catalogPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!catalogPath) throw new Error(`Shared locale catalog is missing: ${filename}`);
  return JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as Record<string, string>;
}

const englishMessages = readSharedCatalog('en.json');
const russianMessages = readSharedCatalog('ru-RU.json');

function sourceHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function getLocale(value: string) {
  try {
    const [locale] = Intl.getCanonicalLocales(value);
    return locale;
  } catch {
    return null;
  }
}

function validMessageKey(key: string) {
  return !['__proto__', 'prototype', 'constructor'].includes(key);
}

function getTranslationMap(value: unknown): TranslationMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.create(null) as TranslationMap;
  const safe: TranslationMap = Object.create(null) as TranslationMap;
  for (const [key, entry] of Object.entries(value)) {
    if (!validMessageKey(key) || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const candidate = entry as Partial<TranslationEntry>;
    if (typeof candidate.translation !== 'string' || typeof candidate.sourceHash !== 'string') continue;
    safe[key] = { translation: candidate.translation, sourceHash: candidate.sourceHash };
  }
  return safe;
}

function getCurrentSourceHash(key: string) {
  return sourceHash(englishMessages[key] ?? '');
}

function validateParameters(source: string, translation: string) {
  const parameters = (value: string) => [...value.matchAll(/{{\s*([\w.-]+)\s*}}/g)].map((match) => match[1]).sort();
  return JSON.stringify(parameters(source)) === JSON.stringify(parameters(translation));
}

function getLocaleDisplayName(locale: string) {
  return new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale;
}

async function ensureInstanceSettings() {
  return prisma.instanceSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, activeLocale: 'en' }
  });
}

async function requireInstanceAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = getAuthUser(request);
  if (isProtectedAdminEmail(user.email)) return true;
  await reply.status(403).send({ error: 'Instance administrator access required' });
  return false;
}

function parsePackage(input: unknown) {
  const parsed = packageSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten() } as const;

  const canonicalLocale = getLocale(parsed.data.locale);
  if (!canonicalLocale || canonicalLocale !== parsed.data.locale) {
    return { error: { formErrors: ['locale must be a canonical BCP 47 language tag'], fieldErrors: {} } } as const;
  }
  if (canonicalLocale === 'en') {
    return { error: { formErrors: ['English is built in and cannot be imported'], fieldErrors: {} } } as const;
  }

  const invalidKeys = Object.keys(parsed.data.messages).filter((key) => !validMessageKey(key));
  if (invalidKeys.length > 0) {
    return { error: { formErrors: ['The file contains a reserved message key'], fieldErrors: {} } } as const;
  }

  return { data: { ...parsed.data, locale: canonicalLocale } } as const;
}

function calculatePreview(
  incoming: LocaleFile,
  current: TranslationMap
) {
  const unknownKeys = Object.keys(incoming.messages).filter((key) => !(key in englishMessages));
  const staleKeys = new Set<string>();
  const invalidParameters: string[] = [];
  const effective = { ...current };

  for (const [key, message] of Object.entries(incoming.messages)) {
    if (!(key in englishMessages)) continue;
    const activeSource = englishMessages[key];
    const incomingSourceHash = message.sourceHash ?? sourceHash(message.source);
    if (incomingSourceHash !== getCurrentSourceHash(key) || message.source !== activeSource) staleKeys.add(key);
    if (message.translation && !validateParameters(activeSource, message.translation)) invalidParameters.push(key);
    if (message.translation.trim()) {
      effective[key] = { translation: message.translation, sourceHash: incomingSourceHash };
    }
  }

  for (const key of Object.keys(englishMessages)) {
    const currentEntry = effective[key];
    if (currentEntry?.translation && currentEntry.sourceHash !== getCurrentSourceHash(key)) staleKeys.add(key);
  }

  const missingKeys = Object.keys(englishMessages).filter((key) => !effective[key]?.translation.trim());
  return {
    translated: Object.keys(englishMessages).length - missingKeys.length,
    total: Object.keys(englishMessages).length,
    missing: missingKeys.length,
    stale: staleKeys.size,
    staleKeys: [...staleKeys],
    unknown: unknownKeys.length,
    unknownKeys,
    invalidParameters
  };
}

function buildLocaleFile(locale: string, translations: TranslationMap, includeTranslations: boolean) {
  const messages: LocaleFile['messages'] = Object.create(null) as LocaleFile['messages'];
  for (const [key, source] of Object.entries(englishMessages)) {
    messages[key] = {
      source,
      translation: includeTranslations ? translations[key]?.translation ?? '' : '',
      sourceHash: translations[key]?.sourceHash ?? sourceHash(source)
    };
  }

  if (includeTranslations) {
    for (const [key, entry] of Object.entries(translations)) {
      if (key in englishMessages) continue;
      messages[key] = { source: '', translation: entry.translation, sourceHash: entry.sourceHash };
    }
  }

  return { format: 'wrighttest-locale', version: 1, locale, messages };
}

export async function localizationRoutes(fastify: FastifyInstance) {
  fastify.get('/localization/public', async () => {
    const settings = await ensureInstanceSettings();
    const userPack = await prisma.languagePack.findUnique({ where: { locale: settings.activeLocale } });
    const translations = getTranslationMap(userPack?.translations);
    const messages = Object.fromEntries(
      Object.entries(translations)
        .filter(([key, entry]) => key in englishMessages && Boolean(entry.translation.trim()))
        .map(([key, entry]) => [key, entry.translation])
    );

    return { activeLocale: settings.activeLocale, messages };
  });

  fastify.get('/instance/locales', async (request, reply) => {
    if (!await requireInstanceAdmin(request, reply)) return;
    const [settings, installed] = await Promise.all([
      ensureInstanceSettings(),
      prisma.languagePack.findMany({ orderBy: { locale: 'asc' } })
    ]);
    const packs = new Map(installed.map((pack) => [pack.locale, pack]));
    const builtins = ['en', 'ru-RU'].map((locale) => {
      const pack = packs.get(locale);
      const translations = getTranslationMap(pack?.translations);
      const builtinTranslations = locale === 'ru-RU'
        ? Object.fromEntries(Object.entries(russianMessages).map(([key, translation]) => [key, { translation, sourceHash: getCurrentSourceHash(key) }])) as TranslationMap
        : Object.create(null) as TranslationMap;
      const effective = { ...builtinTranslations, ...translations };
      const missing = Object.keys(englishMessages).filter((key) => !effective[key]?.translation.trim());
      const stale = Object.keys(englishMessages).filter((key) => {
        const entry = translations[key];
        return Boolean(entry?.translation.trim()) && entry.sourceHash !== getCurrentSourceHash(key);
      });
      return {
        locale,
        displayName: locale === 'en' ? 'English' : 'Русский',
        isBuiltIn: true,
        hasCustomPack: Boolean(pack),
        translated: locale === 'en' ? Object.keys(englishMessages).length : Object.keys(englishMessages).length - missing.length,
        total: Object.keys(englishMessages).length,
        stale: stale.length,
        status: locale === 'en' ? 'built-in' : stale.length > 0 ? 'needs-review' : 'built-in'
      };
    });

    const customPacks = installed
      .filter((pack) => !['en', 'ru-RU'].includes(pack.locale))
      .map((pack) => {
        const translations = getTranslationMap(pack.translations);
        const translated = Object.values(translations).filter((entry) => entry.translation.trim()).length;
        const stale = Object.keys(englishMessages).filter((key) => {
          const entry = translations[key];
          return Boolean(entry?.translation.trim()) && entry.sourceHash !== getCurrentSourceHash(key);
        }).length;
        return {
          locale: pack.locale,
          displayName: pack.displayName,
          isBuiltIn: false,
          hasCustomPack: true,
          translated,
          total: Object.keys(englishMessages).length,
          stale,
          status: stale > 0 ? 'needs-review' : 'installed'
        };
      });

    return { activeLocale: settings.activeLocale, packs: [...builtins, ...customPacks] };
  });

  fastify.get('/instance/locales/template/:locale', async (request, reply) => {
    if (!await requireInstanceAdmin(request, reply)) return;
    const { locale } = request.params as { locale: string };
    const canonicalLocale = getLocale(locale);
    if (!canonicalLocale || canonicalLocale === 'en') return reply.status(400).send({ error: 'Invalid target locale' });
    return buildLocaleFile(canonicalLocale, Object.create(null) as TranslationMap, false);
  });

  fastify.get('/instance/locales/:locale/export', async (request, reply) => {
    if (!await requireInstanceAdmin(request, reply)) return;
    const { locale } = request.params as { locale: string };
    const canonicalLocale = getLocale(locale);
    if (!canonicalLocale || canonicalLocale === 'en') return reply.status(400).send({ error: 'Invalid locale' });
    const pack = await prisma.languagePack.findUnique({ where: { locale: canonicalLocale } });
    const customTranslations = getTranslationMap(pack?.translations);
    const builtinTranslations = canonicalLocale === 'ru-RU'
      ? Object.fromEntries(Object.entries(russianMessages).map(([key, translation]) => [key, { translation, sourceHash: getCurrentSourceHash(key) }])) as TranslationMap
      : Object.create(null) as TranslationMap;
    return buildLocaleFile(canonicalLocale, { ...builtinTranslations, ...customTranslations }, true);
  });

  fastify.post('/instance/locales/validate', async (request, reply) => {
    if (!await requireInstanceAdmin(request, reply)) return;
    const parsed = parsePackage(request.body);
    if ('error' in parsed) return reply.status(400).send({ error: parsed.error });
    const existing = await prisma.languagePack.findUnique({ where: { locale: parsed.data.locale } });
    const preview = calculatePreview(parsed.data, getTranslationMap(existing?.translations));
    if (preview.invalidParameters.length > 0) {
      return reply.status(400).send({ error: 'Translation parameters do not match their source strings', ...preview });
    }
    return { locale: parsed.data.locale, displayName: getLocaleDisplayName(parsed.data.locale), ...preview };
  });

  fastify.put('/instance/locales/:locale/apply', async (request, reply) => {
    if (!await requireInstanceAdmin(request, reply)) return;
    const parsed = parsePackage(request.body);
    if ('error' in parsed) return reply.status(400).send({ error: parsed.error });
    const { locale } = request.params as { locale: string };
    if (locale !== parsed.data.locale) return reply.status(400).send({ error: 'Locale in URL and file must match' });

    const existing = await prisma.languagePack.findUnique({ where: { locale } });
    const oldTranslations = getTranslationMap(existing?.translations);
    const preview = calculatePreview(parsed.data, oldTranslations);
    if (preview.invalidParameters.length > 0) {
      return reply.status(400).send({ error: 'Translation parameters do not match their source strings', ...preview });
    }

    const merged: TranslationMap = { ...oldTranslations };
    for (const [key, message] of Object.entries(parsed.data.messages)) {
      if (!message.translation.trim()) continue;
      const sourceIsCurrent = message.source === englishMessages[key];
      const translationChanged = oldTranslations[key]?.translation !== message.translation;
      merged[key] = {
        translation: message.translation,
        sourceHash: sourceIsCurrent && translationChanged
          ? getCurrentSourceHash(key)
          : message.sourceHash ?? sourceHash(message.source)
      };
    }

    const pack = await prisma.$transaction(async (tx) => {
      const saved = await tx.languagePack.upsert({
        where: { locale },
        update: {
          displayName: getLocaleDisplayName(locale),
          translations: merged,
          sourceHashes: Object.fromEntries(Object.entries(merged).map(([key, entry]) => [key, entry.sourceHash]))
        },
        create: {
          locale,
          displayName: getLocaleDisplayName(locale),
          translations: merged,
          sourceHashes: Object.fromEntries(Object.entries(merged).map(([key, entry]) => [key, entry.sourceHash]))
        }
      });
      await tx.instanceSettings.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1, activeLocale: 'en' }
      });
      return saved;
    });

    return { ok: true, locale: pack.locale, ...calculatePreview(parsed.data, merged) };
  });

  fastify.patch('/instance/settings/language', async (request, reply) => {
    if (!await requireInstanceAdmin(request, reply)) return;
    const body = z.object({ locale: z.string().min(2).max(64) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });
    const locale = getLocale(body.data.locale);
    if (!locale || locale !== body.data.locale) return reply.status(400).send({ error: 'Invalid locale' });
    const hasBuiltIn = locale === 'en' || locale === 'ru-RU';
    const hasCustom = await prisma.languagePack.findUnique({ where: { locale }, select: { locale: true } });
    if (!hasBuiltIn && !hasCustom) return reply.status(400).send({ error: 'Language pack is not installed' });
    const settings = await prisma.instanceSettings.upsert({
      where: { id: 1 },
      update: { activeLocale: locale },
      create: { id: 1, activeLocale: locale }
    });
    return { activeLocale: settings.activeLocale };
  });

  fastify.delete('/instance/locales/:locale', async (request, reply) => {
    if (!await requireInstanceAdmin(request, reply)) return;
    const { locale } = request.params as { locale: string };
    if (['en', 'ru-RU'].includes(locale)) return reply.status(400).send({ error: 'Built-in languages cannot be deleted' });
    const pack = await prisma.languagePack.findUnique({ where: { locale } });
    if (!pack) return reply.status(404).send({ error: 'Language pack not found' });
    const settings = await ensureInstanceSettings();
    await prisma.$transaction([
      prisma.languagePack.delete({ where: { locale } }),
      ...(settings.activeLocale === locale
        ? [prisma.instanceSettings.update({ where: { id: 1 }, data: { activeLocale: 'en' } })]
        : [])
    ]);
    return { ok: true, activeLocale: settings.activeLocale === locale ? 'en' : settings.activeLocale };
  });
}

export const localizationFileLimit = MAX_LANGUAGE_FILE_BYTES;
