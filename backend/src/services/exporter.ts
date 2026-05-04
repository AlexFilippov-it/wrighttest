import type { Step } from '../types/step';

export interface ExportOptions {
  testName: string;
  variables?: Record<string, string>;
  useEnvVars?: boolean;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function templateToExpression(
  value: string,
  variables: Record<string, string>,
  useEnvVars: boolean
) {
  const parts: string[] = [];
  const pattern = /\{\{(\w+)\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    const [placeholder, name] = match;
    const literal = value.slice(lastIndex, match.index);
    if (literal) parts.push(JSON.stringify(literal));

    if (useEnvVars) {
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
  useEnvVars: boolean
) {
  const parts: string[] = [];
  const pattern = /\{\{(\w+)\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    const [placeholder, name] = match;
    const literal = value.slice(lastIndex, match.index);
    if (literal) parts.push(`escapeRegExp(${JSON.stringify(literal)})`);

    if (useEnvVars) {
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
  useEnvVars: boolean
) {
  if (selector.startsWith('page.')) {
    return selector;
  }

  return `page.locator(${templateToExpression(selector, variables, useEnvVars)})`;
}

function stepToCode(step: Step, variables: Record<string, string>, useEnvVars: boolean, indent = '  '): string {
  const selectorExpr = step.selector ? selectorToExpression(step.selector, variables, useEnvVars) : '';
  const valueExpr = step.value ? templateToExpression(step.value, variables, useEnvVars) : '""';
  const expectedExpr = step.expected ? templateToExpression(step.expected, variables, useEnvVars) : '""';

  switch (step.action) {
    case 'goto':
      return `${indent}await page.goto(${valueExpr});`;
    case 'click':
      return `${indent}await ${selectorExpr}.click();`;
    case 'fill':
      return `${indent}await ${selectorExpr}.fill(${valueExpr});`;
    case 'press':
      return `${indent}await ${selectorExpr}.press(${valueExpr});`;
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
        : `${indent}await expect(page).toHaveURL(new RegExp(${templateToRegexExpression(step.expected ?? '', variables, useEnvVars)}));`;
    case 'assertTitle':
      return step.options?.exact
        ? `${indent}await expect(page).toHaveTitle(${expectedExpr});`
        : `${indent}await expect(page).toHaveTitle(new RegExp(${templateToRegexExpression(step.expected ?? '', variables, useEnvVars)}));`;
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

export function exportToSpec(steps: Step[], opts: ExportOptions): string {
  const { testName, variables = {}, useEnvVars = false } = opts;
  const usesTemplates = useEnvVars && steps.some((step) => JSON.stringify(step).includes('{{'));
  const needsEscapeRegExpHelper = useEnvVars && steps.some((step) => step.action === 'assertURL' || step.action === 'assertTitle');

  const lines = steps.map((step) => stepToCode(step, variables, useEnvVars)).join('\n');

  const helper = usesTemplates
    ? [
        'const env = (name: string) => process.env[name] ?? \'\';',
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
    "import { test, expect } from '@playwright/test';",
    helper,
    `test(${JSON.stringify(testName)}, async ({ page }) => {`,
    lines,
    '});',
    ''
  ].join('\n');
}
