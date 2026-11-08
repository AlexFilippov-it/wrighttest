import { randomInt, randomUUID } from 'node:crypto';
import type { Step } from '../types/step';

export const GENERATORS = [
  'username', 'email', 'password', 'uuid', 'string', 'number', 'boolean', 'date', 'timestamp', 'pattern'
] as const;

export type TestDataGenerator = typeof GENERATORS[number];
export type GeneratorOptions = Record<string, string | number | boolean>;

const MAX_OUTPUT_LENGTH = 512;
const MAX_PATTERN_LENGTH = 256;
const ALPHANUMERIC = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CHARSETS: Record<string, string> = {
  alphanumeric: ALPHANUMERIC,
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  hex: '0123456789abcdef',
  'lowercase-digits': 'abcdefghijklmnopqrstuvwxyz0123456789'
};

function fail(message: string): never {
  throw new Error(`Generate Test Data: ${message}`);
}

function optionString(options: GeneratorOptions, name: string, fallback: string) {
  const value = options[name];
  return typeof value === 'string' ? value : fallback;
}

function optionNumber(options: GeneratorOptions, name: string, fallback: number) {
  const value = options[name];
  return typeof value === 'number' ? value : fallback;
}

function optionBoolean(options: GeneratorOptions, name: string, fallback: boolean) {
  const value = options[name];
  return typeof value === 'boolean' ? value : fallback;
}

function boundedLength(options: GeneratorOptions, fallback: number, min = 1) {
  const length = optionNumber(options, 'length', fallback);
  if (!Number.isInteger(length) || length < min || length > MAX_OUTPUT_LENGTH) {
    fail(`length must be an integer between ${min} and ${MAX_OUTPUT_LENGTH}.`);
  }
  return length;
}

function charset(options: GeneratorOptions, key = 'charset', fallback = 'alphanumeric') {
  const name = optionString(options, key, fallback);
  if (name === 'custom') {
    const custom = optionString(options, 'characters', '');
    if (custom.length < 2 || custom.length > 128 || new Set(custom).size < 2) fail('custom character set must contain 2 to 128 characters with at least two distinct values.');
    return custom;
  }
  const chars = CHARSETS[name];
  if (!chars) fail(`unsupported character set "${name}".`);
  return chars;
}

function randomChars(length: number, chars: string) {
  if (chars.length < 2) fail('character set must contain at least two distinct characters.');
  return Array.from({ length }, () => chars[randomInt(chars.length)]).join('');
}

function secureShuffle<T>(items: T[]) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [items[index], items[swap]] = [items[swap], items[index]];
  }
  return items;
}

