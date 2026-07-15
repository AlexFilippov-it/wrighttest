import type { Environment, Step, TestDataCase } from '../types';

export const VARIABLE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const TEMPLATE_VARIABLE_PATTERN = /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g;

export type TemplateVariableUsage = {
  variable: string;
  location: string;
};

export type TemplateVariablesDiagnostics = {
  usedVariables: string[];
  usagesByVariable: Record<string, string[]>;
  errors: string[];
  warnings: string[];
  caseErrors: Record<number, string[]>;
};

function addUsage(
  usages: Map<string, Set<string>>,
  variable: string,
  location: string
) {
  if (!VARIABLE_KEY_PATTERN.test(variable)) return;
  const locations = usages.get(variable) ?? new Set<string>();
  locations.add(location);
  usages.set(variable, locations);
}

function collectFromString(
  usages: Map<string, Set<string>>,
  value: string | undefined | null,
  location: string
) {
  if (!value) return;

  let match: RegExpExecArray | null;
  TEMPLATE_VARIABLE_PATTERN.lastIndex = 0;
  while ((match = TEMPLATE_VARIABLE_PATTERN.exec(value)) !== null) {
    addUsage(usages, match[1], location);
  }
}

export function extractTemplateVariableUsages(url: string | undefined | null, steps: Step[]) {
  const usages = new Map<string, Set<string>>();

  collectFromString(usages, url, 'Test URL');

  steps.forEach((step, index) => {
    const label = `Step ${index + 1}`;
    collectFromString(usages, step.selector, `${label} selector`);
    collectFromString(usages, step.value, `${label} value`);
    collectFromString(usages, step.expected, `${label} expected`);
  });

  return Array.from(usages.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([variable, locations]) => ({
      variable,
      locations: Array.from(locations)
    }));
}

function caseHasVariable(testCase: TestDataCase, variable: string) {
  return Object.prototype.hasOwnProperty.call(testCase.variables ?? {}, variable);
}

function environmentHasVariable(environmentVariables: Record<string, string>, variable: string) {
  return Object.prototype.hasOwnProperty.call(environmentVariables, variable);
}

function keysOf(testCase: TestDataCase) {
  return Object.keys(testCase.variables ?? {}).filter((key) => VARIABLE_KEY_PATTERN.test(key)).sort();
}

function setsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function buildTemplateVariablesDiagnostics(params: {
  useTestData: boolean;
  url?: string | null;
  steps: Step[];
  testData: TestDataCase[];
  selectedEnvironment?: Pick<Environment, 'variables'> | null;
}): TemplateVariablesDiagnostics {
  const usages = extractTemplateVariableUsages(params.url, params.steps);
  const usedVariables = usages.map((usage) => usage.variable);
  const usagesByVariable = Object.fromEntries(
    usages.map((usage) => [usage.variable, usage.locations])
  );

  if (!params.useTestData) {
    return { usedVariables, usagesByVariable, errors: [], warnings: [], caseErrors: {} };
  }

  const enabledCases = params.testData
    .map((testCase, index) => ({ testCase, index }))
    .filter(({ testCase }) => testCase.enabled);
  const environmentVariables = params.selectedEnvironment?.variables ?? {};
  const errors: string[] = [];
  const warnings: string[] = [];
  const caseErrors: Record<number, string[]> = {};

  for (const variable of usedVariables) {
    const missingCases = enabledCases.filter(({ testCase }) =>
      !caseHasVariable(testCase, variable) && !environmentHasVariable(environmentVariables, variable)
    );

    if (enabledCases.length > 0 && missingCases.length === enabledCases.length) {
      errors.push(`Variable ${variable} is missing in all enabled cases.`);
      for (const { testCase, index } of missingCases) {
        caseErrors[index] = [
          ...(caseErrors[index] ?? []),
          `Case "${testCase.name}" is missing variable ${variable}.`
        ];
      }
    } else {
      for (const { testCase, index } of missingCases) {
        const message = `Case "${testCase.name}" is missing variable ${variable}.`;
        errors.push(message);
        caseErrors[index] = [...(caseErrors[index] ?? []), message];
      }
    }
  }

  const usedVariableSet = new Set(usedVariables);
  const dataVariables = new Set(
    params.testData.flatMap((testCase) => Object.keys(testCase.variables ?? {}))
  );
  for (const variable of Array.from(dataVariables).sort((a, b) => a.localeCompare(b))) {
    if (VARIABLE_KEY_PATTERN.test(variable) && !usedVariableSet.has(variable)) {
      warnings.push(`Variable ${variable} exists in test data but is not used.`);
    }
  }

  if (params.testData.length > 0 && usedVariables.length === 0) {
    warnings.push('Test data is enabled, but this check does not use template variables.');
  }

  if (enabledCases.length > 1) {
    const [first, ...rest] = enabledCases.map(({ testCase }) => keysOf(testCase));
    if (rest.some((keys) => !setsEqual(first, keys))) {
      warnings.push('Enabled cases use different variable key sets.');
    }
  }

  if (params.testData.length > 0 && !params.steps.some((step) => step.action.startsWith('assert'))) {
    warnings.push('This data-driven check does not contain assertions.');
  }

  return { usedVariables, usagesByVariable, errors, warnings, caseErrors };
}

export function getBlockingTemplateVariableErrorsForCase(
  diagnostics: TemplateVariablesDiagnostics,
  dataCaseIndex: number | undefined
) {
  if (dataCaseIndex === undefined) return [];
  return diagnostics.caseErrors[dataCaseIndex] ?? [];
}
