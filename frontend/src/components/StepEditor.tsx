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
  UpOutlined,
  HolderOutlined,
  CopyOutlined,
  TagOutlined,
  UnorderedListOutlined,
  ThunderboltOutlined,
  SaveOutlined
} from '@ant-design/icons';
import { Alert, Button, Card, Checkbox, Collapse, Dropdown, Input, InputNumber, message, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Step, StepAction, StepValidationResult } from '../types';
import type { DatabaseConnection } from '../types';
import type { ProjectVariable } from '../api/client';
import VariableAutocompleteInput from './VariableAutocompleteInput';
import { isSecretVariableName } from '../utils/secret-variable';
import SqlCodeEditor from './SqlCodeEditor';
import HttpRequestEditor from './HttpRequestEditor';
import { safeHttpUrl } from '../utils/safe-display';
import './database-testing.css';

const { Text } = Typography;

type ActionGroup = 'Actions' | 'Assertions' | 'Database' | 'API';

type ActionOption = {
  value: StepAction;
  icon: ReactNode;
  group: ActionGroup;
  needsSelector: boolean;
  needsValue: boolean;
  needsExpected: boolean;
};

const ACTION_OPTIONS: ActionOption[] = [
  { value: 'generateData', icon: <ThunderboltOutlined />, group: 'Actions', needsSelector: false, needsValue: false, needsExpected: false },
  { value: 'captureValue', icon: <SaveOutlined />, group: 'Actions', needsSelector: false, needsValue: false, needsExpected: false },
  { value: 'executeSql', icon: <DatabaseOutlined />, group: 'Database', needsSelector: false, needsValue: false, needsExpected: false },
  { value: 'assertDatabaseResult', icon: <DatabaseOutlined />, group: 'Database', needsSelector: false, needsValue: false, needsExpected: false },
  { value: 'httpRequest', icon: <GlobalOutlined />, group: 'API', needsSelector: false, needsValue: false, needsExpected: false },
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
  projectVariables?: ProjectVariable[];
  testDataVariableNames?: string[];
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

export default function StepEditor({ steps, onChange, readOnly = false, validationResults, stepIssues = [], variableNames = [], projectVariables = [], testDataVariableNames = [], databaseConnections = [], projectId, defaultDatabaseConnectionId }: Props) {
  const { t } = useTranslation();
  const [collapsedSteps, setCollapsedSteps] = useState<Set<number>>(() => new Set());
  const [parameterDrafts, setParameterDrafts] = useState<Record<number, string>>({});
  const [rawParameterIndex, setRawParameterIndex] = useState<number | null>(null);
  const [parameterNameDrafts, setParameterNameDrafts] = useState<Record<string, string>>({});
  const addStep = () => {
    const newIndex = steps.length;
    setCollapsedSteps((current) => {
      if (!current.has(newIndex)) return current;
      const next = new Set(current);
      next.delete(newIndex);
      return next;
    });
    onChange([...steps, { action: 'goto', value: '' }]);
  };

  const removeStep = (index: number) => {
    setCollapsedSteps((current) => new Set(Array.from(current, (stepIndex) => stepIndex < index ? stepIndex : stepIndex > index ? stepIndex - 1 : -1).filter((stepIndex) => stepIndex >= 0)));
    onChange(steps.filter((_, idx) => idx !== index));
  };

  const duplicateStep = (index: number) => {
    const cloned = { ...steps[index] };
    const nextSteps = [...steps];
    nextSteps.splice(index + 1, 0, cloned);
    setCollapsedSteps((current) => new Set(Array.from(current, (stepIndex) => stepIndex > index ? stepIndex + 1 : stepIndex)));
    onChange(nextSteps);
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= steps.length) return;
    const nextSteps = [...steps];
    const [moved] = nextSteps.splice(index, 1);
    nextSteps.splice(nextIndex, 0, moved);
    setCollapsedSteps((current) => new Set(Array.from(current, (stepIndex) => {
      if (stepIndex === index) return nextIndex;
      if (index < nextIndex && stepIndex > index && stepIndex <= nextIndex) return stepIndex - 1;
      if (nextIndex < index && stepIndex >= nextIndex && stepIndex < index) return stepIndex + 1;
      return stepIndex;
    })));
    onChange(nextSteps);
  };

  const updateStep = (index: number, patch: Partial<Step>) =>
    onChange(steps.map((step, idx) => (idx === index ? { ...step, ...patch } : step)));

  const updateParameters = (index: number, parameters: Record<string, SqlParameterValue>) => {
    setParameterDrafts((current) => { const next = { ...current }; delete next[index]; return next; });
    updateStep(index, { parameters });
  };

  useEffect(() => {
    const issueIndex = stepIssues.findIndex((issue) => Boolean(issue?.message || issue?.selector || issue?.value || issue?.expected));
    const validationIndex = validationResults?.findIndex((result) => result.status === 'not_found' || result.status === 'action_failed');
    const invalidIndex = issueIndex >= 0 ? issueIndex : validationIndex != null && validationIndex >= 0 ? validationIndex : -1;
    if (invalidIndex < 0) return;
    setCollapsedSteps((current) => {
      if (!current.has(invalidIndex)) return current;
      const next = new Set(current);
      next.delete(invalidIndex);
      return next;
    });
    const timer = window.setTimeout(() => {
      const card = document.querySelector<HTMLElement>(`[data-step-index="${invalidIndex}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card?.querySelector<HTMLElement>('.ant-input-status-error input, .ant-select-status-error, [aria-invalid="true"]')?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [stepIssues, validationResults]);

  const setAllCollapsed = (collapsed: boolean) => {
    setCollapsedSteps(collapsed ? new Set(steps.map((_, index) => index)) : new Set());
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
    <div className="wt-editor-step-list" style={{ display: 'grid', gap: 12 }}>
      {steps.length > 1 && <Space className="wt-editor-step-list__controls" wrap>
        <Button size="small" onClick={() => setAllCollapsed(true)}>{t('step.collapseAll')}</Button>
        <Button size="small" onClick={() => setAllCollapsed(false)}>{t('step.expandAll')}</Button>
      </Space>}
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
        const isCollapsed = collapsedSteps.has(index);
        const isInvalid = isHardInvalid || validation?.status === 'ambiguous';
        const stepSummary = step.action === 'httpRequest'
          ? [step.http?.method, step.http?.url ? safeHttpUrl(step.http.url) : t('http.urlRequired'), step.http?.assertions?.length ? t('http.assertionCount', { count: step.http.assertions.length }) : undefined, step.http?.capture?.length ? t('http.captureCount', { count: step.http.capture.length }) : undefined].filter(Boolean).join(' · ')
          : step.action === 'executeSql' || step.action === 'assertDatabaseResult'
            ? [step.sql?.trim().split(/\s+/)[0]?.toUpperCase() || t('connections.sqlQuery'), step.assertion ? t('connections.assertion') : undefined, step.saveResultAs ? t('connections.saveResultAs', { variable: step.saveResultAs }) : undefined].filter(Boolean).join(' · ')
            : step.action === 'generateData' || step.action === 'captureValue'
              ? step.saveAs ? `{{${step.saveAs}}}${step.secret || isSecretVariableName(step.saveAs) ? ` · ${t('testData.secret')}` : ''}` : t('step.notConfigured')
              : step.action === 'goto' && step.value
                ? safeHttpUrl(step.value)
                : [step.selector, step.value, step.expected].filter(Boolean)[0] ?? t('step.notConfigured');
        const rowStyle = {
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'wrap' as const,
          minWidth: 0
        };
        const isDatabaseStep = step.action === 'executeSql' || step.action === 'assertDatabaseResult';
        const isWriteSql = /^(insert|update|delete)\b/i.test(step.sql?.trim() ?? '');
        const isSelectSql = /^(?:--[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*select\b/i.test(step.sql?.trim() ?? '');
        const isGenerateDataStep = step.action === 'generateData';
        const isCaptureValueStep = step.action === 'captureValue';
        const isHttpRequestStep = step.action === 'httpRequest';
        const generatorOptions = step.generatorOptions ?? {};
        const priorGeneratedNames = steps.slice(0, index).filter((candidate) => candidate.action === 'generateData' && candidate.saveAs).map((candidate) => candidate.saveAs!);
        const priorCapturedNames = steps.slice(0, index).filter((candidate) =>
          (candidate.action === 'captureValue' && candidate.saveAs) ||
          (candidate.action === 'httpRequest' && candidate.http?.capture?.some((capture) => capture.saveAs)) ||
          ((candidate.action === 'executeSql' || candidate.action === 'assertDatabaseResult') && candidate.saveResultAs)
        ).map((candidate) => candidate.saveAs ?? candidate.saveResultAs!);
        const projectVariableNames = projectVariables.map(({ name }) => name);
        const priorHttpCapturedNames = steps.slice(0, index).flatMap((candidate) => candidate.action === 'httpRequest' ? (candidate.http?.capture ?? []).map((capture) => capture.saveAs) : []);
        const availableVariableNames = [...new Set([...projectVariableNames, ...variableNames, ...testDataVariableNames, ...priorGeneratedNames, ...priorCapturedNames, ...priorHttpCapturedNames])];
        const availableVariableDetails = [
          ...projectVariables.map((variable) => ({ name: variable.name, source: t('capture.variableSource.project'), type: variable.type, secret: variable.secret })),
          ...variableNames.map((name) => ({ name, source: t('capture.variableSource.environment'), type: 'string', secret: isSecretVariableName(name) })),
          ...testDataVariableNames.map((name) => ({ name, source: t('capture.variableSource.testData'), type: 'string', secret: isSecretVariableName(name) })),
          ...steps.slice(0, index).flatMap((candidate) => {
            if (candidate.action === 'generateData' && candidate.saveAs) return [{ name: candidate.saveAs, source: t('capture.variableSource.generated'), type: candidate.generator === 'number' ? 'number' : candidate.generator === 'boolean' ? 'boolean' : 'string', secret: Boolean(candidate.secret || candidate.generator === 'password' || isSecretVariableName(candidate.saveAs)) }];
            if (candidate.action === 'captureValue' && candidate.saveAs) return [{ name: candidate.saveAs, source: t('capture.variableSource.captured'), type: candidate.captureSource === 'count' ? 'number' : 'string', secret: Boolean(candidate.secret || isSecretVariableName(candidate.saveAs)) }];
            if ((candidate.action === 'executeSql' || candidate.action === 'assertDatabaseResult') && candidate.saveResultAs) return [{ name: candidate.saveResultAs, source: t('capture.variableSource.sql'), type: t('capture.type.runtime'), secret: Boolean(candidate.secret || isSecretVariableName(candidate.saveResultAs)) }];
            if (candidate.action === 'httpRequest') return (candidate.http?.capture ?? []).map((capture) => ({ name: capture.saveAs, source: t('http.capture'), type: t('capture.type.runtime'), secret: Boolean(capture.secret || isSecretVariableName(capture.saveAs)) }));
            return [];
          })
        ];
        const updateGeneratorOption = (name: string, value: string | number | boolean | undefined) => {
          const next = { ...generatorOptions };
          if (value === undefined) delete next[name];
          else next[name] = value;
          updateStep(index, { generatorOptions: next });
        };

        return (
          <Card
            key={`${index}-${step.action}`}
            className="wt-editor-step-card"
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
              <Space size={4} className="wt-editor-step-card__actions">
              <Button
                size="small"
                type="text"
                aria-expanded={!isCollapsed}
                aria-label={t(isCollapsed ? 'step.expand' : 'step.collapse')}
                icon={isCollapsed ? <DownOutlined /> : <UpOutlined />}
                onClick={(event) => {
                  event.stopPropagation();
                  setCollapsedSteps((current) => {
                    const next = new Set(current);
                    if (next.has(index)) next.delete(index); else next.add(index);
                    return next;
                  });
                }}
              />
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
              </Space>
            }
              title={
                <Space size={8} wrap className="wt-editor-step-card__title">
                  <HolderOutlined style={{ color: '#8c8c8c', cursor: 'grab' }} />
                <span style={{ color: opt.group === 'Assertions' ? '#722ed1' : '#1677ff' }}>
                  {opt.icon}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  <span>{t('step.numberedTitle', { number: index + 1 })}</span>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {stepLabel}
                  </Text>
                  <Text type="secondary" className="wt-editor-step-card__summary">{stepSummary}</Text>
                </div>
                {isInvalid && <Tag color="error">{t('step.validation.invalid')}</Tag>}
                {validation?.status === 'ambiguous' && <span style={{ color: '#ad8b00', fontSize: 12 }}>{t('step.selectorAmbiguous')}</span>}
                {validation?.status === 'not_found' && <span style={{ color: '#cf1322', fontSize: 12 }}>{t('step.selectorNotFound')}</span>}
                {validation?.status === 'action_failed' && <span style={{ color: '#cf1322', fontSize: 12 }}>{t('step.actionFailed')}</span>}
              </Space>
            }
          >
            {!isCollapsed && <div className="wt-step-editor-row" style={rowStyle}>
              <div style={{ flex: '0 0 260px', minWidth: 0 }}>
                <Select
                  value={step.action}
                  style={{ width: '100%' }}
                  disabled={readOnly}
                  onChange={(action) => updateStep(index, {
                    action,
                    ...(action === 'generateData' && step.action !== 'generateData' ? { generator: 'username', generatorOptions: { prefix: 'user_', length: 16, charset: 'lowercase-digits' }, saveAs: 'USERNAME', secret: false, replace: false } : {}),
                    ...(action === 'captureValue' && step.action !== 'captureValue' ? { captureSource: 'text', selector: '', saveAs: 'CAPTURED_VALUE', secret: false, replace: false } : {}),
                    ...(action === 'executeSql' || action === 'assertDatabaseResult'
                      ? { databaseConnectionId: step.databaseConnectionId ?? defaultDatabaseConnectionId }
                      : {}),
                    ...(action === 'httpRequest' && step.action !== 'httpRequest' ? { http: { method: 'GET', url: '', body: { type: 'none' }, auth: { type: 'none' }, headers: [], queryParams: [], assertions: [], capture: [], timeoutMs: 15000, followRedirects: true } } : {})
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
                  <Select.OptGroup label={t('http.group')}>
                    {ACTION_OPTIONS.filter((option) => option.group === 'API').map((option) => <Select.Option key={option.value} value={option.value}><Space size={8}>{option.icon}<span>{humanizeStepAction(option.value, t)}</span></Space></Select.Option>)}
                  </Select.OptGroup>
                </Select>
              </div>

              {isGenerateDataStep && <div style={{ flex: '1 1 100%', minWidth: 0, display: 'grid', gap: 12 }}>
                <Space wrap align="end">
                  <div style={{ minWidth: 190 }}>
                    <Text type="secondary">{t('testData.generator')}</Text>
                    <Select
                      style={{ width: '100%' }}
                      value={step.generator ?? 'username'}
                      disabled={readOnly}
                      options={['username', 'email', 'password', 'uuid', 'string', 'number', 'boolean', 'date', 'timestamp', 'pattern'].map((generator) => ({ value: generator, label: t(`testData.generator.${generator}`) }))}
                      onChange={(generator: NonNullable<Step['generator']>) => updateStep(index, {
                        generator,
                        generatorOptions: generator === 'username' ? { prefix: 'user_', length: 16, charset: 'lowercase-digits' }
                          : generator === 'email' ? { prefix: 'user_', domain: 'example.test', length: 12 }
                            : generator === 'password' ? { length: 16, uppercase: true, lowercase: true, digits: true, symbols: false }
                              : generator === 'string' ? { length: 16, charset: 'alphanumeric' }
                                : generator === 'number' ? { min: 0, max: 1_000_000, integer: true, precision: 2 }
                                  : generator === 'date' ? { start: '2020-01-01', end: '2030-12-31', format: 'isoDate' }
                                    : generator === 'timestamp' ? { format: 'unixMs' }
                                      : generator === 'pattern' ? { pattern: 'user_XXXX_####' } : {}
                      })}
                    />
                  </div>
                  <div style={{ minWidth: 190 }}>
                    <Text type="secondary">{t('testData.saveAs')}</Text>
                    <Input
                      value={step.saveAs ?? ''}
                      placeholder="USERNAME"
                      disabled={readOnly}
                      status={step.saveAs && !/^[A-Z][A-Z0-9_]{0,99}$/.test(step.saveAs) ? 'error' : undefined}
                      onChange={(event) => updateStep(index, { saveAs: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
                    />
                  </div>
                  <Checkbox checked={step.generator === 'password' || Boolean(step.secret) || isSecretVariableName(step.saveAs ?? '')} disabled={readOnly || step.generator === 'password' || isSecretVariableName(step.saveAs ?? '')} onChange={(event) => updateStep(index, { secret: event.target.checked })}>
                    {t('testData.secret')}
                  </Checkbox>
                </Space>

                {step.generator === 'username' && <Space wrap>
                  <Input aria-label={t('testData.prefix')} addonBefore={t('testData.prefix')} value={String(generatorOptions.prefix ?? 'user_')} disabled={readOnly} onChange={(event) => updateGeneratorOption('prefix', event.target.value)} />
                  <Input aria-label={t('testData.suffix')} addonBefore={t('testData.suffix')} value={String(generatorOptions.suffix ?? '')} disabled={readOnly} onChange={(event) => updateGeneratorOption('suffix', event.target.value)} />
                  <InputNumber aria-label={t('testData.length')} addonBefore={t('testData.length')} min={6} max={512} value={Number(generatorOptions.length ?? 16)} disabled={readOnly} onChange={(value) => updateGeneratorOption('length', value ?? 16)} />
                  <Select aria-label={t('testData.charset')} value={String(generatorOptions.charset ?? 'lowercase-digits')} disabled={readOnly} options={['lowercase-digits', 'alphanumeric', 'hex', 'custom'].map((value) => ({ value, label: t(`testData.charset.${value}`) }))} onChange={(value) => updateGeneratorOption('charset', value)} />
                  {generatorOptions.charset === 'custom' && <Input aria-label={t('testData.allowedCharacters')} value={String(generatorOptions.characters ?? '')} disabled={readOnly} onChange={(event) => updateGeneratorOption('characters', event.target.value)} />}
                </Space>}
                {step.generator === 'email' && <Space wrap>
                  <Input aria-label={t('testData.prefix')} addonBefore={t('testData.prefix')} value={String(generatorOptions.prefix ?? 'user_')} disabled={readOnly} onChange={(event) => updateGeneratorOption('prefix', event.target.value)} />
                  <Input aria-label={t('testData.domain')} addonBefore={t('testData.domain')} value={String(generatorOptions.domain ?? 'example.test')} disabled={readOnly} onChange={(event) => updateGeneratorOption('domain', event.target.value)} />
                  <InputNumber aria-label={t('testData.length')} addonBefore={t('testData.length')} min={6} max={512} value={Number(generatorOptions.length ?? 12)} disabled={readOnly} onChange={(value) => updateGeneratorOption('length', value ?? 12)} />
                </Space>}
                {step.generator === 'password' && <Space wrap>
                  <InputNumber aria-label={t('testData.length')} addonBefore={t('testData.length')} min={8} max={128} value={Number(generatorOptions.length ?? 16)} disabled={readOnly} onChange={(value) => updateGeneratorOption('length', value ?? 16)} />
                  {(['uppercase', 'lowercase', 'digits', 'symbols'] as const).map((group) => <Checkbox key={group} checked={typeof generatorOptions[group] === 'boolean' ? Boolean(generatorOptions[group]) : group !== 'symbols'} disabled={readOnly} onChange={(event) => updateGeneratorOption(group, event.target.checked)}>{t(`testData.passwordGroup.${group}`)}</Checkbox>)}
                  <Text type="secondary">{t('testData.passwordAlwaysSecret')}</Text>
                </Space>}
                {step.generator === 'string' && <Space wrap>
                  <InputNumber aria-label={t('testData.length')} addonBefore={t('testData.length')} min={1} max={512} value={Number(generatorOptions.length ?? 16)} disabled={readOnly} onChange={(value) => updateGeneratorOption('length', value ?? 16)} />
                  <Select aria-label={t('testData.charset')} value={String(generatorOptions.charset ?? 'alphanumeric')} disabled={readOnly} options={['alphanumeric', 'lowercase', 'uppercase', 'digits', 'hex', 'lowercase-digits', 'custom'].map((value) => ({ value, label: t(`testData.charset.${value}`) }))} onChange={(value) => updateGeneratorOption('charset', value)} />
                  {generatorOptions.charset === 'custom' && <Input aria-label={t('testData.allowedCharacters')} value={String(generatorOptions.characters ?? '')} disabled={readOnly} onChange={(event) => updateGeneratorOption('characters', event.target.value)} />}
                </Space>}
                {step.generator === 'number' && <Space wrap>
                  <InputNumber aria-label={t('testData.min')} addonBefore={t('testData.min')} value={Number(generatorOptions.min ?? 0)} disabled={readOnly} onChange={(value) => updateGeneratorOption('min', value ?? 0)} />
                  <InputNumber aria-label={t('testData.max')} addonBefore={t('testData.max')} value={Number(generatorOptions.max ?? 1_000_000)} disabled={readOnly} onChange={(value) => updateGeneratorOption('max', value ?? 1_000_000)} />
                  <Checkbox checked={generatorOptions.integer !== false} disabled={readOnly} onChange={(event) => updateGeneratorOption('integer', event.target.checked)}>{t('testData.integer')}</Checkbox>
                  {generatorOptions.integer === false && <InputNumber aria-label={t('testData.precision')} addonBefore={t('testData.precision')} min={0} max={8} value={Number(generatorOptions.precision ?? 2)} disabled={readOnly} onChange={(value) => updateGeneratorOption('precision', value ?? 2)} />}
                </Space>}
                {step.generator === 'date' && <Space wrap>
                  <Input type="date" aria-label={t('testData.startDate')} value={String(generatorOptions.start ?? '2020-01-01')} disabled={readOnly} onChange={(event) => updateGeneratorOption('start', event.target.value)} />
                  <Input type="date" aria-label={t('testData.endDate')} value={String(generatorOptions.end ?? '2030-12-31')} disabled={readOnly} onChange={(event) => updateGeneratorOption('end', event.target.value)} />
                  <Select aria-label={t('testData.format')} value={String(generatorOptions.format ?? 'isoDate')} disabled={readOnly} options={['isoDate', 'iso', 'us'].map((format) => ({ value: format, label: t(`testData.dateFormat.${format}`) }))} onChange={(value) => updateGeneratorOption('format', value)} />
                </Space>}
                {step.generator === 'timestamp' && <Select aria-label={t('testData.format')} style={{ maxWidth: 260 }} value={String(generatorOptions.format ?? 'unixMs')} disabled={readOnly} options={['unixMs', 'iso'].map((format) => ({ value: format, label: t(`testData.timestampFormat.${format}`) }))} onChange={(value) => updateGeneratorOption('format', value)} />}
                {step.generator === 'pattern' && <Input.TextArea aria-label={t('testData.pattern')} value={String(generatorOptions.pattern ?? 'user_XXXX_####')} autoSize={{ minRows: 1, maxRows: 3 }} disabled={readOnly} onChange={(event) => updateGeneratorOption('pattern', event.target.value)} />}

                <Space wrap align="center">
                  <Tag color="blue">{t(`testData.generator.${step.generator ?? 'username'}`)}</Tag>
                  <Text type="secondary">{t('testData.generatedEveryRun')}</Text>
                  {step.saveAs && <>
                    <Text type="secondary">{t('testData.availableAs', { variable: `{{${step.saveAs}}}` })}</Text>
                    <Button size="small" icon={<CopyOutlined />} disabled={readOnly} onClick={() => navigator.clipboard.writeText(`{{${step.saveAs}}}`).then(() => message.success(t('testData.copied'))).catch(() => message.error(t('testData.copyFailed')))}>{t('testData.copyVariable')}</Button>
                  </>}
                </Space>
                <Collapse size="small" items={[{
                  key: 'advanced',
                  label: t('testData.advancedSettings'),
                  children: <Checkbox checked={Boolean(step.replace)} disabled={readOnly} onChange={(event) => updateStep(index, { replace: event.target.checked })}>{t('testData.replaceRuntimeVariable')}</Checkbox>
                }]} />
                {fieldIssue?.message && <Text type="danger">{fieldIssue.message}</Text>}
              </div>}

              {isCaptureValueStep && <div style={{ flex: '1 1 100%', minWidth: 0, display: 'grid', gap: 12 }}>
                <Space wrap align="end">
                  <div style={{ minWidth: 190 }}>
                    <Text type="secondary">{t('capture.source')}</Text>
                    <Select
                      style={{ width: '100%' }}
                      value={step.captureSource ?? 'text'}
                      disabled={readOnly}
                      options={(['text', 'input', 'attribute', 'url', 'count'] as const).map((source) => ({ value: source, label: t(`capture.source.${source}`) }))}
                      onChange={(captureSource: NonNullable<Step['captureSource']>) => updateStep(index, { captureSource, ...(captureSource === 'url' ? { selector: undefined } : {}), ...(captureSource !== 'attribute' ? { attributeName: undefined } : {}) })}
                    />
                  </div>
                  {step.captureSource !== 'url' && <div style={{ minWidth: 260, flex: '1 1 320px' }}>
                    <Text type="secondary">{t('capture.selector')}</Text>
                    <VariableAutocompleteInput
                      value={step.selector ?? ''}
                      variableNames={availableVariableNames}
                      placeholder={t('step.selectorPlaceholder')}
                      disabled={readOnly}
                      onValueChange={(selector) => updateStep(index, { selector })}
                    />
                  </div>}
                  {step.captureSource === 'attribute' && <div style={{ minWidth: 180 }}>
                    <Text type="secondary">{t('capture.attribute')}</Text>
                    <Input value={step.attributeName ?? ''} placeholder={t('capture.attributePlaceholder')} disabled={readOnly} onChange={(event) => updateStep(index, { attributeName: event.target.value })} />
                  </div>}
                  <div style={{ minWidth: 190 }}>
                    <Text type="secondary">{t('testData.saveAs')}</Text>
                    <Input
                      value={step.saveAs ?? ''}
                      placeholder={t('capture.variablePlaceholder')}
                      disabled={readOnly}
                      status={step.saveAs && !/^[A-Z][A-Z0-9_]{0,99}$/.test(step.saveAs) ? 'error' : undefined}
                      onChange={(event) => updateStep(index, { saveAs: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
                    />
                  </div>
                  <Checkbox checked={Boolean(step.secret) || isSecretVariableName(step.saveAs ?? '')} disabled={readOnly || isSecretVariableName(step.saveAs ?? '')} onChange={(event) => updateStep(index, { secret: event.target.checked })}>{t('capture.secret')}</Checkbox>
                </Space>
                <Space wrap align="center">
                  <Tag color="blue">{t(`capture.source.${step.captureSource ?? 'text'}`)}</Tag>
                  {step.saveAs && <Text type="secondary">{t('testData.availableAs', { variable: `{{${step.saveAs}}}` })}</Text>}
                  {step.saveAs && <Button size="small" icon={<CopyOutlined />} disabled={readOnly} onClick={() => navigator.clipboard.writeText(`{{${step.saveAs}}}`).then(() => message.success(t('testData.copied'))).catch(() => message.error(t('testData.copyFailed')))}>{t('testData.copyVariable')}</Button>}
                </Space>
                <Collapse size="small" items={[{
                  key: 'advanced', label: t('testData.advancedSettings'),
                  children: <Checkbox checked={Boolean(step.replace)} disabled={readOnly} onChange={(event) => updateStep(index, { replace: event.target.checked })}>{t('testData.replaceRuntimeVariable')}</Checkbox>
                }]} />
                <Text type="secondary">{t('capture.artifactsNote')}</Text>
                {availableVariableDetails.length > 0 && <Space wrap size={[4, 4]}>
                  {availableVariableDetails.map((variable) => <Tooltip key={variable.name} title={t('capture.variableMetadata', { source: variable.source, type: variable.type, secret: variable.secret ? t('testData.yes') : t('testData.no'), available: t('capture.availableNow') })}>
                    <Tag>{`{{${variable.name}}}`}</Tag>
                  </Tooltip>)}
                </Space>}
                {fieldIssue?.message && <Text type="danger">{fieldIssue.message}</Text>}
                {fieldIssue?.selector && <Text type="danger">{fieldIssue.selector}</Text>}
              </div>}

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
                          variableNames={availableVariableNames}
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
                      value={!step.saveResultAs ? 'none' : ((step.saveResultType === 'rowCount' && isSelectSql) || (step.saveResultType === 'affectedRows' && isWriteSql) ? step.saveResultType : step.saveColumn !== undefined ? 'column' : 'first')}
                      disabled={readOnly}
                      style={{ minWidth: 190 }}
                      options={[
                        { value: 'none', label: t('connections.saveMode.none') },
                        { value: 'first', label: t('connections.saveMode.first') },
                        { value: 'column', label: t('connections.saveMode.column') },
                        ...(isSelectSql ? [{ value: 'rowCount', label: t('connections.saveMode.rowCount') }] : []),
                        ...(isWriteSql ? [{ value: 'affectedRows', label: t('connections.saveMode.affectedRows') }] : [])
                      ]}
                      onChange={(mode: 'none' | 'first' | 'column' | 'rowCount' | 'affectedRows') => updateStep(index, mode === 'none'
                        ? { saveResultAs: undefined, saveResultType: undefined, saveColumn: undefined, saveRowIndex: undefined }
                        : { saveResultAs: step.saveResultAs ?? 'RESULT', saveResultType: mode === 'first' || mode === 'column' ? 'column' : mode, saveColumn: mode === 'column' ? (step.saveColumn ?? '') : undefined, saveRowIndex: mode === 'first' || mode === 'column' ? (step.saveRowIndex ?? 0) : undefined })}
                    />
                    {step.saveResultAs && <Input
                      aria-label={t('connections.variableName')}
                      placeholder={t('connections.saveResultVariablePlaceholder')}
                      value={step.saveResultAs}
                      disabled={readOnly}
                      status={!/^[A-Z][A-Z0-9_]{0,99}$/.test(step.saveResultAs) ? 'error' : undefined}
                      onChange={(event) => updateStep(index, { saveResultAs: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
                    />}
                    {step.saveResultAs && (!step.saveResultType || step.saveResultType === 'column') && <InputNumber min={0} max={100} aria-label={t('connections.rowIndex')} placeholder={t('connections.rowIndex')} value={step.saveRowIndex ?? 0} disabled={readOnly} onChange={(saveRowIndex) => updateStep(index, { saveRowIndex: saveRowIndex ?? 0 })} />}
                    {step.saveResultAs && step.saveColumn !== undefined && <Input aria-label={t('connections.column')} placeholder={t('connections.column')} value={step.saveColumn} disabled={readOnly} onChange={(event) => updateStep(index, { saveColumn: event.target.value })} />}
                    {step.saveResultAs && <Checkbox checked={Boolean(step.secret) || isSecretVariableName(step.saveResultAs)} disabled={readOnly || isSecretVariableName(step.saveResultAs)} onChange={(event) => updateStep(index, { secret: event.target.checked })}>{t('capture.secret')}</Checkbox>}
                  </Space>
                </div>
                {fieldIssue?.message && <Text type="danger">{fieldIssue.message}</Text>}
              </div>}

              {isHttpRequestStep && <HttpRequestEditor step={step} variableNames={availableVariableNames} readOnly={readOnly} onChange={(http) => updateStep(index, { http })} />}

              {needsSelector && (
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                  <VariableAutocompleteInput
                    placeholder={t('step.selectorPlaceholder')}
                    value={step.selector ?? ''}
                    style={{ width: '100%' }}
                    disabled={readOnly}
                    status={fieldIssue?.selector ? 'error' : undefined}
                    suffix={variableHint(step.selector, t)}
                    variableNames={availableVariableNames}
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
                      variableNames={availableVariableNames}
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
                    variableNames={availableVariableNames}
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
            </div>}
          </Card>
        );
      })}
      <Button icon={<PlusOutlined />} onClick={addStep} type="dashed" block disabled={readOnly}>
        {t('editor.addStep')}
      </Button>
    </div>
  );
}
