import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Collapse, Empty, Input, Modal, Popconfirm, Segmented, Space, Switch, Table, Typography } from 'antd';
import { CopyOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  addEditableVariableToAllCases,
  createEmptyCase,
  createVariableRow,
  duplicateCase,
  getEditableVariable,
  getEditableVariableColumns,
  removeEditableVariableFromAllCases,
  updateEditableVariableValue,
  type EditableTestDataCase,
  type TestDataValidationErrors
} from '../../utils/testData';
import type { TemplateVariablesDiagnostics } from '../../utils/templateVariables';

const { Text } = Typography;
const TABLE_MODE_STORAGE_KEY = 'wrighttest:test-data-editor-mode';
const VARIABLE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

type TestDataEditorProps = {
  useTestData: boolean;
  cases: EditableTestDataCase[];
  errors: TestDataValidationErrors;
  readOnly?: boolean;
  diagnostics?: TemplateVariablesDiagnostics;
  enabledCasesCount?: number;
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
  diagnostics,
  enabledCasesCount = 0,
  onUseTestDataChange,
  onCasesChange
}: TestDataEditorProps) {
  const [mode, setMode] = useState<'table' | 'cards'>(() => {
    const stored = window.localStorage.getItem(TABLE_MODE_STORAGE_KEY);
    if (stored === 'table' || stored === 'cards') return stored;
    return cases.length > 3 ? 'table' : 'cards';
  });
  const [activeCardKeys, setActiveCardKeys] = useState<string[]>([]);
  const [addVariableOpen, setAddVariableOpen] = useState(false);
  const [newVariableKey, setNewVariableKey] = useState('');
  const modeInitializedRef = useRef(cases.length > 0);

  useEffect(() => {
    const stored = window.localStorage.getItem(TABLE_MODE_STORAGE_KEY);
    if (!stored && !modeInitializedRef.current && cases.length > 0) {
      setMode(cases.length > 3 ? 'table' : 'cards');
      modeInitializedRef.current = true;
    }
  }, [cases.length]);

  const variableColumns = useMemo(() => getEditableVariableColumns(cases), [cases]);

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

  const openAddVariable = () => {
    setNewVariableKey('');
    setAddVariableOpen(true);
  };

  const confirmAddVariable = () => {
    const key = newVariableKey.trim();
    if (!VARIABLE_KEY_PATTERN.test(key)) return;
    onCasesChange(addEditableVariableToAllCases(cases, key));
    setAddVariableOpen(false);
    setNewVariableKey('');
    onUseTestDataChange(true);
  };

  const deleteVariableColumn = (key: string) => {
    onCasesChange(removeEditableVariableFromAllCases(cases, key));
  };

  const openDetails = (caseId: string) => {
    setMode('cards');
    window.localStorage.setItem(TABLE_MODE_STORAGE_KEY, 'cards');
    setActiveCardKeys([caseId]);
  };

  const setEditorMode = (nextMode: 'table' | 'cards') => {
    setMode(nextMode);
    window.localStorage.setItem(TABLE_MODE_STORAGE_KEY, nextMode);
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

  const tableColumns = useMemo(() => [
    {
      title: 'Enabled',
      width: 96,
      fixed: 'left' as const,
      render: (_: unknown, testCase: EditableTestDataCase) => (
        <Checkbox
          checked={testCase.enabled}
          disabled={readOnly}
          onChange={(event) => onCasesChange(updateCase(cases, testCase.id, { enabled: event.target.checked }))}
        />
      )
    },
    {
      title: 'Case name',
      width: 240,
      fixed: 'left' as const,
      render: (_: unknown, testCase: EditableTestDataCase) => {
        const caseErrors = errors.cases[testCase.id];
        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Input
              value={testCase.name}
              onChange={(event) => onCasesChange(updateCase(cases, testCase.id, { name: event.target.value }))}
              status={caseErrors?.name ? 'error' : undefined}
              disabled={readOnly}
            />
            {caseErrors?.name && <Text type="danger" style={{ fontSize: 12 }}>{caseErrors.name}</Text>}
          </Space>
        );
      }
    },
    ...variableColumns.map((key) => ({
      title: (
        <Space size={6}>
          <span>{key}</span>
          <Popconfirm
            title={`Delete variable ${key}?`}
            description="This removes the variable from all cases."
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => deleteVariableColumn(key)}
            disabled={readOnly}
          >
            <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={readOnly} />
          </Popconfirm>
        </Space>
      ),
      width: 220,
      render: (_: unknown, testCase: EditableTestDataCase) => {
        const variable = getEditableVariable(cases, testCase.id, key);
        const variableErrors = variable ? errors.cases[testCase.id]?.variables?.[variable.id] : undefined;
        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Input.TextArea
              value={variable?.value ?? ''}
              placeholder={variable ? 'Empty string' : 'Missing'}
              autoSize={{ minRows: 1, maxRows: 3 }}
              status={variableErrors?.value ? 'error' : undefined}
              disabled={readOnly}
              onChange={(event) => onCasesChange(updateEditableVariableValue(cases, testCase.id, key, event.target.value))}
            />
            {!variable && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                Missing until edited
              </Text>
            )}
            {variableErrors?.value && <Text type="danger" style={{ fontSize: 12 }}>{variableErrors.value}</Text>}
          </Space>
        );
      }
    })),
    {
      title: 'Actions',
      width: 230,
      fixed: 'right' as const,
      render: (_: unknown, testCase: EditableTestDataCase) => (
        <Space wrap>
          <Button size="small" onClick={() => openDetails(testCase.id)}>
            Open details
          </Button>
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => onCasesChange(duplicateCase(cases, testCase.id))}
            disabled={readOnly}
          >
            Duplicate
          </Button>
          <Button
            size="small"
            icon={<DeleteOutlined />}
            danger
            onClick={() => removeCase(testCase.id)}
            disabled={readOnly}
          />
        </Space>
      )
    }
  ], [cases, errors.cases, onCasesChange, readOnly, variableColumns]);

  const renderEditorActions = () => (
    <Space wrap>
      <Segmented
        value={mode}
        onChange={(value) => setEditorMode(value as 'table' | 'cards')}
        options={[
          { label: 'Table', value: 'table' },
          { label: 'Cards', value: 'cards' }
        ]}
      />
      <Button icon={<PlusOutlined />} onClick={addCase} disabled={readOnly || cases.length >= 100}>
        Add case
      </Button>
      <Button icon={<PlusOutlined />} onClick={openAddVariable} disabled={readOnly || cases.length === 0}>
        Add variable
      </Button>
    </Space>
  );

  return (
    <Card
      title={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>Test data</span>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Define scenario variables used anywhere in your browser flow, including inputs and expected results.
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
              message="Use uppercase letters, numbers and underscores. Examples: EMAIL, PASS, EXPECTED_MESSAGE, EXPECTED_URL."
              description="Use them in steps as Fill {{EMAIL}} or Assert text {{EXPECTED_MESSAGE}}."
            />

            {diagnostics && (
              <Card size="small" title="Variables check" style={{ borderRadius: 14, background: '#fcfcfd' }}>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {diagnostics.errors.length === 0 ? (
                    <Alert
                      type="success"
                      showIcon
                      message={`All variables are available for ${enabledCasesCount} enabled case${enabledCasesCount === 1 ? '' : 's'}.`}
                    />
                  ) : (
                    <Alert
                      type="error"
                      showIcon
                      message={`${diagnostics.errors.length} issue${diagnostics.errors.length === 1 ? '' : 's'} found`}
                      description={
                        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                          {diagnostics.errors.slice(0, 6).map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                          {diagnostics.errors.length > 6 && <li>{diagnostics.errors.length - 6} more issues</li>}
                        </ul>
                      }
                    />
                  )}

                  {diagnostics.warnings.length > 0 && (
                    <Alert
                      type="warning"
                      showIcon
                      message={`${diagnostics.warnings.length} warning${diagnostics.warnings.length === 1 ? '' : 's'}`}
                      description={
                        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                          {diagnostics.warnings.slice(0, 6).map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                          {diagnostics.warnings.length > 6 && <li>{diagnostics.warnings.length - 6} more warnings</li>}
                        </ul>
                      }
                    />
                  )}

                  {diagnostics.usedVariables.length > 0 && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Used variables: {diagnostics.usedVariables.map((name) => `{{${name}}}`).join(', ')}
                    </Text>
                  )}
                </Space>
              </Card>
            )}

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
              <>
                {renderEditorActions()}
                {mode === 'table' ? (
                  <Table
                    size="small"
                    rowKey="id"
                    columns={tableColumns}
                    dataSource={cases}
                    pagination={cases.length > 20 ? { pageSize: 20, showSizeChanger: false } : false}
                    scroll={{ x: Math.max(760, 560 + variableColumns.length * 220) }}
                    rowClassName={(testCase) => errors.cases[testCase.id] ? 'test-data-row-has-error' : ''}
                  />
                ) : (
              <Collapse
                activeKey={activeCardKeys}
                onChange={(keys) => setActiveCardKeys(Array.isArray(keys) ? keys.map(String) : [String(keys)])}
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
              </>
            )}
          </>
        )}
      </div>
      <Modal
        title="Add variable"
        open={addVariableOpen}
        onOk={confirmAddVariable}
        onCancel={() => setAddVariableOpen(false)}
        okButtonProps={{ disabled: !VARIABLE_KEY_PATTERN.test(newVariableKey.trim()) }}
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Text type="secondary">
            Add this key to all cases. Values start as an explicit empty string.
          </Text>
          <Input
            value={newVariableKey}
            onChange={(event) => setNewVariableKey(event.target.value.toUpperCase())}
            placeholder="EXPECTED_MESSAGE"
            status={newVariableKey && !VARIABLE_KEY_PATTERN.test(newVariableKey.trim()) ? 'error' : undefined}
            autoFocus
          />
          {newVariableKey && !VARIABLE_KEY_PATTERN.test(newVariableKey.trim()) && (
            <Text type="danger" style={{ fontSize: 12 }}>
              Use uppercase letters, numbers and underscores. Start with a letter.
            </Text>
          )}
        </Space>
      </Modal>
    </Card>
  );
}
