import { Alert, Button, Card, Checkbox, Collapse, Empty, Input, Space, Switch, Typography } from 'antd';
import { CopyOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  createEmptyCase,
  createVariableRow,
  duplicateCase,
  type EditableTestDataCase,
  type TestDataValidationErrors
} from '../../utils/testData';

const { Text } = Typography;

type TestDataEditorProps = {
  useTestData: boolean;
  cases: EditableTestDataCase[];
  errors: TestDataValidationErrors;
  readOnly?: boolean;
  onUseTestDataChange: (enabled: boolean) => void;
  onCasesChange: (cases: EditableTestDataCase[]) => void;
};

function updateCase(
  cases: EditableTestDataCase[],
  caseId: string,
  patch: Partial<EditableTestDataCase>
) {
  return cases.map((testCase) => (testCase.id === caseId ? { ...testCase, ...patch } : testCase));
}

export default function TestDataEditor({
  useTestData,
  cases,
  errors,
  readOnly = false,
  onUseTestDataChange,
  onCasesChange
}: TestDataEditorProps) {
  const setUseTestData = (enabled: boolean) => {
    if (readOnly) return;

    if (enabled && cases.length === 0) {
      onCasesChange([createEmptyCase()]);
    }

    onUseTestDataChange(enabled);
  };

  const addCase = () => {
    onCasesChange([...cases, createEmptyCase(cases)]);
    onUseTestDataChange(true);
  };

  const removeCase = (caseId: string) => {
    const nextCases = cases.filter((testCase) => testCase.id !== caseId);
    onCasesChange(nextCases);
    if (nextCases.length === 0) {
      onUseTestDataChange(false);
    }
  };

  const addVariable = (caseId: string) => {
    onCasesChange(cases.map((testCase) => (
      testCase.id === caseId
        ? { ...testCase, variables: [...testCase.variables, createVariableRow()] }
        : testCase
    )));
  };

  const updateVariable = (
    caseId: string,
    variableId: string,
    patch: Partial<{ key: string; value: string }>
  ) => {
    onCasesChange(cases.map((testCase) => (
      testCase.id === caseId
        ? {
            ...testCase,
            variables: testCase.variables.map((variable) => (
              variable.id === variableId ? { ...variable, ...patch } : variable
            ))
          }
        : testCase
    )));
  };

  const removeVariable = (caseId: string, variableId: string) => {
    onCasesChange(cases.map((testCase) => (
      testCase.id === caseId
        ? { ...testCase, variables: testCase.variables.filter((variable) => variable.id !== variableId) }
        : testCase
    )));
  };

  return (
    <Card
      title={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>Test data</span>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Define named cases with template variables for future data-driven runs.
          </Text>
        </div>
      }
      extra={
        <Space>
          <Text>Use test data</Text>
          <Switch checked={useTestData} onChange={setUseTestData} disabled={readOnly} />
        </Space>
      }
      style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {errors.general && useTestData && (
          <Alert type="error" showIcon message={errors.general} />
        )}

        {!useTestData ? (
          <Text type="secondary">
            Test data is off. Saved checks will run exactly as regular checks.
          </Text>
        ) : (
          <>
            <Alert
              type="info"
              showIcon
              message="Use uppercase letters, numbers and underscores. Example: EMAIL, EXPECTED_MESSAGE."
            />

            {cases.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No test cases yet"
              >
                <Button icon={<PlusOutlined />} onClick={addCase} disabled={readOnly}>
                  Add case
                </Button>
              </Empty>
            ) : (
              <Collapse
                items={cases.map((testCase, caseIndex) => {
                  const caseErrors = errors.cases[testCase.id];

                  return {
                    key: testCase.id,
                    label: (
                      <Space wrap>
                        <Text strong>{testCase.name || `Case ${caseIndex + 1}`}</Text>
                        {!testCase.enabled && <Text type="secondary">Disabled</Text>}
                        {caseErrors && <Text type="danger">Has errors</Text>}
                      </Space>
                    ),
                    children: (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <Space wrap align="start" style={{ justifyContent: 'space-between', width: '100%' }}>
                          <div style={{ minWidth: 280, flex: 1 }}>
                            <Text type="secondary">Case name</Text>
                            <Input
                              value={testCase.name}
                              onChange={(event) => onCasesChange(updateCase(cases, testCase.id, { name: event.target.value }))}
                              status={caseErrors?.name ? 'error' : undefined}
                              disabled={readOnly}
                              style={{ marginTop: 4 }}
                            />
                            {caseErrors?.name && (
                              <Text type="danger" style={{ fontSize: 12 }}>
                                {caseErrors.name}
                              </Text>
                            )}
                          </div>
                          <Checkbox
                            checked={testCase.enabled}
                            disabled={readOnly}
                            onChange={(event) => onCasesChange(updateCase(cases, testCase.id, { enabled: event.target.checked }))}
                          >
                            Enabled
                          </Checkbox>
                          <Space>
                            <Button
                              icon={<CopyOutlined />}
                              onClick={() => onCasesChange(duplicateCase(cases, testCase.id))}
                              disabled={readOnly}
                            >
                              Duplicate
                            </Button>
                            <Button
                              icon={<DeleteOutlined />}
                              danger
                              onClick={() => removeCase(testCase.id)}
                              disabled={readOnly}
                            >
                              Delete
                            </Button>
                          </Space>
                        </Space>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Text strong>Variables</Text>
                            <Button icon={<PlusOutlined />} onClick={() => addVariable(testCase.id)} disabled={readOnly}>
                              Add variable
                            </Button>
                          </Space>
                          {caseErrors?.variablesLimit && (
                            <Text type="danger" style={{ fontSize: 12 }}>
                              {caseErrors.variablesLimit}
                            </Text>
                          )}

                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 8px' }}>
                              <thead>
                                <tr>
                                  <th style={{ textAlign: 'left', width: '28%', paddingRight: 8 }}>
                                    <Text type="secondary">Variable</Text>
                                  </th>
                                  <th style={{ textAlign: 'left', paddingRight: 8 }}>
                                    <Text type="secondary">Value</Text>
                                  </th>
                                  <th style={{ width: 96 }} />
                                </tr>
                              </thead>
                              <tbody>
                                {testCase.variables.map((variable) => {
                                  const variableErrors = caseErrors?.variables?.[variable.id];

                                  return (
                                    <tr key={variable.id}>
                                      <td style={{ verticalAlign: 'top', paddingRight: 8 }}>
                                        <Input
                                          value={variable.key}
                                          onChange={(event) => updateVariable(testCase.id, variable.id, { key: event.target.value })}
                                          placeholder="EMAIL"
                                          status={variableErrors?.key ? 'error' : undefined}
                                          disabled={readOnly}
                                        />
                                        {variableErrors?.key && (
                                          <Text type="danger" style={{ fontSize: 12 }}>
                                            {variableErrors.key}
                                          </Text>
                                        )}
                                      </td>
                                      <td style={{ verticalAlign: 'top', paddingRight: 8 }}>
                                        <Input.TextArea
                                          value={variable.value}
                                          onChange={(event) => updateVariable(testCase.id, variable.id, { value: event.target.value })}
                                          placeholder="Value"
                                          autoSize={{ minRows: 1, maxRows: 4 }}
                                          status={variableErrors?.value ? 'error' : undefined}
                                          disabled={readOnly}
                                        />
                                        {variableErrors?.value && (
                                          <Text type="danger" style={{ fontSize: 12 }}>
                                            {variableErrors.value}
                                          </Text>
                                        )}
                                      </td>
                                      <td style={{ verticalAlign: 'top' }}>
                                        <Button
                                          icon={<DeleteOutlined />}
                                          onClick={() => removeVariable(testCase.id, variable.id)}
                                          disabled={readOnly}
                                        />
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          {testCase.variables.length === 0 && (
                            <Text type="secondary" style={{ fontSize: 13 }}>
                              Add variables that can later be used as {'{{EMAIL}}'} or {'{{EXPECTED_MESSAGE}}'}.
                            </Text>
                          )}
                        </div>
                      </div>
                    )
                  };
                })}
              />
            )}

            <Button icon={<PlusOutlined />} onClick={addCase} disabled={readOnly || cases.length >= 100}>
              Add case
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
