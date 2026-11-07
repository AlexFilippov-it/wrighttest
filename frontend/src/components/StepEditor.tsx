import {
  AimOutlined,
  CheckSquareOutlined,
  DeleteOutlined,
  DatabaseOutlined,
  EditOutlined,
  DownOutlined,
  InfoCircleOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  FieldNumberOutlined,
  FileTextOutlined,
  GlobalOutlined,
  KeyOutlined,
  LinkOutlined,
  OrderedListOutlined,
  PlusOutlined,
  HolderOutlined,
  CopyOutlined,
  TagOutlined,
  UnorderedListOutlined
} from '@ant-design/icons';
import { Alert, Button, Card, Checkbox, Dropdown, Input, InputNumber, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Step, StepAction, StepValidationResult } from '../types';
import type { DatabaseConnection } from '../types';
import VariableAutocompleteInput from './VariableAutocompleteInput';
import SqlCodeEditor from './SqlCodeEditor';
import './database-testing.css';

const { Text } = Typography;

type ActionGroup = 'Actions' | 'Assertions' | 'Database';

type ActionOption = {
  value: StepAction;
  icon: ReactNode;
  group: ActionGroup;
  needsSelector: boolean;
  needsValue: boolean;
  needsExpected: boolean;
};

const ACTION_OPTIONS: ActionOption[] = [
  { value: 'executeSql', icon: <DatabaseOutlined />, group: 'Database', needsSelector: false, needsValue: false, needsExpected: false },
  { value: 'assertDatabaseResult', icon: <DatabaseOutlined />, group: 'Database', needsSelector: false, needsValue: false, needsExpected: false },
  { value: 'goto', icon: <GlobalOutlined />, group: 'Actions', needsSelector: false, needsValue: true, needsExpected: false },
  { value: 'click', icon: <AimOutlined />, group: 'Actions', needsSelector: true, needsValue: false, needsExpected: false },
  { value: 'fill', icon: <EditOutlined />, group: 'Actions', needsSelector: true, needsValue: true, needsExpected: false },
  { value: 'press', icon: <KeyOutlined />, group: 'Actions', needsSelector: true, needsValue: true, needsExpected: false },
  { value: 'keyboardPress', icon: <KeyOutlined />, group: 'Actions', needsSelector: false, needsValue: true, needsExpected: false },
  { value: 'selectOption', icon: <UnorderedListOutlined />, group: 'Actions', needsSelector: true, needsValue: true, needsExpected: false },
  { value: 'assertVisible', icon: <EyeOutlined />, group: 'Assertions', needsSelector: true, needsValue: false, needsExpected: false },
  { value: 'assertHidden', icon: <EyeInvisibleOutlined />, group: 'Assertions', needsSelector: true, needsValue: false, needsExpected: false },
  { value: 'assertText', icon: <FileTextOutlined />, group: 'Assertions', needsSelector: true, needsValue: false, needsExpected: true },
  { value: 'assertValue', icon: <FieldNumberOutlined />, group: 'Assertions', needsSelector: true, needsValue: false, needsExpected: true },
  { value: 'assertURL', icon: <LinkOutlined />, group: 'Assertions', needsSelector: false, needsValue: false, needsExpected: true },
  { value: 'assertTitle', icon: <TagOutlined />, group: 'Assertions', needsSelector: false, needsValue: false, needsExpected: true },
  { value: 'assertChecked', icon: <CheckSquareOutlined />, group: 'Assertions', needsSelector: true, needsValue: false, needsExpected: false },
  { value: 'assertCount', icon: <OrderedListOutlined />, group: 'Assertions', needsSelector: true, needsValue: false, needsExpected: true },
  { value: 'waitForSelector', icon: <EyeOutlined />, group: 'Actions', needsSelector: true, needsValue: false, needsExpected: false }
];

interface Props {
  steps: Step[];
  onChange: (steps: Step[]) => void;
  readOnly?: boolean;
  validationResults?: StepValidationResult[];
  stepIssues?: Array<{
    message?: string;
    selector?: string;
    value?: string;
    expected?: string;
  } | undefined>;
  variableNames?: string[];
  databaseConnections?: DatabaseConnection[];
  projectId?: string;
  defaultDatabaseConnectionId?: string;
}

