import {
  AimOutlined,
  CheckSquareOutlined,
  DeleteOutlined,
  EditOutlined,
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
  TagOutlined,
  UnorderedListOutlined
} from '@ant-design/icons';
import { Button, Card, Checkbox, Select, Space, Tooltip, Typography } from 'antd';
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
  variableNames?: string[];
}

const statusStyles: Record<StepValidationResult['status'], { backgroundColor?: string; border?: string }> = {
  ok: { backgroundColor: '#f6ffed', border: '1px solid #b7eb8f' },
  ambiguous: { backgroundColor: '#fffbe6', border: '1px solid #ffe58f' },
  not_found: { backgroundColor: '#fff2f0', border: '1px solid #ffccc7' },
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

export default function StepEditor({ steps, onChange, validationResults, variableNames = [] }: Props) {
  const addStep = () => onChange([...steps, { action: 'goto', value: '' }]);

  const removeStep = (index: number) => onChange(steps.filter((_, idx) => idx !== index));

  const updateStep = (index: number, patch: Partial<Step>) =>
    onChange(steps.map((step, idx) => (idx === index ? { ...step, ...patch } : step)));

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {steps.map((step, index) => {
        const opt = ACTION_OPTIONS.find((candidate) => candidate.value === step.action)!;
        const validation = validationResults?.[index];
        const cardStyle = validation ? statusStyles[validation.status] : {};
        const showExactToggle = ['assertText', 'assertTitle', 'assertURL'].includes(step.action);
        const needsSelector = opt.needsSelector;
        const needsValue = opt.needsValue;
        const needsExpected = opt.needsExpected;
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
              borderLeft: opt.group === 'Assertions' ? '3px solid #52c41a' : '3px solid #1677ff',
              ...cardStyle
            }}
            extra={<Button danger icon={<DeleteOutlined />} size="small" onClick={() => removeStep(index)} />}
            title={
              <Space size={8}>
                <span style={{ color: opt.group === 'Assertions' ? '#52c41a' : '#1677ff' }}>
                  {opt.icon}
                </span>
                <span>Step {index + 1}</span>
                {validation?.status === 'ambiguous' && <span style={{ color: '#ad8b00', fontSize: 12 }}>selector ambiguous</span>}
                {validation?.status === 'not_found' && <span style={{ color: '#cf1322', fontSize: 12 }}>selector not found</span>}
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
                    suffix={variableHint(step.selector)}
                    variableNames={variableNames}
                    onValueChange={(nextValue) => updateStep(index, { selector: nextValue })}
                  />
                </div>
              )}

              {needsValue && (
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                  <VariableAutocompleteInput
                    placeholder={step.action === 'goto' ? 'https://example.com' : 'Value'}
                    value={step.value ?? ''}
                    style={{ width: '100%' }}
                    suffix={variableHint(step.value)}
                    variableNames={variableNames}
                    onValueChange={(nextValue) => updateStep(index, { value: nextValue })}
                  />
                </div>
              )}

              {needsExpected && (
                <div style={{ flex: '1 1 320px', minWidth: 0, display: 'grid', gap: 4 }}>
                  <VariableAutocompleteInput
                    placeholder={getExpectedPlaceholder(step.action)}
                    value={step.expected ?? ''}
                    style={{ width: '100%', borderColor: '#52c41a' }}
                    suffix={variableHint(step.expected)}
                    variableNames={variableNames}
                    onValueChange={(nextValue) => updateStep(index, { expected: nextValue })}
                  />
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
