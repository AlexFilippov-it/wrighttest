import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Breadcrumb, Button, Card, Col, Form, Input, Layout, Modal, Radio, Row, Select, Space, Tag, Typography, message, notification } from 'antd';
import { DownloadOutlined, PlayCircleOutlined, StopOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { createTest, getDevices, getEnvironments, getProject, getTest, startRecording, stopRecording, updateTest, validateTestSteps, runTestWithEnvironment } from '../api/client';
import AppHeader from '../components/AppHeader';
import StepEditor from '../components/StepEditor';
import VariableAutocompleteInput from '../components/VariableAutocompleteInput';
import UserMenu from '../components/UserMenu';
import type { Environment, Step, StepValidationResult, Test } from '../types';

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

function extractVariableNames(value: string | null | undefined) {
  if (!value) return [] as string[];
  const names: string[] = [];
  const re = /\{\{(\w+)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    names.push(match[1]);
  }
  return names;
}

type StepIssue = {
  message: string;
  selector?: string;
  value?: string;
  expected?: string;
};

function buildStepIssue(fields: Omit<StepIssue, 'message'>): StepIssue | null {
  const message = fields.selector ?? fields.value ?? fields.expected;
  return message ? { message, ...fields } : null;
}

function validateRequiredStepFields(step: Step): StepIssue | null {
  switch (step.action) {
    case 'goto':
      if (!step.value?.trim()) {
        return { message: 'URL is required.', value: 'URL is required.' };
      }
      return null;
    case 'click':
    case 'waitForSelector':
    case 'assertVisible':
    case 'assertHidden':
    case 'assertChecked':
      if (!step.selector?.trim()) {
        return { message: 'Target is required.', selector: 'Target is required.' };
      }
      return null;
    case 'fill':
      return buildStepIssue({
        ...(step.selector?.trim() ? {} : { selector: 'Target is required.' }),
        ...(step.value?.trim() ? {} : { value: 'Value is required.' })
      });
    case 'press':
      return buildStepIssue({
        ...(step.selector?.trim() ? {} : { selector: 'Target is required.' }),
        ...(step.value?.trim() ? {} : { value: 'Key is required.' })
      });
    case 'selectOption':
      return buildStepIssue({
        ...(step.selector?.trim() ? {} : { selector: 'Target is required.' }),
        ...(step.value?.trim() ? {} : { value: 'Option value is required.' })
      });
    case 'assertText':
      return buildStepIssue({
        ...(step.selector?.trim() ? {} : { selector: 'Target is required.' }),
        ...(step.expected?.trim() ? {} : { expected: 'Expected text is required.' })
      });
    case 'assertValue':
      return buildStepIssue({
        ...(step.selector?.trim() ? {} : { selector: 'Target is required.' }),
        ...(step.expected?.trim() ? {} : { expected: 'Expected value is required.' })
      });
    case 'assertTitle':
      if (!step.expected?.trim()) {
        return { message: 'Expected title is required.', expected: 'Expected title is required.' };
      }
      return null;
    case 'assertURL':
      if (!step.expected?.trim()) {
        return { message: 'Expected URL/pattern is required.', expected: 'Expected URL/pattern is required.' };
      }
      return null;
    case 'assertCount':
      return buildStepIssue({
        ...(step.selector?.trim() ? {} : { selector: 'Target is required.' }),
        ...(step.expected?.trim() ? {} : { expected: 'Expected count is required.' })
      });
    default:
      return null;
  }
}

function validateStepRequirements(steps: Step[]) {
  const issues = steps.map((step) => validateRequiredStepFields(step) ?? undefined);
  const firstInvalidIndex = issues.findIndex(Boolean);
  return {
    issues,
    firstInvalidIndex: firstInvalidIndex >= 0 ? firstInvalidIndex : null
  };
}

function validateCurrentSteps(steps: Step[]) {
  const issues = steps.map((step) => validateRequiredStepFields(step) ?? undefined);
  const firstInvalidIndex = issues.findIndex(Boolean);
  return {
    issues,
    firstInvalidIndex: firstInvalidIndex >= 0 ? firstInvalidIndex : null
  };
}

function formatStepIssueSummary(step: Step, index: number, issue: StepIssue) {
  const label = `${index + 1}. ${step.action === 'goto' ? 'Navigate to URL' : step.action}`;
  const fieldMessage = issue.selector ?? issue.value ?? issue.expected ?? issue.message;
  return `${label}: ${fieldMessage}`;
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
  const [validationFeedback, setValidationFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportMode, setExportMode] = useState<'inline' | 'envvars' | 'raw'>('inline');
  const [exportEnvId, setExportEnvId] = useState<string | undefined>(undefined);
  const [deviceOptions, setDeviceOptions] = useState<{ label: string; value: string }[]>([]);
  const [validationTracePath, setValidationTracePath] = useState<string | undefined>(undefined);
  const [novncAvailable, setNovncAvailable] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [currentProjectId, setCurrentProjectId] = useState<string | undefined>(projectId);
  const [stepIssues, setStepIssues] = useState<Array<StepIssue | undefined>>([]);
  const [firstInvalidStepIndex, setFirstInvalidStepIndex] = useState<number | null>(null);
  const [initialSnapshotReady, setInitialSnapshotReady] = useState(false);
  const stepsRef = useRef<Step[]>([]);
  const initialSnapshotRef = useRef<string>('');
  const navigate = useNavigate();
  const [confirmModal, confirmModalContextHolder] = Modal.useModal();
  const isEdit = Boolean(testId);
  const checkName = Form.useWatch('name', form);
  const selectedUrl = Form.useWatch('url', form);
  const selectedDevice = Form.useWatch('device', form);

  useEffect(() => {
    initialSnapshotRef.current = '';
    setInitialSnapshotReady(false);

    if (projectId) {
      setCurrentProjectId(projectId);
      void getProject(projectId)
        .then((project) => setProjectName(project.name))
        .catch(() => setProjectName(''));
    }

    if (!testId) {
      form.setFieldsValue({ name: '', url: '', device: undefined });
      stepsRef.current = [{ action: 'goto', value: '' }];
      setSteps(stepsRef.current);
      setRecordingProjectId(projectId);
      setCurrentProjectId(projectId);
      setValidationTracePath(undefined);
      setValidationFeedback(null);
      setStepIssues([]);
      setFirstInvalidStepIndex(null);
      setInitialSnapshotReady(true);
      return;
    }

    void getTest(testId).then((test) => {
      form.setFieldsValue({ name: test.name, url: test.url, device: test.device ?? undefined });
      stepsRef.current = test.steps.length > 0 ? test.steps : [{ action: 'goto', value: '' }];
      setSteps(stepsRef.current);
      setRecordingProjectId(test.projectId);
      setCurrentProjectId(test.projectId);
      setValidationTracePath(undefined);
      setValidationFeedback(null);
      setStepIssues([]);
      setFirstInvalidStepIndex(null);
      setInitialSnapshotReady(true);
    });
  }, [form, projectId, testId]);

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

  useEffect(() => {
    if (!ENABLE_NOVNC || !recording) {
      setNovncAvailable(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    void fetch(`${NOVNC_URL}/vnc.html`, {
      method: 'GET',
      mode: 'no-cors',
      signal: controller.signal
    })
      .then(() => {
        if (!cancelled) setNovncAvailable(true);
      })
      .catch(() => {
        if (!cancelled) setNovncAvailable(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [recording]);

  const replaceOrAppendRecordedSteps = (recordedSteps: Step[]) => {
    setSteps((current) => {
      const isPlaceholder =
        current.length === 1 &&
        current[0]?.action === 'goto' &&
        !current[0]?.selector &&
        !current[0]?.value;

      const nextSteps = isPlaceholder ? recordedSteps : [...current, ...recordedSteps];
      stepsRef.current = nextSteps;
      return nextSteps;
    });
    setValidationResults(undefined);
    setValidationFeedback(null);
    setStepIssues([]);
    setFirstInvalidStepIndex(null);
  };

  const handleStepsChange = (nextSteps: Step[]) => {
    stepsRef.current = nextSteps;
    setSteps(nextSteps);
    setValidationResults(undefined);
    setValidationTracePath(undefined);
    setValidationFeedback(null);
    setStepIssues([]);
    setFirstInvalidStepIndex(null);
  };

  const persistTest = async (
    values: { name: string; url: string; device?: string | null },
    stepsToSave: Step[],
    manageLoading = true
  ): Promise<Test> => {
    if (manageLoading) {
      setSaving(true);
    }
    try {
      const payload = {
        ...values,
        device: form.getFieldValue('device') || undefined,
        steps: stepsToSave
      };

      if (isEdit) {
        return await updateTest(testId!, payload);
      }

      return await createTest(projectId!, payload);
    } finally {
      if (manageLoading) {
        setSaving(false);
      }
    }
  };

  useEffect(() => {
    if (firstInvalidStepIndex === null) return;

    const timer = window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(`[data-step-index="${firstInvalidStepIndex}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [firstInvalidStepIndex]);

  const saveTest = async (values: { name: string; url: string; device?: string | null }, stepsToSave: Step[]) => {
    const saved = await persistTest(values, stepsToSave);
    return saved;
  };

  const validateAndPrepareSteps = async (values: { name: string; url: string; device?: string | null }) => {
    const currentSteps = stepsRef.current;
    const localIssues = validateCurrentSteps(currentSteps);
    setValidationResults(undefined);
    setValidationTracePath(undefined);
    setStepIssues(localIssues.issues);
    setFirstInvalidStepIndex(localIssues.firstInvalidIndex);
    if (localIssues.firstInvalidIndex !== null) {
      const firstIssue = localIssues.issues[localIssues.firstInvalidIndex];
      const firstStep = currentSteps[localIssues.firstInvalidIndex];
      const summary = firstIssue && firstStep ? formatStepIssueSummary(firstStep, localIssues.firstInvalidIndex, firstIssue) : 'Some steps are missing required fields.';
      setValidationFeedback({
        type: 'error',
        text: summary
      });
      message.error(summary);
      return null;
    }

    setValidating(true);
    try {
      const report = await validateTestSteps(values.url, currentSteps, values.device);
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

      const fixedSteps = currentSteps.map((step, index) => {
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

      stepsRef.current = fixedSteps;
      setSteps(fixedSteps);

      if (hasUnfixable) {
        setValidationFeedback({
          type: 'error',
          text: 'Some selectors need manual review before saving this check.'
        });
        message.warning('Some selectors need manual review');
        return null;
      }

      if (!report.valid && fixedCount > 0) {
        message.success(`Auto-fixed ${fixedCount} selectors`);
      }

      return { values, fixedSteps };
    } catch (error) {
      const responseError =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { error?: string; message?: string } } }).response?.data
          : undefined;
      const validationMessage =
        responseError?.error ??
        responseError?.message ??
        'Validation failed';

      setValidationFeedback({
        type: 'error',
        text: validationMessage
      });
      message.error(validationMessage);
      return null;
    } finally {
      setValidating(false);
    }
  };

  const handleRunCheck = async () => {
    const values = {
      ...(await form.validateFields()),
      device: form.getFieldValue('device') || undefined
    };
    if (steps.length === 0) {
      message.warning('Add at least one step before running');
      return;
    }

    const prepared = await validateAndPrepareSteps(values);
    if (!prepared) return;

    setSaving(true);
    try {
      const saved = await persistTest(values, prepared.fixedSteps, false);
      const run = await runTestWithEnvironment(saved.id, selectedRecordingEnvironmentId);
      navigate(`/runs/${run.testRunId}`);
    } catch (error) {
      const responseError =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { error?: string; message?: string } } }).response?.data
          : undefined;
      const validationMessage =
        responseError?.error ??
        responseError?.message ??
        'Validation failed';

      setValidationFeedback({
        type: 'error',
        text: validationMessage
      });
      message.error(validationMessage);
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
    const values = {
      ...(await form.validateFields()),
      device: form.getFieldValue('device') || undefined
    };
    const currentSteps = stepsRef.current;
    if (currentSteps.length === 0) {
      const saved = await saveTest(values, currentSteps);
      const nextProjectId = saved.projectId ?? currentProjectId ?? projectId;
      setCurrentProjectId(nextProjectId);
      initialSnapshotRef.current = JSON.stringify({
        name: saved.name,
        url: saved.url,
        device: saved.device ?? null,
        steps: currentSteps
      });
      setValidationFeedback({
        type: 'success',
        text: isEdit ? 'Check updated successfully.' : 'Check created successfully.'
      });
      message.success(isEdit ? 'Check updated' : 'Check created');
      if (nextProjectId) {
        navigate(`/projects/${nextProjectId}`);
      } else {
        navigate('/projects');
      }
      return;
    }

    const prepared = await validateAndPrepareSteps(values);
    if (!prepared) return;

    stepsRef.current = prepared.fixedSteps;
    setSteps(prepared.fixedSteps);
    const saved = await saveTest(values, prepared.fixedSteps);
    const nextProjectId = saved.projectId ?? currentProjectId ?? projectId;
    setCurrentProjectId(nextProjectId);
    initialSnapshotRef.current = JSON.stringify({
      name: saved.name,
      url: saved.url,
      device: saved.device ?? null,
      steps: prepared.fixedSteps
    });
    setValidationFeedback({
      type: 'success',
      text: isEdit ? 'Check updated successfully.' : 'Check created successfully.'
    });
    message.success(isEdit ? 'Check updated' : 'Check created');
    if (nextProjectId) {
      navigate(`/projects/${nextProjectId}`);
    } else {
      navigate('/projects');
    }
  };

  const getDeviceLabel = () => {
    const value = selectedDevice;
    if (!value) return 'Desktop';
    return deviceOptions.find((device) => device.value === value)?.label ?? value;
  };

  const getEnvironmentLabel = () => {
    if (!selectedRecordingEnvironmentId) return 'No environment selected';
    return recordEnvironments.find((environment) => environment.id === selectedRecordingEnvironmentId)?.name ?? 'No environment selected';
  };

  const stepAssertionsCount = steps.filter((step) => step.action.startsWith('assert')).length;
  const stepSummary = `${steps.length} steps · ${stepAssertionsCount} assertion${stepAssertionsCount === 1 ? '' : 's'} · ${getDeviceLabel()} · ${getEnvironmentLabel()}`;

  const selectedVariables = Array.from(
    new Set([
      ...extractVariableNames(selectedUrl),
      ...steps.flatMap((step) => [
        ...extractVariableNames(step.selector),
        ...extractVariableNames(step.value),
        ...extractVariableNames(step.expected)
      ])
    ])
  );
  const variableWarning =
    !selectedRecordingEnvironmentId && selectedVariables.length > 0
      ? `This check uses ${selectedVariables.map((name) => `{{${name}}}`).join(', ')}, but no environment is selected.`
      : null;

  const currentSnapshot = useMemo(
    () =>
      JSON.stringify({
        name: checkName ?? '',
        url: selectedUrl ?? '',
        device: selectedDevice ?? null,
        steps
      }),
    [checkName, selectedUrl, selectedDevice, steps]
  );

  useEffect(() => {
    if (!initialSnapshotReady) return;
    if (initialSnapshotRef.current) return;
    initialSnapshotRef.current = currentSnapshot;
  }, [currentSnapshot, initialSnapshotReady]);

  const isDirty = initialSnapshotReady && currentSnapshot !== initialSnapshotRef.current;

  const confirmLeave = (onLeave: () => void) => {
    if (!isDirty) {
      onLeave();
      return;
    }

    confirmModal.confirm({
      title: 'Discard changes?',
      content: 'You have unsaved changes. Leave this page and lose your edits?',
      okText: 'Leave page',
      cancelText: 'Stay',
      onOk: onLeave
    });
  };

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  const validationTraceUrl = validationTracePath
    ? `${BACKEND_URL}/trace-viewer/?trace=${encodeURIComponent(`${BACKEND_URL}/traces/${validationTracePath}`)}`
    : undefined;
  const projectRouteId = currentProjectId ?? projectId;
  const projectLink = projectRouteId ? `/projects/${projectRouteId}` : '/projects';

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #ffffff 100%)' }}>
      {confirmModalContextHolder}
      <AppHeader actions={[<UserMenu key="menu" />]} />
      <Content style={{ padding: 32, paddingBottom: 260, maxWidth: 1180, width: '100%', margin: '0 auto' }}>
        <Row gutter={[24, 24]}>
          <Col span={24}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
                  <Breadcrumb
                    items={[
                      { title: <Link to="/projects" onClick={(event) => { if (isDirty) { event.preventDefault(); confirmLeave(() => navigate('/projects')); } }}>Projects</Link> },
                      { title: projectRouteId ? <Link to={projectLink} onClick={(event) => { if (isDirty) { event.preventDefault(); confirmLeave(() => navigate(projectLink)); } }}>{projectName || 'Project'}</Link> : <Text type="secondary">{projectName || 'Project'}</Text> },
                      { title: projectRouteId ? <Link to={projectLink} onClick={(event) => { if (isDirty) { event.preventDefault(); confirmLeave(() => navigate(projectLink)); } }}>Checks</Link> : <Text type="secondary">Checks</Text> },
                      { title: checkName || (isEdit ? 'New_Test' : 'New Check') }
                    ]}
                  />
                  <Title level={2} style={{ margin: 0 }}>
                    Edit Check
                  </Title>
                  <Text type="secondary" style={{ maxWidth: 760 }}>
                    Update the browser flow, target, device, and assertions for this check.
                  </Text>
                </div>

                <Space wrap align="center">
                  <Button icon={<PlayCircleOutlined />} onClick={() => void handleRunCheck()}>
                    Run check
                  </Button>
                  <Button icon={<VideoCameraOutlined />} onClick={handleStartRecording}>
                    Start recording
                  </Button>
                  <Button icon={<DownloadOutlined />} onClick={handleOpenExport}>
                    Export .spec.ts
                  </Button>
              <Button type="primary" loading={saving || validating} disabled={!isDirty || saving || validating} onClick={handleValidateAndSave}>
                Save changes
              </Button>
            </Space>
          </div>
        </Card>
          </Col>

          <Col span={24}>
            <Card title="Check settings" style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <Form form={form} layout="vertical">
                <Row gutter={[20, 12]}>
                  <Col xs={24} lg={12}>
                    <Form.Item
                      name="name"
                      label="Check name"
                      rules={[{ required: true, message: 'Check name is required' }]}
                    >
                      <Input placeholder="Check homepage title" size="large" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={12}>
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
                  </Col>
                  <Col span={24}>
                    <Form.Item
                      name="url"
                      label="Start URL"
                      help="Supports environment variables."
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
                  </Col>
                  <Col span={24}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                      <Text type="secondary">Environment</Text>
                      <Select
                        allowClear
                        value={selectedRecordingEnvironmentId}
                        onChange={(value) => setSelectedRecordingEnvironmentId(value)}
                        placeholder="No environment selected"
                        style={{ width: '100%' }}
                        options={recordEnvironments.map((environment) => ({
                          value: environment.id,
                          label: `${environment.name} • ${Object.keys(environment.variables).length} variables`
                        }))}
                      />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Variables from the selected environment can be used in Start URL and steps as {'{{BASE_URL}}'}, {'{{USERNAME}}'}, or {'{{PASSWORD}}'}.
                      </Text>
                    </div>
                  </Col>
                  {variableWarning && (
                    <Col span={24}>
                      <Alert
                        type="warning"
                        showIcon
                        message={variableWarning}
                        style={{ borderRadius: 12 }}
                      />
                    </Col>
                  )}
                </Row>
              </Form>
            </Card>
          </Col>

          <Col span={24}>
            <Card
              title={
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>Steps</span>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    Record, edit, and validate the browser flow.
                  </Text>
                </div>
              }
              extra={
                <Space wrap>
                  <Tag color="blue">{stepSummary}</Tag>
                  {!recording ? (
                    <Button icon={<VideoCameraOutlined />} onClick={handleStartRecording}>
                      Start recording
                    </Button>
                  ) : (
                    <Button icon={<StopOutlined />} onClick={handleStopRecording} danger>
                      Stop recording
                    </Button>
                  )}
                  <Button onClick={() => setSteps((current) => [...current, { action: 'goto', value: '' }])}>
                    Add step
                  </Button>
                  <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => void handleRunCheck()} disabled={saving || validating}>
                    Run check
                  </Button>
                </Space>
              }
              style={{
                borderRadius: 20,
                boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)',
                scrollMarginTop: 120,
                scrollMarginBottom: 120
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
                {validationFeedback && (
                  <Alert
                    type={validationFeedback.type}
                    showIcon
                    message={validationFeedback.text}
                    action={validationTraceUrl ? (
                      <Button type="link" onClick={() => window.open(validationTraceUrl, '_blank', 'noopener,noreferrer')}>
                        Open validation trace
                      </Button>
                    ) : undefined}
                  />
                )}

                {recording && ENABLE_NOVNC && novncAvailable && (
                  <div>
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
                {recording && ENABLE_NOVNC && !novncAvailable && (
                  <Text type="secondary">
                    Live browser preview is unavailable in the current setup. Start the Docker noVNC service to enable it.
                  </Text>
                )}

                <Space>
                  {recording && <span style={{ color: '#ff4d4f', fontSize: 13 }}>● Recording in progress...</span>}
                </Space>

                {steps.length > 0 ? (
                  <StepEditor
                    steps={steps}
                    onChange={handleStepsChange}
                    stepIssues={stepIssues}
                    validationResults={validationResults}
                    variableNames={environmentVariableNames}
                  />
                ) : (
                  <Card style={{ borderRadius: 16, background: '#fafafa' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                      <Title level={5} style={{ margin: 0 }}>No steps yet</Title>
                      <Text type="secondary">
                        Start recording a browser flow or add the first step manually.
                      </Text>
                      <Space wrap>
                        {!recording ? (
                          <Button icon={<VideoCameraOutlined />} onClick={handleStartRecording}>
                            Start recording
                          </Button>
                        ) : (
                          <Button icon={<StopOutlined />} onClick={handleStopRecording} danger>
                            Stop recording
                          </Button>
                        )}
                        <Button type="dashed" onClick={() => setSteps([{ action: 'goto', value: '' }])}>
                          Add step
                        </Button>
                      </Space>
                    </div>
                  </Card>
                )}
              </div>
            </Card>
          </Col>
        </Row>
      </Content>

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 8,
          marginTop: 12,
          borderTop: '1px solid #e5e7eb',
          background: 'rgba(255, 255, 255, 0.96)',
          backdropFilter: 'blur(14px)',
          boxShadow: '0 -10px 30px rgba(15, 23, 42, 0.08)'
        }}
      >
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '14px 32px' }}>
          <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space wrap>
              <Button onClick={() => confirmLeave(() => navigate(-1))}>Cancel</Button>
              <Button icon={<DownloadOutlined />} onClick={handleOpenExport}>
                Export .spec.ts
              </Button>
            </Space>
            <Space wrap>
              <Button onClick={handleValidateAndSave} loading={saving || validating} disabled={!isDirty || saving || validating}>
                Save changes
              </Button>
            </Space>
          </Space>
        </div>
      </div>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
          <Typography.Text type="secondary">
            Choose how to handle environment variables ({'{{BASE_URL}}'} etc.)
          </Typography.Text>

          <Radio.Group value={exportMode} onChange={(event) => setExportMode(event.target.value)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Radio value="inline">
                Inline values - replace variables with actual values from environment
              </Radio>
              <Radio value="envvars">
                process.env - use Node.js environment variables
              </Radio>
              <Radio value="raw">
                Keep as-is - leave {'{{VARIABLE}}'} placeholders
              </Radio>
            </div>
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
        </div>
      </Modal>
    </Layout>
  );
}