const statusStyles: Record<StepValidationResult['status'], { backgroundColor?: string; border?: string }> = {
  ok: {},
  ambiguous: { backgroundColor: '#fffbe6', border: '1px solid #ffe58f' },
  not_found: { backgroundColor: '#fff2f0', border: '1px solid #ffccc7' },
  action_failed: { backgroundColor: '#fff2f0', border: '1px solid #ffccc7' },
  skipped: {}
};

function getExpectedPlaceholder(action: StepAction) {
  switch (action) {
    case 'assertURL':
      return 'https://example.com/dashboard';
    case 'assertTitle':
      return 'Dashboard | WrightTest';
    case 'assertText':
      return 'Welcome back';
    case 'assertValue':
      return 'user@example.com';
    case 'assertCount':
      return '3';
    default:
      return 'Expected value';
  }
}

function getExpectedHint(action: StepAction, exact: boolean | undefined, t: TFunction) {
  if (action === 'assertURL') {
    return t(exact ? 'step.urlExactHelp' : 'step.urlPartialHelp');
  }

  if (action === 'assertTitle') {
    return t(exact ? 'step.titleExactHelp' : 'step.titlePartialHelp');
  }

  if (action === 'assertText') {
    return t(exact ? 'step.textExactHelp' : 'step.textPartialHelp');
  }

  if (action === 'assertValue') {
    return t('step.valueHelp');
  }

  if (action === 'assertCount') {
    return t('step.countHelp');
  }

  return null;
}

function humanizeStepAction(action: StepAction, t: TFunction) {
  return t(`step.action.${action}`);
}

function variableHint(value: string | undefined, t: TFunction) {
  if (!value || !value.includes('{{')) return null;

  return (
    <Tooltip title={t('step.variableRuntimeHint')}>
      <InfoCircleOutlined style={{ color: '#1677ff' }} />
    </Tooltip>
  );
}

type SqlParameterValue = string | number | boolean | null;
type SqlParameterType = 'string' | 'number' | 'boolean' | 'null' | 'variable';

function parameterType(value: SqlParameterValue): SqlParameterType {
  if (value === null) return 'null';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return /^\{\{[A-Z][A-Z0-9_]*\}\}$/.test(value) ? 'variable' : 'string';
}

