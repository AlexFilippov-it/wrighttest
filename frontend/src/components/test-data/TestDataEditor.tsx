import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Collapse, Empty, Input, Modal, Popconfirm, Segmented, Select, Space, Switch, Table, Typography } from 'antd';
import { CopyOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
    patch: Partial<EditableTestDataCase['variables'][number]>
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

  const renderVariableValueEditor = (caseId: string, variable: EditableTestDataCase['variables'][number], error?: string) => (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      <Select
        value={variable.kind}
        disabled={readOnly}
        options={[
          { value: 'literal', label: t('testData.cellMode.literal') },
          { value: 'reference', label: t('testData.cellMode.reference') },
          { value: 'generated', label: t('testData.cellMode.generated') }
        ]}
        onChange={(kind: EditableTestDataCase['variables'][number]['kind']) => updateVariable(caseId, variable.id, { kind })}
      />
      {variable.kind === 'literal' ? <Input.TextArea
        value={variable.value}
        aria-label={variable.value === '' ? `${variable.key} ${t('testData.emptyString')}` : variable.key}
        onChange={(event) => updateVariable(caseId, variable.id, { value: event.target.value })}
        placeholder={t('common.value')}
        autoSize={{ minRows: 1, maxRows: 4 }}
        status={error ? 'error' : undefined}
        disabled={readOnly}
      /> : null}
      {variable.kind === 'reference' ? <>
        <Input
          value={variable.referenceName ?? ''}
          onChange={(event) => updateVariable(caseId, variable.id, { referenceName: event.target.value.toUpperCase() })}
          placeholder={t('testData.referenceNamePlaceholder')}
          disabled={readOnly}
        />
        <Select
          allowClear
          value={variable.referenceSource}
          placeholder={t('testData.referenceSource')}
          options={[{ value: 'project', label: t('testData.source.project') }, { value: 'environment', label: t('testData.source.environment') }]}
          onChange={(referenceSource: 'project' | 'environment' | undefined) => updateVariable(caseId, variable.id, { referenceSource })}
          disabled={readOnly}
        />
      </> : null}
      {variable.kind === 'generated' ? <>
        <Select
          value={variable.generator ?? 'username'}
          options={['username', 'email', 'password', 'uuid', 'string', 'number', 'boolean', 'date', 'timestamp', 'pattern'].map((generator) => ({ value: generator, label: t(`testData.generator.${generator}`) }))}
          onChange={(generator: string) => updateVariable(caseId, variable.id, { generator, secret: generator === 'password' ? true : variable.secret })}
          disabled={readOnly}
        />
        <Input.TextArea
          value={JSON.stringify(variable.options ?? {})}
          onChange={(event) => { try { const options = JSON.parse(event.target.value) as Record<string, string | number | boolean>; updateVariable(caseId, variable.id, { options }); } catch { /* Keep the last valid generator options while the user edits JSON. */ } }}
          placeholder={t('testData.generatorOptionsPlaceholder')}
          autoSize={{ minRows: 1, maxRows: 3 }}
          disabled={readOnly}
        />
        <Checkbox checked={Boolean(variable.secret)} onChange={(event) => updateVariable(caseId, variable.id, { secret: event.target.checked })} disabled={readOnly}>{t('testData.secretOutput')}</Checkbox>
      </> : null}
      {error ? <Text type="danger" style={{ fontSize: 12 }}>{error}</Text> : null}
    </Space>
  );

  const tableColumns = useMemo(() => [
    {
      title: t('common.enabled'),
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
      title: t('testData.caseName'),
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
            title={t('testData.deleteVariableTitle', { name: key })}
            description={t('testData.deleteVariableDescription')}
            okText={t('common.delete')}
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
            {variable ? renderVariableValueEditor(testCase.id, variable, variableErrors?.value) : <Input.TextArea
              value="" placeholder={t('testData.missing')} autoSize={{ minRows: 1, maxRows: 3 }} disabled={readOnly}
              onChange={(event) => onCasesChange(updateEditableVariableValue(cases, testCase.id, key, event.target.value))}
            />}
            {!variable && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('testData.missingUntilEdited')}
              </Text>
            )}
            {variableErrors?.value && <Text type="danger" style={{ fontSize: 12 }}>{variableErrors.value}</Text>}
          </Space>
        );
      }
    })),
    {
      title: t('common.actions'),
      width: 230,
      fixed: 'right' as const,
      render: (_: unknown, testCase: EditableTestDataCase) => (
        <Space wrap>
          <Button size="small" onClick={() => openDetails(testCase.id)}>
            {t('testData.openDetails')}
          </Button>
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => onCasesChange(duplicateCase(cases, testCase.id))}
            disabled={readOnly}
          >
            {t('common.duplicate')}
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
  ], [cases, errors.cases, onCasesChange, readOnly, t, variableColumns]);

  const renderEditorActions = () => (
    <Space wrap>
      <Segmented
        value={mode}
        onChange={(value) => setEditorMode(value as 'table' | 'cards')}
        options={[
          { label: t('testData.table'), value: 'table' },
          { label: t('testData.cards'), value: 'cards' }
        ]}
      />
      <Button icon={<PlusOutlined />} onClick={addCase} disabled={readOnly || cases.length >= 100}>
        {t('testData.addCase')}
      </Button>
      <Button icon={<PlusOutlined />} onClick={openAddVariable} disabled={readOnly || cases.length === 0}>
        {t('testData.addVariable')}
      </Button>
    </Space>
  );

  return (
    <Card
      className="wt-editor-section-card wt-editor-test-data-card"
      title={
        <div className="wt-editor-section-card__heading">
          <span>{t('testData.title')}</span>
          <Text type="secondary" className="wt-editor-section-card__description">
            {t('testData.description')}
          </Text>
        </div>
      }
      extra={
        <Space>
          <Text>{t('testData.use')}</Text>
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
            {t('testData.offDescription')}
          </Text>
        ) : (
          <>
            <Alert
              type="info"
              showIcon
              message={t('testData.variableNamingHelp')}
              description={t('testData.variableUsageHelp')}
            />

            {diagnostics && (
              <Card size="small" title={t('testData.variablesCheck')} style={{ borderRadius: 14, background: '#fcfcfd' }}>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {diagnostics.errors.length === 0 ? (
                    <Alert
                      type="success"
                      showIcon
                      message={t('testData.variablesAvailable', { count: enabledCasesCount })}
                    />
                  ) : (
                    <Alert
                      type="error"
                      showIcon
                      message={t('testData.issuesFound', { count: diagnostics.errors.length })}
                      description={
                        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                          {diagnostics.errors.slice(0, 6).map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                          {diagnostics.errors.length > 6 && <li>{t('testData.moreIssues', { count: diagnostics.errors.length - 6 })}</li>}
                        </ul>
                      }
                    />
                  )}

                  {diagnostics.warnings.length > 0 && (
                    <Alert
                      type="warning"
                      showIcon
                      message={t('testData.warningsFound', { count: diagnostics.warnings.length })}
                      description={
                        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                          {diagnostics.warnings.slice(0, 6).map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                          {diagnostics.warnings.length > 6 && <li>{t('testData.moreWarnings', { count: diagnostics.warnings.length - 6 })}</li>}
                        </ul>
                      }
                    />
                  )}

                  {diagnostics.usedVariables.length > 0 && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t('testData.usedVariables')}: {diagnostics.usedVariables.map((name) => `{{${name}}}`).join(', ')}
                    </Text>
                  )}
                </Space>
              </Card>
            )}

            {cases.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('testData.noCases')}
              >
                <Button icon={<PlusOutlined />} onClick={addCase} disabled={readOnly}>
                  {t('testData.addCase')}
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
                        {!testCase.enabled && <Text type="secondary">{t('common.disabled')}</Text>}
                        {caseErrors && <Text type="danger">{t('testData.hasErrors')}</Text>}
                      </Space>
                    ),
                    children: (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <Space wrap align="start" style={{ justifyContent: 'space-between', width: '100%' }}>
                          <div style={{ minWidth: 280, flex: 1 }}>
                            <Text type="secondary">{t('testData.caseName')}</Text>
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
                            {t('common.enabled')}
                          </Checkbox>
                          <Space>
                            <Button
                              icon={<CopyOutlined />}
                              onClick={() => onCasesChange(duplicateCase(cases, testCase.id))}
                              disabled={readOnly}
                            >
                              {t('common.duplicate')}
                            </Button>
                            <Button
                              icon={<DeleteOutlined />}
                              danger
                              onClick={() => removeCase(testCase.id)}
                              disabled={readOnly}
                            >
                              {t('common.delete')}
                            </Button>
                          </Space>
                        </Space>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Text strong>{t('testData.variables')}</Text>
                            <Button icon={<PlusOutlined />} onClick={() => addVariable(testCase.id)} disabled={readOnly}>
                              {t('testData.addVariable')}
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
                                    <Text type="secondary">{t('testData.variable')}</Text>
                                  </th>
                                  <th style={{ textAlign: 'left', paddingRight: 8 }}>
                                    <Text type="secondary">{t('common.value')}</Text>
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
                                          placeholder={t('testData.variableExample')}
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
                                        {renderVariableValueEditor(testCase.id, variable, variableErrors?.value)}
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
                              {t('testData.addVariablesHelp', { email: '{{EMAIL}}', expected: '{{EXPECTED_MESSAGE}}' })}
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
        title={t('testData.addVariable')}
        open={addVariableOpen}
        onOk={confirmAddVariable}
        onCancel={() => setAddVariableOpen(false)}
        okButtonProps={{ disabled: !VARIABLE_KEY_PATTERN.test(newVariableKey.trim()) }}
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Text type="secondary">
            {t('testData.addVariableDescription')}
          </Text>
          <Input
            value={newVariableKey}
            onChange={(event) => setNewVariableKey(event.target.value.toUpperCase())}
            placeholder={t('testData.variableExpectedExample')}
            status={newVariableKey && !VARIABLE_KEY_PATTERN.test(newVariableKey.trim()) ? 'error' : undefined}
            autoFocus
          />
          {newVariableKey && !VARIABLE_KEY_PATTERN.test(newVariableKey.trim()) && (
            <Text type="danger" style={{ fontSize: 12 }}>
              {t('testData.variableKeyValidation')}
            </Text>
          )}
        </Space>
      </Modal>
    </Card>
  );
}