function generatePassword(options: GeneratorOptions) {
  const length = boundedLength(options, 16, 8);
  const groups = [
    optionBoolean(options, 'uppercase', true) ? CHARSETS.uppercase : '',
    optionBoolean(options, 'lowercase', true) ? CHARSETS.lowercase : '',
    optionBoolean(options, 'digits', true) ? CHARSETS.digits : '',
    optionBoolean(options, 'symbols', false) ? '!@#$%^&*_-+=' : ''
  ].filter(Boolean);
  if (groups.length < 2) fail('password must require at least two character groups.');
  if (length < groups.length) fail('password length is shorter than the required character groups.');
  const all = groups.join('');
  const chars = groups.map((group) => group[randomInt(group.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  return secureShuffle(chars).join('');
}

function generateNumber(options: GeneratorOptions) {
  const min = optionNumber(options, 'min', 0);
  const max = optionNumber(options, 'max', 1_000_000);
  const integer = optionBoolean(options, 'integer', true);
  const precision = optionNumber(options, 'precision', 2);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) fail('number range must contain finite min <= max.');
  if (!Number.isInteger(precision) || precision < 0 || precision > 8) fail('precision must be an integer between 0 and 8.');
  if (integer && (!Number.isSafeInteger(min) || !Number.isSafeInteger(max))) fail('integer range must use safe integer bounds.');
  const scale = integer ? 1 : 10 ** precision;
  const scaledMin = Math.ceil(min * scale);
  const scaledMax = Math.floor(max * scale);
  if (!Number.isSafeInteger(scaledMin) || !Number.isSafeInteger(scaledMax) || scaledMin > scaledMax || scaledMax - scaledMin > 2 ** 48 - 2) {
    fail('scaled number range is invalid or too wide.');
  }
  const result = randomInt(scaledMin, scaledMax + 1) / scale;
  return integer ? result : Number(result.toFixed(precision));
}

function parseDate(options: GeneratorOptions, name: string, fallback: string) {
  const value = optionString(options, name, fallback);
  const time = Date.parse(value);
  if (!Number.isFinite(time)) fail(`${name} must be a valid date.`);
  return time;
}

function generateDate(options: GeneratorOptions) {
  const start = parseDate(options, 'start', '2020-01-01T00:00:00.000Z');
  const end = parseDate(options, 'end', '2030-12-31T23:59:59.999Z');
      if (start > end || end - start >= 2 ** 48 - 1 || Math.abs(start) >= 2 ** 48 || Math.abs(end) >= 2 ** 48) fail('date range must be ordered and within supported bounds.');
  const date = new Date(randomInt(start, end + 1));
  switch (optionString(options, 'format', 'isoDate')) {
    case 'isoDate': return date.toISOString().slice(0, 10);
    case 'iso': return date.toISOString();
    case 'us': return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`;
    default: return fail('date format must be isoDate, iso, or us.');
  }
}

function generatePattern(pattern: string) {
  if (pattern.length === 0 || pattern.length > MAX_PATTERN_LENGTH) fail(`pattern must contain 1 to ${MAX_PATTERN_LENGTH} characters.`);
  let result = '';
  for (let index = 0; index < pattern.length;) {
    if (pattern.startsWith('\\', index)) {
      const next = pattern[index + 1];
      if (!next || !['X', '#', '\\', '{'].includes(next)) fail('escape only X, #, \\, or { with a backslash.');
      result += next;
      index += 2;
    } else if (pattern.startsWith('{{TIMESTAMP}}', index)) {
      result += String(Date.now());
      index += '{{TIMESTAMP}}'.length;
    } else if (pattern.startsWith('{{', index)) {
      fail('unsupported pattern token. Only {{TIMESTAMP}} is supported.');
    } else if (pattern[index] === 'X') {
      result += randomChars(1, ALPHANUMERIC).toLowerCase();
      index += 1;
    } else if (pattern[index] === '#') {
      result += randomChars(1, CHARSETS.digits);
      index += 1;
    } else {
      result += pattern[index];
      index += 1;
    }
    if (result.length > MAX_OUTPUT_LENGTH) fail(`generated value exceeds ${MAX_OUTPUT_LENGTH} characters.`);
  }
  return result;
}

function validatePattern(pattern: string) {
  if (pattern.length === 0 || pattern.length > MAX_PATTERN_LENGTH) fail(`pattern must contain 1 to ${MAX_PATTERN_LENGTH} characters.`);
  for (let index = 0; index < pattern.length;) {
    if (pattern[index] === '\\') {
      const next = pattern[index + 1];
      if (!next || !['X', '#', '\\', '{'].includes(next)) fail('escape only X, #, \\, or { with a backslash.');
      index += 2;
    } else if (pattern.startsWith('{{TIMESTAMP}}', index)) index += '{{TIMESTAMP}}'.length;
    else if (pattern.startsWith('{{', index)) fail('unsupported pattern token. Only {{TIMESTAMP}} is supported.');
    else index += 1;
  }
}

export function validateGeneratorOptions(generator: string | undefined, options: GeneratorOptions = {}) {
  if (!generator || !GENERATORS.includes(generator as TestDataGenerator)) fail('select a supported generator.');
  const allowedOptions: Record<TestDataGenerator, string[]> = {
    username: ['prefix', 'suffix', 'length', 'charset', 'characters'],
    email: ['prefix', 'domain', 'length'],
    password: ['length', 'uppercase', 'lowercase', 'digits', 'symbols'],
    uuid: [],
    string: ['length', 'charset', 'characters'],
    number: ['min', 'max', 'integer', 'precision'],
    boolean: [],
    date: ['start', 'end', 'format'],
    timestamp: ['format'],
    pattern: ['pattern']
  };
  const optionTypes: Record<string, 'string' | 'number' | 'boolean'> = {
    prefix: 'string', suffix: 'string', domain: 'string', length: 'number', charset: 'string', characters: 'string',
    uppercase: 'boolean', lowercase: 'boolean', digits: 'boolean', symbols: 'boolean', min: 'number', max: 'number',
    integer: 'boolean', precision: 'number', start: 'string', end: 'string', format: 'string', pattern: 'string'
  };
  if (Object.keys(options).some((name) => !allowedOptions[generator as TestDataGenerator].includes(name))) fail('configuration contains unsupported options for this generator.');
  if (Object.entries(options).some(([name, value]) => typeof value !== optionTypes[name])) fail('configuration contains an option with an invalid type.');
  switch (generator as TestDataGenerator) {
    case 'username': {
      const length = boundedLength(options, 16, 6);
      const prefix = optionString(options, 'prefix', 'user_');
      const suffix = optionString(options, 'suffix', '');
      const chars = charset(options, 'charset', 'lowercase-digits');
      if (prefix.length + suffix.length >= length || chars.length < 2) fail('username prefix and suffix must leave room for a random suffix.');
      break;
    }
    case 'email': {
      const prefix = optionString(options, 'prefix', 'user_');
      const domain = optionString(options, 'domain', 'example.test');
      if (!/^[A-Za-z0-9._+-]{0,64}$/.test(prefix) || !/^(?=.{1,253}$)[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(domain)) fail('email prefix or domain is invalid.');
      boundedLength(options, 12, 6);
      break;
    }
    case 'password':
      {
        const length = boundedLength(options, 16, 8);
        const groups = ['uppercase', 'lowercase', 'digits', 'symbols'].filter((name) =>
          optionBoolean(options, name, name !== 'symbols')
        );
        if (groups.length < 2) fail('password must require at least two character groups.');
        if (length < groups.length) fail('password length is shorter than the required character groups.');
      }
      break;
    case 'uuid':
    case 'boolean':
    case 'timestamp':
      if (generator === 'timestamp' && !['unixMs', 'iso'].includes(optionString(options, 'format', 'unixMs'))) fail('timestamp format must be unixMs or iso.');
      break;
    case 'string':
      boundedLength(options, 16);
      charset(options);
      break;
    case 'number':
      {
        const min = optionNumber(options, 'min', 0);
        const max = optionNumber(options, 'max', 1_000_000);
        const precision = optionNumber(options, 'precision', 2);
        const scale = optionBoolean(options, 'integer', true) ? 1 : 10 ** precision;
        if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) fail('number range must contain finite min <= max.');
        if (!Number.isInteger(precision) || precision < 0 || precision > 8) fail('precision must be an integer between 0 and 8.');
        if (optionBoolean(options, 'integer', true) && (!Number.isSafeInteger(min) || !Number.isSafeInteger(max))) fail('integer range must use safe integer bounds.');
        const scaledMin = Math.ceil(min * scale);
        const scaledMax = Math.floor(max * scale);
        if (!Number.isSafeInteger(scaledMin) || !Number.isSafeInteger(scaledMax) || scaledMin > scaledMax || scaledMax - scaledMin > 2 ** 48 - 2) fail('scaled number range is invalid or too wide.');
      }
      break;
    case 'date':
      {
        const start = parseDate(options, 'start', '2020-01-01T00:00:00.000Z');
        const end = parseDate(options, 'end', '2030-12-31T23:59:59.999Z');
        if (start > end || end - start >= 2 ** 48 - 1) fail('date range must be ordered and within supported bounds.');
        if (!['isoDate', 'iso', 'us'].includes(optionString(options, 'format', 'isoDate'))) fail('date format must be isoDate, iso, or us.');
      }
      break;
    case 'pattern':
      validatePattern(optionString(options, 'pattern', ''));
      break;
  }
}

export function generateTestDataValue(generator: string | undefined, options: GeneratorOptions = {}): string | number | boolean {
  validateGeneratorOptions(generator, options);
  let value: string | number | boolean;
  switch (generator as TestDataGenerator) {
    case 'username': {
      const length = boundedLength(options, 16, 6);
      const prefix = optionString(options, 'prefix', 'user_');
      const suffix = optionString(options, 'suffix', '');
      value = `${prefix}${randomChars(length - prefix.length - suffix.length, charset(options, 'charset', 'lowercase-digits'))}${suffix}`;
      break;
    }
    case 'email':
      value = `${optionString(options, 'prefix', 'user_')}${randomChars(boundedLength(options, 12, 6), CHARSETS['lowercase-digits'])}@${optionString(options, 'domain', 'example.test')}`;
      break;
    case 'password': value = generatePassword(options); break;
    case 'uuid': value = randomUUID(); break;
    case 'string': value = randomChars(boundedLength(options, 16), charset(options)); break;
    case 'number': value = generateNumber(options); break;
    case 'boolean': value = randomInt(2) === 1; break;
    case 'date': value = generateDate(options); break;
    case 'timestamp': value = optionString(options, 'format', 'unixMs') === 'iso' ? new Date().toISOString() : Date.now(); break;
    case 'pattern': value = generatePattern(optionString(options, 'pattern', '')); break;
  }
  if (typeof value === 'string' && value.length > MAX_OUTPUT_LENGTH) fail(`generated value exceeds ${MAX_OUTPUT_LENGTH} characters.`);
  return value;
}

export function isSecretGeneratorStep(step: Pick<Step, 'generator' | 'secret' | 'saveAs'>) {
  return step.generator === 'password' || Boolean(step.secret) || /(pass(word)?|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key)/i.test(step.saveAs ?? '');
}
