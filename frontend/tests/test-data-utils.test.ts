import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addEditableVariableToAllCases,
  createEmptyCase,
  createVariableRow,
  duplicateCase,
  getEnabledTestDataCaseOptions,
  getEditableVariable,
  getEditableVariableColumns,
  hasTestDataValidationErrors,
  removeEditableVariableFromAllCases,
  shouldBlockRunForTestData,
  toApiTestData,
  toEditableTestData,
  updateEditableVariableValue,
  validateEditableTestData,
  type EditableTestDataCase
} from '../src/utils/testData';

function idFactory() {
  let index = 0;
  return () => `id-${++index}`;
}

function editableCase(overrides: Partial<EditableTestDataCase> = {}): EditableTestDataCase {
  return {
    id: 'case-1',
    name: 'Invalid email',
    enabled: true,
    variables: [
      { id: 'var-1', key: 'EMAIL', value: 'wrong-email' }
    ],
    ...overrides
  };
}

test('empty editor state has no API test data while disabled', () => {
  assert.deepEqual(toEditableTestData(undefined), []);
  assert.deepEqual(toApiTestData([], false), []);
  assert.equal(hasTestDataValidationErrors(validateEditableTestData([], false)), false);
});

test('loads existing testData into editable rows without losing disabled cases', () => {
  const makeId = idFactory();
  const editable = toEditableTestData([
    {
      name: 'Short password',
      enabled: false,
      variables: {
        EMAIL: 'user@example.com',
        PASSWORD: '123'
      }
    }
  ], makeId);

  assert.equal(editable[0].name, 'Short password');
  assert.equal(editable[0].enabled, false);
  assert.deepEqual(editable[0].variables.map((variable) => [variable.key, variable.value]), [
    ['EMAIL', 'user@example.com'],
    ['PASSWORD', '123']
  ]);
});

test('creates unique default case names', () => {
  const makeId = idFactory();
  const first = createEmptyCase([], makeId);
  const second = createEmptyCase([first], makeId);

  assert.equal(first.name, 'Case 1');
  assert.equal(second.name, 'Case 2');
});

test('adding and removing a variable is represented by editable rows', () => {
  const variable = createVariableRow(() => 'var-2');
  const testCase = editableCase({
    variables: [variable]
  });

  assert.deepEqual(testCase.variables, [{ id: 'var-2', key: '', value: '' }]);
  assert.deepEqual(toApiTestData([{ ...testCase, variables: [] }], true)[0].variables, {});
});

test('duplicate case name validation catches names after trim', () => {
  const errors = validateEditableTestData([
    editableCase({ id: 'case-1', name: 'Duplicate' }),
    editableCase({ id: 'case-2', name: ' Duplicate ' })
  ], true);

  assert.equal(hasTestDataValidationErrors(errors), true);
  assert.equal(errors.cases['case-1'].name, 'Case names must be unique.');
  assert.equal(errors.cases['case-2'].name, 'Case names must be unique.');
});

test('invalid variable key validation allows temporary invalid input', () => {
  const errors = validateEditableTestData([
    editableCase({
      variables: [{ id: 'var-1', key: 'email', value: 'user@example.com' }]
    })
  ], true);

  assert.equal(hasTestDataValidationErrors(errors), true);
  assert.equal(errors.cases['case-1'].variables?.['var-1'].key, 'Use uppercase letters, numbers and underscores.');
});

test('variable value keeps leading and trailing spaces in API payload', () => {
  const payload = toApiTestData([
    editableCase({
      variables: [{ id: 'var-1', key: 'MESSAGE', value: '  keep spaces  ' }]
    })
  ], true);

  assert.equal(payload[0].variables.MESSAGE, '  keep spaces  ');
});

test('disabled case remains in save payload while enabled feature is on', () => {
  const payload = toApiTestData([
    editableCase({ enabled: false })
  ], true);

  assert.equal(payload[0].enabled, false);
});

test('duplicating a case creates a unique copy name and cloned variables', () => {
  const makeId = idFactory();
  const cases = [
    editableCase({ id: 'case-1', name: 'Invalid email' }),
    editableCase({ id: 'case-2', name: 'Invalid email copy' })
  ];
  const nextCases = duplicateCase(cases, 'case-1', makeId);

  assert.equal(nextCases[1].name, 'Invalid email copy 2');
  assert.deepEqual(nextCases[1].variables.map((variable) => [variable.key, variable.value]), [['EMAIL', 'wrong-email']]);
  assert.notEqual(nextCases[1].variables[0].id, cases[0].variables[0].id);
});

test('turning feature off sends an empty testData payload', () => {
  const payload = toApiTestData([editableCase()], false);

  assert.deepEqual(payload, []);
});

test('enabled test data cases form options with original indexes', () => {
  const options = getEnabledTestDataCaseOptions([
    { name: 'First', enabled: true, variables: {} },
    { name: 'Disabled', enabled: false, variables: {} },
    { name: 'Third', enabled: true, variables: {} }
  ]);

  assert.deepEqual(options, [
    { label: 'First', value: 0 },
    { label: 'Third', value: 2 }
  ]);
});

test('run is blocked when data-driven test has no enabled cases or no selected case', () => {
  assert.equal(shouldBlockRunForTestData([], undefined), false);
  assert.equal(shouldBlockRunForTestData([{ name: 'Disabled', enabled: false, variables: {} }], undefined), true);
  assert.equal(shouldBlockRunForTestData([{ name: 'Enabled', enabled: true, variables: {} }], undefined), true);
  assert.equal(shouldBlockRunForTestData([{ name: 'Enabled', enabled: true, variables: {} }], 0), false);
});

