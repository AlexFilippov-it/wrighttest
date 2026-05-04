import { useEffect, useState } from 'react';
import { Button, Card, Col, Form, Input, Layout, Modal, Radio, Row, Select, Space, Typography, message, notification } from 'antd';
import { DownloadOutlined, StopOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { createTest, getDevices, getEnvironments, getTest, startRecording, stopRecording, updateTest, validateTestSteps } from '../api/client';
import AppHeader from '../components/AppHeader';
import StepEditor from '../components/StepEditor';
import VariableAutocompleteInput from '../components/VariableAutocompleteInput';
import UserMenu from '../components/UserMenu';
import type { Environment, Step, StepValidationResult } from '../types';

const { Content } = Layout;
const { Title, Text } = Typography;
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000';
const NOVNC_URL = import.meta.env.VITE_NOVNC_URL ?? 'http://localhost:6080';
const ENABLE_NOVNC = import.meta.env.VITE_ENABLE_NOVNC !== 'false';

function collectVariableNames(environments: Environment[]) {
  return Array.from(
    new Set(environments.flatMap((environment) => Object.keys(environment.variables ?? {})))
  ).sort((a, b) => a.localeCompare(b));
}

export default function TestEditorPage() {
  const { projectId, testId } = useParams<{ projectId?: string; testId?: string }>();
  const [form] = Form.useForm();
  const [steps, setSteps] = useState<Step[]>([]);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [recordingProjectId, setRecordingProjectId] = useState<string | undefined>(projectId);
  const [recordEnvironments, setRecordEnvironments] = useState<Environment[]>([]);
  const [environmentVariableNames, setEnvironmentVariableNames] = useState<string[]>([]);
  const [selectedRecordingEnvironmentId, setSelectedRecordingEnvironmentId] = useState<string | undefined>(undefined);
  const [recordingUrlHasTemplate, setRecordingUrlHasTemplate] = useState(false);
  const [recordLoading, setRecordLoading] = useState(false);
  const [validationResults, setValidationResults] = useState<StepValidationResult[] | undefined>();
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportMode, setExportMode] = useState<'inline' | 'envvars' | 'raw'>('inline');
  const [exportEnvId, setExportEnvId] = useState<string | undefined>(undefined);
  const [deviceOptions, setDeviceOptions] = useState<{ label: string; value: string }[]>([]);
  const [validationTracePath, setValidationTracePath] = useState<string | undefined>(undefined);
  const navigate = useNavigate();
  const isEdit = Boolean(testId);

  useEffect(() => {
    if (!testId) {
      form.setFieldsValue({ name: '', url: '', device: undefined });
      setSteps([{ action: 'goto', value: '' }]);
      setRecordingProjectId(projectId);
      setValidationTracePath(undefined);
      return;
    }

    void getTest(testId).then((test) => {
      form.setFieldsValue({ name: test.name, url: test.url, device: test.device ?? undefined });
      setSteps(test.steps.length > 0 ? test.steps : [{ action: 'goto', value: '' }]);
      setRecordingProjectId(test.projectId);
      setValidationTracePath(undefined);
    });
  }, [form, testId]);

  useEffect(() => {
    if (!recordingProjectId) {
      setRecordEnvironments([]);
      setEnvironmentVariableNames([]);
      return;
    }

    let cancelled = false;

    void getEnvironments(recordingProjectId)
      .then((environments) => {
        if (cancelled) return;
        setRecordEnvironments(environments);
        setEnvironmentVariableNames(collectVariableNames(environments));
      })
      .catch(() => {
        if (cancelled) return;
        setRecordEnvironments([]);
        setEnvironmentVariableNames([]);
      });

    return () => {
      cancelled = true;
    };
  }, [recordingProjectId]);

  useEffect(() => {
    void getDevices()
      .then(setDeviceOptions)
      .catch(() => setDeviceOptions([]));
  }, []);

  const replaceOrAppendRecordedSteps = (recordedSteps: Step[]) => {
    setSteps((current) => {
      const isPlaceholder =
        current.length === 1 &&
        current[0]?.action === 'goto' &&
        !current[0]?.selector &&
        !current[0]?.value;

      return isPlaceholder ? recordedSteps : [...current, ...recordedSteps];
    });
    setValidationResults(undefined);
  };

  const handleStepsChange = (nextSteps: Step[]) => {
    setSteps(nextSteps);
    setValidationResults(undefined);
    setValidationTracePath(undefined);
  };

  const saveTest = async (values: { name: string; url: string }, stepsToSave: Step[]) => {
    setSaving(true);
    try {
      const payload = {
        ...values,
        device: form.getFieldValue('device') || undefined,
        steps: stepsToSave
      };

      if (isEdit) {
        await updateTest(testId!, payload);
        message.success('Test updated');
        navigate(-1);
      } else {
        const created = await createTest(projectId!, payload);
        message.success('Test created');
        navigate(`/projects/${created.projectId}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleStartRecording = async () => {
    const url = form.getFieldValue('url');
    const device = form.getFieldValue('device') || undefined;
    if (!url) {
      message.warning('Enter Start URL before recording');
      return;
    }

    const hasTemplate = url.includes('{{');

    try {
      if (recordingProjectId) {
        const environments =
          recordEnvironments.length > 0
            ? recordEnvironments
            : await getEnvironments(recordingProjectId);

        if (recordEnvironments.length === 0) {
          setRecordEnvironments(environments);
          setEnvironmentVariableNames(collectVariableNames(environments));
        }

        if (hasTemplate && environments.length === 0) {
          message.warning('Create an environment first before using {{VARIABLE}} in Start URL');
          return;
        }

        if (environments.length > 0) {
          setRecordEnvironments(environments);
          setRecordingUrlHasTemplate(hasTemplate);
          setSelectedRecordingEnvironmentId(
            hasTemplate ? environments[0]?.id : selectedRecordingEnvironmentId
          );
          setRecordModalOpen(true);
          return;
        }
      }

      const data = await startRecording(url, undefined, device);
      setSessionId(data.sessionId);
      setRecording(true);
      setRecordModalOpen(false);
      message.info('Browser opened. Interact with the page, then click Stop Recording.');
    } catch {
      message.error('Failed to start recording');
    }
  };

  const handleConfirmRecordingStart = async () => {
    const url = form.getFieldValue('url');
    const device = form.getFieldValue('device') || undefined;
    if (!url) return;

    setRecordLoading(true);
    try {
      const data = await startRecording(url, selectedRecordingEnvironmentId || undefined, device);
      setSessionId(data.sessionId);
      setRecording(true);
      setRecordModalOpen(false);
      message.info('Browser opened. Interact with the page, then click Stop Recording.');
    } catch (error) {
      const responseError = error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : null;
      message.error(typeof responseError === 'string' ? responseError : 'Failed to start recording');
    } finally {
      setRecordLoading(false);
    }
  };

  const handleStopRecording = async () => {
    if (!sessionId) return;

    try {
      const data = await stopRecording(sessionId);
      replaceOrAppendRecordedSteps(data.steps);
      setRecording(false);
      setSessionId(null);
      message.success(`Recorded ${data.steps.length} steps`);
    } catch {
      message.error('Failed to stop recording');
    }
  };

  const handleOpenExport = () => {
    setExportEnvId(recordEnvironments[0]?.id);
    setExportMode(recordEnvironments.length > 0 ? 'inline' : 'raw');
    setExportModalOpen(true);
  };

  const handleDownloadSpec = () => {
    const params = new URLSearchParams();
    if (exportMode === 'inline' && !exportEnvId) {
      message.warning('Select an environment for inline export');
      return;
    }

    if (exportMode === 'inline' && exportEnvId) {
      params.set('envId', exportEnvId);
    }
    if (exportMode === 'envvars') {
      params.set('useEnvVars', 'true');
    }

    const query = params.toString();
    const url = `${BACKEND_URL}/tests/${testId}/export${query ? `?${query}` : ''}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setExportModalOpen(false);
  };

  const handleValidateAndSave = async () => {
    const values = await form.validateFields();
    if (steps.length === 0) {
      await saveTest(values, steps);
      return;
    }

    setValidating(true);
    try {
      const report = await validateTestSteps(values.url, steps, values.device);
      setValidationResults(report.results);
      setValidationTracePath(report.tracePath);
      if (report.tracePath) {
        const traceUrl = `${BACKEND_URL}/trace-viewer/?trace=${encodeURIComponent(`${BACKEND_URL}/traces/${report.tracePath}`)}`;
        notification.info({
          message: 'Validation trace ready',
          description: (
            <a href={traceUrl} target="_blank" rel="noreferrer">
              Open validation trace
            </a>
          ),
          duration: 0
        });
      }

      const fixedSteps = steps.map((step, index) => {
        const result = report.results[index];
        if ((result?.status === 'ambiguous' || result?.status === 'not_found') && result.suggestion) {
          return { ...step, selector: result.suggestion };
        }
        return step;
      });

      const hasUnfixable = report.results.some(
        (result) =>
          (result.status === 'ambiguous' || result.status === 'not_found') && !result.suggestion
      );
      const fixedCount = report.results.filter(
        (result) =>
          (result.status === 'ambiguous' || result.status === 'not_found') && !!result.suggestion
      ).length;

      setSteps(fixedSteps);

      if (hasUnfixable) {
        message.warning('Some selectors need manual review');
        return;
      }

      if (!report.valid && fixedCount > 0) {
        message.success(`Auto-fixed ${fixedCount} selectors`);
      }

      await saveTest(values, fixedSteps);
    } catch (error) {
      const responseError =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { error?: string; message?: string } } }).response?.data
          : undefined;
      const validationMessage =
        responseError?.error ??
        responseError?.message ??
        'Validation failed';

      message.error(validationMessage);
    } finally {
      setValidating(false);
    }
  };

  const validationTraceUrl = validationTracePath
    ? `${BACKEND_URL}/trace-viewer/?trace=${encodeURIComponent(`${BACKEND_URL}/traces/${validationTracePath}`)}`
    : undefined;

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #ffffff 100%)' }}>
      <AppHeader actions={[<UserMenu key="menu" />]} />
      <Content style={{ padding: 32, maxWidth: 1100, width: '100%', margin: '0 auto' }}>
        <Row gutter={[24, 24]}>
          <Col span={24}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Text type="secondary">
                  <Link to="/projects">Projects</Link>
                  <Link to="/dashboard" style={{ marginLeft: 16 }}>Dashboard</Link>
                </Text>
                <Title level={2} style={{ margin: 0 }}>{isEdit ? 'Edit Test' : 'New Test'}</Title>
              </div>
            </Card>
          </Col>
          <Col span={24}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <Form form={form} layout="vertical">
                <Form.Item
                  name="name"
                  label="Test name"
                  rules={[{ required: true, message: 'Test name is required' }]}
                >
                  <Input placeholder="Check homepage title" size="large" />
                </Form.Item>
                <Form.Item
                  name="url"
                  label="Start URL"
                  rules={[
                    { required: true, message: 'Start URL is required' },
                    {
                      validator: async (_, value?: string) => {
                        if (!value) return;
                        if (value.includes('{{')) return;
                        try {
                          new URL(value);
                        } catch {
                          throw new Error('Enter a valid URL or use {{VARIABLE}} placeholders');
                        }
                      }
                    }
                  ]}
                >
                  <VariableAutocompleteInput
                    placeholder="{{BASE_URL}}/projects or https://example.com"
                    size="large"
                    variableNames={environmentVariableNames}
                  />
                </Form.Item>
                <Form.Item
                  name="device"
                  label="Device"
                  tooltip="Leave empty for desktop. Select a device to emulate mobile viewport, user agent and touch events."
                >
                  <Select
                    allowClear
                    placeholder="Desktop (default)"
                    options={[
                      {
                        label: 'Desktop',
                        options: deviceOptions.filter((device) => !device.value || device.label.startsWith('Desktop'))
                      },
                      {
                        label: 'iPhone / iPad',
                        options: deviceOptions.filter((device) => device.label.startsWith('iPhone') || device.label.startsWith('iPad'))
                      },
                      {
                        label: 'Android',
                        options: deviceOptions.filter((device) =>
                          device.label.startsWith('Pixel') || device.label.startsWith('Samsung') || device.label.startsWith('Galaxy')
                        )
                      }
                    ]}
                  />
                </Form.Item>
                <Form.Item label="Steps">
                  {recording && ENABLE_NOVNC && (
                    <div style={{ marginBottom: 16 }}>
                      <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                        Live browser session:
                      </Text>
                      <iframe
                        src={`${NOVNC_URL}/vnc.html?autoconnect=true&resize=scale&view_only=false`}
                        style={{ width: '100%', height: 500, border: '1px solid #d9d9d9', borderRadius: 8 }}
                        title="Live browser"
                      />
                    </div>
                  )}
                  <Space style={{ marginBottom: 12 }}>
                    {!recording ? (
                      <Button icon={<VideoCameraOutlined />} onClick={handleStartRecording}>
                        Start Recording
                      </Button>
                    ) : (
                      <Button icon={<StopOutlined />} onClick={handleStopRecording} danger>
                        Stop Recording
                      </Button>
                    )}
                    {recording && (
                      <span style={{ color: '#ff4d4f', fontSize: 13 }}>
                        ● Recording in progress...
                      </span>
                    )}
                  </Space>
                  <StepEditor
                    steps={steps}
                    onChange={handleStepsChange}
                    validationResults={validationResults}
                    variableNames={environmentVariableNames}
                  />
                </Form.Item>
                <Space wrap>
                  <Button type="primary" size="large" onClick={handleValidateAndSave} loading={saving || validating}>
                    Validate & Save
                  </Button>
                  {validationTraceUrl && (
                    <Button
                      size="large"
                      onClick={() => window.open(validationTraceUrl, '_blank', 'noopener,noreferrer')}
                    >
                      Open validation trace
                    </Button>
                  )}
                  <Button
                    size="large"
                    icon={<DownloadOutlined />}
                    onClick={handleOpenExport}
                  >
                    Export
                  </Button>
                  <Button size="large" onClick={() => navigate(-1)}>Cancel</Button>
                </Space>
              </Form>
            </Card>
          </Col>
        </Row>
      </Content>
      <Modal
        title="Select Environment for Recording"
        open={recordModalOpen}
        onOk={() => void handleConfirmRecordingStart()}
        onCancel={() => setRecordModalOpen(false)}
        confirmLoading={recordLoading}
      >
        <Radio.Group
          style={{ display: 'grid', gap: 12, width: '100%' }}
          value={selectedRecordingEnvironmentId ?? ''}
          onChange={(event) => setSelectedRecordingEnvironmentId(event.target.value || undefined)}
        >
          <Radio value="" disabled={recordingUrlHasTemplate}>
            No environment (use values as-is)
          </Radio>
          {recordEnvironments.map((environment) => (
            <Radio key={environment.id} value={environment.id}>
              {environment.name}
              <Text type="secondary" style={{ marginLeft: 8 }}>
                {Object.keys(environment.variables).length} variables
              </Text>
            </Radio>
          ))}
        </Radio.Group>
        {recordEnvironments.length > 0 && (
          <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
            When Start URL contains {'{{VARIABLE}}'}, choose the environment that defines it.
          </Text>
        )}
      </Modal>

      <Modal
        title="Export as Playwright spec"
        open={exportModalOpen}
        onCancel={() => setExportModalOpen(false)}
        footer={null}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            Choose how to handle environment variables ({'{{BASE_URL}}'} etc.)
          </Typography.Text>

          <Radio.Group value={exportMode} onChange={(event) => setExportMode(event.target.value)}>
            <Space direction="vertical">
              <Radio value="inline">
                Inline values - replace variables with actual values from environment
              </Radio>
              <Radio value="envvars">
                process.env - use Node.js environment variables
              </Radio>
              <Radio value="raw">
                Keep as-is - leave {'{{VARIABLE}}'} placeholders
              </Radio>
            </Space>
          </Radio.Group>

          {exportMode === 'inline' && recordEnvironments.length > 0 && (
            <Select
              placeholder="Select environment"
              style={{ width: '100%' }}
              options={recordEnvironments.map((environment) => ({ value: environment.id, label: environment.name }))}
              value={exportEnvId}
              onChange={(value) => setExportEnvId(value)}
            />
          )}

          <Button type="primary" icon={<DownloadOutlined />} block onClick={handleDownloadSpec}>
            Download .spec.ts
          </Button>
        </Space>
      </Modal>
    </Layout>
  );
}
