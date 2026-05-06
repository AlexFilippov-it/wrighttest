import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Dropdown,
  Empty,
  Checkbox,
  Input,
  Layout,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tabs,
  Typography,
  Upload,
  message
} from 'antd';
import {
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  ExportOutlined,
  ClockCircleOutlined,
  MobileOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  WarningOutlined,
  UploadOutlined
} from '@ant-design/icons';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  createTest,
  createChannel,
  createEnvironment,
  createSchedule,
  deleteTest,
  deleteProject,
  deleteChannel,
  deleteEnvironment,
  deleteSchedule,
  getChannels,
  getEnvironments,
  getProject,
  getSchedules,
  getSuites,
  importTestSpec,
  runSuite,
  runTestWithEnvironment,
  testChannel,
  testChannelDraft,
  updateChannel,
  updateEnvironment,
  updateSchedule,
  updateProject
} from '../api/client';
import AppHeader from '../components/AppHeader';
import RunStatusBadge from '../components/RunStatusBadge';
import UserMenu from '../components/UserMenu';
import {
  clearProjectSettingsDraft,
  getProjectDefaultDeviceOptions,
  readProjectSettingsDraft,
  writeProjectSettingsDraft
} from '../utils/projectSettings';
import type {
  Environment,
  NotificationChannel,
  ProjectCheck,
  ProjectWorkspace,
  RunStatus,
  Schedule,
  Suite
} from '../types';

const { Content } = Layout;
const { Title, Text } = Typography;
const APP_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

type ProjectTabKey = 'overview' | 'checks' | 'runs' | 'schedules' | 'environments' | 'alerts' | 'settings';
type EntityMode = 'create' | 'edit';
type ScheduleTargetType = 'suite' | 'test';

type EnvironmentRowState = { id: string; key: string; value: string };

type ChannelFormState = {
  name: string;
  botToken: string;
  chatId: string;
  webhookUrl: string;
  onFailed: boolean;
  onRecovered: boolean;
  onPassed: boolean;
  enabled: boolean;
};

type ChannelRuleKey = 'onFailed' | 'onRecovered' | 'onPassed';

type ScheduleFormState = {
  name: string;
  cronPreset: string;
  customCron: string;
  targetType: ScheduleTargetType;
  suiteId?: string;
  testId?: string;
  environmentId?: string;
  enabled: boolean;
};

const CRON_PRESETS = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every day 9am', value: '0 9 * * *' },
  { label: 'Every day 2am', value: '0 2 * * *' },
  { label: 'Every Monday', value: '0 9 * * 1' },
  { label: 'Custom...', value: 'custom' }
];

const DEFAULT_DEVICE_OPTIONS = getProjectDefaultDeviceOptions();

function formatCreatedLabel(value: string) {
  return `Created ${new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })}`;
}