export default function StepEditor({ steps, onChange, readOnly = false, validationResults, stepIssues = [], variableNames = [], databaseConnections = [], projectId, defaultDatabaseConnectionId }: Props) {
  const { t } = useTranslation();
  const [parameterDrafts, setParameterDrafts] = useState<Record<number, string>>({});
  const [rawParameterIndex, setRawParameterIndex] = useState<number | null>(null);
  const [parameterNameDrafts, setParameterNameDrafts] = useState<Record<string, string>>({});
  const addStep = () => onChange([...steps, { action: 'goto', value: '' }]);

  const removeStep = (index: number) => onChange(steps.filter((_, idx) => idx !== index));

  const duplicateStep = (index: number) => {
    const cloned = { ...steps[index] };
    const nextSteps = [...steps];
    nextSteps.splice(index + 1, 0, cloned);
    onChange(nextSteps);
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= steps.length) return;
    const nextSteps = [...steps];
    const [moved] = nextSteps.splice(index, 1);
    nextSteps.splice(nextIndex, 0, moved);
    onChange(nextSteps);
  };

  const updateStep = (index: number, patch: Partial<Step>) =>
    onChange(steps.map((step, idx) => (idx === index ? { ...step, ...patch } : step)));

  const updateParameters = (index: number, parameters: Record<string, SqlParameterValue>) => {
    setParameterDrafts((current) => { const next = { ...current }; delete next[index]; return next; });
    updateStep(index, { parameters });
  };

  const changeParameterType = (index: number, key: string, value: SqlParameterValue, type: SqlParameterType) => {
    const textValue = value == null ? '' : String(value);
    const nextValue: SqlParameterValue = type === 'null' ? null
      : type === 'boolean' ? (typeof value === 'boolean' ? value : /^true$/i.test(textValue))
        : type === 'number' ? (typeof value === 'number' ? value : (textValue.trim() && Number.isFinite(Number(textValue)) ? Number(textValue) : 0))
          : type === 'variable' ? (typeof value === 'string' ? value : '{{VARIABLE}}')
            : textValue;
    updateParameters(index, { ...(steps[index].parameters ?? {}), [key]: nextValue });
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {steps.map((step, index) => {
        const opt = ACTION_OPTIONS.find((candidate) => candidate.value === step.action)!;
        const validation = validationResults?.[index];
        const fieldIssue = stepIssues[index];
        const hasLocalIssue = Boolean(fieldIssue?.message || fieldIssue?.selector || fieldIssue?.value || fieldIssue?.expected);
        const isHardInvalid = validation?.status === 'not_found' || validation?.status === 'action_failed' || hasLocalIssue;
        const cardStyle = validation ? statusStyles[validation.status] : {};
        const showExactToggle = ['assertText', 'assertTitle', 'assertURL'].includes(step.action);
        const needsSelector = opt.needsSelector;
        const needsValue = opt.needsValue;
        const needsExpected = opt.needsExpected;
        const stepLabel = humanizeStepAction(step.action, t);
        const rowStyle = {
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: step.action === 'executeSql' || step.action === 'assertDatabaseResult' ? 'wrap' as const : 'nowrap' as const,
          minWidth: 0
        };
        const isDatabaseStep = step.action === 'executeSql' || step.action === 'assertDatabaseResult';

        return (
          <Card
            key={`${index}-${step.action}`}
            size="small"
            style={{
              borderRadius: 16,
              scrollMarginTop: 120,
              scrollMarginBottom: 120,
              borderLeft: isHardInvalid
                ? '3px solid #ff4d4f'
                : opt.group === 'Assertions'
                  ? '3px solid #722ed1'
                  : '3px solid #1677ff',
              ...cardStyle
            }}
            data-step-index={index}
            extra={
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    { key: 'duplicate', icon: <CopyOutlined />, label: t('step.duplicate'), disabled: readOnly },
                    { key: 'move-up', icon: <HolderOutlined />, label: t('step.moveUp'), disabled: readOnly || index === 0 },
                    { key: 'move-down', icon: <HolderOutlined />, label: t('step.moveDown'), disabled: readOnly || index === steps.length - 1 },
                    { type: 'divider' },
                    { key: 'delete', icon: <DeleteOutlined />, label: t('common.delete'), danger: true, disabled: readOnly }
                  ],
                  onClick: ({ key, domEvent }) => {
                    domEvent.stopPropagation();
                    if (readOnly) return;
                    if (key === 'duplicate') duplicateStep(index);
                    if (key === 'move-up') moveStep(index, -1);
                    if (key === 'move-down') moveStep(index, 1);
                    if (key === 'delete') removeStep(index);
                  }
                }}
              >
                <Button icon={<DownOutlined />} size="small" disabled={readOnly}>
                  {t('step.more')}
                </Button>
              </Dropdown>
            }
              title={
                <Space size={8}>
                  <HolderOutlined style={{ color: '#8c8c8c', cursor: 'grab' }} />
                <span style={{ color: opt.group === 'Assertions' ? '#722ed1' : '#1677ff' }}>
                  {opt.icon}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  <span>{t('step.numberedTitle', { number: index + 1 })}</span>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {stepLabel}
                  </Text>
                </div>
                {validation?.status === 'ambiguous' && <span style={{ color: '#ad8b00', fontSize: 12 }}>{t('step.selectorAmbiguous')}</span>}
                {validation?.status === 'not_found' && <span style={{ color: '#cf1322', fontSize: 12 }}>{t('step.selectorNotFound')}</span>}
                {validation?.status === 'action_failed' && <span style={{ color: '#cf1322', fontSize: 12 }}>{t('step.actionFailed')}</span>}
              </Space>
            }
          >
            <div style={rowStyle}>
              <div style={{ flex: '0 0 260px', minWidth: 0 }}>
                <Select
                  value={step.action}
                  style={{ width: '100%' }}
                  disabled={readOnly}
                  onChange={(action) => updateStep(index, {
                    action,
                    ...(action === 'executeSql' || action === 'assertDatabaseResult'
                      ? { databaseConnectionId: step.databaseConnectionId ?? defaultDatabaseConnectionId }
                      : {})
                  })}
                >
                  <Select.OptGroup label={t('step.actions')}>
                    {ACTION_OPTIONS.filter((option) => option.group === 'Actions').map((option) => (
                      <Select.Option key={option.value} value={option.value}>
                        <Space size={8}>
                          {option.icon}
                          <span>{humanizeStepAction(option.value, t)}</span>
                        </Space>
                      </Select.Option>
                    ))}
                  </Select.OptGroup>
                  <Select.OptGroup label={t('step.assertions')}>
                    {ACTION_OPTIONS.filter((option) => option.group === 'Assertions').map((option) => (
                      <Select.Option key={option.value} value={option.value}>
                        <Space size={8}>
                          {option.icon}
                          <span>{humanizeStepAction(option.value, t)}</span>
                        </Space>
                      </Select.Option>
                    ))}
                  </Select.OptGroup>
                  <Select.OptGroup label={t('step.database')}>
                    {ACTION_OPTIONS.filter((option) => option.group === 'Database').map((option) => (
                      <Select.Option key={option.value} value={option.value}>
                        <Space size={8}>{option.icon}<span>{humanizeStepAction(option.value, t)}</span></Space>
                      </Select.Option>
                    ))}
                  </Select.OptGroup>
                </Select>
              </div>

              {isDatabaseStep && <div className="wt-sql-step-fields">
                <div>
                  <Space style={{ width: '100%', justifyContent: 'space-between' }} align="center" wrap>
                    <Text type="secondary">{t('connections.databaseConnection')}</Text>
                    {projectId && <Link to={`/projects/${projectId}/connections`} target="_blank">{t('connections.manage')}</Link>}
                  </Space>
                  {databaseConnections.length === 0 ? (
                    <Alert
                      type="info"
                      showIcon
                      title={t('connections.noConnectionsForStep')}
                      action={projectId ? <Link to={`/projects/${projectId}/connections`} target="_blank">{t('connections.manage')}</Link> : undefined}
                    />
                  ) : <Select
                      value={databaseConnections.some((connection) => connection.id === step.databaseConnectionId) ? step.databaseConnectionId : undefined}
                      placeholder={t('connections.selectConnection')}
                      style={{ width: '100%' }}
                      disabled={readOnly}
                      optionLabelProp="label"
                      options={databaseConnections.map((connection) => ({
                        value: connection.id,
                        label: <span>{connection.name}</span>,
                        title: `${connection.name} · ${t(`connections.provider.${connection.provider}`)} · ${t(`connections.mode.${connection.accessMode}`)}`,
                        connection
                      })).map(({ connection, ...option }) => ({
                        ...option,
                        label: <div className="wt-sql-connection-option">
                          <span>{connection.name}</span>
                          <Text type="secondary">{t(`connections.provider.${connection.provider}`)} · {t(`connections.mode.${connection.accessMode}`)}</Text>
                        </div>
                      }))}
                      onChange={(databaseConnectionId) => updateStep(index, { databaseConnectionId })}
                    />}
                  {step.databaseConnectionId && !databaseConnections.some((connection) => connection.id === step.databaseConnectionId) && (
                    <Alert type="warning" showIcon title={t('connections.missingConnection')} />
                  )}
                  {databaseConnections.length > 0 && <Tooltip title={t('connections.environmentBindingNote')}><Text type="secondary" className="wt-sql-field-help wt-sql-connection-help">{t('connections.environmentBindingShort')} <InfoCircleOutlined /></Text></Tooltip>}
                </div>
                <div>
                  <Text type="secondary">{t('connections.sqlQuery')}</Text>
                  <SqlCodeEditor
                    value={step.sql ?? ''}
                    placeholder={t('connections.sqlPlaceholder')}
                    ariaLabel={t('connections.sqlQuery')}
                    disabled={readOnly}
                    onChange={(sql) => updateStep(index, { sql })}
                  />
                  <Text type="secondary" className="wt-sql-field-help">{t('connections.queryRunsWithCheck')}</Text>
                </div>
                <div className="wt-sql-parameters">
                  <div className="wt-sql-subsection-heading">
                    <div>
                      <Text strong>{t('connections.parameters')}</Text>
                      <Tooltip title={t('connections.parametersHelp')}><InfoCircleOutlined className="wt-sql-info-icon" /></Tooltip>
                    </div>
                    <Space wrap>
                      <Button size="small" disabled={readOnly} onClick={() => {
                        const existing = step.parameters ?? {};
                        let suffix = 1;
                        while (`param${suffix}` in existing) suffix += 1;
                        updateParameters(index, { ...existing, [`param${suffix}`]: '' });
                      }}>{t('connections.addParameter')}</Button>
                      <Button size="small" type="link" disabled={readOnly} onClick={() => {
                        if (rawParameterIndex === index) setRawParameterIndex(null);
                        else {
                          setParameterDrafts((current) => ({ ...current, [index]: JSON.stringify(step.parameters ?? {}, null, 2) }));
                          setRawParameterIndex(index);
                        }
                      }}>
                        {rawParameterIndex === index ? t('connections.parameterTable') : t('connections.rawJson')}
                      </Button>
                    </Space>
                  </div>
                  {rawParameterIndex === index ? (
                    <Input.TextArea
                      value={parameterDrafts[index] ?? JSON.stringify(step.parameters ?? {}, null, 2)}
                      placeholder={'{\n  "orderId": "{{ORDER_ID}}"\n}'}
                      autoSize={{ minRows: 3, maxRows: 8 }}
                      spellCheck={false}
                      disabled={readOnly}
                      status={parameterDrafts[index] && (() => { try { JSON.parse(parameterDrafts[index]); return false; } catch { return true; } })() ? 'error' : undefined}
                      onChange={(event) => {
                        const draft = event.target.value;
                        setParameterDrafts((current) => ({ ...current, [index]: draft }));
                        try {
                          const parsed = JSON.parse(draft);
                          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.values(parsed).every((value) => value === null || ['string', 'number', 'boolean'].includes(typeof value))) {
                            updateStep(index, { parameters: parsed as Record<string, SqlParameterValue> });
                          }
                        } catch { /* Keep the in-progress JSON draft until it becomes valid. */ }
                      }}
                    />
                  ) : Object.entries(step.parameters ?? {}).length === 0 ? (
                    <Text type="secondary">{t('connections.noParameters')}</Text>
                  ) : <div className="wt-sql-parameter-table">
                    <div className="wt-sql-parameter-header"><span>{t('connections.parameter')}</span><span>{t('connections.value')}</span><span>{t('connections.type')}</span><span /></div>
                    {Object.entries(step.parameters ?? {}).map(([key, value]) => {
                      const draftKey = `${index}:${key}`;
                      const draftName = parameterNameDrafts[draftKey];
                      const nameIsValid = /^[A-Za-z_][A-Za-z\d_]*$/.test(draftName ?? key);
                      return <div className="wt-sql-parameter-row" key={key}>
                        <Input
                          value={draftName ?? key}
                          disabled={readOnly}
                          status={!nameIsValid ? 'error' : undefined}
                          aria-label={t('connections.parameter')}
                          onChange={(event) => setParameterNameDrafts((current) => ({ ...current, [draftKey]: event.target.value }))}
                          onBlur={() => {
                            const nextName = (parameterNameDrafts[draftKey] ?? key).trim();
                            setParameterNameDrafts((current) => { const next = { ...current }; delete next[draftKey]; return next; });
                            if (!/^[A-Za-z_][A-Za-z\d_]*$/.test(nextName) || nextName === key || nextName in (step.parameters ?? {})) return;
                            const nextParameters = { ...(step.parameters ?? {}) };
                            delete nextParameters[key];
                            nextParameters[nextName] = value;
                            updateParameters(index, nextParameters);
                          }}
                        />
                        {parameterType(value) === 'number' ? <InputNumber
                          value={typeof value === 'number' ? value : undefined}
                          disabled={readOnly}
                          aria-label={t('connections.parameterValue')}
                          style={{ width: '100%' }}
                          onChange={(nextValue) => { if (nextValue !== null) updateParameters(index, { ...(step.parameters ?? {}), [key]: nextValue }); }}
                        /> : parameterType(value) === 'boolean' ? <Select
                          value={String(value)}
                          disabled={readOnly}
                          aria-label={t('connections.parameterValue')}
                          options={[{ value: 'true', label: t('connections.boolean.true') }, { value: 'false', label: t('connections.boolean.false') }]}
                          onChange={(nextValue) => updateParameters(index, { ...(step.parameters ?? {}), [key]: nextValue === 'true' })}
                        /> : parameterType(value) === 'null' ? <Input value="NULL" aria-label={t('connections.parameterValue')} disabled /> : <VariableAutocompleteInput
                          value={typeof value === 'string' ? value : ''}
                          placeholder={t('connections.parameterValuePlaceholder')}
                          disabled={readOnly}
                          variableNames={variableNames}
                          onValueChange={(nextValue) => updateParameters(index, { ...(step.parameters ?? {}), [key]: nextValue })}
                        />}
                        <Select
                          className="wt-sql-parameter-type"
                          aria-label={t('connections.type')}
                          value={parameterType(value)}
                          disabled={readOnly}
                          options={(['string', 'number', 'boolean', 'null', 'variable'] as SqlParameterType[]).map((type) => ({ value: type, label: t(`connections.parameterType.${type}`) }))}
                          onChange={(type: SqlParameterType) => changeParameterType(index, key, value, type)}
                        />
                        <Button type="text" danger icon={<DeleteOutlined />} aria-label={t('connections.removeParameter')} disabled={readOnly} onClick={() => {
                          const nextParameters = { ...(step.parameters ?? {}) };
                          delete nextParameters[key];
                          updateParameters(index, nextParameters);
                        }} />
                      </div>;
                    })}
                  </div>}
                </div>
                <Space wrap align="end" className="wt-sql-assertion-fields">
                  <div style={{ minWidth: 190 }}>
                    <Space size={4}><Text type="secondary">{t('connections.assertion')}</Text><Tooltip title={t('connections.assertionHelp')}><InfoCircleOutlined className="wt-sql-info-icon" /></Tooltip></Space>
                    <Select
                      allowClear
                      value={step.assertion?.type}
                      style={{ width: '100%' }}
                      disabled={readOnly}
                      options={[
                        { label: t('connections.selectResults'), options: ['notEmpty', 'empty', 'rowCountEquals', 'rowCountGreaterThan', 'columnEquals', 'columnContains', 'columnNotNull'].map((value) => ({ value, label: t(`connections.assertion.${value}`) })) },
                        { label: t('connections.writeResults'), options: ['affectedRowsEquals'].map((value) => ({ value, label: t(`connections.assertion.${value}`) })) }
                      ]}
                      onChange={(type) => updateStep(index, { assertion: type ? { ...step.assertion, type } : undefined })}
                    />
                  </div>
                  {step.assertion && ['columnEquals', 'columnContains', 'columnNotNull'].includes(step.assertion.type) && <div className="wt-sql-assertion-field"><Text type="secondary">{t('connections.column')}</Text><Input aria-label={t('connections.column')} placeholder={t('connections.column')} value={step.assertion.column ?? ''} disabled={readOnly} onChange={(event) => updateStep(index, { assertion: { ...step.assertion!, column: event.target.value } })} /></div>}
                  {step.assertion && ['columnEquals', 'columnContains', 'rowCountEquals', 'rowCountGreaterThan', 'affectedRowsEquals'].includes(step.assertion.type) && <div className="wt-sql-assertion-field"><Text type="secondary">{t('connections.expected')}</Text><Input aria-label={t('connections.expected')} placeholder={t('connections.expected')} value={step.assertion.expected ?? ''} disabled={readOnly} onChange={(event) => updateStep(index, { assertion: { ...step.assertion!, expected: event.target.value } })} /></div>}
                  {step.assertion && ['columnEquals', 'columnContains', 'columnNotNull'].includes(step.assertion.type) && <div className="wt-sql-assertion-field"><Space size={4}><Text type="secondary">{t('connections.rowIndex')}</Text><Tooltip title={t('connections.rowIndexHelp')}><InfoCircleOutlined className="wt-sql-info-icon" /></Tooltip></Space><InputNumber min={0} max={100} aria-label={t('connections.rowIndex')} value={step.assertion.rowIndex ?? 0} disabled={readOnly} onChange={(rowIndex) => updateStep(index, { assertion: { ...step.assertion!, rowIndex: rowIndex ?? 0 } })} /></div>}
                </Space>
                <Space wrap align="center">
                  <Checkbox checked={Boolean(step.waitForResult)} disabled={readOnly || !step.assertion} onChange={(event) => updateStep(index, { waitForResult: event.target.checked ? { timeoutMs: 15000, pollIntervalMs: 1000 } : undefined })}>{t('connections.waitForResult')}</Checkbox>
                  {step.waitForResult && <>
                    <Text type="secondary">{t('connections.timeoutMs')}</Text><InputNumber min={250} max={30000} value={step.waitForResult.timeoutMs} disabled={readOnly} onChange={(timeoutMs) => timeoutMs && updateStep(index, { waitForResult: { ...step.waitForResult!, timeoutMs } })} />
                    <Text type="secondary">{t('connections.pollIntervalMs')}</Text><InputNumber min={250} max={5000} value={step.waitForResult.pollIntervalMs} disabled={readOnly} onChange={(pollIntervalMs) => pollIntervalMs && updateStep(index, { waitForResult: { ...step.waitForResult!, pollIntervalMs } })} />
                  </>}
                  <Checkbox checked={Boolean(step.captureRows)} disabled={readOnly} onChange={(event) => updateStep(index, { captureRows: event.target.checked })}>{t('connections.captureRows')}</Checkbox>
                </Space>
                <div className="wt-sql-save-result">
                  <div className="wt-sql-subsection-heading"><Text strong>{t('connections.saveResult')}</Text><Text type="secondary">{t('connections.saveResultHelp')}</Text></div>
                  <Space wrap>
                    <Select
                      value={!step.saveResultAs ? 'none' : step.saveColumn ? 'column' : 'first'}
                      disabled={readOnly}
                      style={{ minWidth: 190 }}
                      options={[
                        { value: 'none', label: t('connections.saveMode.none') },
                        { value: 'first', label: t('connections.saveMode.first') },
                        { value: 'column', label: t('connections.saveMode.column') }
                      ]}
                      onChange={(mode: 'none' | 'first' | 'column') => updateStep(index, mode === 'none'
                        ? { saveResultAs: undefined, saveColumn: undefined, saveRowIndex: undefined }
                        : { saveResultAs: step.saveResultAs ?? 'RESULT', saveColumn: mode === 'column' ? (step.saveColumn ?? '') : undefined, saveRowIndex: step.saveRowIndex ?? 0 })}
                    />
                    {step.saveResultAs && <Input
                      aria-label={t('connections.variableName')}
                      placeholder={t('connections.saveResultVariablePlaceholder')}
                      value={step.saveResultAs}
                      disabled={readOnly}
                      status={!/^[A-Z][A-Z0-9_]{0,99}$/.test(step.saveResultAs) ? 'error' : undefined}
                      onChange={(event) => updateStep(index, { saveResultAs: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
                    />}
                    {step.saveResultAs && <InputNumber min={0} max={100} aria-label={t('connections.rowIndex')} placeholder={t('connections.rowIndex')} value={step.saveRowIndex ?? 0} disabled={readOnly} onChange={(saveRowIndex) => updateStep(index, { saveRowIndex: saveRowIndex ?? 0 })} />}
                    {step.saveResultAs && step.saveColumn !== undefined && <Input aria-label={t('connections.column')} placeholder={t('connections.column')} value={step.saveColumn} disabled={readOnly} onChange={(event) => updateStep(index, { saveColumn: event.target.value })} />}
                  </Space>
                </div>
                {fieldIssue?.message && <Text type="danger">{fieldIssue.message}</Text>}
              </div>}

              {needsSelector && (
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                  <VariableAutocompleteInput
                    placeholder={t('step.selectorPlaceholder')}
                    value={step.selector ?? ''}
                    style={{ width: '100%' }}
                    disabled={readOnly}
                    status={fieldIssue?.selector ? 'error' : undefined}
                    suffix={variableHint(step.selector, t)}
                    variableNames={variableNames}
                    onValueChange={(nextValue) => updateStep(index, { selector: nextValue })}
                  />
                  {fieldIssue?.selector ? (
                    <Text type="danger" style={{ fontSize: 12, lineHeight: 1.4 }}>
                      {fieldIssue.selector}
                    </Text>
                  ) : validation?.status === 'action_failed' && validation.error ? (
                    <Text type="danger" style={{ fontSize: 12, lineHeight: 1.4 }}>
                      {validation.error}
                    </Text>
                  ) : null}
                </div>
              )}

              {needsValue && (
                <div style={{ flex: '1 1 320px', minWidth: 0, display: 'grid', gap: 4 }}>
                  {step.action === 'fill' ? (
                    <Input
                      placeholder={t('step.valuePlaceholder')}
                      value={step.value ?? ''}
                      style={{ width: '100%' }}
                      disabled={readOnly}
                      status={fieldIssue?.value ? 'error' : undefined}
                      onChange={(event) => updateStep(index, { value: event.target.value })}
                      onInput={(event) => updateStep(index, { value: event.currentTarget.value })}
                    />
                  ) : (
                    <VariableAutocompleteInput
                      placeholder={step.action === 'goto' ? 'https://example.com' : t('step.valuePlaceholder')}
                      value={step.value ?? ''}
                      style={{ width: '100%' }}
                      disabled={readOnly}
                      status={fieldIssue?.value ? 'error' : undefined}
                      suffix={variableHint(step.value, t)}
                      variableNames={variableNames}
                      onValueChange={(nextValue) => updateStep(index, { value: nextValue })}
                    />
                  )}
                  {fieldIssue?.value ? (
                    <Text type="danger" style={{ fontSize: 12, lineHeight: 1.4 }}>
                      {fieldIssue.value}
                    </Text>
                  ) : validation?.status === 'action_failed' && validation.error ? (
                    <Text type="danger" style={{ fontSize: 12, lineHeight: 1.4 }}>
                      {validation.error}
                    </Text>
                  ) : null}
                </div>
              )}

              {needsExpected && (
                <div style={{ flex: '1 1 320px', minWidth: 0, display: 'grid', gap: 4 }}>
                  <VariableAutocompleteInput
                    placeholder={getExpectedPlaceholder(step.action)}
                    value={step.expected ?? ''}
                    style={{ width: '100%' }}
                    disabled={readOnly}
                    status={fieldIssue?.expected ? 'error' : undefined}
                    suffix={variableHint(step.expected, t)}
                    variableNames={variableNames}
                    onValueChange={(nextValue) => updateStep(index, { expected: nextValue })}
                  />
                  {fieldIssue?.expected ? (
                    <Text type="danger" style={{ fontSize: 12, lineHeight: 1.4 }}>
                      {fieldIssue.expected}
                    </Text>
                  ) : validation?.status === 'action_failed' && validation.error ? (
                    <Text type="danger" style={{ fontSize: 12, lineHeight: 1.4 }}>
                      {validation.error}
                    </Text>
                  ) : null}
                  {getExpectedHint(step.action, step.options?.exact, t) && (
                    <Text
                      type="secondary"
                      style={{
                        fontSize: 12,
                        lineHeight: 1.3,
                        minHeight: 32,
                        display: 'block'
                      }}
                    >
                      {getExpectedHint(step.action, step.options?.exact, t)}
                    </Text>
                  )}
                </div>
              )}

              {showExactToggle && (
                <div style={{ flex: '0 0 140px', minWidth: 0, display: 'flex', alignItems: 'flex-start' }}>
                  <Checkbox
                    checked={step.options?.exact ?? false}
                    disabled={readOnly}
                    onChange={(e) =>
                      updateStep(index, {
                        options: {
                          ...step.options,
                          exact: e.target.checked
                        }
                      })
                    }
                  >
                    {t('step.exactMatch')}
                  </Checkbox>
                </div>
              )}
            </div>
          </Card>
        );
      })}
      <Button icon={<PlusOutlined />} onClick={addStep} type="dashed" block disabled={readOnly}>
        {t('editor.addStep')}
      </Button>
    </div>
  );
}
