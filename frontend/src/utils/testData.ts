import type { TestDataCase } from '../types';

export type EditableVariableRow = {
  id: string;
  key: string;
  value: string;
};

export type EditableTestDataCase = {
  id: string;
  name: string;
  enabled: boolean;
  variables: EditableVariableRow[];
};

export type TestDataValidationErrors = {
  cases: Record<string, {
    name?: string;
    variables?: Record<string, {
      key?: string;
      value?: string;
    }>;
    variablesLimit?: string;
  }>;
  general?: string;
};

const CASE_LIMIT = 100;
const VARIABLE_LIMIT = 100;
const CASE_NAME_LIMIT = 150;
const VARIABLE_KEY_LIMIT = 100;
const VARIABLE_VALUE_LIMIT = 10_000;
const VARIABLE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nextUniqueName(baseName: string, existingNames: Iterable<string>) {
  const used = new Set(Array.from(existingNames).map((name) => name.trim()));
  if (!used.has(baseName)) return baseName;

  let index = 2;
  while (used.has(`${baseName} ${index}`)) {
    index += 1;
  }

  return `${baseName} ${index}`;
}

export function createEmptyCase(existingCases: EditableTestDataCase[] = [], makeId = createId): EditableTestDataCase {
  const name = nextUniqueName('Case 1', existingCases.map((testCase) => testCase.name));
  if (name === 'Case 1') {
    return { id: makeId(), name, enabled: true, variables: [] };
  }

  let index = 2;
  const used = new Set(existingCases.map((testCase) => testCase.name.trim()));
  while (used.has(`Case ${index}`)) {
    index += 1;
  }

  return { id: makeId(), name: `Case ${index}`, enabled: true, variables: [] };
}

export function createVariableRow(makeId = createId): EditableVariableRow {
  return { id: makeId(), key: '', value: '' };
}

export function toEditableTestData(testData: TestDataCase[] | undefined | null, makeId = createId): EditableTestDataCase[] {
  if (!Array.isArray(testData)) return [];

  return testData.map((testCase) => ({
    id: makeId(),
    name: testCase.name,
    enabled: testCase.enabled,
    variables: Object.entries(testCase.variables ?? {}).map(([key, value]) => ({
      id: makeId(),
      key,
      value
    }))
  }));
}

export function toApiTestData(cases: EditableTestDataCase[], useTestData: boolean): TestDataCase[] {
  if (!useTestData) return [];

  return cases.map((testCase) => ({
    name: testCase.name.trim(),
    enabled: testCase.enabled,
    variables: Object.fromEntries(
      testCase.variables.map((variable) => [variable.key, variable.value])
    )
  }));
}

export function duplicateCase(
  cases: EditableTestDataCase[],
  caseId: string,
  makeId = createId
): EditableTestDataCase[] {
  const source = cases.find((testCase) => testCase.id === caseId);
  if (!source) return cases;

  const baseCopyName = `${source.name.trim() || 'Case'} copy`;
  const name = nextUniqueName(baseCopyName, cases.map((testCase) => testCase.name));
  const duplicated: EditableTestDataCase = {
    id: makeId(),
    name,
    enabled: source.enabled,
    variables: source.variables.map((variable) => ({
      id: makeId(),
      key: variable.key,
      value: variable.value
    }))
  };

  const sourceIndex = cases.findIndex((testCase) => testCase.id === caseId);
  const nextCases = [...cases];
  nextCases.splice(sourceIndex + 1, 0, duplicated);
  return nextCases;
}

export function validateEditableTestData(cases: EditableTestDataCase[], useTestData: boolean): TestDataValidationErrors {
  const errors: TestDataValidationErrors = { cases: {} };
  if (!useTestData) return errors;

  if (cases.length > CASE_LIMIT) {
    errors.general = `Use at most ${CASE_LIMIT} cases.`;
  }

  const nameCounts = new Map<string, number>();
  for (const testCase of cases) {
    const trimmedName = testCase.name.trim();
    if (trimmedName) {
      nameCounts.set(trimmedName, (nameCounts.get(trimmedName) ?? 0) + 1);
    }
  }

  for (const testCase of cases) {
    const caseErrors = errors.cases[testCase.id] ?? {};
    const trimmedName = testCase.name.trim();

    if (!trimmedName) {
      caseErrors.name = 'Case name is required.';
    } else if (trimmedName.length > CASE_NAME_LIMIT) {
      caseErrors.name = `Case name must be ${CASE_NAME_LIMIT} characters or fewer.`;
    } else if ((nameCounts.get(trimmedName) ?? 0) > 1) {
      caseErrors.name = 'Case names must be unique.';
    }

    if (testCase.variables.length > VARIABLE_LIMIT) {
      caseErrors.variablesLimit = `Use at most ${VARIABLE_LIMIT} variables per case.`;
    }

    const keyCounts = new Map<string, number>();
    for (const variable of testCase.variables) {
      if (variable.key) {
        keyCounts.set(variable.key, (keyCounts.get(variable.key) ?? 0) + 1);
      }
    }

    for (const variable of testCase.variables) {
      const variableErrors = caseErrors.variables?.[variable.id] ?? {};

      if (!variable.key) {
        variableErrors.key = 'Variable key is required.';
      } else if (variable.key.length > VARIABLE_KEY_LIMIT) {
        variableErrors.key = `Variable key must be ${VARIABLE_KEY_LIMIT} characters or fewer.`;
      } else if (!VARIABLE_KEY_PATTERN.test(variable.key)) {
        variableErrors.key = 'Use uppercase letters, numbers and underscores.';
      } else if ((keyCounts.get(variable.key) ?? 0) > 1) {
        variableErrors.key = 'Variable keys must be unique within a case.';
      }

      if (variable.value.length > VARIABLE_VALUE_LIMIT) {
        variableErrors.value = `Value must be ${VARIABLE_VALUE_LIMIT} characters or fewer.`;
      }

      if (variableErrors.key || variableErrors.value) {
        caseErrors.variables = {
          ...caseErrors.variables,
          [variable.id]: variableErrors
        };
      }
    }

    if (caseErrors.name || caseErrors.variables || caseErrors.variablesLimit) {
      errors.cases[testCase.id] = caseErrors;
    }
  }

  return errors;
}

export function hasTestDataValidationErrors(errors: TestDataValidationErrors) {
  return Boolean(
    errors.general ||
    Object.values(errors.cases).some((caseErrors) =>
      Boolean(
        caseErrors.name ||
        caseErrors.variablesLimit ||
        Object.values(caseErrors.variables ?? {}).some((variableErrors) => variableErrors.key || variableErrors.value)
      )
    )
  );
}

export function getEnabledTestDataCaseOptions(testData: TestDataCase[]) {
  return testData
    .map((testCase, index) => ({ testCase, index }))
    .filter(({ testCase }) => testCase.enabled)
    .map(({ testCase, index }) => ({
      label: testCase.name,
      value: index
    }));
}

export function shouldBlockRunForTestData(testData: TestDataCase[], selectedDataCaseIndex?: number) {
  if (testData.length === 0) return false;
  const enabledOptions = getEnabledTestDataCaseOptions(testData);
  return enabledOptions.length === 0 || selectedDataCaseIndex === undefined;
}