function formatShortTimestamp(value: string) {
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatRelativeTime(value: string | null) {
  if (!value) return 'Never';

  const diffMs = Date.now() - new Date(value).getTime();
  if (diffMs < 60_000) return 'just now';

  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

  return new Date(value).toLocaleDateString();
}

function formatDuration(ms?: number | null) {
  if (typeof ms !== 'number') return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDurationLabel(ms?: number | null) {
  if (typeof ms !== 'number') return '—';
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatCompactDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDateOnly(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function resolveInitialEnvironmentId(environments: Environment[]) {
  return environments.find((environment) => environment.name.toUpperCase() === 'DEV')?.id ?? environments[0]?.id ?? '';
}

function createEnvRow(key = '', value = ''): EnvironmentRowState {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    key,
    value
  };
}

function isSecretKey(key: string) {
  return /password|token|secret|api_key|key/i.test(key);
}

function isEmptyEnvRow(row: EnvironmentRowState) {
  return !row.key.trim() && !row.value.trim();
}

function envRowsFromRecord(variables: Record<string, string>): EnvironmentRowState[] {
  const entries = Object.entries(variables);
  return entries.length > 0 ? entries.map(([key, value]) => createEnvRow(key, value)) : [createEnvRow()];
}

function envRecordFromRows(rows: EnvironmentRowState[]) {
  return Object.fromEntries(
    rows
      .filter((row) => row.key.trim() && row.value.trim())
      .map((row) => [row.key.trim(), row.value.trim()])
  );
}

function validateEnvironmentRows(name: string, rows: EnvironmentRowState[]) {
  if (!name.trim()) return 'Environment name is required';

  const seen = new Set<string>();
  for (const row of rows) {
    if (isEmptyEnvRow(row)) continue;

    const key = row.key.trim();
    const value = row.value.trim();
    if (!key) return 'Variable name is required';
    if (!value) return 'Variable value is required';
    if (!/^[A-Z0-9_]+$/.test(key)) return 'Variable names should use uppercase letters, numbers, and underscores';
    if (seen.has(key)) return `Variable name "${key}" must be unique`;
    seen.add(key);
  }

  return null;
}

function extractVariableNames(value: string | null | undefined) {
  if (!value) return [];
  const names: string[] = [];
  const re = /\{\{(\w+)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    names.push(match[1]);
  }
  return names;
}

function collectCheckVariables(check: ProjectCheck) {
  const names = new Set<string>();
  extractVariableNames(check.url).forEach((name) => names.add(name));
  check.steps.forEach((step) => {
    extractVariableNames(step.selector).forEach((name) => names.add(name));
    extractVariableNames(step.value).forEach((name) => names.add(name));
    extractVariableNames(step.expected).forEach((name) => names.add(name));
  });
  return names;
}

function countEnvironmentUsage(environment: Environment, checks: ProjectCheck[]) {
  const keys = Object.keys(environment.variables);
  if (keys.length === 0) return 0;
  return checks.filter((check) => {
    const names = collectCheckVariables(check);
    return keys.some((key) => names.has(key));
  }).length;
}

function formatAlertRules(channel: NotificationChannel) {
  const rules: string[] = [];
  if (channel.onFailed) rules.push('Failed');
  if (channel.onRecovered) rules.push('Recovered');
  if (channel.onPassed) rules.push('Passed');
  if (rules.length === 0) rules.push('No rules');
  return rules;
}

function channelRuleDescriptions() {
  return [
    {
      key: 'onFailed' as ChannelRuleKey,
      label: 'Failed runs',
      helper: 'Send a notification when a check fails.'
    },
    {
      key: 'onRecovered' as ChannelRuleKey,
      label: 'Recovered runs',
      helper: 'Send a notification when a previously failing check passes again.'
    },
    {
      key: 'onPassed' as ChannelRuleKey,
      label: 'Passed runs',
      helper: 'Send a notification on every successful run.'
    }
  ];
}

function formatScheduleNextRun(schedule: Schedule) {
  if (!schedule.enabled) return { primary: 'Paused', secondary: '', overdue: false };
  if (!schedule.nextRunAt) return { primary: '—', secondary: '', overdue: false };

  const nextRunAt = new Date(schedule.nextRunAt).getTime();
  if (nextRunAt <= Date.now()) {
    return {
      primary: formatCompactDateTime(schedule.nextRunAt),
      secondary: '',
      overdue: true
    };
  }

  const diffMs = nextRunAt - Date.now();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const relative =
    diffMs < hour
      ? `in ${Math.round(diffMs / minute)} min`
      : diffMs < day
        ? `in ${Math.round(diffMs / hour)} hour${Math.round(diffMs / hour) === 1 ? '' : 's'}`
        : `in ${Math.round(diffMs / day)} day${Math.round(diffMs / day) === 1 ? '' : 's'}`;
  return {
    primary: relative,
    secondary: formatCompactDateTime(schedule.nextRunAt),
    overdue: false
  };
}

function formatScheduleNextRunRelative(schedule: Schedule) {
  if (!schedule.enabled || !schedule.nextRunAt) return '—';
  return formatCompactDateTime(schedule.nextRunAt);
}

function describeCron(cron: string) {
  const map: Record<string, string> = {
    '* * * * *': 'Runs every minute',
    '*/15 * * * *': 'Runs every 15 minutes',
    '0 * * * *': 'Runs every hour',
    '0 2 * * *': 'Runs every day at 02:00',
    '0 9 * * *': 'Runs every day at 09:00',
    '0 9 * * 1': 'Runs every Monday at 09:00'
  };

  if (map[cron]) return map[cron];

  const dailyMatch = cron.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (dailyMatch) {
    const hour = String(Number(dailyMatch[2])).padStart(2, '0');
    const minute = String(Number(dailyMatch[1])).padStart(2, '0');
    return `Runs every day at ${hour}:${minute}`;
  }

  return 'Custom cron schedule';
}

function usesVariables(value?: string | null) {
  return Boolean(value && /{{\s*[\w.-]+\s*}}/.test(value));
}

function testUsesVariables(test?: ProjectCheck | null) {
  if (!test) return false;
  if (usesVariables(test.url)) return true;
  return test.steps.some((step) => usesVariables(step.selector) || usesVariables(step.value) || usesVariables(step.expected));
}

function collectEffectiveSchedules(check: ProjectCheck, schedules: Schedule[] = []) {
  const effectiveSchedules = new Map<string, ProjectCheck['schedules'][number]>();

  for (const schedule of check.schedules) {
    effectiveSchedules.set(schedule.id, schedule);
  }

  for (const schedule of schedules) {
    if (!schedule.enabled) continue;
    const suiteMatches = Array.isArray(schedule.suite?.testIds) && schedule.suite.testIds.includes(check.id);
    const directMatch = schedule.testId === check.id;
    if (!suiteMatches && !directMatch) continue;

    effectiveSchedules.set(schedule.id, {
      id: schedule.id,
      name: schedule.name,
      cron: schedule.cron,
      enabled: schedule.enabled
    });
  }

  return Array.from(effectiveSchedules.values()).filter((schedule) => schedule.enabled);
}

function formatScheduleSummary(check: ProjectCheck, schedules: Schedule[] = []) {
  const activeSchedules = collectEffectiveSchedules(check, schedules);
  if (activeSchedules.length === 0) return 'Not scheduled';
  if (activeSchedules.length > 1) return `${activeSchedules.length} active`;
  return humanizeCron(activeSchedules[0]?.cron ?? 'Not scheduled');
}

function renderCheckCell(check: ProjectCheck, navigateToCheck: (id: string) => void) {
  const metadata: string[] = [check.url, `${check.steps.length} steps`, `${check.runCount} runs`].filter(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <Button
        type="link"
        style={{ padding: 0, textAlign: 'left', fontWeight: 600, height: 'auto', whiteSpace: 'normal' }}
        onClick={() => navigateToCheck(check.id)}
      >
        {check.name}
      </Button>
      <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.4, whiteSpace: 'normal' }}>
        {metadata.join(' · ')}
      </Text>
    </div>
  );
}

const RECENT_RESULTS_GRID_COLUMNS = 'minmax(220px, 1.4fr) 160px minmax(180px, 1fr) 120px';

function renderRecentResultCell(check: ProjectCheck, onOpenCheck: (id: string) => void) {
  return (
    <div style={{ minWidth: 0, textAlign: 'left' }}>
      <Button
        type="link"
        style={{
          display: 'block',
          width: '100%',
          padding: 0,
          textAlign: 'left',
          fontWeight: 600,
          height: 'auto',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
        onClick={() => onOpenCheck(check.id)}
      >
        {check.name}
      </Button>
      <Text
        type="secondary"
        style={{
          display: 'block',
          fontSize: 12,
          lineHeight: 1.4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {check.url}
      </Text>
    </div>
  );
}

function humanizeCron(cron: string) {
  const presets: Record<string, string> = {
    '* * * * *': 'Every minute',
    '*/15 * * * *': 'Every 15 min',
    '0 * * * *': 'Hourly',
    '0 2 * * *': 'Daily 2am',
    '0 9 * * *': 'Daily 9am',
    '0 9 * * 1': 'Every Monday'
  };

  return presets[cron] ?? cron;
}

function resolveTabFromPathname(pathname: string): ProjectTabKey {
  if (pathname.endsWith('/overview')) return 'overview';
  if (pathname.endsWith('/runs')) return 'runs';
  if (pathname.endsWith('/schedules')) return 'schedules';
  if (pathname.endsWith('/environments')) return 'environments';
  if (pathname.endsWith('/alerts') || pathname.endsWith('/notifications')) return 'alerts';
  if (pathname.endsWith('/settings')) return 'settings';
  return 'checks';
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [confirmModal, confirmModalContextHolder] = Modal.useModal();

  const [project, setProject] = useState<ProjectWorkspace | null>(null);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProjectTabKey>(() => resolveTabFromPathname(location.pathname));
  const [importing, setImporting] = useState(false);
  const [runCheckModalOpen, setRunCheckModalOpen] = useState(false);
  const [runCheckId, setRunCheckId] = useState<string | null>(null);
  const [runSuiteModalOpen, setRunSuiteModalOpen] = useState(false);
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | undefined>(undefined);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | undefined>(undefined);
  const [checkRunLoading, setCheckRunLoading] = useState(false);
  const [runningSuite, setRunningSuite] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [savingProject, setSavingProject] = useState(false);
  const [environmentModalOpen, setEnvironmentModalOpen] = useState(false);
  const [environmentMode, setEnvironmentMode] = useState<EntityMode>('create');
  const [editingEnvironment, setEditingEnvironment] = useState<Environment | null>(null);
  const [environmentName, setEnvironmentName] = useState('');
  const [environmentRows, setEnvironmentRows] = useState<EnvironmentRowState[]>([createEnvRow()]);
  const [environmentSaving, setEnvironmentSaving] = useState(false);
  const [channelModalOpen, setChannelModalOpen] = useState(false);
  const [channelMode, setChannelMode] = useState<EntityMode>('create');
  const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null);
  const [channelType, setChannelType] = useState<'telegram' | 'slack'>('telegram');
  const [channelForm, setChannelForm] = useState<ChannelFormState>({
    name: '',
    botToken: '',
    chatId: '',
    webhookUrl: '',
    onFailed: true,
    onRecovered: true,
    onPassed: false,
    enabled: true
  });
  const [channelSaving, setChannelSaving] = useState(false);
  const [channelTesting, setChannelTesting] = useState(false);
  const [channelTestFeedback, setChannelTestFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<EntityMode>('create');
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>({
    name: '',
    cronPreset: '0 2 * * *',
    customCron: '0 2 * * *',
    targetType: 'suite',
    suiteId: undefined,
    testId: undefined,
    environmentId: undefined,
    enabled: true
  });
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [projectDescription, setProjectDescription] = useState('');
  const [savedProjectDescription, setSavedProjectDescription] = useState('');
  const [projectDefaultEnvironmentId, setProjectDefaultEnvironmentId] = useState<string | undefined>(undefined);
  const [projectDefaultDevice, setProjectDefaultDevice] = useState<string>(DEFAULT_DEVICE_OPTIONS[0]);
  const [projectNameError, setProjectNameError] = useState<string | null>(null);
  const [projectDescriptionError, setProjectDescriptionError] = useState<string | null>(null);
  const [deleteProjectModalOpen, setDeleteProjectModalOpen] = useState(false);
  const [deleteProjectConfirmText, setDeleteProjectConfirmText] = useState('');
  const [deletingProject, setDeletingProject] = useState(false);
  const settingsHydratedRef = useRef(false);

  const summary = project?.summary;
  const hasChecks = (project?.tests.length ?? 0) > 0;

  const load = async () => {
    setLoading(true);
    try {
      const [projectData, suiteData, environmentData, scheduleData, channelData] = await Promise.all([
        getProject(projectId!),
        getSuites(projectId!),
        getEnvironments(projectId!),
        getSchedules(projectId!),
        getChannels(projectId!)
      ]);
      setProject(projectData);
      setProjectName(projectData.name);
      setSuites(suiteData);
      setEnvironments(environmentData);
      setSchedules(scheduleData);
      setChannels(channelData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  useEffect(() => {
    settingsHydratedRef.current = false;
    setProjectDescription('');
    setSavedProjectDescription('');
    setProjectDefaultEnvironmentId(undefined);
    setProjectDefaultDevice(DEFAULT_DEVICE_OPTIONS[0]);
    setProjectNameError(null);
    setProjectDescriptionError(null);
    setDeleteProjectConfirmText('');
    setDeleteProjectModalOpen(false);
  }, [projectId]);

  useEffect(() => {
    setActiveTab(resolveTabFromPathname(location.pathname));
  }, [location.pathname]);

  useEffect(() => {
    if (!project || settingsHydratedRef.current) return;
    const draft = readProjectSettingsDraft(project.id);
    const nextDefaultEnvironmentId =
      draft?.defaultEnvironmentId && environments.some((environment) => environment.id === draft.defaultEnvironmentId)
        ? draft.defaultEnvironmentId
        : resolveInitialEnvironmentId(environments);
    const nextDescription = draft?.description ?? '';

    setProjectName(project.name);
    setProjectDescription(nextDescription);
    setSavedProjectDescription(nextDescription.trim());
    setProjectDefaultEnvironmentId(nextDefaultEnvironmentId);
    setProjectDefaultDevice(draft?.defaultDevice ?? DEFAULT_DEVICE_OPTIONS[0]);
    settingsHydratedRef.current = true;
  }, [environments, project]);

  const projectHeaderDescription = savedProjectDescription || 'Monitor browser checks, schedules, and alerts for this project.';

  const projectChecks = useMemo(() => project?.tests ?? [], [project]);
  const latestChecks = useMemo(() => {
    return [...projectChecks].sort((left, right) => {
      const leftDate = left.lastRunAt ? new Date(left.lastRunAt).getTime() : 0;
      const rightDate = right.lastRunAt ? new Date(right.lastRunAt).getTime() : 0;
      return rightDate - leftDate;
    });
  }, [projectChecks]);

  const environmentUsage = useMemo(
    () =>
      environments.map((environment) => ({
        ...environment,
        usedByChecks: countEnvironmentUsage(environment, projectChecks)
      })),
    [environments, projectChecks]
  );

  const overviewChecks = useMemo(() => {
    return latestChecks.filter((check) => check.lastRunAt).slice(0, 5);
  }, [latestChecks]);

  const attentionChecks = useMemo(() => {
    return latestChecks.filter((check) => check.lastRunStatus === 'FAILED' || (check.lastRunAt && check.steps.length > 0 && check.runCount > 1));
  }, [latestChecks]);

  const projectSetupItems = useMemo(
    () => [
      { label: 'Checks created', done: (projectChecks.length ?? 0) > 0 },
      { label: 'Environment configured', done: environments.length > 0 },
      { label: 'Schedule configured', done: schedules.some((schedule) => schedule.enabled) },
      { label: 'Alert channel configured', done: channels.length > 0 }
    ],
    [channels.length, environments.length, projectChecks.length, schedules]
  );

  const scheduleFormCron = scheduleForm.cronPreset === 'custom' ? scheduleForm.customCron.trim() : scheduleForm.cronPreset;
  const scheduleFormTargetSuite = useMemo(
    () => suites.find((suite) => suite.id === scheduleForm.suiteId),
    [scheduleForm.suiteId, suites]
  );
  const scheduleFormTargetCheck = useMemo(
    () => projectChecks.find((check) => check.id === scheduleForm.testId),
    [projectChecks, scheduleForm.testId]
  );
  const scheduleFormTargetUsesVariables = useMemo(() => {
    if (scheduleForm.targetType === 'suite') {
      if (!scheduleFormTargetSuite) return false;
      return scheduleFormTargetSuite.testIds.some((testId) => testUsesVariables(projectChecks.find((check) => check.id === testId)));
    }
    return testUsesVariables(scheduleFormTargetCheck);
  }, [projectChecks, scheduleForm.targetType, scheduleFormTargetCheck, scheduleFormTargetSuite]);
  const scheduleFormNeedsEnvironment = scheduleFormTargetUsesVariables && !scheduleForm.environmentId;

  const openEnvironmentCreate = () => {
    setEnvironmentMode('create');
    setEditingEnvironment(null);
    setEnvironmentName('');
    setEnvironmentRows([createEnvRow()]);
    setEnvironmentModalOpen(true);
  };

  const openEnvironmentEdit = (environment: Environment) => {
    setEnvironmentMode('edit');
    setEditingEnvironment(environment);
    setEnvironmentName(environment.name);
    setEnvironmentRows(envRowsFromRecord(environment.variables));
    setEnvironmentModalOpen(true);
  };

  const saveEnvironment = async () => {
    const validationError = validateEnvironmentRows(environmentName, environmentRows);
    if (validationError) {
      message.error(validationError);
      return;
    }

    setEnvironmentSaving(true);
    try {
      const payload = {
        name: environmentName.trim(),
        variables: envRecordFromRows(environmentRows)
      };
      if (environmentMode === 'edit' && editingEnvironment) {
        await updateEnvironment(editingEnvironment.id, payload);
        message.success('Environment updated');
      } else {
        await createEnvironment(projectId!, payload);
        message.success('Environment created');
      }
      setEnvironmentModalOpen(false);
      await load();
    } catch {
      message.error('Failed to save environment');
    } finally {
      setEnvironmentSaving(false);
    }
  };

  const duplicateEnvironment = async (environment: Environment) => {
    try {
      await createEnvironment(projectId!, {
        name: `${environment.name} Copy`,
        variables: environment.variables
      });
      message.success('Environment duplicated');
      await load();
    } catch {
      message.error('Failed to duplicate environment');
    }
  };

  const openChannelCreate = (type: 'telegram' | 'slack') => {
    setChannelMode('create');
    setEditingChannel(null);
    setChannelType(type);
    setChannelForm({
      name: '',
      botToken: '',
      chatId: '',
      webhookUrl: '',
      onFailed: true,
      onRecovered: true,
      onPassed: false,
      enabled: true
    });
    setChannelTestFeedback(null);
    setChannelModalOpen(true);
  };

  const openChannelEdit = (channel: NotificationChannel) => {
    setChannelMode('edit');
    setEditingChannel(channel);
    setChannelType(channel.type);
    setChannelForm({
      name: channel.name,
      botToken: channel.type === 'telegram' ? channel.config.botToken ?? '' : '',
      chatId: channel.type === 'telegram' ? channel.config.chatId ?? '' : '',
      webhookUrl: channel.type === 'slack' ? channel.config.webhookUrl ?? '' : '',
      onFailed: channel.onFailed,
      onRecovered: channel.onRecovered,
      onPassed: channel.onPassed,
      enabled: channel.enabled
    });
    setChannelTestFeedback(null);
    setChannelModalOpen(true);
  };

  const saveChannel = async () => {
    if (!channelForm.name.trim()) {
      message.error('Alert name is required');
      return;
    }

    if (channelType === 'telegram') {
      if (!channelForm.botToken.trim()) {
        message.error('Bot token is required');
        return;
      }
      if (!channelForm.chatId.trim()) {
        message.error('Chat ID is required');
        return;
      }
    } else if (!channelForm.webhookUrl.trim()) {
      message.error('Webhook URL is required');
      return;
    } else if (!channelForm.webhookUrl.trim().startsWith('https://hooks.slack.com/services/')) {
      message.error('Webhook URL must start with https://hooks.slack.com/services/');
      return;
    }

    setChannelSaving(true);
    try {
      const payload: {
        type: 'telegram' | 'slack';
        name: string;
        config: Record<string, string>;
        onFailed: boolean;
        onRecovered: boolean;
        onPassed: boolean;
        enabled: boolean;
      } = channelType === 'telegram'
        ? {
            type: 'telegram',
            name: channelForm.name.trim(),
            config: {
              botToken: channelForm.botToken.trim(),
              chatId: channelForm.chatId.trim()
            },
            onFailed: channelForm.onFailed,
            onRecovered: channelForm.onRecovered,
            onPassed: channelForm.onPassed,
            enabled: channelForm.enabled
          }
        : {
            type: 'slack',
            name: channelForm.name.trim(),
            config: {
              webhookUrl: channelForm.webhookUrl.trim()
            },
            onFailed: channelForm.onFailed,
            onRecovered: channelForm.onRecovered,
            onPassed: channelForm.onPassed,
            enabled: channelForm.enabled
          };

      if (channelMode === 'edit' && editingChannel) {
        await updateChannel(editingChannel.id, {
          name: payload.name,
          config: payload.config,
          onFailed: payload.onFailed,
          onRecovered: payload.onRecovered,
          onPassed: payload.onPassed,
          enabled: payload.enabled
        });
        message.success('Channel updated');
      } else {
        await createChannel(projectId!, payload);
        message.success('Channel created');
      }

      setChannelModalOpen(false);
      await load();
    } catch {
      message.error('Failed to save channel');
    } finally {
      setChannelSaving(false);
    }
  };

  const sendChannelDraftTest = async () => {
    setChannelTestFeedback(null);

    if (!channelForm.name.trim()) {
      setChannelTestFeedback({ type: 'error', text: 'Alert name is required' });
      return;
    }

    if (channelType === 'telegram') {
      if (!channelForm.botToken.trim() || !channelForm.chatId.trim()) {
        setChannelTestFeedback({ type: 'error', text: 'Bot token and Chat ID are required' });
        return;
      }
    } else if (!channelForm.webhookUrl.trim()) {
      setChannelTestFeedback({ type: 'error', text: 'Webhook URL is required' });
      return;
    } else if (!channelForm.webhookUrl.trim().startsWith('https://hooks.slack.com/services/')) {
      setChannelTestFeedback({ type: 'error', text: 'Webhook URL must start with https://hooks.slack.com/services/' });
      return;
    }

    setChannelTesting(true);
    try {
      await testChannelDraft(projectId!, {
        type: channelType,
        name: channelForm.name.trim(),
        config:
          channelType === 'telegram'
            ? {
                botToken: channelForm.botToken.trim(),
                chatId: channelForm.chatId.trim()
              }
            : {
                webhookUrl: channelForm.webhookUrl.trim()
              }
        });
      setChannelTestFeedback({ type: 'success', text: 'Test notification sent.' });
    } catch (error) {
      const apiError = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setChannelTestFeedback({
        type: 'error',
        text: typeof apiError === 'string' && apiError.trim().length > 0 ? apiError : 'Failed to send test notification'
      });
    } finally {
      setChannelTesting(false);
    }
  };

  const testExistingChannel = async (channel: NotificationChannel) => {
    try {
      await testChannel(channel.id);
      message.success('Test notification sent');
      await load();
    } catch {
      message.error('Failed to send test notification');
    }
  };

  const deleteExistingChannel = async (channelId: string) => {
    await deleteChannel(channelId);
    message.success('Channel deleted');
    await load();
  };

  const toggleChannelEnabled = async (channel: NotificationChannel) => {
    try {
      await updateChannel(channel.id, { enabled: !channel.enabled });
      message.success(channel.enabled ? 'Alert paused' : 'Alert activated');
      await load();
    } catch {
      message.error('Failed to update alert status');
    }
  };

  const channelDraftReadyForTest = channelType === 'telegram'
    ? Boolean(channelForm.name.trim() && channelForm.botToken.trim() && channelForm.chatId.trim())
    : Boolean(
        channelForm.name.trim() &&
          channelForm.webhookUrl.trim() &&
          channelForm.webhookUrl.trim().startsWith('https://hooks.slack.com/services/')
      );

  const openScheduleCreate = () => {
    setScheduleMode('create');
    setEditingSchedule(null);
    setScheduleForm({
      name: '',
      cronPreset: '0 2 * * *',
      customCron: '0 2 * * *',
      targetType: suites.length > 0 ? 'suite' : 'test',
      suiteId: suites[0]?.id,
      testId: projectChecks[0]?.id,
      environmentId: undefined,
      enabled: true
    });
    setScheduleModalOpen(true);
  };

  const openScheduleEdit = (schedule: Schedule) => {
    const targetType: ScheduleTargetType = schedule.suiteId ? 'suite' : 'test';
    const preset = CRON_PRESETS.some((item) => item.value === schedule.cron) ? schedule.cron : 'custom';
    setScheduleMode('edit');
    setEditingSchedule(schedule);
    setScheduleForm({
      name: schedule.name,
      cronPreset: preset,
      customCron: preset === 'custom' ? schedule.cron : schedule.cron,
      targetType,
      suiteId: schedule.suiteId ?? undefined,
      testId: schedule.testId ?? undefined,
      environmentId: schedule.environmentId ?? undefined,
      enabled: schedule.enabled
    });
    setScheduleModalOpen(true);
  };

  const saveSchedule = async () => {
    if (!scheduleForm.name.trim()) {
      message.error('Schedule name is required');
      return;
    }

    const cronValue = scheduleForm.cronPreset === 'custom' ? scheduleForm.customCron.trim() : scheduleForm.cronPreset;
    if (!cronValue) {
      message.error('Cron is required');
      return;
    }

    const targetSuiteId = scheduleForm.targetType === 'suite' ? scheduleForm.suiteId : undefined;
    const targetTestId = scheduleForm.targetType === 'test' ? scheduleForm.testId : undefined;

    if (!targetSuiteId && !targetTestId) {
      message.error('Select a suite or a check');
      return;
    }

    if (scheduleFormNeedsEnvironment) {
      message.error('Select an environment for checks that use variables');
      return;
    }

    setScheduleSaving(true);
    try {
      const payload = {
        name: scheduleForm.name.trim(),
        cron: cronValue,
        suiteId: targetSuiteId ?? null,
        testId: targetTestId ?? null,
        environmentId: scheduleForm.environmentId ?? null,
        enabled: scheduleForm.enabled
      };

      if (scheduleMode === 'edit' && editingSchedule) {
        await updateSchedule(editingSchedule.id, payload);
        message.success('Schedule updated');
      } else {
        await createSchedule(projectId!, {
          name: payload.name,
          cron: payload.cron,
          suiteId: payload.suiteId ?? undefined,
          testId: payload.testId ?? undefined,
          environmentId: payload.environmentId ?? undefined,
          enabled: payload.enabled
        });
        message.success('Schedule created');
      }

      setScheduleModalOpen(false);
      await load();
    } catch {
      message.error('Failed to save schedule');
    } finally {
      setScheduleSaving(false);
    }
  };

  const runScheduleNow = async (schedule: Schedule) => {
    try {
      if (schedule.suiteId) {
        const result = await runSuite(schedule.suiteId, schedule.environmentId ?? undefined);
        if (result.jobs.length > 0) {
          navigate(`/runs/${result.jobs[0].testRunId}`);
        }
      } else if (schedule.testId) {
        const result = await runTestWithEnvironment(schedule.testId, schedule.environmentId ?? undefined);
        navigate(`/runs/${result.testRunId}`);
      }
      message.success('Schedule run started');
    } catch {
      message.error('Failed to run schedule');
    }
  };

  const toggleSchedule = async (schedule: Schedule) => {
    try {
      await updateSchedule(schedule.id, { enabled: !schedule.enabled });
      message.success(schedule.enabled ? 'Schedule paused' : 'Schedule resumed');
      await load();
    } catch {
      message.error('Failed to update schedule');
    }
  };

  const deleteExistingSchedule = async (scheduleId: string) => {
    await deleteSchedule(scheduleId);
    message.success('Schedule deleted');
    await load();
  };

  const duplicateCheckName = (name: string) => `${name} Copy`;

  const openCheck = (testId: string) => {
    navigate(`/tests/${testId}/edit`);
  };

  const handleRunCheck = async (testId: string, event?: MouseEvent) => {
    event?.stopPropagation();
    try {
      if (environments.length === 0) {
        const { testRunId } = await runTestWithEnvironment(testId);
        message.success('Check started');
        navigate(`/runs/${testRunId}`);
        return;
      }

      setRunCheckId(testId);
      setSelectedEnvironmentId(undefined);
      setRunCheckModalOpen(true);
    } catch {
      message.error('Failed to start check');
    }
  };

  const handleConfirmCheckRun = async () => {
    if (!runCheckId) return;

    setCheckRunLoading(true);
    try {
      const { testRunId } = await runTestWithEnvironment(runCheckId, selectedEnvironmentId);
      setRunCheckModalOpen(false);
      message.success('Check started');
      navigate(`/runs/${testRunId}`);
    } catch {
      message.error('Failed to start check');
    } finally {
      setCheckRunLoading(false);
    }
  };

  const handleDeleteCheck = async (testId: string) => {
    await deleteTest(testId);
    message.success('Check deleted');
    await load();
  };

  const handleDuplicateCheck = async (check: ProjectCheck) => {
    try {
      const created = await createTest(projectId!, {
        name: `${check.name} Copy`,
        url: check.url,
        device: check.device ?? undefined,
        steps: check.steps
      });
      message.success('Check duplicated');
      navigate(`/tests/${created.id}/edit`);
    } catch {
      message.error('Failed to duplicate check');
    }
  };

  const handleExportCheck = async (check: ProjectCheck) => {
    try {
      const response = await api.get(`/tests/${check.id}/export`, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${check.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'check'}.spec.ts`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      message.success('Check exported');
    } catch {
      message.error('Failed to export check');
    }
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const code = await file.text();
      const { test, parsedSteps } = await importTestSpec(projectId!, code);
      message.success(`Imported "${test.name}" — ${parsedSteps} steps`);
      await load();
      navigate(`/tests/${test.id}/edit`);
    } catch (error) {
      const responseError =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
      message.error(typeof responseError === 'string' ? responseError : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const openRunSuiteModal = () => {
    setSelectedSuiteId(suites[0]?.id);
    setSelectedEnvironmentId(undefined);
    setRunSuiteModalOpen(true);
  };

  const handleRunSuite = async () => {
    if (!selectedSuiteId) {
      message.warning('Create a suite first to run multiple checks together');
      return;
    }

    setRunningSuite(true);
    try {
      const result = await runSuite(selectedSuiteId, selectedEnvironmentId);
      setRunSuiteModalOpen(false);
      if (result.jobs.length > 0) {
        navigate(`/runs/${result.jobs[0].testRunId}`);
      } else {
        navigate('/dashboard');
      }
    } catch {
      message.error('Failed to run suite');
    } finally {
      setRunningSuite(false);
    }
  };

  const handleSaveProject = async () => {
    if (!project) return;

    const nextName = projectName.trim();
    const nextDescription = projectDescription.trim();
    const nextDefaultEnvironmentId = projectDefaultEnvironmentId || undefined;

    setProjectNameError(null);
    setProjectDescriptionError(null);

    if (!nextName) {
      setProjectNameError('Project name is required');
      message.error('Project name is required');
      return;
    }

    if (nextDescription.length > 500) {
      setProjectDescriptionError('Description must be 500 characters or fewer');
      message.error('Description must be 500 characters or fewer');
      return;
    }

    setSavingProject(true);
    try {
      if (nextName !== project.name) {
        const updated = await updateProject(project.id, { name: nextName });
        setProject((current) => (current ? { ...current, ...updated, name: updated.name } : current));
      }
      writeProjectSettingsDraft(project.id, {
        description: nextDescription,
        defaultEnvironmentId: nextDefaultEnvironmentId,
        defaultDevice: projectDefaultDevice
      });
      setProjectDescription(nextDescription);
      setSavedProjectDescription(nextDescription);
      setProjectDefaultEnvironmentId(nextDefaultEnvironmentId);
      message.success('Project settings saved');
      await load();
    } finally {
      setSavingProject(false);
    }
  };

  const handleResetProjectSettings = () => {
    if (!project) return;
    clearProjectSettingsDraft(project.id);
    setProjectName(project.name);
    setProjectDescription('');
    setSavedProjectDescription('');
    setProjectDefaultEnvironmentId(resolveInitialEnvironmentId(environments));
    setProjectDefaultDevice(DEFAULT_DEVICE_OPTIONS[0]);
    setProjectNameError(null);
    setProjectDescriptionError(null);
    message.info('Project settings reset');
  };

  const openDeleteProjectModal = () => {
    setDeleteProjectConfirmText('');
    setDeleteProjectModalOpen(true);
  };

  const handleDeleteProject = async () => {
    if (!project || deleteProjectConfirmText.trim() !== project.name.trim()) return;

    setDeletingProject(true);
    try {
      clearProjectSettingsDraft(project.id);
      await deleteProject(project.id);
      message.success('Project deleted');
      setDeleteProjectModalOpen(false);
      navigate('/projects');
    } catch {
      message.error('Failed to delete project');
    } finally {
      setDeletingProject(false);
    }
  };

  const deleteProjectReady = Boolean(
    project && deleteProjectConfirmText.trim() === project.name.trim()
  );

  const runSuiteItems = suites.map((suite) => ({
    value: suite.id,
    label: `${suite.name}${Array.isArray(suite.testIds) ? ` • ${suite.testIds.length} checks` : ''}`
  }));

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'checks', label: 'Checks' },
    { key: 'runs', label: 'Runs' },
    { key: 'schedules', label: 'Schedules' },
    { key: 'environments', label: 'Environments' },
    { key: 'alerts', label: 'Alerts' },
    { key: 'settings', label: 'Settings' }
  ];

  const checkColumns = [
    {
      title: 'Check',
      dataIndex: 'name',
      width: 340,
      render: (_: string, row: ProjectCheck) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, alignItems: 'stretch' }}>
          <Link
            to={`/tests/${row.id}/edit`}
            onClick={(event) => event.stopPropagation()}
            style={{
              display: 'block',
              fontWeight: 600,
              lineHeight: 1.45,
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
              textAlign: 'left'
            }}
          >
            {row.name}
          </Link>
          <Text
            type="secondary"
            style={{ fontSize: 12, lineHeight: 1.4, whiteSpace: 'normal', overflowWrap: 'anywhere', textAlign: 'left' }}
          >
            {row.url} · {row.steps.length} steps · {row.runCount} runs
          </Text>
        </div>
      )
    },
    {
      title: 'Status',
      width: 130,
      render: (_: unknown, row: ProjectCheck) =>
        row.lastRunStatus ? <RunStatusBadge status={row.lastRunStatus} /> : <Tag color="default">Never run</Tag>
    },
    {
      title: 'Last run',
      width: 200,
      render: (_: unknown, row: ProjectCheck) =>
        row.lastRunAt ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <Text>{formatRelativeTime(row.lastRunAt)}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatDurationLabel(row.lastRunDurationMs)} · {formatShortTimestamp(row.lastRunAt)}
            </Text>
          </div>
        ) : (
          <Text type="secondary">Never</Text>
        )
    },
    {
      title: 'Schedule',
      width: 160,
      render: (_: unknown, row: ProjectCheck) => <Tag color="purple">{formatScheduleSummary(row, schedules)}</Tag>
    },
    {
      title: 'Device',
      width: 150,
      render: (_: unknown, row: ProjectCheck) =>
        row.device ? (
          <Tag icon={<MobileOutlined />} color="blue">
            {row.device}
          </Tag>
        ) : (
          <Tag>Desktop</Tag>
        )
    },
    {
      title: 'Runs',
      width: 88,
      render: (_: unknown, row: ProjectCheck) => <Tag>{row.runCount}</Tag>
    },
    {
      title: 'Actions',
      width: 190,
      fixed: 'right' as const,
      render: (_: unknown, row: ProjectCheck) => (
        <Space onClick={(event) => event.stopPropagation()} size={8}>
          <Button size="small" type="primary" onClick={(event) => void handleRunCheck(row.id, event)}>
            Run
          </Button>
          <Button size="small" onClick={() => openCheck(row.id)}>
            Open
          </Button>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'edit', icon: <EditOutlined />, label: 'Edit' },
                { key: 'duplicate', icon: <CopyOutlined />, label: 'Duplicate' },
                { key: 'export', icon: <ExportOutlined />, label: 'Export .spec.ts' },
                { type: 'divider' },
                { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true }
              ],
              onClick: ({ key, domEvent }) => {
                domEvent.stopPropagation();

                if (key === 'edit') {
                  openCheck(row.id);
                }

                if (key === 'duplicate') {
                  void handleDuplicateCheck(row);
                }

                if (key === 'export') {
                  void handleExportCheck(row);
                }

                if (key === 'delete') {
                  confirmModal.confirm({
                    title: 'Delete check?',
                    content: `This will remove "${row.name}" and its run history.`,
                    okText: 'Delete',
                    okButtonProps: { danger: true },
                    centered: true,
                    onOk: async () => {
                      await handleDeleteCheck(row.id);
                    }
                  });
                }
              }
            }}
          >
            <Button size="small" icon={<EllipsisOutlined />} />
          </Dropdown>
        </Space>
      )
    }
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eef6ff 48%, #ffffff 100%)' }}>
      {confirmModalContextHolder}
      <AppHeader actions={[<UserMenu key="menu" />]} />
      <Content style={{ padding: 32, maxWidth: 1560, width: '100%', margin: '0 auto' }}>
        <Row gutter={[24, 24]}>
          <Col span={24}>
            <Card style={{ borderRadius: 24, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                    <Text type="secondary">
                      <Link to="/projects">Projects</Link>
                    </Text>
                    <Title level={2} style={{ margin: 0 }}>
                      {project?.name ?? 'Loading...'}
                    </Title>
                    <Text
                      type="secondary"
                      style={{ maxWidth: 760, overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                    >
                      {projectHeaderDescription}
                    </Text>
                    {project && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatCreatedLabel(project.createdAt)}
                      </Text>
                    )}
                  </div>

                  <Space wrap>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate(`/projects/${projectId}/tests/new`)}>
                      New Check
                    </Button>
                    <Upload
                      accept=".ts,.js"
                      showUploadList={false}
                      beforeUpload={(file) => {
                        void handleImport(file);
                        return false;
                      }}
                    >
                      <Button icon={<UploadOutlined />} loading={importing}>
                        Import .spec.ts
                      </Button>
                    </Upload>
                    <Button icon={<PlayCircleOutlined />} onClick={openRunSuiteModal}>
                      Run suite
                    </Button>
                  </Space>
                </div>

                <Tabs
                  activeKey={activeTab}
                  items={tabs.map((tab) => ({ key: tab.key, label: tab.label }))}
                  onChange={(key) => setActiveTab(key as ProjectTabKey)}
                />
              </div>
            </Card>
          </Col>

          <Col span={24}>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} xl={4}>
                <Card style={{ borderRadius: 20, boxShadow: '0 14px 30px rgba(15, 23, 42, 0.08)', height: '100%' }}>
                  <Statistic title="Checks" value={summary?.checksCount ?? 0} />
                  <Text type="secondary">Browser checks in this project</Text>
                </Card>
              </Col>
              <Col xs={24} sm={12} xl={4}>
                <Card style={{ borderRadius: 20, boxShadow: '0 14px 30px rgba(15, 23, 42, 0.08)', height: '100%' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Text type="secondary">Last result</Text>
                    {summary?.lastResult ? (
                      <RunStatusBadge status={summary.lastResult} />
                    ) : (
                      <Tag color="default">No runs</Tag>
                    )}
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} xl={4}>
                <Card style={{ borderRadius: 20, boxShadow: '0 14px 30px rgba(15, 23, 42, 0.08)', height: '100%' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <Text type="secondary">Pass rate</Text>
                    <Text
                      style={{
                        fontSize: 28,
                        lineHeight: 1.1,
                        fontWeight: 600,
                        color:
                          summary?.passRate30d == null ? '#8c8c8c' : summary.passRate30d >= 80 ? '#52c41a' : '#ff4d4f'
                      }}
                    >
                      {summary?.passRate30d == null ? '—' : `${summary.passRate30d}%`}
                    </Text>
                    <Text type="secondary">
                      {summary?.totalRuns30d ? `${summary.passedRuns30d}/${summary.totalRuns30d} runs in last 30 days` : 'No runs yet'}
                    </Text>
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} xl={4}>
                <Card style={{ borderRadius: 20, boxShadow: '0 14px 30px rgba(15, 23, 42, 0.08)', height: '100%' }}>
                  <Statistic title="Active schedules" value={summary?.activeSchedulesCount ?? 0} />
                  <Text type="secondary">Project-level schedules</Text>
                </Card>
              </Col>
              <Col xs={24} sm={12} xl={4}>
                <Card style={{ borderRadius: 20, boxShadow: '0 14px 30px rgba(15, 23, 42, 0.08)', height: '100%' }}>
                  <Statistic title="Alert channels" value={summary?.alertChannelsCount ?? 0} />
                  <Text type="secondary">Telegram and Slack</Text>
                </Card>
              </Col>
              <Col xs={24} sm={12} xl={4}>
                <Card style={{ borderRadius: 20, boxShadow: '0 14px 30px rgba(15, 23, 42, 0.08)', height: '100%' }}>
                  <Statistic
                    title="Avg duration"
                    value={summary?.avgDurationMs != null ? formatDuration(summary.avgDurationMs) : '—'}
                  />
                  <Text type="secondary">
                    {summary?.failedChecks ? `${summary.failedChecks} failing checks` : 'Healthy checks'}
                  </Text>
                </Card>
              </Col>
            </Row>
          </Col>

          {activeTab === 'overview' && (
            <Col span={24}>
              <Row gutter={[24, 24]}>
                <Col xs={24} xl={14}>
                  <Card
                    style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
                    title="Recent results"
                    extra={summary?.totalRuns30d ? <Tag color="blue">{summary.totalRuns30d} runs in 30 days</Tag> : <Tag color="default">No runs yet</Tag>}
                  >
                    {overviewChecks.length > 0 ? (
                      <div style={{ width: '100%', minWidth: 0 }}>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: RECENT_RESULTS_GRID_COLUMNS,
                            alignItems: 'center',
                            gap: 16,
                            padding: '0 16px 12px',
                            color: '#8c8c8c',
                            fontSize: 12,
                            fontWeight: 500
                          }}
                        >
                          <div style={{ minWidth: 0 }}>Check</div>
                          <div style={{ minWidth: 0 }}>Status</div>
                          <div style={{ minWidth: 0 }}>Last run</div>
                          <div style={{ minWidth: 0 }}>Open</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {overviewChecks.map((row) => (
                            <div
                              key={row.id}
                              style={{
                                display: 'grid',
                                gridTemplateColumns: RECENT_RESULTS_GRID_COLUMNS,
                                alignItems: 'center',
                                gap: 16,
                                padding: '14px 16px',
                                borderRadius: 16,
                                border: '1px solid #edf2f7',
                                background: '#fff'
                              }}
                            >
                              {renderRecentResultCell(row, openCheck)}
                              <div style={{ minWidth: 0 }}>
                                {row.lastRunStatus ? <RunStatusBadge status={row.lastRunStatus} /> : <Tag>Never run</Tag>}
                              </div>
                              <div style={{ minWidth: 0 }}>
                                {row.lastRunAt ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                                    <Text>{formatRelativeTime(row.lastRunAt)}</Text>
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                      {formatDurationLabel(row.lastRunDurationMs)} · {formatShortTimestamp(row.lastRunAt)}
                                    </Text>
                                  </div>
                                ) : (
                                  <Text type="secondary">Never</Text>
                                )}
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <Button size="small" onClick={() => openCheck(row.id)}>
                                  Open
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={
                          <Space direction="vertical" size={4}>
                            <Text strong>No runs yet</Text>
                            <Text type="secondary">
                              Run a check manually or create a schedule to start collecting results.
                            </Text>
                          </Space>
                        }
                      >
                        <Space wrap>
                          <Button type="primary" onClick={openRunSuiteModal}>
                            Run suite
                          </Button>
                          <Button onClick={() => setActiveTab('checks')}>Go to Checks</Button>
                        </Space>
                      </Empty>
                    )}
                  </Card>
                </Col>
                <Col xs={24} xl={10}>
                  <Card
                    style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
                    title="Needs attention"
                    extra={summary?.flakyChecks ? <Tag color="gold">{summary.flakyChecks} flaky</Tag> : <Tag color="green">All clear</Tag>}
                  >
                    {attentionChecks.filter((check) => check.lastRunStatus === 'FAILED').length > 0 ? (
                      <Table<ProjectCheck>
                        dataSource={attentionChecks.filter((check) => check.lastRunStatus === 'FAILED')}
                        rowKey="id"
                        pagination={false}
                        columns={[
                          {
                            title: 'Check',
                            dataIndex: 'name',
                            render: (value: string, row: ProjectCheck) => (
                              <Button type="link" style={{ padding: 0, textAlign: 'left', fontWeight: 600 }} onClick={() => openCheck(row.id)}>
                                {value}
                              </Button>
                            )
                          },
                          {
                            title: 'Status',
                            render: (_: unknown, row: ProjectCheck) =>
                              row.lastRunStatus ? <RunStatusBadge status={row.lastRunStatus} /> : <Tag>Never run</Tag>
                          },
                          {
                            title: 'Last failure',
                            render: (_: unknown, row: ProjectCheck) =>
                              row.lastRunAt ? <Text>{formatCompactDateTime(row.lastRunAt)}</Text> : <Text type="secondary">—</Text>
                          },
                          {
                            title: 'Error summary',
                            render: (_: unknown, row: ProjectCheck) => (
                              <Text type="secondary" ellipsis={{ tooltip: row.latestRun?.error ?? 'No error summary' }} style={{ maxWidth: 220, display: 'inline-block' }}>
                                {row.latestRun?.error ?? 'No error summary'}
                              </Text>
                            )
                          },
                          {
                            title: 'Actions',
                            render: (_: unknown, row: ProjectCheck) => (
                              <Space>
                                <Button size="small" onClick={() => openCheck(row.id)}>
                                  Open result
                                </Button>
                                <Button size="small" onClick={() => void handleRunCheck(row.id)}>
                                  Rerun
                                </Button>
                              </Space>
                            )
                          }
                        ]}
                      />
                    ) : (
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Title level={5} style={{ margin: 0 }}>No active failures</Title>
                        <Text type="secondary">All browser checks in this project are currently passing.</Text>
                        {summary?.flakyChecks ? (
                          <Text type="secondary">{summary.flakyChecks} flaky checks were detected in recent runs.</Text>
                        ) : null}
                      </Space>
                    )}
                  </Card>
                </Col>
                <Col span={24}>
                  <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
                    <Title level={4}>Project setup</Title>
                    <Row gutter={[16, 16]}>
                      {projectSetupItems.map((item) => (
                        <Col key={item.label} xs={24} sm={12} xl={6}>
                          <Space align="start">
                            {item.done ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : <WarningOutlined style={{ color: '#8c8c8c' }} />}
                            <div>
                              <Text strong>{item.label}</Text>
                              <br />
                              <Text type="secondary">{item.done ? 'Configured' : 'Not configured'}</Text>
                            </div>
                          </Space>
                        </Col>
                      ))}
                    </Row>
                  </Card>
                </Col>
              </Row>
            </Col>
          )}

          {activeTab === 'checks' && (
            <Col span={24}>
              <Card
                style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
                title="Checks"
              >
                {loading ? (
                  <Table
                    dataSource={[]}
                    columns={checkColumns as never}
                    loading
                    pagination={false}
                    rowKey="id"
                  />
                ) : hasChecks ? (
                  <Table<ProjectCheck>
                    dataSource={projectChecks}
                    rowKey="id"
                    pagination={false}
                    rowClassName={() => 'clickable-row'}
                    onRow={(row) => ({ onClick: () => openCheck(row.id) })}
                    columns={checkColumns as never}
                  />
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      <Space direction="vertical" size={4}>
                        <Text strong>No browser checks yet</Text>
                        <Text type="secondary">Create your first check or import an existing Playwright .spec.ts file.</Text>
                      </Space>
                    }
                  >
                    <Space wrap>
                      <Button type="primary" onClick={() => navigate(`/projects/${projectId}/tests/new`)}>
                        New Check
                      </Button>
                      <Upload
                        accept=".ts,.js"
                        showUploadList={false}
                        beforeUpload={(file) => {
                          void handleImport(file);
                          return false;
                        }}
                      >
                        <Button>Import .spec.ts</Button>
                      </Upload>
                    </Space>
                  </Empty>
                )}
              </Card>
            </Col>
          )}

          {activeTab === 'runs' && (
            <Col span={24}>
              <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }} title="Recent results">
                {latestChecks.some((check) => check.lastRunAt) ? (
                  <Table<ProjectCheck>
                    dataSource={latestChecks.filter((check) => check.lastRunAt)}
                    rowKey="id"
                    pagination={false}
                    columns={[
                      {
                        title: 'Check',
                        dataIndex: 'name',
                        render: (_: string, row: ProjectCheck) => (
                          <Space direction="vertical" size={0}>
                            <Button type="link" style={{ padding: 0, textAlign: 'left', fontWeight: 600, height: 'auto' }} onClick={() => openCheck(row.id)}>
                              {row.name}
                            </Button>
                            <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.4 }}>
                              {row.url}
                            </Text>
                          </Space>
                        )
                      },
                      {
                        title: 'Status',
                        render: (_: unknown, row: ProjectCheck) =>
                          row.lastRunStatus ? <RunStatusBadge status={row.lastRunStatus} /> : <Tag>Never run</Tag>
                      },
                      {
                        title: 'Last run',
                        render: (_: unknown, row: ProjectCheck) =>
                          row.lastRunAt ? (
                            <Space direction="vertical" size={0}>
                              <Text>{formatRelativeTime(row.lastRunAt)}</Text>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {formatDurationLabel(row.lastRunDurationMs)} · {formatShortTimestamp(row.lastRunAt)}
                              </Text>
                            </Space>
                          ) : (
                            <Text type="secondary">Never</Text>
                          )
                      },
                      {
                        title: 'Open',
                        render: (_: unknown, row: ProjectCheck) => (
                          <Button size="small" onClick={() => openCheck(row.id)}>
                            Open
                          </Button>
                        )
                      }
                    ]}
                  />
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="Run history will appear here once checks have been executed."
                  >
                    <Button type="primary" onClick={openRunSuiteModal}>
                      Run suite
                    </Button>
                  </Empty>
                )}
              </Card>
            </Col>
          )}

          {activeTab === 'schedules' && (
            <Col span={24}>
              <Card
                style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
                title="Schedules"
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={openScheduleCreate}>New Schedule</Button>}
              >
                <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 16 }}>
                  <Text type="secondary">Run browser checks or suites automatically on a cron expression.</Text>
                </Space>

                {schedules.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      <Space direction="vertical" size={4}>
                        <Text strong>No schedules yet</Text>
                        <Text type="secondary">Create a schedule to run checks automatically.</Text>
                      </Space>
                    }
                  >
                    <Button type="primary" onClick={openScheduleCreate}>
                      New Schedule
                    </Button>
                  </Empty>
                ) : (
                  <Table<Schedule>
                    dataSource={schedules}
                    rowKey="id"
                    loading={loading}
                    pagination={false}
                    rowClassName={() => 'clickable-row'}
                    onRow={(row) => ({ onClick: () => openScheduleEdit(row) })}
                    columns={[
                      {
                        title: 'Schedule',
                        dataIndex: 'name',
                        render: (value: string, row: Schedule) => (
                          <Space direction="vertical" size={0}>
                            <Button type="link" style={{ padding: 0, textAlign: 'left', fontWeight: 600 }} onClick={() => openScheduleEdit(row)}>
                              {value}
                            </Button>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {describeCron(row.cron)}
                            </Text>
                          </Space>
                        )
                      },
                      {
                        title: 'Target',
                        render: (_: unknown, row) => (
                          <Space direction="vertical" size={0}>
                            <Text strong>{row.suite?.name ?? row.test?.name ?? '—'}</Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {row.environment?.name ?? 'No environment'}
                            </Text>
                          </Space>
                        )
                      },
                      {
                        title: 'Cron',
                        dataIndex: 'cron',
                        render: (value: string) => <Tag color="blue"><code>{value}</code></Tag>
                      },
                      {
                        title: 'Status',
                        render: (_: unknown, row) => (row.enabled ? <Tag color="green">Active</Tag> : <Tag>Paused</Tag>)
                      },
                      {
                        title: 'Last run',
                        render: (_: unknown, row) =>
                          row.lastRunAt ? (
                            <Space direction="vertical" size={0}>
                              <Text>{formatRelativeTime(row.lastRunAt)}</Text>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {formatCompactDateTime(row.lastRunAt)}
                              </Text>
                            </Space>
                          ) : (
                            <Text type="secondary">Never</Text>
                          )
                      },
                      {
                        title: 'Next run',
                        render: (_: unknown, row) =>
                          row.enabled ? (
                            formatScheduleNextRun(row).overdue ? (
                              <Space direction="vertical" size={0}>
                                <Text>{formatScheduleNextRun(row).primary}</Text>
                                <Tag color="orange" style={{ width: 'fit-content', marginTop: 2 }}>
                                  Overdue
                                </Tag>
                              </Space>
                            ) : (
                              <Space direction="vertical" size={0}>
                                <Text>{formatScheduleNextRun(row).primary}</Text>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {formatScheduleNextRun(row).secondary}
                                </Text>
                              </Space>
                            )
                          ) : (
                            <Text type="secondary">Paused</Text>
                          )
                      },
                      {
                        title: 'Actions',
                        render: (_: unknown, row) => (
                          <Space onClick={(event) => event.stopPropagation()} size={8}>
                            <Button size="small" onClick={() => void runScheduleNow(row)}>
                              Run now
                            </Button>
                            <Button size="small" onClick={() => navigate(`/schedules/${row.id}/history`)}>
                              History
                            </Button>
                            <Button size="small" onClick={() => openScheduleEdit(row)}>
                              Edit
                            </Button>
                            <Dropdown
                              trigger={['click']}
                              menu={{
                                items: [
                                  { key: 'toggle', label: row.enabled ? 'Pause' : 'Resume' },
                                  { type: 'divider' },
                                  { key: 'delete', label: 'Delete', danger: true }
                                ],
                                onClick: ({ key, domEvent }) => {
                                  domEvent.stopPropagation();
                                  if (key === 'toggle') {
                                    void toggleSchedule(row);
                                  }
                                  if (key === 'delete') {
                                    confirmModal.confirm({
                                      title: 'Delete schedule?',
                                      content: `This will remove "${row.name}" and stop automatic runs.`,
                                      okText: 'Delete',
                                      okButtonProps: { danger: true },
                                      centered: true,
                                      onOk: async () => {
                                        await deleteExistingSchedule(row.id);
                                      }
                                    });
                                  }
                                }
                              }}
                            >
                              <Button size="small" icon={<EllipsisOutlined />} />
                            </Dropdown>
                          </Space>
                        )
                      }
                    ]}
                  />
                )}
              </Card>
            </Col>
          )}

          {activeTab === 'environments' && (
            <Col span={24}>
              <Card
                style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
                title="Environments"
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={openEnvironmentCreate}>New Environment</Button>}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginBottom: 16 }}>
                  <Text type="secondary">Manage variable sets used in check URLs and steps.</Text>
                  <Text type="secondary">Use variables in checks as {'{{BASE_URL}}'}, {'{{USERNAME}}'}, or {'{{PASSWORD}}'}.</Text>
                </div>

                {environments.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <Text strong>No environments yet</Text>
                        <Text type="secondary">Create an environment to reuse variables like {'{{BASE_URL}}'} across checks.</Text>
                      </div>
                    }
                  >
                    <Button type="primary" onClick={openEnvironmentCreate}>
                      New Environment
                    </Button>
                  </Empty>
                ) : (
                  <Table<Environment & { usedByChecks: number }>
                    dataSource={environmentUsage}
                    rowKey="id"
                    loading={loading}
                    pagination={false}
                    rowClassName={() => 'clickable-row'}
                    onRow={(row) => ({ onClick: () => openEnvironmentEdit(row) })}
                    columns={[
                      {
                        title: 'Environment',
                        dataIndex: 'name',
                        render: (value: string, row) => (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            <Button type="link" style={{ padding: 0, textAlign: 'left', fontWeight: 600 }} onClick={() => openEnvironmentEdit(row)}>
                              {value}
                            </Button>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {Object.keys(row.variables).length} variables
                            </Text>
                          </div>
                        )
                      },
                      {
                        title: 'Variables',
                        render: (_: unknown, row) => <Tag color="purple">{Object.keys(row.variables).length}</Tag>
                      },
                      {
                        title: 'Used by checks',
                        render: (_: unknown, row) => <Tag color={row.usedByChecks > 0 ? 'blue' : 'default'}>{row.usedByChecks}</Tag>
                      },
                      {
                        title: 'Created',
                        dataIndex: 'createdAt',
                        render: (value: string) => formatDateOnly(value)
                      },
                      {
                        title: 'Actions',
                        render: (_: unknown, row) => (
                          <Space onClick={(event) => event.stopPropagation()} size={8}>
                            <Button size="small" onClick={() => openEnvironmentEdit(row)}>
                              Edit
                            </Button>
                            <Dropdown
                              trigger={['click']}
                              menu={{
                                items: [
                                  { key: 'duplicate', icon: <CopyOutlined />, label: 'Duplicate' },
                                  { type: 'divider' },
                                  { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true }
                                ],
                                onClick: ({ key, domEvent }) => {
                                  domEvent.stopPropagation();
                                  if (key === 'duplicate') {
                                    void duplicateEnvironment(row);
                                  }
                                  if (key === 'delete') {
                                    confirmModal.confirm({
                                      title: 'Delete environment?',
                                      content: `This will remove "${row.name}" and stop variable reuse.`,
                                      okText: 'Delete',
                                      okButtonProps: { danger: true },
                                      centered: true,
                                      onOk: async () => {
                                        await deleteEnvironment(row.id);
                                        message.success('Environment deleted');
                                        await load();
                                      }
                                    });
                                  }
                                }
                              }}
                            >
                              <Button size="small" icon={<EllipsisOutlined />} />
                            </Dropdown>
                          </Space>
                        )
                      }
                    ]}
                  />
                )}
              </Card>
            </Col>
          )}

          {activeTab === 'alerts' && (
            <Col span={24}>
              <Card
                style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
                title="Alerts"
                extra={
                  <Space>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openChannelCreate('telegram')}>
                      Add Telegram
                    </Button>
                    <Button icon={<PlusOutlined />} onClick={() => openChannelCreate('slack')}>
                      Add Slack
                    </Button>
                  </Space>
                }
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginBottom: 16 }}>
                  <Text type="secondary">Send failed and recovered check notifications to Telegram or Slack.</Text>
                </div>

                {channels.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <Text strong>No alert channels configured</Text>
                        <Text type="secondary">Send failed and recovered browser check notifications to Telegram or Slack.</Text>
                      </div>
                    }
                  >
                    <Space wrap>
                      <Button type="primary" onClick={() => openChannelCreate('telegram')}>
                        Add Telegram
                      </Button>
                      <Button onClick={() => openChannelCreate('slack')}>Add Slack</Button>
                    </Space>
                  </Empty>
                ) : (
                  <Table<NotificationChannel>
                    dataSource={channels}
                    rowKey="id"
                    loading={loading}
                    pagination={false}
                    rowClassName={() => 'clickable-row'}
                    onRow={(row) => ({ onClick: () => openChannelEdit(row) })}
                    columns={[
                      {
                        title: 'Alert',
                        dataIndex: 'name',
                        render: (value: string, row) => (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            <Button type="link" style={{ padding: 0, textAlign: 'left', fontWeight: 600 }} onClick={() => openChannelEdit(row)}>
                              {value}
                            </Button>
                          </div>
                        )
                      },
                      {
                        title: 'Type',
                        dataIndex: 'type',
                        render: (value: string) => <Tag color={value === 'telegram' ? 'blue' : 'gold'}>{value}</Tag>
                      },
                      {
                        title: 'Rules',
                        render: (_: unknown, row) => (
                          <Space wrap>
                            {formatAlertRules(row).map((rule) => (
                              <Tag key={rule} color="purple">
                                {rule}
                              </Tag>
                            ))}
                          </Space>
                        )
                      },
                      {
                        title: 'Status',
                        render: (_: unknown, row) => (row.enabled ? <Tag color="green">Active</Tag> : <Tag color="default">Paused</Tag>)
                      },
                      {
                        title: 'Last test',
                        render: (_: unknown, row) =>
                          row.lastTestAt ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                              <Text>{formatRelativeTime(row.lastTestAt)}</Text>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {formatCompactDateTime(row.lastTestAt)}
                              </Text>
                            </div>
                        ) : (
                          <Text type="secondary">Never</Text>
                        )
                      },
                      {
                        title: 'Actions',
                        render: (_: unknown, row) => (
                          <Space onClick={(event) => event.stopPropagation()} size={8}>
                            <Button size="small" onClick={() => openChannelEdit(row)}>
                              Edit
                            </Button>
                            <Button size="small" onClick={() => void testExistingChannel(row)}>
                              Send test
                            </Button>
                            <Dropdown
                              trigger={['click']}
                              menu={{
                                items: [
                                  { key: 'toggle', label: row.enabled ? 'Pause' : 'Activate' },
                                  { key: 'delete', label: 'Delete', danger: true }
                                ],
                                onClick: ({ key, domEvent }) => {
                                  domEvent.stopPropagation();
                                  if (key === 'toggle') {
                                    void toggleChannelEnabled(row);
                                  }
                                  if (key === 'delete') {
                                    confirmModal.confirm({
                                      title: 'Delete alert channel?',
                                      content: `This will remove "${row.name}".`,
                                      okText: 'Delete',
                                      okButtonProps: { danger: true },
                                      centered: true,
                                      onOk: async () => {
                                        await deleteExistingChannel(row.id);
                                      }
                                    });
                                  }
                                }
                              }}
                            >
                              <Button size="small" icon={<EllipsisOutlined />} />
                            </Dropdown>
                          </Space>
                        )
                      }
                    ]}
                  />
                )}
              </Card>
            </Col>
          )}

          {activeTab === 'settings' && (
            <Col span={24}>
              <Space direction="vertical" size={24} style={{ width: '100%' }}>
                <Row gutter={[24, 24]}>
                  <Col xs={24} xl={14}>
                    <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }} title="Project settings">
                      <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Row gutter={[16, 16]}>
                          <Col xs={24} md={12}>
                            <div>
                              <Text type="secondary">Project name</Text>
                              <Input
                                value={projectName}
                                onChange={(event) => {
                                  setProjectName(event.target.value);
                                  if (event.target.value.trim()) setProjectNameError(null);
                                }}
                                placeholder="Project name"
                                style={{ marginTop: 8 }}
                                status={projectNameError ? 'error' : undefined}
                              />
                              {projectNameError ? (
                                <Text type="danger" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
                                  {projectNameError}
                                </Text>
                              ) : null}
                            </div>
                          </Col>
                          <Col xs={24} md={12}>
                            <div>
                              <Text type="secondary">Default environment</Text>
                              <Select
                                value={environments.length === 0 ? '' : projectDefaultEnvironmentId}
                                onChange={(value) => setProjectDefaultEnvironmentId(value)}
                                disabled={environments.length === 0}
                                placeholder="No default environment"
                                style={{ marginTop: 8, width: '100%' }}
                                options={[
                                  { label: 'No default environment', value: '' },
                                  ...environments.map((environment) => ({ label: environment.name, value: environment.id }))
                                ]}
                              />
                            </div>
                          </Col>
                          <Col xs={24} md={12}>
                            <div>
                              <Text type="secondary">Description</Text>
                              <Input.TextArea
                                value={projectDescription}
                                onChange={(event) => {
                                  setProjectDescription(event.target.value);
                                  if (event.target.value.length <= 500) setProjectDescriptionError(null);
                                }}
                                placeholder="Describe what this project monitors"
                                autoSize={{ minRows: 3, maxRows: 4 }}
                                maxLength={500}
                                style={{ marginTop: 8 }}
                                status={projectDescriptionError ? 'error' : undefined}
                              />
                              <Space direction="vertical" size={4} style={{ width: '100%', marginTop: 6 }}>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  Optional. Up to 500 characters.
                                </Text>
                                {projectDescriptionError ? (
                                  <Text type="danger" style={{ fontSize: 12 }}>
                                    {projectDescriptionError}
                                  </Text>
                                ) : null}
                              </Space>
                            </div>
                          </Col>
                          <Col xs={24} md={12}>
                            <div>
                              <Text type="secondary">Default device</Text>
                              <Select
                                value={projectDefaultDevice}
                                onChange={(value) => setProjectDefaultDevice(value)}
                                style={{ marginTop: 8, width: '100%' }}
                                options={DEFAULT_DEVICE_OPTIONS.map((device) => ({ label: device, value: device }))}
                              />
                            </div>
                          </Col>
                        </Row>
                        <Space wrap>
                          <Button type="primary" loading={savingProject} onClick={() => void handleSaveProject()}>
                            Save changes
                          </Button>
                          <Button onClick={handleResetProjectSettings} disabled={!project}>
                            Reset
                          </Button>
                        </Space>
                      </Space>
                    </Card>
                  </Col>
                  <Col xs={24} xl={10}>
                    <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }} title="Metadata">
                      <Row gutter={[12, 12]}>
                        <Col span={24}>
                          <div
                            style={{
                              padding: '12px 14px',
                              border: '1px solid #f1f5f9',
                              borderRadius: 14,
                              background: '#fafcff'
                            }}
                          >
                            <Text type="secondary">Project ID</Text>
                            <Text code style={{ display: 'block', marginTop: 4, wordBreak: 'break-all' }}>
                              {project?.id ?? '—'}
                            </Text>
                          </div>
                        </Col>
                        <Col xs={24} sm={12}>
                          <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                            <Text type="secondary">Created</Text>
                            <Text style={{ display: 'block', marginTop: 4 }}>
                              {project ? formatDateTime(project.createdAt) : '—'}
                            </Text>
                          </div>
                        </Col>
                        <Col xs={24} sm={12}>
                          <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                            <Text type="secondary">Checks</Text>
                            <Text style={{ display: 'block', marginTop: 4 }}>{summary?.checksCount ?? 0}</Text>
                          </div>
                        </Col>
                        <Col xs={24} sm={12}>
                          <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                            <Text type="secondary">Runs</Text>
                            <Text style={{ display: 'block', marginTop: 4 }}>
                              {summary?.totalRuns30d ?? projectChecks.reduce((count, check) => count + check.runCount, 0) ?? 0}
                            </Text>
                          </div>
                        </Col>
                        <Col xs={24} sm={12}>
                          <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                            <Text type="secondary">Schedules</Text>
                            <Text style={{ display: 'block', marginTop: 4 }}>{summary?.activeSchedulesCount ?? 0}</Text>
                          </div>
                        </Col>
                        <Col xs={24} sm={12}>
                          <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                            <Text type="secondary">Environments</Text>
                            <Text style={{ display: 'block', marginTop: 4 }}>{environments.length}</Text>
                          </div>
                        </Col>
                        <Col xs={24} sm={12}>
                          <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                            <Text type="secondary">Alert channels</Text>
                            <Text style={{ display: 'block', marginTop: 4 }}>{channels.length}</Text>
                          </div>
                        </Col>
                        <Col xs={24} sm={12}>
                          <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                            <Text type="secondary">Last run</Text>
                            <Text style={{ display: 'block', marginTop: 4 }}>
                              {summary?.lastRunAt ? formatCompactDateTime(summary.lastRunAt) : '—'}
                            </Text>
                          </div>
                        </Col>
                        <Col xs={24} sm={12}>
                          <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                            <Text type="secondary">Last result</Text>
                            <div style={{ marginTop: 4 }}>
                              {summary?.lastResult === 'PASSED' ? (
                                <Tag color="green">Passed</Tag>
                              ) : summary?.lastResult === 'FAILED' ? (
                                <Tag color="red">Failed</Tag>
                              ) : (
                                <Tag color="default">No runs</Tag>
                              )}
                            </div>
                          </div>
                        </Col>
                      </Row>
                    </Card>
                  </Col>
                </Row>
                <Card
                  style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)', borderColor: '#fecaca' }}
                  title="Danger zone"
                >
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <div>
                      <Text strong>Delete project</Text>
                      <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                        Permanently delete this project, checks, schedules, environments, alerts, run history, screenshots, and traces.
                      </Text>
                    </div>
                    <Button danger ghost onClick={openDeleteProjectModal}>
                      Delete project
                    </Button>
                  </Space>
                </Card>
              </Space>
            </Col>
          )}
        </Row>
      </Content>

      <Modal
        title="Select Environment"
        open={runCheckModalOpen}
        onOk={() => void handleConfirmCheckRun()}
        onCancel={() => setRunCheckModalOpen(false)}
        confirmLoading={checkRunLoading}
      >
        <Radio.Group
          style={{ display: 'grid', gap: 12, width: '100%' }}
          value={selectedEnvironmentId ?? ''}
          onChange={(event) => setSelectedEnvironmentId(event.target.value || undefined)}
        >
          <Radio value="">No environment (use values as-is)</Radio>
          {environments.map((environment) => (
            <Radio key={environment.id} value={environment.id}>
              {environment.name}
              <Tag style={{ marginLeft: 8 }}>{Object.keys(environment.variables).length} variables</Tag>
            </Radio>
          ))}
        </Radio.Group>
      </Modal>

      <Modal
        title="Run Suite"
        open={runSuiteModalOpen}
        onOk={() => void handleRunSuite()}
        onCancel={() => setRunSuiteModalOpen(false)}
        confirmLoading={runningSuite}
        okButtonProps={{ disabled: suites.length === 0 }}
      >
        {suites.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space direction="vertical" size={4}>
                <Text strong>No suites yet</Text>
                <Text type="secondary">Create a suite to run multiple browser checks together.</Text>
              </Space>
            }
          >
            <Button type="primary" onClick={() => navigate(`/projects/${projectId}/suites`)}>
              Create suite
            </Button>
          </Empty>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <div>
              <Text type="secondary">Suite</Text>
              <Radio.Group
                style={{ display: 'grid', gap: 12, width: '100%', marginTop: 8 }}
                value={selectedSuiteId}
                onChange={(event) => setSelectedSuiteId(event.target.value)}
              >
                {runSuiteItems.map((suite) => (
                  <Radio key={suite.value} value={suite.value}>
                    {suite.label}
                  </Radio>
                ))}
              </Radio.Group>
            </div>
            <div>
              <Text type="secondary">Environment</Text>
              <Radio.Group
                style={{ display: 'grid', gap: 12, width: '100%', marginTop: 8 }}
                value={selectedEnvironmentId ?? ''}
                onChange={(event) => setSelectedEnvironmentId(event.target.value || undefined)}
              >
                <Radio value="">No environment (use values as-is)</Radio>
                {environments.map((environment) => (
                  <Radio key={environment.id} value={environment.id}>
                    {environment.name}
                    <Tag style={{ marginLeft: 8 }}>{Object.keys(environment.variables).length} variables</Tag>
                  </Radio>
                ))}
              </Radio.Group>
            </div>
          </Space>
        )}
      </Modal>

      <Modal
        title={environmentMode === 'edit' ? `Edit Environment: ${editingEnvironment?.name ?? ''}` : 'New Environment'}
        open={environmentModalOpen}
        onOk={() => void saveEnvironment()}
        onCancel={() => setEnvironmentModalOpen(false)}
        confirmLoading={environmentSaving}
        width={920}
        centered
        style={{ top: 24 }}
        styles={{
          body: { maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }
        }}
        okText={environmentMode === 'edit' ? 'Save changes' : 'Create environment'}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Text type="secondary">Environment name</Text>
            <Input
              value={environmentName}
              onChange={(event) => setEnvironmentName(event.target.value)}
              placeholder="Dev"
              style={{ marginTop: 8 }}
            />
          </div>

          <div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '240px minmax(0, 1fr) 112px',
                gap: 12,
                padding: '0 4px',
                marginBottom: 8
              }}
            >
              <Text type="secondary" style={{ fontSize: 12 }}>
                Variable name
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Value
              </Text>
              <Text type="secondary" style={{ fontSize: 12, textAlign: 'right' }}>
                Actions
              </Text>
            </div>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {environmentRows.map((row, index) => (
                <div
                  key={row.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '240px minmax(0, 1fr) 112px',
                    gap: 12,
                    alignItems: 'start'
                  }}
                >
                  <Input
                    value={row.key}
                    onChange={(event) =>
                      setEnvironmentRows((current) =>
                        current.map((item, idx) => (idx === index ? { ...item, key: event.target.value } : item))
                      )
                    }
                    placeholder="BASE_URL"
                    style={{ width: '100%' }}
                  />
                  {isSecretKey(row.key) ? (
                    <Input.Password
                      value={row.value}
                      onChange={(event) =>
                        setEnvironmentRows((current) =>
                          current.map((item, idx) => (idx === index ? { ...item, value: event.target.value } : item))
                        )
                      }
                      placeholder="https://dev.example.com"
                      style={{ width: '100%' }}
                    />
                  ) : (
                    <Input
                      value={row.value}
                      onChange={(event) =>
                        setEnvironmentRows((current) =>
                          current.map((item, idx) => (idx === index ? { ...item, value: event.target.value } : item))
                        )
                      }
                      placeholder="https://dev.example.com"
                      style={{ width: '100%' }}
                    />
                  )}
                  <Button
                    danger
                    onClick={() =>
                      setEnvironmentRows((current) => {
                        if (current.length === 1) return current;
                        return current.filter((_, idx) => idx !== index);
                      })
                    }
                    disabled={environmentRows.length === 1}
                    style={{ justifySelf: 'end' }}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <div style={{ display: 'grid', gap: 8 }}>
                <Button type="dashed" block onClick={() => setEnvironmentRows((current) => [...current, createEnvRow()])}>
                  Add variable
                </Button>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Use variables in checks as {'{{BASE_URL}}'}, {'{{USERNAME}}'}, or {'{{PASSWORD}}'}.
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Variable names should use uppercase letters, numbers, and underscores.
                </Text>
              </div>
            </Space>
          </div>
        </Space>
      </Modal>

      <Modal
        title={
          channelMode === 'edit'
            ? channelType === 'telegram'
              ? 'Edit Telegram alert'
              : 'Edit Slack alert'
            : channelType === 'telegram'
              ? 'Add Telegram alert'
              : 'Add Slack alert'
        }
        open={channelModalOpen}
        onCancel={() => setChannelModalOpen(false)}
        confirmLoading={channelSaving}
        width={760}
        centered
        style={{ top: 24 }}
        styles={{
          body: { maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }
        }}
        footer={
          <Space wrap style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setChannelModalOpen(false)}>Cancel</Button>
            <Button onClick={() => void sendChannelDraftTest()} loading={channelTesting} disabled={!channelDraftReadyForTest || channelTesting}>
              Send test notification
            </Button>
            <Button type="primary" onClick={() => void saveChannel()} loading={channelSaving}>
              {channelMode === 'edit' ? 'Save changes' : 'Create alert'}
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Text type="secondary">Alert name</Text>
            <Input
              value={channelForm.name}
              onChange={(event) => setChannelForm((current) => ({ ...current, name: event.target.value }))}
              placeholder={channelType === 'telegram' ? 'Dev alerts' : 'Production alerts'}
              style={{ marginTop: 8 }}
            />
          </div>

          {channelType === 'telegram' ? (
            <Row gutter={16}>
              <Col span={12}>
                <div>
                  <Text type="secondary">Bot token</Text>
                  <Input.Password
                    value={channelForm.botToken}
                    onChange={(event) => setChannelForm((current) => ({ ...current, botToken: event.target.value }))}
                    placeholder="123456789:AA..."
                    autoComplete="new-password"
                    style={{ marginTop: 8 }}
                  />
                </div>
              </Col>
              <Col span={12}>
                <div>
                  <Text type="secondary">Chat ID</Text>
                  <Input
                    value={channelForm.chatId}
                    onChange={(event) => setChannelForm((current) => ({ ...current, chatId: event.target.value }))}
                    placeholder="-1001234567890"
                    style={{ marginTop: 8 }}
                  />
                  <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                    Add the bot to your Telegram chat or channel, then paste the chat ID here.
                  </Text>
                </div>
              </Col>
            </Row>
          ) : (
            <div>
              <Text type="secondary">Webhook URL</Text>
              {channelMode === 'edit' ? (
                <Input.Password
                  value={channelForm.webhookUrl}
                  onChange={(event) => setChannelForm((current) => ({ ...current, webhookUrl: event.target.value }))}
                  placeholder="Replace webhook URL"
                  autoComplete="new-password"
                  style={{ marginTop: 8 }}
                />
              ) : (
                <Input
                  value={channelForm.webhookUrl}
                  onChange={(event) => setChannelForm((current) => ({ ...current, webhookUrl: event.target.value }))}
                  placeholder="https://hooks.slack.com/services/..."
                  autoComplete="off"
                  style={{ marginTop: 8 }}
                />
              )}
              <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                Paste an incoming webhook URL from your Slack workspace.
              </Text>
            </div>
          )}

          <div style={{ display: 'grid', gap: 12 }}>
            <Text strong>Notification rules</Text>
            {channelRuleDescriptions().map((rule) => {
              const key = rule.key;
              return (
                <div key={rule.key} style={{ display: 'grid', gap: 4 }}>
                  <Checkbox
                    checked={channelForm[key]}
                    onChange={(event) => setChannelForm((current) => ({ ...current, [key]: event.target.checked }))}
                  >
                    {rule.label}
                  </Checkbox>
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 24 }}>
                    {rule.helper}
                  </Text>
                </div>
              );
            })}
          </div>

          {channelTestFeedback ? (
            <Alert
              type={channelTestFeedback.type}
              showIcon
              message={channelTestFeedback.text}
            />
          ) : null}
        </Space>
      </Modal>

      <Modal
        title={scheduleMode === 'edit' ? `Edit Schedule: ${editingSchedule?.name ?? ''}` : 'New Schedule'}
        open={scheduleModalOpen}
        onOk={() => void saveSchedule()}
        onCancel={() => setScheduleModalOpen(false)}
        confirmLoading={scheduleSaving}
        width={760}
        centered
        style={{ top: 24 }}
        styles={{
          body: { maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }
        }}
        okText={scheduleMode === 'edit' ? 'Save changes' : 'Create schedule'}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Text type="secondary">Schedule name</Text>
            <Input
              value={scheduleForm.name}
              onChange={(event) => setScheduleForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Nightly smoke"
              style={{ marginTop: 8 }}
            />
          </div>

          <div>
            <Text type="secondary">Cron preset</Text>
            <Select
              value={scheduleForm.cronPreset}
              onChange={(value) =>
                setScheduleForm((current) => ({
                  ...current,
                  cronPreset: value,
                  customCron: value === 'custom' ? current.customCron : value
                }))
              }
              style={{ width: '100%', marginTop: 8 }}
              options={CRON_PRESETS}
            />
            <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: '#fafafa', border: '1px solid #f0f0f0' }}>
              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                Cron expression
              </Text>
              <Text strong style={{ display: 'block', fontFamily: 'monospace' }}>
                {scheduleFormCron || '—'}
              </Text>
              <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                Schedule preview
              </Text>
              <Text style={{ display: 'block', marginTop: 2 }}>
                {describeCron(scheduleFormCron)} {scheduleFormCron ? APP_TIMEZONE : ''}
              </Text>
            </div>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                Timezone
              </Text>
              <Text style={{ display: 'block', marginTop: 2 }}>{APP_TIMEZONE}</Text>
            </div>
            {scheduleForm.cronPreset === 'custom' && (
              <Input
                value={scheduleForm.customCron}
                onChange={(event) => setScheduleForm((current) => ({ ...current, customCron: event.target.value }))}
                placeholder="0 9 * * *"
                style={{ marginTop: 8 }}
              />
            )}
          </div>

          <div>
            <Text type="secondary">Target</Text>
            <Radio.Group
              style={{ display: 'flex', gap: 12, marginTop: 8 }}
              value={scheduleForm.targetType}
              onChange={(event) =>
                setScheduleForm((current) => ({
                  ...current,
                  targetType: event.target.value,
                  suiteId: event.target.value === 'suite' ? current.suiteId ?? suites[0]?.id : undefined,
                  testId: event.target.value === 'test' ? current.testId ?? projectChecks[0]?.id : undefined
                }))
              }
            >
              <Radio value="suite">Suite</Radio>
              <Radio value="test">Check</Radio>
            </Radio.Group>
          </div>

          {scheduleForm.targetType === 'suite' ? (
            <div>
              <Text type="secondary">Suite</Text>
              <Select
                value={scheduleForm.suiteId}
                onChange={(value) => setScheduleForm((current) => ({ ...current, suiteId: value }))}
                style={{ width: '100%', marginTop: 8 }}
                placeholder="Select a suite"
                options={suites.map((suite) => ({ value: suite.id, label: `${suite.name} • ${suite.testIds.length} checks` }))}
              />
            </div>
          ) : (
            <div>
              <Text type="secondary">Check</Text>
              <Select
                value={scheduleForm.testId}
                onChange={(value) => setScheduleForm((current) => ({ ...current, testId: value }))}
                style={{ width: '100%', marginTop: 8 }}
                placeholder="Select a check"
                options={projectChecks.map((check) => ({ value: check.id, label: check.name }))}
              />
            </div>
          )}

          <div>
            <Text type="secondary">Environment</Text>
            <Select
              allowClear
              value={scheduleForm.environmentId}
              onChange={(value) => setScheduleForm((current) => ({ ...current, environmentId: value }))}
              style={{ width: '100%', marginTop: 8 }}
              placeholder="No environment"
              options={environments.map((environment) => ({
                value: environment.id,
                label: `${environment.name} • ${Object.keys(environment.variables).length} variables`
              }))}
            />
            {scheduleFormNeedsEnvironment && (
              <Alert
                style={{ marginTop: 12 }}
                type="warning"
                showIcon
                message="No environment selected"
                description="Checks using variables like {{BASE_URL}} may fail."
              />
            )}
          </div>

          <div>
            <Text type="secondary">Status</Text>
              <Radio.Group
                style={{ display: 'flex', gap: 12, marginTop: 8 }}
                value={scheduleForm.enabled ? 'active' : 'paused'}
                onChange={(event) =>
                  setScheduleForm((current) => ({ ...current, enabled: event.target.value === 'active' }))
                }
              >
                <Radio value="active">Active</Radio>
                <Radio value="paused">Paused</Radio>
              </Radio.Group>
            </div>
        </Space>
      </Modal>

      <Modal
        title="Delete project?"
        open={deleteProjectModalOpen}
        onCancel={() => setDeleteProjectModalOpen(false)}
        centered
        confirmLoading={deletingProject}
        footer={
          <Space wrap style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setDeleteProjectModalOpen(false)} disabled={deletingProject}>
              Cancel
            </Button>
            <Button
              danger
              onClick={() => void handleDeleteProject()}
              loading={deletingProject}
              disabled={!deleteProjectReady || deletingProject}
            >
              Delete project
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Text type="secondary">
            This action cannot be undone. It will permanently delete this project and all related data:
            {' '}
            checks, schedules, environments, alert channels, run history, screenshots, and traces.
          </Text>
          <div>
            <Text type="secondary">Type project name to confirm</Text>
            <Input
              value={deleteProjectConfirmText}
              onChange={(event) => setDeleteProjectConfirmText(event.target.value)}
              placeholder={project?.name ?? 'Project name'}
              style={{ marginTop: 8 }}
            />
            <Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
              Type &quot;{project?.name ?? 'project'}&quot; to enable deletion.
            </Text>
          </div>
        </Space>
      </Modal>
    </Layout>
  );
}
