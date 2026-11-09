import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Breadcrumb, Button, Card, Checkbox, Col, Dropdown, Form, Input, Layout, Modal, Radio, Row, Select, Space, Tag, Typography, message, notification } from 'antd';
import type { MenuProps } from 'antd';
import { DownOutlined, DownloadOutlined, PlayCircleOutlined, StopOutlined, VideoCameraOutlined, WarningOutlined } from '@ant-design/icons';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, createTest, getDatabaseConnections, getDevices, getEnvironments, getProject, getProjectVariables, getTest, startRecording, stopRecording, updateTest, validateTestSteps, runTestWithEnvironment, runAllEnabledTestCases, type ProjectVariable } from '../api/client';
import AppHeader from '../components/AppHeader';
import AppFooter from '../components/AppFooter';
import StepEditor from '../components/StepEditor';
import TestDataEditor from '../components/test-data/TestDataEditor';
import VariableAutocompleteInput from '../components/VariableAutocompleteInput';
import UserMenu from '../components/UserMenu';
import { useAuth } from '../context/AuthContext';
import type { DatabaseConnection, Environment, Step, StepValidationResult, Test } from '../types';
import {
  hasTestDataValidationErrors,
  getEnabledTestDataCaseOptions,
  shouldBlockRunForTestData,
  toApiTestData,
  toEditableTestData,
  validateEditableTestData,
  type EditableTestDataCase
} from '../utils/testData';
import {
  buildTemplateVariablesDiagnostics,
  getBlockingTemplateVariableErrorsForCase
} from '../utils/templateVariables';
import { normalizeDeviceForPayload } from '../utils/testPayload';
import { useAppShell } from '../shell/ShellContext';
import { BACKEND_URL, ENABLE_NOVNC, NOVNC_URL } from '../utils/runtimeConfig';

const { Content } = Layout;
const { Title, Text } = Typography;

function resolveNoVncWebsocketPath(baseUrl: string) {
  try {
    const resolved = new URL(baseUrl, window.location.origin);
    const basePath = resolved.pathname.replace(/\/$/, '');
    return `${basePath}/websockify`;
  } catch {
    return '/websockify';
  }
}

function collectVariableNames(environments: Environment[]) {
  return Array.from(
    new Set(environments.flatMap((environment) => Object.keys(environment.variables ?? {})))
  ).sort((a, b) => a.localeCompare(b));
}

function normalizeTestData(test?: Partial<Test> | null) {
  return Array.isArray(test?.testData) ? test.testData : [];
}

function getSaveErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'errorFields' in error) {
    return 'Fix the highlighted fields before saving.';
  }

  if (error && typeof error === 'object' && 'response' in error) {
    const responseData = (error as {
      response?: {
        data?: {
          error?: string | { fieldErrors?: Record<string, string[]> };
          message?: string;
        };
      };
    }).response?.data;

    if (typeof responseData?.error === 'string') return responseData.error;
    if (responseData?.error && typeof responseData.error === 'object') {
      const fieldError = Object.values(responseData.error.fieldErrors ?? {}).flat().find(Boolean);
      if (fieldError) return fieldError;
    }
    if (responseData?.message) return responseData.message;
  }

  return error instanceof Error ? error.message : 'Failed to save check.';
}

function selectedDataCaseStorageKey(testId: string) {
  return `wrighttest:selected-data-case:${testId}`;
}

function readSelectedDataCaseIndex(testId: string, testData: Test['testData']) {
  const raw = window.localStorage.getItem(selectedDataCaseStorageKey(testId));
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) return undefined;
  return testData[value]?.enabled ? value : undefined;
}

