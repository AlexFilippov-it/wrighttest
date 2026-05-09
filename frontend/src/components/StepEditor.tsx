import {
  AimOutlined,
  CheckSquareOutlined,
  DeleteOutlined,
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
import { Button, Card, Checkbox, Dropdown, Input, Select, Space, Tooltip, Typography } from 'antd';
import type { ReactNode } from 'react';
import type { Step, StepAction, StepValidationResult } from '../types';
import VariableAutocompleteInput from './VariableAutocompleteInput';

const { Text } = Typography;

type ActionGroup = 'Actions' | 'Assertions';

type ActionOption = {
  value: StepAction;
  label: string;
  icon: ReactNode;
  group: ActionGroup;
  needsSelector: boolean;
  needsValue: boolean;
  needsExpected: boolean;
};

const ACTION_OPTIONS: ActionOption[] = [
  { value: 'goto', label: 'Navigate to URL', icon: <GlobalOutlined />, group: 'Actions', needsSelector: false, needsValue: true, needsExpected: false },
  { value: 'click', label: 'Click element', icon: <AimOutlined />, group: 'Actions', needsSelector: true, needsValue: false, needsExpected: false },
  { value: 'fill', label: 'Fill input', icon: <EditOutlined />, group: 'Actions', needsSelector: true, needsValue: true, needsExpected: false },
  { value: 'press', label: 'Press key', icon: <KeyOutlined />, group: 'Actions', needsSelector: true, needsValue: true, needsExpected: false },
  { value: 'selectOption', label: 'Select option', icon: <UnorderedListOutlined />, group: 'Actions', needsSelector: true, needsValue: true, needsExpected: false },
  { value: 'assertVisible', label: 'Assert visible', icon: <EyeOutlined />, group: 'Assertions', needsSelector: true, needsValue: false, needsExpected: false },
  { value: 'assertHidden', label: 'Assert hidden', icon: <EyeInvisibleOutlined />, group: 'Assertions', needsSelector: true, needsValue: false, needsExpected: false },
  { value: 'assertText', label: 'Assert text', icon: <FileTextOutlined />, group: 'Assertions', needsSelector: true, needsValue: false, needsExpected: true },
  { value: 'assertValue', label: 'Assert value', icon: <FieldNumberOutlined />, group: 'Assertions', needsSelector: true, needsValue: false, needsExpected: true },
  { value: 'assertURL', label: 'Assert URL', icon: <LinkOutlined />, group: 'Assertions', needsSelector: false, needsValue: false, needsExpected: true },
  { value: 'assertTitle', label: 'Assert title', icon: <TagOutlined />, group: 'Assertions', needsSelector: false, needsValue: false, needsExpected: true },
  { value: 'assertChecked', label: 'Assert checked', icon: <CheckSquareOutlined />, group: 'Assertions', needsSelector: true, needsValue: false, needsExpected: false },
  { value: 'assertCount', label: 'Assert count', icon: <OrderedListOutlined />, group: 'Assertions', needsSelector: true, needsValue: false, needsExpected: true },
  { value: 'waitForSelector', label: 'Wait for element', icon: <EyeOutlined />, group: 'Actions', needsSelector: true, needsValue: false, needsExpected: false }
];

interface Props {
  steps: Step[];
  onChange: (steps: Step[]) => void;
  validationResults?: StepValidationResult[];
  stepIssues?: Array<{
    message?: string;
    selector?: string;
    value?: string;
    expected?: string;
  } | undefined>;
  variableNames?: string[];
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

function getExpectedHint(action: StepAction, exact?: boolean) {
  if (action === 'assertURL') {
    return exact
      ? 'Exact match checks the full URL, including path and query string.'
      : 'Substring match is allowed. Use a stable fragment like /dashboard or /settings.';
  }

  if (action === 'assertTitle') {
    return exact
      ? 'Exact match checks the full page title.'
      : 'Substring match is allowed. Use the stable part of the title, for example Dashboard.';
  }

  if (action === 'assertText') {
    return exact
      ? 'Exact match compares the full visible text.'
      : 'Substring match is allowed. Use the unique fragment you expect to see.';
  }

  if (action === 'assertValue') {
    return 'Checks the current value of the input or control.';
  }

  if (action === 'assertCount') {
    return 'Enter the expected number of matching elements.';
  }

  return null;
}

function variableHint(value?: string) {
  if (!value || !value.includes('{{')) return null;

  return (
    <Tooltip title="Variable will be replaced at runtime">
      <InfoCircleOutlined style={{ color: '#1677ff' }} />
    </Tooltip>
  );
}

export default function StepEditor({ steps, onChange, validationResults, stepIssues = [], variableNames = [] }: Props) {
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
        const stepLabel = opt.label;
        const rowStyle = {
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'nowrap' as const,
          minWidth: 0
        };

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
                    { key: 'duplicate', icon: <CopyOutlined />, label: 'Duplicate step' },
                    { key: 'move-up', icon: <HolderOutlined />, label: 'Move up', disabled: index === 0 },
                    { key: 'move-down', icon: <HolderOutlined />, label: 'Move down', disabled: index === steps.length - 1 },
                    { type: 'divider' },
                    { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true }
                  ],
                  onClick: ({ key, domEvent }) => {
                    domEvent.stopPropagation();
                    if (key === 'duplicate') duplicateStep(index);
                    if (key === 'move-up') moveStep(index, -1);
                    if (key === 'move-down') moveStep(index, 1);
                    if (key === 'delete') removeStep(index);
                  }
                }}
              >
                <Button icon={<DownOutlined />} size="small">
                  More
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
                  <span>Step {index + 1}</span>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {stepLabel}
                  </Text>
                </div>
                {validation?.status === 'ambiguous' && <span style={{ color: '#ad8b00', fontSize: 12 }}>selector ambiguous</span>}
                {validation?.status === 'not_found' && <span style={{ color: '#cf1322', fontSize: 12 }}>selector not found</span>}
                {validation?.status === 'action_failed' && <span style={{ color: '#cf1322', fontSize: 12 }}>action failed</span>}
              </Space>
            }
          >
            <div style={rowStyle}>
              <div style={{ flex: '0 0 260px', minWidth: 0 }}>
                <Select
                  value={step.action}
                  style={{ width: '100%' }}
                  onChange={(action) => updateStep(index, { action })}
                >
                  <Select.OptGroup label="Actions">
                    {ACTION_OPTIONS.filter((option) => option.group === 'Actions').map((option) => (
                      <Select.Option key={option.value} value={option.value}>
                        <Space size={8}>
                          {option.icon}
                          <span>{option.label}</span>
                        </Space>
                      </Select.Option>
                    ))}
                  </Select.OptGroup>
                  <Select.OptGroup label="Assertions">
                    {ACTION_OPTIONS.filter((option) => option.group === 'Assertions').map((option) => (
                      <Select.Option key={option.value} value={option.value}>
                        <Space size={8}>
                          {option.icon}
                          <span>{option.label}</span>
                        </Space>
                      </Select.Option>
                    ))}
                  </Select.OptGroup>
                </Select>
              </div>

              {needsSelector && (
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                  <VariableAutocompleteInput
                    placeholder="CSS selector or Playwright locator"
                    value={step.selector ?? ''}
                    style={{ width: '100%' }}
                    status={fieldIssue?.selector ? 'error' : undefined}
                    suffix={variableHint(step.selector)}
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
                      placeholder="Value"
                      value={step.value ?? ''}
                      style={{ width: '100%' }}
                      status={fieldIssue?.value ? 'error' : undefined}
                      onChange={(event) => updateStep(index, { value: event.target.value })}
                      onInput={(event) => updateStep(index, { value: event.currentTarget.value })}
                    />
                  ) : (
                    <VariableAutocompleteInput
                      placeholder={step.action === 'goto' ? 'https://example.com' : 'Value'}
                      value={step.value ?? ''}
                      style={{ width: '100%' }}
                      status={fieldIssue?.value ? 'error' : undefined}
                      suffix={variableHint(step.value)}
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
                    status={fieldIssue?.expected ? 'error' : undefined}
                    suffix={variableHint(step.expected)}
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
                  {getExpectedHint(step.action, step.options?.exact) && (
                    <Text
                      type="secondary"
                      style={{
                        fontSize: 12,
                        lineHeight: 1.3,
                        minHeight: 32,
                        display: 'block'
                      }}
                    >
                      {getExpectedHint(step.action, step.options?.exact)}
                    </Text>
                  )}
                </div>
              )}

              {showExactToggle && (
                <div style={{ flex: '0 0 140px', minWidth: 0, display: 'flex', alignItems: 'flex-start' }}>
                  <Checkbox
                    checked={step.options?.exact ?? false}
                    onChange={(e) =>
                      updateStep(index, {
                        options: {
                          ...step.options,
                          exact: e.target.checked
                        }
                      })
                    }
                  >
                    Exact match
                  </Checkbox>
                </div>
              )}
            </div>
          </Card>
        );
      })}
      <Button icon={<PlusOutlined />} onClick={addStep} type="dashed" block>
        Add step
      </Button>
    </div>
  );
}
