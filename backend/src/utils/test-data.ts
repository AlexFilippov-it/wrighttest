export type TestDataCase = {
  name: string;
  enabled: boolean;
  variables: Record<string, string>;
};

export type DataCaseSnapshot = {
  dataCaseName: string;
  dataCaseIndex: number;
  dataCaseVariables: Record<string, string>;
};

export const DATA_DRIVEN_CASE_REQUIRED_ERROR = 'Data-driven test requires an explicitly selected test case.';

export function getTestDataCases(value: unknown): TestDataCase[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is TestDataCase => (
    typeof item === 'object' &&
    item !== null &&
    typeof (item as TestDataCase).name === 'string' &&
    typeof (item as TestDataCase).enabled === 'boolean' &&
    typeof (item as TestDataCase).variables === 'object' &&
    (item as TestDataCase).variables !== null &&
    !Array.isArray((item as TestDataCase).variables)
  ));
}

export function hasTestDataCases(value: unknown) {
  return getTestDataCases(value).length > 0;
}

export function buildDataCaseSnapshot(testData: unknown, dataCaseIndex: number): DataCaseSnapshot {
  const cases = getTestDataCases(testData);
  const testCase = cases[dataCaseIndex];

  if (!testCase) {
    throw new Error('Selected test data case was not found.');
  }

  if (!testCase.enabled) {
    throw new Error('Selected test data case is disabled.');
  }

  return {
    dataCaseName: testCase.name,
    dataCaseIndex,
    dataCaseVariables: testCase.variables
  };
}
