import type { Step } from '../types/step';

function stripSemicolon(line: string) {
  return line.replace(/;$/, '').trim();
}

function unquote(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return JSON.parse(trimmed.replace(/^'/, '"').replace(/'$/, '"'));
  }
  return trimmed;
}

function expressionToTemplate(expression: string): string {
  const normalized = expression
    .replace(/\s+/g, ' ')
    .replace(/escapeRegExp\((process\.env\.\w+\s*\?\?\s*'')\)/g, '$1')
    .replace(/escapeRegExp\((process\.env\.\w+\s*\?\?\s*"")\)/g, '$1')
    .replace(/escapeRegExp\((process\.env\.\w+)\)/g, '$1')
    .replace(/escapeRegExp\(env\((['"])(\w+)\1\)\)/g, 'process.env.$2')
    .replace(/env\((['"])(\w+)\1\)/g, 'process.env.$2')
    .replace(/escapeRegExp\((['"][^'"]*['"])\)/g, '$1');

  const parts = normalized
    .split(/\s+\+\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const envMatch = part.match(/^process\.env\.(\w+)(?:\s*\?\?\s*(?:''|""))?$/);
      if (envMatch) {
        return `{{${envMatch[1]}}}`;
      }

      if (
        (part.startsWith('"') && part.endsWith('"')) ||
        (part.startsWith("'") && part.endsWith("'"))
      ) {
        return unquote(part);
      }

      return part;
    });

  return parts.join('');
}

function extractArgument(expression: string) {
  return stripSemicolon(expression.replace(/^.*\((.*)\)$/, '$1'));
}

function parseLocatorExpression(expression: string) {
  const trimmed = stripSemicolon(expression);
  return trimmed;
}

function parseMaybeRegexOrString(expression: string) {
  const trimmed = stripSemicolon(expression);

  const regexMatch = trimmed.match(/^new RegExp\((.+)\)$/);
  if (regexMatch) {
    return expressionToTemplate(regexMatch[1]);
  }

  return expressionToTemplate(trimmed);
}

export function parsePlaywrightSpec(code: string): { testName: string; steps: Step[] } {
  const lines = code.split('\n');
  const steps: Step[] = [];

  const nameMatch = code.match(/test\((['"`])(.+?)\1/);
  const testName = nameMatch?.[2] ?? 'Imported test';

  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('await ')) continue;

    const gotoMatch = t.match(/await page\.goto\((.+)\);?$/);
    if (gotoMatch) {
      steps.push({ action: 'goto', value: parseMaybeRegexOrString(gotoMatch[1]) });
      continue;
    }

    const clickMatch = t.match(/await (page\..+?)\.click\(\);?$/);
    if (clickMatch) {
      steps.push({ action: 'click', selector: parseLocatorExpression(clickMatch[1]) });
      continue;
    }

    const fillMatch = t.match(/await (page\..+?)\.fill\((.+)\);?$/);
    if (fillMatch) {
      steps.push({ action: 'fill', selector: parseLocatorExpression(fillMatch[1]), value: expressionToTemplate(fillMatch[2]) });
      continue;
    }

    const pressMatch = t.match(/await (page\..+?)\.press\((.+)\);?$/);
    if (pressMatch) {
      steps.push({ action: 'press', selector: parseLocatorExpression(pressMatch[1]), value: expressionToTemplate(pressMatch[2]) });
      continue;
    }

    const selectMatch = t.match(/await (page\..+?)\.selectOption\((.+)\);?$/);
    if (selectMatch) {
      steps.push({ action: 'selectOption', selector: parseLocatorExpression(selectMatch[1]), value: expressionToTemplate(selectMatch[2]) });
      continue;
    }

    const assertVisibleMatch = t.match(/await expect\((page\..+?)\)\.toBeVisible\(\);?$/);
    if (assertVisibleMatch) {
      steps.push({ action: 'assertVisible', selector: parseLocatorExpression(assertVisibleMatch[1]) });
      continue;
    }

    const assertHiddenMatch = t.match(/await expect\((page\..+?)\)\.toBeHidden\(\);?$/);
    if (assertHiddenMatch) {
      steps.push({ action: 'assertHidden', selector: parseLocatorExpression(assertHiddenMatch[1]) });
      continue;
    }

    const toHaveTextMatch = t.match(/await expect\((page\..+?)\)\.toHaveText\((.+)\);?$/);
    if (toHaveTextMatch) {
      steps.push({
        action: 'assertText',
        selector: parseLocatorExpression(toHaveTextMatch[1]),
        expected: parseMaybeRegexOrString(toHaveTextMatch[2]),
        options: { exact: true }
      });
      continue;
    }

    const containTextMatch = t.match(/await expect\((page\..+?)\)\.toContainText\((.+)\);?$/);
    if (containTextMatch) {
      steps.push({
        action: 'assertText',
        selector: parseLocatorExpression(containTextMatch[1]),
        expected: parseMaybeRegexOrString(containTextMatch[2]),
        options: { exact: false }
      });
      continue;
    }

    const toHaveURLMatch = t.match(/await expect\(page\)\.toHaveURL\((.+)\);?$/);
    if (toHaveURLMatch) {
      steps.push({
        action: 'assertURL',
        expected: parseMaybeRegexOrString(toHaveURLMatch[1]),
        options: { exact: !toHaveURLMatch[1].trim().startsWith('new RegExp(') }
      });
      continue;
    }

    const toHaveTitleMatch = t.match(/await expect\(page\)\.toHaveTitle\((.+)\);?$/);
    if (toHaveTitleMatch) {
      steps.push({
        action: 'assertTitle',
        expected: parseMaybeRegexOrString(toHaveTitleMatch[1]),
        options: { exact: !toHaveTitleMatch[1].trim().startsWith('new RegExp(') }
      });
      continue;
    }

    const toHaveValueMatch = t.match(/await expect\((page\..+?)\)\.toHaveValue\((.+)\);?$/);
    if (toHaveValueMatch) {
      steps.push({
        action: 'assertValue',
        selector: parseLocatorExpression(toHaveValueMatch[1]),
        expected: expressionToTemplate(toHaveValueMatch[2])
      });
      continue;
    }

    const toBeCheckedMatch = t.match(/await expect\((page\..+?)\)\.toBeChecked\(\);?$/);
    if (toBeCheckedMatch) {
      steps.push({ action: 'assertChecked', selector: parseLocatorExpression(toBeCheckedMatch[1]) });
      continue;
    }

    const toHaveCountMatch = t.match(/await expect\((page\..+?)\)\.toHaveCount\((.+)\);?$/);
    if (toHaveCountMatch) {
      steps.push({
        action: 'assertCount',
        selector: parseLocatorExpression(toHaveCountMatch[1]),
        expected: expressionToTemplate(toHaveCountMatch[2])
      });
      continue;
    }
  }

  return { testName, steps };
}