function writeSelectedDataCaseIndex(testId: string, value: number | undefined) {
  const key = selectedDataCaseStorageKey(testId);
  if (value === undefined) {
    window.localStorage.removeItem(key);
    return;
  }

  window.localStorage.setItem(key, String(value));
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

function validateRequiredStepFields(step: Step, t: (key: string) => string): StepIssue | null {
  if (step.action === 'executeSql' || step.action === 'assertDatabaseResult') {
    if (!step.databaseConnectionId) return { message: t('connections.validation.connectionRequired') };
    if (!step.sql?.trim()) return { message: t('connections.validation.queryRequired') };
    if (step.action === 'assertDatabaseResult' && !step.assertion) return { message: t('connections.validation.assertionRequired') };
    if (step.assertion) {
      if (['columnEquals', 'columnContains', 'columnNotNull'].includes(step.assertion.type) && !step.assertion.column?.trim()) {
        return { message: t('connections.validation.columnRequired') };
      }
      if (['rowCountEquals', 'rowCountGreaterThan', 'columnEquals', 'columnContains', 'affectedRowsEquals'].includes(step.assertion.type) && step.assertion.expected === undefined) {
        return { message: t('connections.validation.expectedRequired') };
      }
      if (['rowCountEquals', 'rowCountGreaterThan', 'affectedRowsEquals'].includes(step.assertion.type)) {
        const expectedCount = Number(step.assertion.expected);
        if (!/^(0|[1-9]\d*)$/.test(step.assertion.expected ?? '') || !Number.isSafeInteger(expectedCount) || expectedCount < 0) return { message: t('connections.validation.countMustBeNonNegativeInteger') };
      }
    }
    if (step.waitForResult && !step.assertion) return { message: t('connections.validation.waitNeedsAssertion') };
    if (step.saveResultAs && (!step.saveResultType || step.saveResultType === 'column') && step.saveColumn !== undefined && !step.saveColumn.trim()) return { message: t('connections.validation.saveColumnRequired') };
    return null;
  }

  switch (step.action) {
    case 'captureValue':
      if (!step.captureSource) return { message: t('capture.validation.sourceRequired') };
      if (!step.saveAs || !/^[A-Z][A-Z0-9_]{0,99}$/.test(step.saveAs)) return { message: t('testData.validation.variableName') };
      if (step.captureSource !== 'url' && !step.selector?.trim()) return { message: t('step.validation.targetRequired'), selector: t('step.validation.targetRequired') };
      if (step.captureSource === 'attribute' && !step.attributeName?.trim()) return { message: t('capture.validation.attributeRequired') };
      return null;
    case 'generateData':
      if (!step.generator) return { message: t('testData.validation.generatorRequired') };
      if (!step.saveAs || !/^[A-Z][A-Z0-9_]{0,99}$/.test(step.saveAs)) return { message: t('testData.validation.variableName') };
      return null;
    case 'goto':
      if (!step.value?.trim()) {
        return { message: t('step.validation.urlRequired'), value: t('step.validation.urlRequired') };
      }
      return null;
    case 'click':
    case 'waitForSelector':
    case 'assertVisible':
    case 'assertHidden':
    case 'assertChecked':
      if (!step.selector?.trim()) {
        return { message: t('step.validation.targetRequired'), selector: t('step.validation.targetRequired') };
      }
      return null;
    case 'fill':
      return buildStepIssue({
        ...(step.selector?.trim() ? {} : { selector: t('step.validation.targetRequired') }),
        ...(step.value !== undefined && step.value !== null ? {} : { value: t('step.validation.valueRequired') })
      });
    case 'press':
      return buildStepIssue({
        ...(step.selector?.trim() ? {} : { selector: t('step.validation.targetRequired') }),
        ...(step.value?.trim() ? {} : { value: t('step.validation.keyRequired') })
      });
    case 'keyboardPress':
      return buildStepIssue({
        ...(step.value?.trim() ? {} : { value: t('step.validation.keyRequired') })
      });
    case 'selectOption':
      return buildStepIssue({
        ...(step.selector?.trim() ? {} : { selector: t('step.validation.targetRequired') }),
        ...(step.value?.trim() ? {} : { value: t('step.validation.optionRequired') })
      });
    case 'assertText':
      return buildStepIssue({
        ...(step.selector?.trim() ? {} : { selector: t('step.validation.targetRequired') }),
        ...(step.expected?.trim() ? {} : { expected: t('step.validation.expectedTextRequired') })
      });
    case 'assertValue':
      return buildStepIssue({
        ...(step.selector?.trim() ? {} : { selector: t('step.validation.targetRequired') }),
        ...(step.expected?.trim() ? {} : { expected: t('step.validation.expectedValueRequired') })
      });
    case 'assertTitle':
      if (!step.expected?.trim()) {
        return { message: t('step.validation.expectedTitleRequired'), expected: t('step.validation.expectedTitleRequired') };
      }
      return null;
    case 'assertURL':
      if (!step.expected?.trim()) {
        return { message: t('step.validation.expectedUrlRequired'), expected: t('step.validation.expectedUrlRequired') };
      }
      return null;
    case 'assertCount':
      return buildStepIssue({
        ...(step.selector?.trim() ? {} : { selector: t('step.validation.targetRequired') }),
        ...(step.expected?.trim() ? {} : { expected: t('step.validation.expectedCountRequired') })
      });
    default:
      return null;
  }
}

function validateCurrentSteps(steps: Step[], t: (key: string) => string) {
  const issues = steps.map((step) => validateRequiredStepFields(step, t) ?? undefined);
  const firstInvalidIndex = issues.findIndex(Boolean);
  return {
    issues,
    firstInvalidIndex: firstInvalidIndex >= 0 ? firstInvalidIndex : null
  };
}

function formatStepIssueSummary(step: Step, index: number, issue: StepIssue, t: (key: string, options?: Record<string, unknown>) => string) {
  const fieldMessage = issue.selector ?? issue.value ?? issue.expected ?? issue.message;
  return t('step.validation.summary', {
    number: index + 1,
    action: t(`step.action.${step.action}`),
    message: fieldMessage
  });
}

export default function TestEditorPage() {
  const { t } = useTranslation();
  const { isSystemAdmin } = useAuth();
  const { projectId, testId } = useParams<{ projectId?: string; testId?: string }>();
  const { setProject: setShellProject } = useAppShell();
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
  const [projectVariables, setProjectVariables] = useState<ProjectVariable[]>([]);
  const [databaseConnections, setDatabaseConnections] = useState<DatabaseConnection[]>([]);
  const [selectedRecordingEnvironmentId, setSelectedRecordingEnvironmentId] = useState<string | undefined>(undefined);
  const [useProjectAuthentication, setUseProjectAuthentication] = useState(true);
  const [recordingUrlHasTemplate, setRecordingUrlHasTemplate] = useState(false);
  const [recordLoading, setRecordLoading] = useState(false);
  const [validationResults, setValidationResults] = useState<StepValidationResult[] | undefined>();
  const [validationFeedback, setValidationFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportKind, setExportKind] = useState<'spec' | 'project'>('spec');
  const [exportMode, setExportMode] = useState<'inline' | 'envvars' | 'raw'>('inline');
  const [exportEnvId, setExportEnvId] = useState<string | undefined>(undefined);
  const [deviceOptions, setDeviceOptions] = useState<{ label: string; value: string }[]>([]);
  const [validationTraceViewerUrl, setValidationTraceViewerUrl] = useState<string | undefined>(undefined);
  const [novncAvailable, setNovncAvailable] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [currentProjectId, setCurrentProjectId] = useState<string | undefined>(projectId);
  const [currentProjectRole, setCurrentProjectRole] = useState<'OWNER' | 'EDITOR' | 'VIEWER' | null>(null);
  const [stepIssues, setStepIssues] = useState<Array<StepIssue | undefined>>([]);
  const [firstInvalidStepIndex, setFirstInvalidStepIndex] = useState<number | null>(null);
  const [initialSnapshotReady, setInitialSnapshotReady] = useState(false);
  const [useTestData, setUseTestData] = useState(false);
  const [editableTestData, setEditableTestData] = useState<EditableTestDataCase[]>([]);
  const [selectedDataCaseIndex, setSelectedDataCaseIndex] = useState<number | undefined>(undefined);
  const stepsRef = useRef<Step[]>([]);
  const initialSnapshotRef = useRef<string>('');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [confirmModal, confirmModalContextHolder] = Modal.useModal();
  const isEdit = Boolean(testId);
  const isReadOnly = !isSystemAdmin && currentProjectRole !== 'OWNER' && currentProjectRole !== 'EDITOR';
  const checkName = Form.useWatch('name', form);
  const selectedUrl = Form.useWatch('url', form);
  const selectedDevice = Form.useWatch('device', form);
  const noVncBaseUrl = NOVNC_URL.replace(/\/$/, '');
  const noVncWebsocketPath = resolveNoVncWebsocketPath(NOVNC_URL);

  useEffect(() => {
    initialSnapshotRef.current = '';
    setInitialSnapshotReady(false);

    if (projectId) {
      setCurrentProjectId(projectId);
      void getProject(projectId)
        .then((project) => {
          setProjectName(project.name);
          setCurrentProjectRole(project.currentUserRole ?? null);
        })
        .catch(() => {
          setProjectName('');
          setCurrentProjectRole(null);
        });
    }

    if (!testId) {
      form.setFieldsValue({ name: '', url: '', device: undefined });
      stepsRef.current = [{ action: 'goto', value: '' }];
      setUseTestData(false);
      setEditableTestData([]);
      setSelectedDataCaseIndex(undefined);
      setSteps(stepsRef.current);
      setRecordingProjectId(projectId);
      setCurrentProjectId(projectId);
      setSelectedRecordingEnvironmentId(undefined);
      setUseProjectAuthentication(true);
      setValidationTraceViewerUrl(undefined);
      setValidationFeedback(null);
      setStepIssues([]);
      setFirstInvalidStepIndex(null);
      setInitialSnapshotReady(true);
      return;
    }

    void getTest(testId).then((test) => {
      form.setFieldsValue({ name: test.name, url: test.url, device: test.device ?? undefined });
      stepsRef.current = test.steps.length > 0 ? test.steps : [{ action: 'goto', value: '' }];
      const existingTestData = normalizeTestData(test);
      setUseTestData(existingTestData.length > 0);
      setEditableTestData(toEditableTestData(existingTestData));
      setSelectedDataCaseIndex(readSelectedDataCaseIndex(test.id, existingTestData));
      setSteps(stepsRef.current);
      setRecordingProjectId(test.projectId);
      setCurrentProjectId(test.projectId);
      setSelectedRecordingEnvironmentId(test.environmentId ?? undefined);
      setUseProjectAuthentication(test.useProjectAuthentication ?? true);
      void getProject(test.projectId)
        .then((project) => {
          setProjectName(project.name);
          setCurrentProjectRole(project.currentUserRole ?? null);
        })
        .catch(() => {
          setCurrentProjectRole(null);
        });
      setValidationTraceViewerUrl(undefined);
      setValidationFeedback(null);
      setStepIssues([]);
      setFirstInvalidStepIndex(null);
      setInitialSnapshotReady(true);
    });
  }, [form, projectId, testId]);

  useEffect(() => {
    if (!currentProjectId || !projectName) return;
    setShellProject({ id: currentProjectId, name: projectName, role: currentProjectRole ?? undefined });
    return () => {
      setShellProject((current) => (current?.id === currentProjectId ? null : current));
    };
  }, [currentProjectId, currentProjectRole, projectName, setShellProject]);

  useEffect(() => {
    if (!recordingProjectId) {
      setRecordEnvironments([]);
      setEnvironmentVariableNames([]);
      setProjectVariables([]);
      setDatabaseConnections([]);
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

    void getProjectVariables(recordingProjectId)
      .then((variables) => { if (!cancelled) setProjectVariables(variables); })
      .catch(() => { if (!cancelled) setProjectVariables([]); });

    void getDatabaseConnections(recordingProjectId)
      .then((connections) => { if (!cancelled) setDatabaseConnections(connections); })
      .catch(() => { if (!cancelled) setDatabaseConnections([]); });

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

    void fetch(`${noVncBaseUrl}/vnc.html`, {
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
    setValidationTraceViewerUrl(undefined);
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
        device: normalizeDeviceForPayload(values.device),
        environmentId: selectedRecordingEnvironmentId ?? null,
        useProjectAuthentication,
        steps: stepsToSave,
        testData: currentApiTestData
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
    const localIssues = validateCurrentSteps(currentSteps, t);
    setValidationResults(undefined);
    setValidationTraceViewerUrl(undefined);
    setStepIssues(localIssues.issues);
    setFirstInvalidStepIndex(localIssues.firstInvalidIndex);
    if (localIssues.firstInvalidIndex !== null) {
      const firstIssue = localIssues.issues[localIssues.firstInvalidIndex];
      const firstStep = currentSteps[localIssues.firstInvalidIndex];
      const summary = firstIssue && firstStep
        ? formatStepIssueSummary(firstStep, localIssues.firstInvalidIndex, firstIssue, t)
        : t('step.validation.missingRequiredFields');
      setValidationFeedback({
        type: 'error',
        text: summary
      });
      message.error(summary);
      return null;
    }

    setValidating(true);
    try {
      const report = await validateTestSteps(
        currentProjectId ?? projectId ?? '',
        values.url,
        currentSteps,
        values.device,
        selectedRecordingEnvironmentId,
        useProjectAuthentication
      );
      setValidationResults(report.results);
      setValidationTraceViewerUrl(report.traceViewerUrl ? `${BACKEND_URL}${report.traceViewerUrl}` : undefined);
      if (report.traceViewerUrl) {
        const traceUrl = `${BACKEND_URL}${report.traceViewerUrl}`;
        notification.info({
          message: t('editor.validationTraceReady'),
          description: (
            <a href={traceUrl} target="_blank" rel="noreferrer">
              {t('editor.openValidationTrace')}
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
          result.status === 'action_failed' ||
          ((result.status === 'ambiguous' || result.status === 'not_found') && !result.suggestion)
      );
      const fixedCount = report.results.filter(
        (result) =>
          (result.status === 'ambiguous' || result.status === 'not_found') && !!result.suggestion
      ).length;

      stepsRef.current = fixedSteps;
      setSteps(fixedSteps);

      if (hasUnfixable) {
        const blockingResult = report.results.find(
          (result) => result.status === 'action_failed' || ((result.status === 'ambiguous' || result.status === 'not_found') && !result.suggestion)
        );
        setValidationFeedback({
          type: 'error',
          text: blockingResult?.error ?? 'Some selectors need manual review before saving this check.'
        });
        message.warning(blockingResult?.error ?? 'Some selectors need manual review');
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
    if (isReadOnly) {
      message.warning(t('common.readOnly'));
      return;
    }

    const values = {
      ...(await form.validateFields()),
      device: form.getFieldValue('device') || undefined
    };
    if (steps.length === 0) {
      message.warning(t('editor.addStepBeforeRun'));
      return;
    }
    if (hasTestDataErrors) {
      message.error(t('editor.fixTestDataBeforeRun'));
      return;
    }
    if (shouldBlockDataCaseRun) {
      message.error(dataCaseOptions.length === 0
        ? t('editor.enableCaseBeforeRun')
        : t('editor.selectCaseBeforeRun'));
      return;
    }
    const effectiveDataCaseIndex = dataCaseOptions.length === 1
      ? dataCaseOptions[0].value
      : selectedDataCaseIndex;
    const selectedCaseDiagnosticsErrors = getBlockingTemplateVariableErrorsForCase(templateDiagnostics, effectiveDataCaseIndex);
    if (selectedCaseDiagnosticsErrors.length > 0) {
      message.error(selectedCaseDiagnosticsErrors[0]);
      return;
    }

    const prepared = await validateAndPrepareSteps(values);
    if (!prepared) return;

    setSaving(true);
    try {
      const saved = await persistTest(values, prepared.fixedSteps, false);
      writeSelectedDataCaseIndex(saved.id, effectiveDataCaseIndex);
      const savedTestData = normalizeTestData(saved);
      const runDataCaseIndex = savedTestData.length > 0 ? effectiveDataCaseIndex : undefined;
      const run = await runTestWithEnvironment(saved.id, selectedRecordingEnvironmentId, runDataCaseIndex);
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

  const handleRunAllEnabledCases = async () => {
    if (isReadOnly) {
      message.warning(t('common.readOnly'));
      return;
    }

    const values = {
      ...(await form.validateFields()),
      device: form.getFieldValue('device') || undefined
    };
    if (steps.length === 0) {
      message.warning(t('editor.addStepBeforeRun'));
      return;
    }
    if (hasTestDataErrors) {
      message.error(t('editor.fixTestDataBeforeRun'));
      return;
    }
    if (templateDiagnostics.errors.length > 0) {
      message.error(templateDiagnostics.errors[0]);
      return;
    }
    if (dataCaseOptions.length <= 1) {
      message.warning(t('editor.twoEnabledCasesBeforeRun'));
      return;
    }

    const prepared = await validateAndPrepareSteps(values);
    if (!prepared) return;

    setSaving(true);
    try {
      const saved = await persistTest(values, prepared.fixedSteps, false);
      writeSelectedDataCaseIndex(saved.id, selectedDataCaseIndex);
      const result = await runAllEnabledTestCases(saved.id, selectedRecordingEnvironmentId);
      message.success(`${result.queued} test cases queued.`);
      navigate(`/run-batches/${result.batchId}`);
    } catch (error) {
      const responseError =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { error?: string; message?: string } } }).response?.data
          : undefined;
      const validationMessage =
        responseError?.error ??
        responseError?.message ??
        'Failed to queue test data cases';

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
    if (isReadOnly) {
      message.warning(t('common.readOnly'));
      return;
    }

    const url = form.getFieldValue('url');
    const device = form.getFieldValue('device') || undefined;
    if (!url) {
      message.warning(t('editor.enterStartUrlBeforeRecording'));
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
          message.warning(t('editor.environmentRequiredForTemplate'));
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

      const data = await startRecording(
        url,
        recordingProjectId || currentProjectId || projectId || '',
        undefined,
        device,
        useProjectAuthentication
      );
      setSessionId(data.sessionId);
      setRecording(true);
      setRecordModalOpen(false);
      message.info(t('editor.recordingStarted'));
    } catch {
      message.error(t('editor.recordingStartFailed'));
    }
  };

  const handleConfirmRecordingStart = async () => {
    if (isReadOnly) {
      message.warning(t('common.readOnly'));
      return;
    }

    const url = form.getFieldValue('url');
    const device = form.getFieldValue('device') || undefined;
    if (!url) return;

    setRecordLoading(true);
    try {
      const data = await startRecording(
        url,
        recordingProjectId || currentProjectId || projectId || '',
        selectedRecordingEnvironmentId || undefined,
        device,
        useProjectAuthentication
      );
      setSessionId(data.sessionId);
      setRecording(true);
      setRecordModalOpen(false);
      message.info(t('editor.recordingStarted'));
    } catch (error) {
      const responseError = error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
        : null;
      message.error(typeof responseError === 'string' ? responseError : t('editor.recordingStartFailed'));
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
      message.success(t('editor.recordedSteps', { count: data.steps.length }));
    } catch {
      message.error(t('editor.recordingStopFailed'));
    }
  };

  const handleOpenExport = (kind: 'spec' | 'project') => {
    if (isReadOnly) {
      message.warning(t('common.readOnly'));
      return;
    }
    setExportKind(kind);
    setExportEnvId(recordEnvironments[0]?.id);
    setExportMode(recordEnvironments.length > 0 ? 'inline' : 'raw');
    setExportModalOpen(true);
  };

  const handleDownloadExport = () => {
    if (isReadOnly) {
      message.warning(t('common.readOnly'));
      return;
    }

    const params = new URLSearchParams();
    if (exportMode === 'inline' && !exportEnvId) {
      message.warning(t('editor.selectEnvironmentForInlineExport'));
      return;
    }

    if (exportMode === 'inline' && exportEnvId) {
      params.set('envId', exportEnvId);
    }
    if (exportMode === 'envvars') {
      params.set('useEnvVars', 'true');
    }

    void (async () => {
      try {
        const exportParams = Object.fromEntries(params.entries());
        const response =
          exportKind === 'project'
            ? await api.post(`/tests/${testId}/export-project`, exportParams, {
                responseType: 'blob'
              })
            : await api.get(`/tests/${testId}/export`, {
                params: exportParams,
                responseType: 'blob'
              });
        const blob = new Blob([response.data], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${(checkName || 'check')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '') || 'check'}${exportKind === 'project' ? '-playwright-project.zip' : '.spec.ts'}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        message.success(exportKind === 'project' ? t('editor.projectExported') : t('project.checkExported'));
        setExportModalOpen(false);
      } catch {
        message.error(exportKind === 'project' ? t('editor.projectExportFailed') : t('project.checkExportFailed'));
      }
    })();
  };

  const handleValidateAndSave = async () => {
    if (isReadOnly) {
      message.warning(t('common.readOnly'));
      return;
    }

    try {
      const values = {
        ...(await form.validateFields()),
        device: form.getFieldValue('device') || undefined
      };
      if (hasTestDataErrors) {
        message.error(t('editor.fixTestDataBeforeSave'));
        return;
      }
      if (templateDiagnostics.errors.length > 0) {
        message.error(templateDiagnostics.errors[0]);
        return;
      }
      const currentSteps = stepsRef.current;
      if (currentSteps.length === 0) {
        const saved = await saveTest(values, currentSteps);
        form.setFieldsValue({ name: saved.name, url: saved.url, device: saved.device ?? undefined });
        const nextProjectId = saved.projectId ?? currentProjectId ?? projectId;
        setCurrentProjectId(nextProjectId);
        writeSelectedDataCaseIndex(saved.id, selectedDataCaseIndex);
        initialSnapshotRef.current = JSON.stringify({
          name: saved.name,
          url: saved.url,
          device: saved.device ?? null,
          environmentId: saved.environmentId ?? null,
          useProjectAuthentication: saved.useProjectAuthentication,
          testData: normalizeTestData(saved),
          selectedDataCaseIndex: selectedDataCaseIndex ?? null,
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
      form.setFieldsValue({ name: saved.name, url: saved.url, device: saved.device ?? undefined });
      const nextProjectId = saved.projectId ?? currentProjectId ?? projectId;
      setCurrentProjectId(nextProjectId);
      writeSelectedDataCaseIndex(saved.id, selectedDataCaseIndex);
      initialSnapshotRef.current = JSON.stringify({
        name: saved.name,
        url: saved.url,
        device: saved.device ?? null,
        environmentId: saved.environmentId ?? null,
        useProjectAuthentication: saved.useProjectAuthentication,
        testData: normalizeTestData(saved),
        selectedDataCaseIndex: selectedDataCaseIndex ?? null,
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
    } catch (error) {
      const saveError = getSaveErrorMessage(error);
      setValidationFeedback({ type: 'error', text: saveError });
      message.error(saveError);
    }
  };

  const getDeviceLabel = () => {
    const value = selectedDevice;
    if (!value) return 'Desktop 1280px';
    return deviceOptions.find((device) => device.value === value)?.label ?? value;
  };

  const getEnvironmentLabel = () => {
    if (!selectedRecordingEnvironmentId) return t('editor.noEnvironment');
    return recordEnvironments.find((environment) => environment.id === selectedRecordingEnvironmentId)?.name ?? t('editor.noEnvironment');
  };

  const stepAssertionsCount = steps.filter((step) => step.action.startsWith('assert') || (step.action === 'executeSql' && Boolean(step.assertion)) || (step.action === 'httpRequest' && Boolean(step.http?.assertions?.length))).length;
  const stepSummaryBadges = [
    <Tag key="steps" color="blue">
      {t('editor.stepsCount', { count: steps.length })}
    </Tag>,
    stepAssertionsCount === 0 ? (
      <Tag
        key="assertions-warning"
        icon={<WarningOutlined />}
        style={{
          marginInlineEnd: 0,
          background: '#fff7e6',
          color: '#d46b08',
          borderColor: '#ffd591'
        }}
      >
        {t('editor.noAssertions')}
      </Tag>
    ) : (
      <Tag key="assertions" color="purple">
        {t('editor.assertionsCount', { count: stepAssertionsCount })}
      </Tag>
    ),
    <Tag key="device" color="default">
      {getDeviceLabel()}
    </Tag>,
    <Tag key="environment" color="default">
      {getEnvironmentLabel()}
    </Tag>
  ];

  const currentApiTestData = useMemo(
    () => toApiTestData(editableTestData, useTestData),
    [editableTestData, useTestData]
  );
  const selectedEnvironment = useMemo(
    () => recordEnvironments.find((environment) => environment.id === selectedRecordingEnvironmentId) ?? null,
    [recordEnvironments, selectedRecordingEnvironmentId]
  );
  const templateDiagnostics = useMemo(
    () => buildTemplateVariablesDiagnostics({
      useTestData,
      url: selectedUrl,
      steps,
      testData: currentApiTestData,
      selectedEnvironment
    }),
    [useTestData, selectedUrl, steps, currentApiTestData, selectedEnvironment]
  );
  const currentSnapshot = useMemo(
    () =>
      JSON.stringify({
        name: checkName ?? '',
        url: selectedUrl ?? '',
        device: normalizeDeviceForPayload(selectedDevice),
        environmentId: selectedRecordingEnvironmentId ?? null,
        useProjectAuthentication,
        testData: currentApiTestData,
        selectedDataCaseIndex: selectedDataCaseIndex ?? null,
        steps
      }),
    [checkName, selectedUrl, selectedDevice, selectedRecordingEnvironmentId, useProjectAuthentication, currentApiTestData, selectedDataCaseIndex, steps]
  );

  const dataCaseOptions = useMemo(
    () => getEnabledTestDataCaseOptions(currentApiTestData),
    [currentApiTestData]
  );
  const testDataVariableNames = useMemo(() => {
    if (!useTestData || dataCaseOptions.length === 0) return [];
    const enabledCases = editableTestData.filter((testCase) => testCase.enabled);
    const firstCaseNames = new Set(enabledCases[0]?.variables.map((variable) => variable.key).filter(Boolean) ?? []);
    return [...firstCaseNames].filter((name) => enabledCases.every((testCase) => testCase.variables.some((variable) => variable.key === name)));
  }, [dataCaseOptions.length, editableTestData, useTestData]);
  const effectiveSelectedDataCaseIndex = dataCaseOptions.length === 1
    ? dataCaseOptions[0].value
    : selectedDataCaseIndex;
  const shouldBlockDataCaseRun = shouldBlockRunForTestData(currentApiTestData, effectiveSelectedDataCaseIndex);
  const selectedCaseTemplateErrors = useMemo(
    () => getBlockingTemplateVariableErrorsForCase(templateDiagnostics, effectiveSelectedDataCaseIndex),
    [templateDiagnostics, effectiveSelectedDataCaseIndex]
  );
  const shouldBlockSelectedCaseRun = shouldBlockDataCaseRun || selectedCaseTemplateErrors.length > 0;
  const shouldBlockRunAllCases = templateDiagnostics.errors.length > 0;
  const enabledCasesCount = dataCaseOptions.length;
  const testDataErrors = useMemo(
    () => validateEditableTestData(editableTestData, useTestData),
    [editableTestData, useTestData]
  );
  const hasTestDataErrors = hasTestDataValidationErrors(testDataErrors);

  useEffect(() => {
    if (selectedDataCaseIndex === undefined) return;
    const stillEnabled = dataCaseOptions.some((option) => option.value === selectedDataCaseIndex);
    if (!stillEnabled) {
      setSelectedDataCaseIndex(undefined);
    }
  }, [dataCaseOptions, selectedDataCaseIndex]);

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
      title: t('editor.discardChangesTitle'),
      content: t('editor.discardChangesDescription'),
      okText: t('editor.leavePage'),
      cancelText: t('editor.stayOnPage'),
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

  const validationTraceUrl = validationTraceViewerUrl;
  const projectRouteId = currentProjectId ?? projectId;
  const projectLink = projectRouteId ? `/projects/${projectRouteId}/checks` : '/projects';
  const exportMenu: MenuProps = {
    items: [
      { key: 'spec', label: t('editor.exportSpec') },
      { key: 'project', label: t('editor.exportProject') }
    ],
    onClick: ({ key }) => handleOpenExport(key === 'project' ? 'project' : 'spec')
  };
  const exportTrigger = (
    <Dropdown menu={exportMenu} trigger={['click']}>
      <Button icon={<DownloadOutlined />} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} disabled={isReadOnly}>
        <span>{t('editor.export')}</span>
        <DownOutlined />
      </Button>
    </Dropdown>
  );
  return (
    <Layout className="wt-test-editor-page" style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #ffffff 100%)' }}>
      {confirmModalContextHolder}
      <AppHeader actions={[<UserMenu key="menu" />]} />
      <Content className="wt-test-editor-page__content">
        <Row gutter={[24, 24]}>
          <Col span={24}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
                  <Breadcrumb
                    items={[
                      { title: <Link to="/projects" onClick={(event) => { if (isDirty) { event.preventDefault(); confirmLeave(() => navigate('/projects')); } }}>{t('nav.projects')}</Link> },
                      { title: projectRouteId ? <Link to={projectLink} onClick={(event) => { if (isDirty) { event.preventDefault(); confirmLeave(() => navigate(projectLink)); } }}>{projectName || t('common.project')}</Link> : <Text type="secondary">{projectName || t('common.project')}</Text> },
                      { title: projectRouteId ? <Link to={projectLink} onClick={(event) => { if (isDirty) { event.preventDefault(); confirmLeave(() => navigate(projectLink)); } }}>{t('project.checks')}</Link> : <Text type="secondary">{t('project.checks')}</Text> },
                      { title: checkName || t('editor.newCheck') }
                    ]}
                  />
                  <Title level={2} style={{ margin: 0 }}>
                    {isEdit ? t('editor.editCheck') : t('editor.newCheck')}
                  </Title>
                  <Text type="secondary" style={{ maxWidth: 760 }}>
                    {isEdit
                      ? t('editor.updateDescription')
                      : t('editor.createDescription')}
                  </Text>
                  {isReadOnly && (
                    <Alert
                      type="info"
                      showIcon
                      message={t('common.readOnly')}
                      description={t('editor.readOnlyDescription')}
                      style={{ marginTop: 8, width: 'fit-content' }}
                    />
                  )}
                </div>

                <Space wrap align="center">
                  <Button icon={<PlayCircleOutlined />} onClick={() => void handleRunCheck()} disabled={isReadOnly || hasTestDataErrors || shouldBlockSelectedCaseRun}>
                    {t('editor.runCheck')}
                  </Button>
                  {dataCaseOptions.length > 1 && (
                    <Button icon={<PlayCircleOutlined />} onClick={() => void handleRunAllEnabledCases()} disabled={isReadOnly || hasTestDataErrors || shouldBlockRunAllCases || saving || validating}>
                      {t('editor.runAllCases')}
                    </Button>
                  )}
                  {recording ? (
                    <Button icon={<StopOutlined />} onClick={handleStopRecording} danger disabled={isReadOnly}>
                      {t('editor.stopRecording')}
                    </Button>
                  ) : (
                    <Button icon={<VideoCameraOutlined />} onClick={handleStartRecording} disabled={isReadOnly}>
                      {t('editor.startRecording')}
                    </Button>
                  )}
                  {exportTrigger}
                  <Button type="primary" loading={saving || validating} disabled={isReadOnly || !isDirty || saving || validating || hasTestDataErrors || shouldBlockRunAllCases} onClick={handleValidateAndSave}>
                    {isEdit ? t('common.saveChanges') : t('editor.createCheck')}
                  </Button>
                </Space>
          </div>
        </Card>
          </Col>

          <Col span={24}>
            <Card title={t('editor.checkSettings')} style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <Form form={form} layout="vertical">
                <Row gutter={[20, 12]}>
                  <Col xs={24} lg={12}>
                    <Form.Item
                      name="name"
                      label={t('editor.checkName')}
                      rules={[{ required: true, message: t('editor.checkNameRequired') }]}
                    >
                      <Input placeholder={t('editor.checkNamePlaceholder')} size="large" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={12}>
                    <Form.Item
                      name="device"
                      label={t('editor.device')}
                      tooltip={t('editor.deviceHelp')}
                    >
                      <Select
                        allowClear
                        disabled={isReadOnly}
                        placeholder={t('editor.devicePlaceholder')}
                        options={[
                          {
                            label: t('editor.desktop'),
                            options: deviceOptions.filter((device) => device.value && device.label.startsWith('Desktop'))
                          },
                          {
                            label: t('editor.iphoneIpad'),
                            options: deviceOptions.filter((device) => device.label.startsWith('iPhone') || device.label.startsWith('iPad'))
                          },
                          {
                            label: t('editor.android'),
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
                      label={t('editor.startUrl')}
                      help={t('editor.environmentVariablesSupported')}
                      rules={[
                        { required: true, message: t('editor.startUrlRequired') },
                        {
                          validator: async (_, value?: string) => {
                            if (!value) return;
                            if (value.includes('{{')) return;
                            try {
                              new URL(value);
                            } catch {
                              throw new Error(t('editor.startUrlInvalid'));
                            }
                          }
                        }
                      ]}
                    >
                      <VariableAutocompleteInput
                        placeholder="{{BASE_URL}}/projects or https://example.com"
                        size="large"
                        variableNames={[...new Set([...projectVariables.map(({ name }) => name), ...environmentVariableNames])]}
                        disabled={isReadOnly}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={currentApiTestData.length > 0 ? 12 : 24}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                      <Text type="secondary">{t('project.environments')}</Text>
                      <Select
                        allowClear
                        value={selectedRecordingEnvironmentId}
                        disabled={isReadOnly}
                        onChange={(value) => setSelectedRecordingEnvironmentId(value)}
                        placeholder={t('editor.noEnvironment')}
                        style={{ width: '100%' }}
                        options={recordEnvironments.map((environment) => ({
                          value: environment.id,
                          label: `${environment.name} • ${Object.keys(environment.variables).length} variables`
                        }))}
                      />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {t('editor.environmentVariablesHelp')}
                      </Text>
                    </div>
                  </Col>
                  <Col span={24}>
                    <Space direction="vertical" size={4}>
                      <Checkbox
                        checked={useProjectAuthentication}
                        disabled={isReadOnly}
                        onChange={(event) => setUseProjectAuthentication(event.target.checked)}
                      >
                        {t('editor.reusableAuthentication')}
                      </Checkbox>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {t('editor.reusableAuthenticationHelp')}
                      </Text>
                    </Space>
                  </Col>
                  {currentApiTestData.length > 0 && (
                    <Col xs={24} lg={12}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                        <Text type="secondary">{t('editor.testDataCase')}</Text>
                        <Select
                          placeholder={dataCaseOptions.length > 0 ? t('editor.selectCase') : t('editor.noEnabledCases')}
                          value={effectiveSelectedDataCaseIndex}
                          options={dataCaseOptions}
                          onChange={(value) => setSelectedDataCaseIndex(value)}
                          disabled={isReadOnly || dataCaseOptions.length === 0}
                          style={{ width: '100%' }}
                        />
                        {dataCaseOptions.length === 0 ? (
                          <Text type="danger" style={{ fontSize: 12 }}>
                            {t('editor.enableCaseBeforeRun')}
                          </Text>
                        ) : (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {t('editor.selectedCaseVariablesHelp')}
                          </Text>
                        )}
                      </div>
                    </Col>
                  )}
                </Row>
              </Form>
            </Card>
          </Col>

          <Col span={24}>
            <TestDataEditor
              useTestData={useTestData}
              cases={editableTestData}
              errors={testDataErrors}
              diagnostics={useTestData ? templateDiagnostics : undefined}
              enabledCasesCount={enabledCasesCount}
              readOnly={isReadOnly}
              onUseTestDataChange={setUseTestData}
              onCasesChange={setEditableTestData}
            />
          </Col>

          <Col span={24}>
            <Card
              className="wt-editor-section-card wt-editor-steps-card"
              title={
                <div className="wt-editor-section-card__heading">
                  <span>{t('editor.steps')}</span>
                  <Text type="secondary" className="wt-editor-section-card__description">
                    {t('editor.stepsDescription')}
                  </Text>
                </div>
              }
              extra={
                <Space wrap>
                  <Space wrap size={[8, 8]}>
                    {stepSummaryBadges}
                  </Space>
                  <Button onClick={() => setSteps((current) => [...current, { action: 'goto', value: '' }])} disabled={isReadOnly}>
                    {t('editor.addStep')}
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
                        {t('editor.openValidationTrace')}
                      </Button>
                    ) : undefined}
                  />
                )}

                {recording && ENABLE_NOVNC && novncAvailable && (
                  <div>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                      {t('editor.liveBrowserSession')}
                    </Text>
                    <iframe
                      src={`${noVncBaseUrl}/vnc.html?autoconnect=true&resize=scale&view_only=false&path=${encodeURIComponent(noVncWebsocketPath)}`}
                      style={{ width: '100%', height: 500, border: '1px solid #d9d9d9', borderRadius: 8 }}
                      title={t('editor.liveBrowser')}
                    />
                  </div>
                )}
                {recording && ENABLE_NOVNC && !novncAvailable && (
                  <Text type="secondary">
                    {t('editor.liveBrowserUnavailable')}
                  </Text>
                )}

                <Space>
                  {recording && <span style={{ color: '#ff4d4f', fontSize: 13 }}>● {t('editor.recordingInProgress')}</span>}
                </Space>

                {steps.length > 0 ? (
                  <StepEditor
                    steps={steps}
                    onChange={handleStepsChange}
                    readOnly={isReadOnly}
                    stepIssues={stepIssues}
                    validationResults={validationResults}
                    variableNames={environmentVariableNames}
                    projectVariables={projectVariables}
                    testDataVariableNames={testDataVariableNames}
                    databaseConnections={databaseConnections}
                    projectId={currentProjectId}
                    defaultDatabaseConnectionId={!isEdit ? searchParams.get('databaseConnectionId') ?? undefined : undefined}
                  />
                ) : (
                  <Card style={{ borderRadius: 16, background: '#fafafa' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                      <Title level={5} style={{ margin: 0 }}>{t('editor.noSteps')}</Title>
                      <Text type="secondary">
                        {t('editor.noStepsDescription')}
                      </Text>
                      <Space wrap>
                        <Button type="dashed" onClick={() => setSteps([{ action: 'goto', value: '' }])} disabled={isReadOnly}>
                          {t('editor.addStep')}
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

      <AppFooter bottomPadding={24} />
      <Modal
        title={t('editor.selectEnvironmentForRecording')}
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
            {t('editor.noEnvironmentUseAsIs')}
          </Radio>
          {recordEnvironments.map((environment) => (
            <Radio key={environment.id} value={environment.id}>
              {environment.name}
              <Text type="secondary" style={{ marginLeft: 8 }}>
                {t('editor.variableCount', { count: Object.keys(environment.variables).length })}
              </Text>
            </Radio>
          ))}
        </Radio.Group>
        {recordEnvironments.length > 0 && (
          <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
            {t('editor.recordingEnvironmentHelp')}
          </Text>
        )}
      </Modal>

      <Modal
        title={exportKind === 'project' ? t('editor.exportProjectTitle') : t('editor.exportSpecTitle')}
        open={exportModalOpen}
        onCancel={() => setExportModalOpen(false)}
        footer={null}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
          <Typography.Text type="secondary">
            {exportKind === 'project'
              ? t('editor.exportProjectEnvironmentHelp')
              : t('editor.exportEnvironmentHelp')}
          </Typography.Text>

          <Radio.Group value={exportMode} onChange={(event) => setExportMode(event.target.value)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Radio value="inline">
                {t('editor.exportInlineValues')}
              </Radio>
              <Radio value="envvars">
                {t('editor.exportProcessEnv')}
              </Radio>
              <Radio value="raw">
                {t('editor.exportKeepPlaceholders')}
              </Radio>
            </div>
          </Radio.Group>

          {exportMode === 'inline' && recordEnvironments.length > 0 && (
            <Select
              placeholder={t('editor.selectEnvironment')}
              style={{ width: '100%' }}
              options={recordEnvironments.map((environment) => ({ value: environment.id, label: environment.name }))}
              value={exportEnvId}
              onChange={(value) => setExportEnvId(value)}
            />
          )}

          <Button type="primary" icon={<DownloadOutlined />} block onClick={handleDownloadExport}>
            {t('editor.downloadExport', { extension: exportKind === 'project' ? '.zip' : '.spec.ts' })}
          </Button>
        </div>
      </Modal>
    </Layout>
  );
}