test('first test data case is not selected automatically by utility defaults', () => {
  const options = getEnabledTestDataCaseOptions([
    { name: 'First', enabled: true, variables: {} }
  ]);
  const selectedIndex = undefined;

  assert.deepEqual(options, [{ label: 'First', value: 0 }]);
  assert.equal(shouldBlockRunForTestData([{ name: 'First', enabled: true, variables: {} }], selectedIndex), true);
});

test('ordinary run payload omits dataCaseIndex while selected case run payload includes it', () => {
  const ordinaryPayload = {};
  const selectedPayload = { dataCaseIndex: 2 };

  assert.deepEqual(ordinaryPayload, {});
  assert.deepEqual(selectedPayload, { dataCaseIndex: 2 });
});

test('use test data off does not block run because hidden invalid cases are omitted', () => {
  const invalidHiddenCases = [
    editableCase({
      name: '',
      variables: [{ id: 'var-1', key: 'bad', value: 'x' }]
    })
  ];
  const payload = toApiTestData(invalidHiddenCases, false);
  const errors = validateEditableTestData(invalidHiddenCases, false);

  assert.deepEqual(payload, []);
  assert.equal(hasTestDataValidationErrors(errors), false);
  assert.equal(shouldBlockRunForTestData(payload, undefined), false);
});

test('table variable columns merge keys and preserve case order', () => {
  const cases = [
    editableCase({ id: 'case-1', name: 'First', variables: [{ id: 'var-1', key: 'EMAIL', value: 'a' }] }),
    editableCase({ id: 'case-2', name: 'Second', variables: [{ id: 'var-2', key: 'PASSWORD', value: 'b' }, { id: 'var-3', key: 'EMAIL', value: 'c' }] })
  ];

  assert.deepEqual(getEditableVariableColumns(cases), ['EMAIL', 'PASSWORD']);
  assert.deepEqual(cases.map((testCase) => testCase.name), ['First', 'Second']);
});

test('table editing keeps empty string distinct from missing key', () => {
  const cases = [
    editableCase({ id: 'case-1', variables: [{ id: 'var-1', key: 'EMAIL', value: '' }] }),
    editableCase({ id: 'case-2', variables: [] })
  ];

  assert.equal(getEditableVariable(cases, 'case-1', 'EMAIL')?.value, '');
  assert.equal(getEditableVariable(cases, 'case-2', 'EMAIL'), undefined);

  const nextCases = updateEditableVariableValue(cases, 'case-2', 'EMAIL', '', () => 'var-2');
  assert.equal(getEditableVariable(nextCases, 'case-2', 'EMAIL')?.value, '');
  assert.deepEqual(toApiTestData(nextCases, true).map((testCase) => testCase.variables), [
    { EMAIL: '' },
    { EMAIL: '' }
  ]);
});

test('adding variable to all editable cases creates explicit empty values', () => {
  const cases = [
    editableCase({ id: 'case-1', variables: [] }),
    editableCase({ id: 'case-2', variables: [{ id: 'var-existing', key: 'EMAIL', value: 'user@example.com' }] })
  ];
  const makeId = idFactory();
  const nextCases = addEditableVariableToAllCases(cases, 'PASSWORD', makeId);

  assert.deepEqual(nextCases.map((testCase) => getEditableVariable(testCase.id === 'case-1' ? nextCases : nextCases, testCase.id, 'PASSWORD')?.value), ['', '']);
  assert.deepEqual(toApiTestData(nextCases, true).map((testCase) => testCase.variables.PASSWORD), ['', '']);
});

test('removing variable from all editable cases keeps other variables', () => {
  const cases = [
    editableCase({ id: 'case-1', variables: [{ id: 'var-1', key: 'EMAIL', value: 'a' }, { id: 'var-2', key: 'PASSWORD', value: 'b' }] }),
    editableCase({ id: 'case-2', variables: [{ id: 'var-3', key: 'PASSWORD', value: '' }] })
  ];
  const nextCases = removeEditableVariableFromAllCases(cases, 'PASSWORD');

  assert.deepEqual(nextCases[0].variables, [{ id: 'var-1', key: 'EMAIL', value: 'a' }]);
  assert.deepEqual(nextCases[1].variables, []);
});

test('duplicated table case preserves variables and table payload matches card payload', () => {
  const makeId = idFactory();
  const cases = [
    editableCase({
      id: 'case-1',
      variables: [
        { id: 'var-1', key: 'EMAIL', value: 'user@example.com' },
        { id: 'var-2', key: 'PASSWORD', value: '' }
      ]
    })
  ];

  const duplicated = duplicateCase(cases, 'case-1', makeId);
  assert.deepEqual(duplicated[1].variables.map((variable) => [variable.key, variable.value]), [
    ['EMAIL', 'user@example.com'],
    ['PASSWORD', '']
  ]);
  assert.deepEqual(toApiTestData(duplicated, true), duplicated.map((testCase) => ({
    name: testCase.name.trim(),
    enabled: testCase.enabled,
    variables: Object.fromEntries(testCase.variables.map((variable) => [variable.key, variable.value]))
  })));
});

test('validation errors can be mapped to table row and variable key', () => {
  const cases = [
    editableCase({ id: 'case-1', name: '', variables: [{ id: 'var-1', key: 'bad', value: 'x' }] })
  ];
  const errors = validateEditableTestData(cases, true);
  const variable = getEditableVariable(cases, 'case-1', 'bad');

  assert.equal(errors.cases['case-1'].name, 'Case name is required.');
  assert.equal(variable ? errors.cases['case-1'].variables?.[variable.id].key : undefined, 'Use uppercase letters, numbers and underscores.');
});
