import type { Step } from '../types/step';

export interface ExportOptions {
  testName: string;
  variables?: Record<string, string>;
  useEnvVars?: boolean;
  testData?: Array<{ name: string; enabled: boolean; variables: Record<string, unknown> }>;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function templateToExpression(
  value: string,
  variables: Record<string, string>,
  useEnvVars: boolean,
  generatedNames: Set<string>
) {
  const parts: string[] = [];
  const pattern = /\{\{(\w+)\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    const [placeholder, name] = match;
    const literal = value.slice(lastIndex, match.index);
    if (literal) parts.push(JSON.stringify(literal));

    if (generatedNames.has(name)) {
      parts.push(`String(__wtRuntime[${JSON.stringify(name)}])`);
    } else if (useEnvVars) {
      parts.push(`env(${JSON.stringify(name)})`);
    } else {
      const resolved = variables[name];
      parts.push(JSON.stringify(resolved ?? placeholder));
    }

    lastIndex = match.index + placeholder.length;
  }

  const tail = value.slice(lastIndex);
  if (tail) parts.push(JSON.stringify(tail));

  if (parts.length === 0) {
    return JSON.stringify(value);
  }

  return parts.join(' + ');
}

function templateToRegexExpression(
  value: string,
  variables: Record<string, string>,
  useEnvVars: boolean,
  generatedNames: Set<string>
) {
  const parts: string[] = [];
  const pattern = /\{\{(\w+)\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    const [placeholder, name] = match;
    const literal = value.slice(lastIndex, match.index);
    if (literal) parts.push(`escapeRegExp(${JSON.stringify(literal)})`);

    if (generatedNames.has(name)) {
      parts.push(`escapeRegExp(String(__wtRuntime[${JSON.stringify(name)}]))`);
    } else if (useEnvVars) {
      parts.push(`escapeRegExp(env(${JSON.stringify(name)}))`);
    } else {
      const resolved = variables[name];
      parts.push(JSON.stringify(escapeRegExp(resolved ?? placeholder)));
    }

    lastIndex = match.index + placeholder.length;
  }

  const tail = value.slice(lastIndex);
  if (tail) parts.push(`escapeRegExp(${JSON.stringify(tail)})`);

  if (parts.length === 0) {
    return JSON.stringify(escapeRegExp(value));
  }

  return parts.join(' + ');
}

function selectorToExpression(
  selector: string,
  variables: Record<string, string>,
  useEnvVars: boolean,
  generatedNames: Set<string>
) {
  if (selector.startsWith('page.')) {
    let expression = '';
    for (let index = 0; index < selector.length;) {
      const quote = selector[index];
      if (quote !== "'" && quote !== '"') {
        expression += quote;
        index += 1;
        continue;
      }

      const start = index;
      index += 1;
      let literal = '';
      while (index < selector.length && selector[index] !== quote) {
        if (selector[index] === '\\' && index + 1 < selector.length) {
          literal += selector[index + 1];
          index += 2;
        } else {
          literal += selector[index];
          index += 1;
        }
      }
      if (index < selector.length) index += 1;

      const variableNames = [...literal.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
      if (variableNames.length > 0 && variableNames.every((name) => generatedNames.has(name))) {
        expression += `__wtTemplate(${JSON.stringify(literal)})`;
      } else {
        expression += selector.slice(start, index);
      }
    }
    return expression;
  }

  return `page.locator(${templateToExpression(selector, variables, useEnvVars, generatedNames)})`;
}

function stepToCode(step: Step, variables: Record<string, string>, useEnvVars: boolean, generatedNames: Set<string>, indent = '  '): string {
  const selectorExpr = step.selector ? selectorToExpression(step.selector, variables, useEnvVars, generatedNames) : '';
  const valueExpr = step.value ? templateToExpression(step.value, variables, useEnvVars, generatedNames) : '""';
  const expectedExpr = step.expected ? templateToExpression(step.expected, variables, useEnvVars, generatedNames) : '""';

  switch (step.action) {
    case 'generateData':
      return `${indent}__wtRuntime[${JSON.stringify(step.saveAs ?? 'GENERATED_VALUE')}] = __wtGenerate(${JSON.stringify(step.generator ?? 'string')}, ${JSON.stringify({ ...(step.generatorOptions ?? {}), __wtSecret: step.generator === 'password' || Boolean(step.secret) || /(pass(word)?|secret|token|api[_-]?key|authorization|auth[_-]?code|verification[_-]?code|otp|cookie|credential|private[_-]?key)/i.test(step.saveAs ?? ''), __wtReplace: Boolean(step.replace) })});`;
    case 'captureValue':
      return `${indent}// WRIGHTTEST_STEP ${JSON.stringify(step)}\n${indent}__wtRuntime[${JSON.stringify(step.saveAs ?? 'CAPTURED_VALUE')}] = await __wtCapture(page, ${JSON.stringify(step.captureSource ?? 'text')}, ${selectorExpr || 'undefined'}, ${JSON.stringify(step.attributeName ?? '')});`;
    case 'executeSql':
    case 'assertDatabaseResult':
      return `${indent}// WRIGHTTEST_STEP ${JSON.stringify(step)}`;
    case 'goto':
      return `${indent}await page.goto(${valueExpr});`;
    case 'click':
      return `${indent}await ${selectorExpr}.click();`;
    case 'fill':
      return `${indent}await ${selectorExpr}.fill(${valueExpr});`;
    case 'press':
      return `${indent}await ${selectorExpr}.press(${valueExpr});`;
    case 'keyboardPress':
      return `${indent}await page.keyboard.press(${valueExpr});`;
    case 'selectOption':
      return `${indent}await ${selectorExpr}.selectOption(${valueExpr});`;
    case 'assertVisible':
      return `${indent}await expect(${selectorExpr}).toBeVisible();`;
    case 'assertHidden':
      return `${indent}await expect(${selectorExpr}).toBeHidden();`;
    case 'assertText':
      return step.options?.exact
        ? `${indent}await expect(${selectorExpr}).toHaveText(${expectedExpr});`
        : `${indent}await expect(${selectorExpr}).toContainText(${expectedExpr});`;
    case 'assertValue':
      return `${indent}await expect(${selectorExpr}).toHaveValue(${expectedExpr});`;
    case 'assertURL':
      return step.options?.exact
        ? `${indent}await expect(page).toHaveURL(${expectedExpr});`
        : `${indent}await expect(page).toHaveURL(new RegExp(${templateToRegexExpression(step.expected ?? '', variables, useEnvVars, generatedNames)}));`;
    case 'assertTitle':
      return step.options?.exact
        ? `${indent}await expect(page).toHaveTitle(${expectedExpr});`
        : `${indent}await expect(page).toHaveTitle(new RegExp(${templateToRegexExpression(step.expected ?? '', variables, useEnvVars, generatedNames)}));`;
    case 'assertChecked':
      return `${indent}await expect(${selectorExpr}).toBeChecked();`;
    case 'assertCount':
      return `${indent}await expect(${selectorExpr}).toHaveCount(Number(${expectedExpr}));`;
    case 'waitForSelector':
      return `${indent}await ${selectorExpr}.waitFor();`;
    default:
      return `${indent}// Unknown step: ${(step as Step).action}`;
  }
}

function captureHelper() {
  return `async function __wtCapture(page: import('@playwright/test').Page, source: string, locator: import('@playwright/test').Locator | undefined, attribute: string): Promise<string | number> {
  if (source === 'url') return page.url();
  if (!locator) throw new Error('Capture target is required.');
  if (source === 'count') return locator.count();
  if (await locator.count() !== 1) throw new Error('Capture target must match exactly one element.');
  await locator.waitFor({ state: 'attached', timeout: 10000 });
  if (source === 'text') { const value = await locator.textContent(); if (value === null) throw new Error('Element text is unavailable.'); return value; }
  if (source === 'input') return locator.inputValue();
  if (source === 'attribute') { const value = await locator.getAttribute(attribute); if (value === null) throw new Error('Captured attribute is unavailable.'); return value; }
  throw new Error('Unsupported capture source: ' + source);
}`;
}

function generateDataHelper() {
  return `import { randomInt, randomUUID } from 'node:crypto';
const __wtRuntime: Record<string, string | number | boolean> = {};
const __wtGeneratedNames = new Set<string>(__WT_GENERATED_NAMES__);
const __wtTemplate = (value: string) => value.replace(/\\{\\{(\\w+)\\}\\}/g, (_match, name: string) => __wtGeneratedNames.has(name) ? String(__wtRuntime[name] ?? '') : (typeof process !== 'undefined' ? process.env[name] ?? '' : ''));
const __wtSets: Record<string, string> = { alphanumeric: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', lowercase: 'abcdefghijklmnopqrstuvwxyz', uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', digits: '0123456789', hex: '0123456789abcdef', 'lowercase-digits': 'abcdefghijklmnopqrstuvwxyz0123456789' };
const __wtCharset = (name: string, options: Record<string, string | number | boolean>) => name === 'custom' ? String(options.characters ?? '') : __wtSets[name];
const __wtRandom = (length: number, chars: string) => Array.from({ length }, () => chars[randomInt(chars.length)]).join('');
function __wtGenerate(generator: string, options: Record<string, string | number | boolean>): string | number | boolean {
  const length = Number(options.length ?? 16);
  switch (generator) {
    case 'username': { const prefix = String(options.prefix ?? 'user_'), suffix = String(options.suffix ?? ''); return prefix + __wtRandom(length - prefix.length - suffix.length, __wtCharset(String(options.charset ?? 'lowercase-digits'), options)) + suffix; }
    case 'email': return String(options.prefix ?? 'user_') + __wtRandom(Number(options.length ?? 12), __wtSets['lowercase-digits']) + '@' + String(options.domain ?? 'example.test');
    case 'password': { const groups = [options.uppercase !== false ? __wtSets.uppercase : '', options.lowercase !== false ? __wtSets.lowercase : '', options.digits !== false ? __wtSets.digits : '', options.symbols === true ? '!@#$%^&*_-+=' : ''].filter(Boolean); const chars = groups.map((group) => group[randomInt(group.length)]), all = groups.join(''); while (chars.length < length) chars.push(all[randomInt(all.length)]); for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; } return chars.join(''); }
    case 'uuid': return randomUUID();
    case 'string': return __wtRandom(length, __wtCharset(String(options.charset ?? 'alphanumeric'), options));
    case 'number': { const integer = options.integer !== false, scale = integer ? 1 : 10 ** Number(options.precision ?? 2), value = randomInt(Math.ceil(Number(options.min ?? 0) * scale), Math.floor(Number(options.max ?? 1000000) * scale) + 1) / scale; return integer ? value : Number(value.toFixed(Number(options.precision ?? 2))); }
    case 'boolean': return randomInt(2) === 1;
    case 'date': { const start = Date.parse(String(options.start ?? '2020-01-01T00:00:00.000Z')), end = Date.parse(String(options.end ?? '2030-12-31T23:59:59.999Z')), date = new Date(randomInt(start, end + 1)); if (options.format === 'iso') return date.toISOString(); if (options.format === 'us') return String(date.getUTCMonth() + 1).padStart(2, '0') + '/' + String(date.getUTCDate()).padStart(2, '0') + '/' + date.getUTCFullYear(); return date.toISOString().slice(0, 10); }
    case 'timestamp': return options.format === 'iso' ? new Date().toISOString() : Date.now();
    case 'pattern': { const pattern = String(options.pattern ?? ''); let result = ''; for (let i = 0; i < pattern.length;) { if (pattern[i] === '\\\\') { result += pattern[i + 1] ?? ''; i += 2; } else if (pattern.startsWith('{{TIMESTAMP}}', i)) { result += Date.now(); i += 13; } else if (pattern[i] === 'X') { result += __wtRandom(1, __wtSets.alphanumeric).toLowerCase(); i++; } else if (pattern[i] === '#') { result += __wtRandom(1, __wtSets.digits); i++; } else { result += pattern[i]; i++; } } return result; }
    default: throw new Error('Unsupported test data generator: ' + generator);
  }
}`;
}

export function exportToSpec(steps: Step[], opts: ExportOptions): string {
  const { testName, variables = {}, useEnvVars = false, testData = [] } = opts;
  const hasAssertions = steps.some((step) => step.action.startsWith('assert'));
  const generatedNames = new Set(steps.filter((step) => step.action === 'generateData' && step.saveAs).map((step) => step.saveAs!));
  const hasGenerators = generatedNames.size > 0;
  const hasCaptureSteps = steps.some((step) => step.action === 'captureValue');
  const hasSqlSteps = steps.some((step) => step.action === 'executeSql' || step.action === 'assertDatabaseResult');
  const usesTemplates = useEnvVars && steps.some((step) => JSON.stringify(step).includes('{{'));
  const needsEscapeRegExpHelper = (useEnvVars || hasGenerators) && steps.some((step) => step.action === 'assertURL' || step.action === 'assertTitle');

  const lines = steps.map((step) => stepToCode(step, variables, useEnvVars, generatedNames)).join('\n');

  const helper = usesTemplates || hasGenerators || hasCaptureSteps
    ? [
        usesTemplates ? 'const env = (name: string) => process.env[name] ?? \'\';' : '',
        !hasGenerators && hasCaptureSteps ? 'const __wtRuntime: Record<string, string | number | boolean> = {};' : '',
        hasGenerators ? generateDataHelper().replace('__WT_GENERATED_NAMES__', JSON.stringify([...generatedNames])) : '',
        hasCaptureSteps ? captureHelper() : '',
        needsEscapeRegExpHelper
          ? [
              '',
              'function escapeRegExp(value: string) {',
              `  return value.replace(new RegExp(${JSON.stringify('[.*+?^${}()|[\\]\\\\]')}, "g"), "\\\\$&");`,
              '}'
            ].join('\n')
          : '',
        ''
      ].join('\n')
    : '';

  return [
    hasAssertions
      ? "import { test, expect } from '@playwright/test';"
      : "import { test } from '@playwright/test';",
    helper,
    ...(testData.length > 0 ? [`// WRIGHTTEST_TEST_DATA ${JSON.stringify(testData)}`] : []),
    `test(${JSON.stringify(testName)}, async ({ page }) => {`,
    hasSqlSteps ? '  // SQL steps are preserved for WrightTest import but require a configured database connection to execute.' : '',
    lines,
    '});',
    ''
  ].join('\n');
}
