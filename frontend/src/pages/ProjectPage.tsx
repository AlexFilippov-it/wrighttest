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
  Tooltip,
  Typography,
  Upload,
  message
} from 'antd';
import {
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
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
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  api,
  createTest,
  createChannel,
  createEnvironment,
  createSchedule,
  configureProjectAuthProfile,
  deleteTest,
  deleteProject,
  deleteChannel,
  deleteEnvironment,
  deleteSchedule,
  addProjectMember,
  deleteProjectMember,
  deleteProjectAuthProfile,
  getChannels,
  getEnvironments,
  getProject,
  getProjectMembers,
  getProjectAuthProfiles,
  getSchedules,
  getSuites,
  checkUserExists,
  importTestSpec,
  runSuite,
  runAllEnabledTestCases,
  runTestWithEnvironment,
  testChannel,
  testChannelDraft,
  updateChannel,
  updateEnvironment,
  updateSchedule,
  updateProject,
  updateProjectMember,
  refreshProjectAuthentication
} from '../api/client';
import AppHeader from '../components/AppHeader';
import AppFooter from '../components/AppFooter';
import RunStatusBadge from '../components/RunStatusBadge';
import { EmptyState, ErrorState, PageHeader, StatCard } from '../design-system';
import { useProjectShell } from '../shell/ProjectShellContext';
import {
  clearProjectSettingsDraft,
  getProjectDefaultDeviceOptions,
  readProjectSettingsDraft,
  writeProjectSettingsDraft
} from '../utils/projectSettings';
import type {
  Environment,
  NotificationChannel,
  ProjectMember,
  ProjectAuthProfile,
  ProjectCheck,
  ProjectWorkspace,
  ProjectRole,
  RunStatus,
  Schedule,
  Suite
} from '../types';

const { Content } = Layout;
const { Title, Text } = Typography;
const APP_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

type ProjectTabKey = 'overview' | 'checks' | 'suites' | 'runs' | 'schedules' | 'environments' | 'authentication' | 'alerts' | 'settings' | 'members';
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
  { labelKey: 'project.everyHour', value: '0 * * * *' },
  { labelKey: 'project.everyDay9am', value: '0 9 * * *' },
  { labelKey: 'project.everyDay2am', value: '0 2 * * *' },
  { labelKey: 'project.everyMonday', value: '0 9 * * 1' },
  { labelKey: 'project.customCron', value: 'custom' }
];

const DEFAULT_DEVICE_OPTIONS = getProjectDefaultDeviceOptions();

function formatCreatedLabel(value: string) {
  return `Created ${new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })}`;
}

function formatShortTimestamp(value: string, locale?: string) {
  return new Date(value).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatRelativeTime(value: string | null, t: TFunction, locale: string) {
  if (!value) return t('common.never');

  const diffMs = Date.now() - new Date(value).getTime();
  if (diffMs < 60_000) return t('time.justNow');

  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 60) return t('time.minutesAgo', { count: diffMinutes });

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return t('time.hoursAgo', { count: diffHours });

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return t('time.daysAgo', { count: diffDays });

  return new Date(value).toLocaleDateString(locale);
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

function formatCompactDateTime(value: string | null | undefined, locale?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDateOnly(value: string | null | undefined, locale?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function formatDateTime(value: string | null | undefined, locale?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function isPotentialEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
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

function validateEnvironmentRows(name: string, rows: EnvironmentRowState[], t: TFunction) {
  if (!name.trim()) return t('environments.nameRequired');

  const seen = new Set<string>();
  for (const row of rows) {
    if (isEmptyEnvRow(row)) continue;

    const key = row.key.trim();
    const value = row.value.trim();
    if (!key) return t('environments.variableNameRequired');
    if (!value) return t('environments.variableValueRequired');
    if (!/^[A-Z0-9_]+$/.test(key)) return t('environments.variableNameFormat');
    if (seen.has(key)) return t('environments.variableNameUnique', { name: key });
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

function formatAlertRules(channel: NotificationChannel, t: (key: string) => string) {
  const rules: string[] = [];
  if (channel.onFailed) rules.push(t('alerts.failed'));
  if (channel.onRecovered) rules.push(t('alerts.recovered'));
  if (channel.onPassed) rules.push(t('alerts.passed'));
  if (rules.length === 0) rules.push(t('alerts.noRules'));
  return rules;
}

function channelRuleDescriptions(t: TFunction) {
  return [
    {
      key: 'onFailed' as ChannelRuleKey,
      label: t('alerts.failedRuns'),
      helper: t('alerts.failedRunsHelp')
    },
    {
      key: 'onRecovered' as ChannelRuleKey,
      label: t('alerts.recoveredRuns'),
      helper: t('alerts.recoveredRunsHelp')
    },
    {
      key: 'onPassed' as ChannelRuleKey,
      label: t('alerts.passedRuns'),
      helper: t('alerts.passedRunsHelp')
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

function getFirstEnabledDataCaseIndex(test?: ProjectCheck | null) {
  if (!test || test.testData.length === 0) return undefined;

  const index = test.testData.findIndex((dataCase) => dataCase.enabled);
  return index >= 0 ? index : null;
}

function getEnabledDataCaseCount(test?: ProjectCheck | null) {
  return test?.testData.filter((dataCase) => dataCase.enabled).length ?? 0;
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

const RECENT_RESULTS_GRID_COLUMNS = 'minmax(0, 1.4fr) minmax(85px, 0.9fr) minmax(0, 1.2fr) 76px';

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
  if (pathname.endsWith('/suites')) return 'suites';
  if (pathname.endsWith('/runs')) return 'runs';
  if (pathname.endsWith('/schedules')) return 'schedules';
  if (pathname.endsWith('/environments')) return 'environments';
  if (pathname.endsWith('/authentication')) return 'authentication';
  if (pathname.endsWith('/alerts') || pathname.endsWith('/notifications')) return 'alerts';
  if (pathname.endsWith('/settings')) return 'settings';
  if (pathname.endsWith('/members')) return 'members';
  return 'checks';
}

export default function ProjectPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { project: shellProject } = useProjectShell();
  const [confirmModal, confirmModalContextHolder] = Modal.useModal();

  const [project, setProject] = useState<ProjectWorkspace | null>(null);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const activeTab = resolveTabFromPathname(location.pathname);
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
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [authProfiles, setAuthProfiles] = useState<ProjectAuthProfile[]>([]);
  const [authEnvironmentId, setAuthEnvironmentId] = useState<string | undefined>(undefined);
  const [authCheckId, setAuthCheckId] = useState<string | undefined>(undefined);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authSaving, setAuthSaving] = useState(false);
  const [authRefreshing, setAuthRefreshing] = useState(false);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [memberSaving, setMemberSaving] = useState(false);
  const [memberLookupLoading, setMemberLookupLoading] = useState(false);
  const [memberUserExists, setMemberUserExists] = useState<boolean | null>(null);
  const [memberForm, setMemberForm] = useState<{ email: string; password: string; role: ProjectRole }>({
    email: '',
    password: '',
    role: 'VIEWER'
  });
  const settingsHydratedRef = useRef(false);
  const projectLoadRef = useRef<{ projectId: string; promise: Promise<void> } | null>(null);

  const summary = project?.summary;
  const hasRunHistory = Boolean(summary?.lastRunAt || summary?.totalRuns30d);
  const hasChecks = (project?.tests.length ?? 0) > 0;
  const currentUserRole = project?.currentUserRole ?? null;
  const isViewer = currentUserRole === 'VIEWER';
  const isEditor = currentUserRole === 'EDITOR';
  const isOwner = currentUserRole === 'OWNER';
  const canWriteProject = isOwner || isEditor;
  const canManageMembers = isOwner;
  const canManageSchedules = canWriteProject;
  const canManageEnvironments = canWriteProject;
  const isProtectedAdminMember = (member: ProjectMember) => Boolean(member.isSystemAdmin);

  function settledValue<T>(result: PromiseSettledResult<T>, fallback: T): T {
    return result.status === 'fulfilled' ? result.value : fallback;
  }

  const load = () => {
    if (!projectId) return Promise.resolve();
    if (projectLoadRef.current?.projectId === projectId) return projectLoadRef.current.promise;

    const promise = (async () => {
      setLoading(true);
      try {
        const projectData = shellProject.id === projectId ? shellProject : await getProject(projectId);
        const [suiteDataResult, environmentDataResult, scheduleDataResult, channelDataResult, memberDataResult, authProfilesResult] = await Promise.allSettled([
          getSuites(projectId),
          getEnvironments(projectId),
          getSchedules(projectId),
          getChannels(projectId),
          projectData.currentUserRole === 'OWNER' ? getProjectMembers(projectId) : Promise.resolve([]),
          getProjectAuthProfiles(projectId)
        ]);
        setProject(projectData);
        setProjectName(projectData.name);
        setSuites(settledValue(suiteDataResult, []));
        setEnvironments(settledValue(environmentDataResult, []));
        setSchedules(settledValue(scheduleDataResult, []));
        setChannels(settledValue(channelDataResult, []));
        setProjectMembers(settledValue(memberDataResult, []));
        setAuthProfiles(settledValue(authProfilesResult, []));
      } finally {
        setLoading(false);
      }
    })();

    projectLoadRef.current = { projectId, promise };
    void promise.then(
      () => { if (projectLoadRef.current?.promise === promise) projectLoadRef.current = null; },
      () => { if (projectLoadRef.current?.promise === promise) projectLoadRef.current = null; }
    );
    return promise;
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
    setProjectMembers([]);
    setAuthProfiles([]);
    setAuthEnvironmentId(undefined);
    setAuthCheckId(undefined);
    setAuthEnabled(false);
    setMemberModalOpen(false);
    setMemberLookupLoading(false);
    setMemberUserExists(null);
  }, [projectId]);

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

  const sectionDescriptions: Record<ProjectTabKey, string> = {
    overview: t('projectDescription.overview'),
    checks: t('projectDescription.checks'),
    suites: t('projectDescription.suites'),
    runs: t('projectDescription.runs'),
    schedules: t('projectDescription.schedules'),
    environments: t('projectDescription.environments'),
    authentication: t('projectDescription.authentication'),
    alerts: t('projectDescription.alerts'),
    settings: t('projectDescription.settings'),
    members: t('projectDescription.members')
  };
  const projectHeaderDescription = savedProjectDescription || sectionDescriptions[activeTab];

  const projectChecks = useMemo(() => project?.tests ?? [], [project]);
  const selectedAuthProfile = useMemo(
    () => authProfiles.find((profile) => profile.environmentId === authEnvironmentId) ?? null,
    [authEnvironmentId, authProfiles]
  );
  const selectedAuthCheck = useMemo(
    () => projectChecks.find((check) => check.id === authCheckId) ?? null,
    [authCheckId, projectChecks]
  );
  const selectedAuthCheckHasAssertions = Boolean(
    selectedAuthCheck?.steps.some((step) => step.action.startsWith('assert'))
  );
  const authDraftIsSaved = Boolean(
    selectedAuthProfile &&
    selectedAuthProfile.authCheckId === authCheckId &&
    selectedAuthProfile.enabled === authEnabled
  );
  const latestChecks = useMemo(() => {
    return [...projectChecks].sort((left, right) => {
      const leftDate = left.lastRunAt ? new Date(left.lastRunAt).getTime() : 0;
      const rightDate = right.lastRunAt ? new Date(right.lastRunAt).getTime() : 0;
      return rightDate - leftDate;
    });
  }, [projectChecks]);

  useEffect(() => {
    if (environments.length === 0) {
      setAuthEnvironmentId(undefined);
      return;
    }
    if (authEnvironmentId && environments.some((environment) => environment.id === authEnvironmentId)) {
      return;
    }
    setAuthEnvironmentId(projectDefaultEnvironmentId ?? environments[0].id);
  }, [authEnvironmentId, environments, projectDefaultEnvironmentId]);

  useEffect(() => {
    setAuthCheckId(selectedAuthProfile?.authCheckId);
    setAuthEnabled(selectedAuthProfile?.enabled ?? false);
  }, [authEnvironmentId, selectedAuthProfile]);

  useEffect(() => {
    if (!authProfiles.some((profile) => profile.status === 'REFRESHING')) return;

    let cancelled = false;
    const refreshProfiles = async () => {
      try {
        const nextProfiles = await getProjectAuthProfiles(projectId!);
        if (!cancelled) setAuthProfiles(nextProfiles);
      } catch {
        // Keep the current status visible; the next poll can recover.
      }
    };
    const timer = window.setInterval(() => void refreshProfiles(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authProfiles, projectId]);

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
      { label: t('project.setupChecksCreated'), done: (projectChecks.length ?? 0) > 0 },
      { label: t('project.setupEnvironmentConfigured'), done: environments.length > 0 },
      { label: t('project.setupScheduleConfigured'), done: schedules.some((schedule) => schedule.enabled) },
      { label: t('project.setupAlertConfigured'), done: channels.length > 0 }
    ],
    [channels.length, environments.length, projectChecks.length, schedules, t]
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
    if (!canManageEnvironments) {
    message.info(t('common.readOnly'));
      return;
    }
    setEnvironmentMode('create');
    setEditingEnvironment(null);
    setEnvironmentName('');
    setEnvironmentRows([createEnvRow()]);
    setEnvironmentModalOpen(true);
  };

  const openEnvironmentEdit = (environment: Environment) => {
    if (!canManageEnvironments) {
      message.info(t('common.readOnly'));
      return;
    }
    setEnvironmentMode('edit');
    setEditingEnvironment(environment);
    setEnvironmentName(environment.name);
    setEnvironmentRows(envRowsFromRecord(environment.variables));
    setEnvironmentModalOpen(true);
  };

  const saveEnvironment = async () => {
    if (!canManageEnvironments) {
      message.info(t('common.readOnly'));
      return;
    }
    const validationError = validateEnvironmentRows(environmentName, environmentRows, t);
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
        message.success(t('environments.updatedToast'));
      } else {
        await createEnvironment(projectId!, payload);
        message.success(t('environments.createdToast'));
      }
      setEnvironmentModalOpen(false);
      await load();
    } catch {
      message.error(t('environments.saveFailed'));
    } finally {
      setEnvironmentSaving(false);
    }
  };

  const duplicateEnvironment = async (environment: Environment) => {
    if (!canManageEnvironments) {
      message.info(t('common.readOnly'));
      return;
    }
    try {
      await createEnvironment(projectId!, {
        name: `${environment.name} Copy`,
        variables: environment.variables
      });
      message.success(t('environments.duplicatedToast'));
      await load();
    } catch {
      message.error(t('environments.duplicateFailed'));
    }
  };

  const openChannelCreate = (type: 'telegram' | 'slack') => {
    if (!canWriteProject) {
      message.info(t('common.readOnly'));
      return;
    }
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
    if (!canWriteProject) {
      message.info(t('common.readOnly'));
      return;
    }
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
    if (!canWriteProject) {
      message.info(t('common.readOnly'));
      return;
    }
    if (!channelForm.name.trim()) {
      message.error(t('alerts.nameRequired'));
      return;
    }

    if (channelType === 'telegram') {
      if (!channelForm.botToken.trim()) {
        message.error(t('alerts.botTokenRequired'));
        return;
      }
      if (!channelForm.chatId.trim()) {
        message.error(t('alerts.chatIdRequired'));
        return;
      }
    } else if (!channelForm.webhookUrl.trim()) {
      message.error(t('alerts.webhookRequired'));
      return;
    } else if (!channelForm.webhookUrl.trim().startsWith('https://hooks.slack.com/services/')) {
      message.error(t('alerts.webhookInvalid'));
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
        message.success(t('alerts.updated'));
      } else {
        await createChannel(projectId!, payload);
        message.success(t('alerts.created'));
      }

      setChannelModalOpen(false);
      await load();
    } catch {
      message.error(t('alerts.saveError'));
    } finally {
      setChannelSaving(false);
    }
  };

  const sendChannelDraftTest = async () => {
    if (!canWriteProject) {
      message.info(t('common.readOnly'));
      return;
    }
    setChannelTestFeedback(null);

    if (!channelForm.name.trim()) {
      setChannelTestFeedback({ type: 'error', text: t('alerts.nameRequired') });
      return;
    }

    if (channelType === 'telegram') {
      if (!channelForm.botToken.trim() || !channelForm.chatId.trim()) {
        setChannelTestFeedback({ type: 'error', text: t('alerts.telegramFieldsRequired') });
        return;
      }
    } else if (!channelForm.webhookUrl.trim()) {
      setChannelTestFeedback({ type: 'error', text: t('alerts.webhookRequired') });
      return;
    } else if (!channelForm.webhookUrl.trim().startsWith('https://hooks.slack.com/services/')) {
      setChannelTestFeedback({ type: 'error', text: t('alerts.webhookInvalid') });
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
      setChannelTestFeedback({ type: 'success', text: t('alerts.testSent') });
    } catch (error) {
      const apiError = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setChannelTestFeedback({
        type: 'error',
        text: typeof apiError === 'string' && apiError.trim().length > 0 ? apiError : t('alerts.testError')
      });
    } finally {
      setChannelTesting(false);
    }
  };

  const testExistingChannel = async (channel: NotificationChannel) => {
    if (!canWriteProject) {
      message.info(t('common.readOnly'));
      return;
    }
    try {
      await testChannel(channel.id);
      message.success(t('alerts.testSent'));
      await load();
    } catch {
      message.error(t('alerts.testError'));
    }
  };

  const deleteExistingChannel = async (channelId: string) => {
    if (!canWriteProject) {
      message.info(t('common.readOnly'));
      return;
    }
    await deleteChannel(channelId);
    message.success(t('alerts.deleted'));
    await load();
  };

  const toggleChannelEnabled = async (channel: NotificationChannel) => {
    if (!canWriteProject) {
      message.info(t('common.readOnly'));
      return;
    }
    try {
      await updateChannel(channel.id, { enabled: !channel.enabled });
    message.success(channel.enabled ? t('alerts.paused') : t('alerts.activated'));
      await load();
    } catch {
    message.error(t('alerts.statusError'));
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
    if (!canManageSchedules) {
      message.info(t('common.readOnly'));
      return;
    }
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
    if (!canManageSchedules) {
      message.info(t('common.readOnly'));
      return;
    }
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
    if (!canManageSchedules) {
      message.info(t('common.readOnly'));
      return;
    }
    if (!scheduleForm.name.trim()) {
      message.error(t('project.scheduleNameRequired'));
      return;
    }

    const cronValue = scheduleForm.cronPreset === 'custom' ? scheduleForm.customCron.trim() : scheduleForm.cronPreset;
    if (!cronValue) {
      message.error(t('project.cronRequired'));
      return;
    }

    const targetSuiteId = scheduleForm.targetType === 'suite' ? scheduleForm.suiteId : undefined;
    const targetTestId = scheduleForm.targetType === 'test' ? scheduleForm.testId : undefined;

    if (!targetSuiteId && !targetTestId) {
      message.error(t('project.selectScheduleTarget'));
      return;
    }

    if (scheduleFormNeedsEnvironment) {
      message.error(t('project.environmentRequiredForVariables'));
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
        message.success(t('project.scheduleUpdated'));
      } else {
        await createSchedule(projectId!, {
          name: payload.name,
          cron: payload.cron,
          suiteId: payload.suiteId ?? undefined,
          testId: payload.testId ?? undefined,
          environmentId: payload.environmentId ?? undefined,
          enabled: payload.enabled
        });
        message.success(t('project.scheduleCreated'));
      }

      setScheduleModalOpen(false);
      await load();
    } catch {
      message.error(t('project.scheduleSaveFailed'));
    } finally {
      setScheduleSaving(false);
    }
  };

  const runScheduleNow = async (schedule: Schedule) => {
    if (!canManageSchedules) {
      message.info(t('common.readOnly'));
      return;
    }
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
      message.success(t('project.scheduleRunStarted'));
    } catch {
      message.error(t('project.scheduleRunFailed'));
    }
  };

  const toggleSchedule = async (schedule: Schedule) => {
    if (!canManageSchedules) {
      message.info(t('common.readOnly'));
      return;
    }
    try {
      await updateSchedule(schedule.id, { enabled: !schedule.enabled });
      message.success(schedule.enabled ? t('project.schedulePaused') : t('project.scheduleResumed'));
      await load();
    } catch {
      message.error(t('project.scheduleUpdateFailed'));
    }
  };

  const deleteExistingSchedule = async (scheduleId: string) => {
    if (!canManageSchedules) {
      message.info(t('common.readOnly'));
      return;
    }
    await deleteSchedule(scheduleId);
    message.success(t('project.scheduleDeleted'));
    await load();
  };

  const duplicateCheckName = (name: string) => `${name} Copy`;

  const openCheck = (testId: string) => {
    navigate(`/tests/${testId}/edit`);
  };

  const handleRunCheck = async (testId: string, event?: MouseEvent) => {
    event?.stopPropagation();
    try {
      const check = project?.tests.find((test) => test.id === testId);
      const dataCaseIndex = getFirstEnabledDataCaseIndex(check);
      if (dataCaseIndex === null) {
        message.error(t('editor.noEnabledCases'));
        return;
      }
      const enabledDataCaseCount = getEnabledDataCaseCount(check);
      if (enabledDataCaseCount > 1 && environments.length === 0) {
        const result = await runAllEnabledTestCases(testId);
        message.success(t('project.testCasesQueued', { count: result.queued }));
        navigate(`/run-batches/${result.batchId}`);
        return;
      }

      if (environments.length === 0) {
        const { testRunId } = await runTestWithEnvironment(testId, undefined, dataCaseIndex);
        message.success(t('project.checkStarted'));
        navigate(`/runs/${testRunId}`);
        return;
      }

      setRunCheckId(testId);
      setSelectedEnvironmentId(undefined);
      setRunCheckModalOpen(true);
    } catch {
      message.error(t('project.checkStartFailed'));
    }
  };

  const handleConfirmCheckRun = async () => {
    if (!runCheckId) return;

    setCheckRunLoading(true);
    try {
      const check = project?.tests.find((test) => test.id === runCheckId);
      const dataCaseIndex = getFirstEnabledDataCaseIndex(check);
      if (dataCaseIndex === null) {
        message.error(t('editor.noEnabledCases'));
        return;
      }
      const enabledDataCaseCount = getEnabledDataCaseCount(check);
      if (enabledDataCaseCount > 1) {
        const result = await runAllEnabledTestCases(runCheckId, selectedEnvironmentId);
        setRunCheckModalOpen(false);
        message.success(t('project.testCasesQueued', { count: result.queued }));
        navigate(`/run-batches/${result.batchId}`);
        return;
      }

      const { testRunId } = await runTestWithEnvironment(runCheckId, selectedEnvironmentId, dataCaseIndex);
      setRunCheckModalOpen(false);
      message.success(t('project.checkStarted'));
      navigate(`/runs/${testRunId}`);
    } catch {
      message.error(t('project.checkStartFailed'));
    } finally {
      setCheckRunLoading(false);
    }
  };

  const handleDeleteCheck = async (testId: string) => {
    await deleteTest(testId);
    message.success(t('project.checkDeleted'));
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
      message.success(t('project.checkDuplicated'));
      navigate(`/tests/${created.id}/edit`);
    } catch {
      message.error(t('project.checkDuplicateFailed'));
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
      message.success(t('project.checkExported'));
    } catch {
      message.error(t('project.checkExportFailed'));
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
    if (!canWriteProject) {
      message.warning(t('project.readOnlyCannotRunSuites'));
      return;
    }
    setSelectedSuiteId(suites[0]?.id);
    setSelectedEnvironmentId(undefined);
    setRunSuiteModalOpen(true);
  };

  const handleRunSuite = async () => {
    if (!selectedSuiteId) {
      message.warning(t('project.createSuiteBeforeRun'));
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
      message.error(t('project.runSuiteFailed'));
    } finally {
      setRunningSuite(false);
    }
  };

  const replaceAuthProfile = (profile: ProjectAuthProfile) => {
    setAuthProfiles((current) => {
      const withoutCurrent = current.filter((item) => item.id !== profile.id);
      return [...withoutCurrent, profile];
    });
  };

  const handleSaveAuthentication = async () => {
    if (!project || !authEnvironmentId || !authCheckId) {
      message.error(t('authSettings.selectEnvironmentAndCheck'));
      return;
    }
    if (!canWriteProject) {
      message.warning(t('common.readOnly'));
      return;
    }

    setAuthSaving(true);
    try {
      const profile = await configureProjectAuthProfile(project.id, authEnvironmentId, {
        authCheckId,
        enabled: authEnabled
      });
      replaceAuthProfile(profile);
        message.success(t('authSettings.savedToast'));
    } catch {
      message.error(t('authSettings.saveFailed'));
    } finally {
      setAuthSaving(false);
    }
  };

  const handleRefreshAuthentication = async () => {
    if (!project || !authEnvironmentId || !selectedAuthProfile || !authDraftIsSaved) {
      message.warning(t('authSettings.saveBeforeRefresh'));
      return;
    }
    if (!selectedAuthCheckHasAssertions) {
      message.warning(t('authSettings.addAssertionFirst'));
      return;
    }

    setAuthRefreshing(true);
    try {
      const result = await refreshProjectAuthentication(project.id, authEnvironmentId);
      replaceAuthProfile({
        ...selectedAuthProfile,
        status: 'REFRESHING',
        lastError: null,
        updatedAt: new Date().toISOString()
      });
      message.success(t('authSettings.refreshStarted', { runId: result.testRunId }));
    } catch (error) {
      const responseError = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(
        typeof responseError === 'string' ? responseError : t('authSettings.refreshStartFailed')
      );
    } finally {
      setAuthRefreshing(false);
    }
  };

  const handleDeleteAuthentication = async () => {
    if (!project || !authEnvironmentId || !selectedAuthProfile) return;

    try {
      await deleteProjectAuthProfile(project.id, authEnvironmentId);
      setAuthProfiles((current) => current.filter((profile) => profile.id !== selectedAuthProfile.id));
      setAuthCheckId(undefined);
      setAuthEnabled(false);
      message.success(t('authSettings.removedToast'));
    } catch {
      message.error(t('authSettings.removeFailed'));
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
      setProjectNameError(t('projectSettings.nameRequired'));
      message.error(t('projectSettings.nameRequired'));
      return;
    }

    if (nextDescription.length > 500) {
      setProjectDescriptionError(t('projectSettings.descriptionTooLong'));
      message.error(t('projectSettings.descriptionTooLong'));
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
      message.success(t('projectSettings.savedToast'));
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
    message.info(t('projectSettings.resetToast'));
  };

  const openDeleteProjectModal = () => {
    if (!isOwner) {
      message.warning(t('projectSettings.ownerOnly'));
      return;
    }
    setDeleteProjectConfirmText('');
    setDeleteProjectModalOpen(true);
  };

  const handleDeleteProject = async () => {
    if (!project || deleteProjectConfirmText.trim() !== project.name.trim()) return;

    setDeletingProject(true);
    try {
      clearProjectSettingsDraft(project.id);
      await deleteProject(project.id);
      message.success(t('projectSettings.deletedToast'));
      setDeleteProjectModalOpen(false);
      navigate('/projects');
    } catch {
      message.error(t('projectSettings.deleteFailed'));
    } finally {
      setDeletingProject(false);
    }
  };

  const openMemberInvite = () => {
    setMemberForm({ email: '', password: '', role: 'VIEWER' });
    setMemberLookupLoading(false);
    setMemberUserExists(null);
    setMemberModalOpen(true);
  };

  useEffect(() => {
    if (!memberModalOpen) {
      setMemberLookupLoading(false);
      setMemberUserExists(null);
      return;
    }

    const email = memberForm.email.trim().toLowerCase();
    if (!isPotentialEmail(email)) {
      setMemberLookupLoading(false);
      setMemberUserExists(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setMemberLookupLoading(true);
      void checkUserExists(email)
        .then(({ exists }) => {
          if (cancelled) return;
          setMemberUserExists(exists);
          if (exists) {
            setMemberForm((current) => ({ ...current, password: '' }));
          }
        })
        .catch(() => {
          if (cancelled) return;
          setMemberUserExists(null);
        })
        .finally(() => {
          if (!cancelled) {
            setMemberLookupLoading(false);
          }
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [memberForm.email, memberModalOpen]);

  const handleCreateUserAccess = async () => {
    if (!project) return;
    if (!memberForm.email.trim()) {
      message.error(t('members.emailRequired'));
      return;
    }

    const email = memberForm.email.trim().toLowerCase();
    if (!isPotentialEmail(email)) {
      message.error(t('members.emailInvalid'));
      return;
    }

    let userExists = memberUserExists;
    if (userExists === null) {
      try {
        const result = await checkUserExists(email);
        userExists = result.exists;
        setMemberUserExists(result.exists);
        if (result.exists) {
          setMemberForm((current) => ({ ...current, password: '' }));
        }
      } catch {
        userExists = null;
      }
    }

    const password = memberForm.password.trim();
    if (userExists === false && !password) {
      message.error(t('members.passwordRequired'));
      return;
    }

    setMemberSaving(true);
    try {
      await addProjectMember(project.id, {
        email,
        password: userExists === true ? undefined : password,
        role: memberForm.role
      });
      message.success(t('members.createdToast'));
      setMemberModalOpen(false);
      await load();
    } catch (error) {
      const responseError =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
      const errorText =
        typeof responseError === 'string'
          ? responseError
          : t('members.createFailed');
      message.error(errorText);
    } finally {
      setMemberSaving(false);
    }
  };

  const handleChangeMemberRole = async (member: ProjectMember, role: ProjectRole) => {
    if (!project) return;
    try {
      await updateProjectMember(project.id, member.id, { role });
      message.success(t('members.roleUpdatedToast'));
      await load();
    } catch {
      message.error(t('members.roleUpdateFailed'));
    }
  };

  const handleRemoveMember = async (member: ProjectMember) => {
    if (!project) return;
    try {
      await deleteProjectMember(project.id, member.id);
      message.success(t('members.removedToast'));
      await load();
    } catch (error) {
      const responseError =
        error && typeof error === 'object' && 'response' in error
          ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
      message.error(typeof responseError === 'string' ? responseError : t('members.removeFailed'));
    }
  };

  const deleteProjectReady = Boolean(
    project && deleteProjectConfirmText.trim() === project.name.trim()
  );
  const authStatus = selectedAuthProfile?.status ?? 'UNAVAILABLE';
  const authStatusPresentation = selectedAuthProfile
    ? {
        UNAVAILABLE: { label: t('authSettings.unavailable'), color: 'default' },
        REFRESHING: { label: t('authSettings.refreshing'), color: 'processing' },
        AVAILABLE: { label: t('authSettings.available'), color: 'success' },
        REFRESH_FAILED: { label: t('authSettings.refreshFailed'), color: 'error' }
      }[authStatus]
    : { label: t('authSettings.notConfigured'), color: 'default' };

  const runSuiteItems = suites.map((suite) => ({
    value: suite.id,
    label: `${suite.name}${Array.isArray(suite.testIds) ? ` • ${suite.testIds.length} checks` : ''}`
  }));

  const sectionTitle = t(`project.${activeTab}`);
  const projectHeaderActions = (() => {
    if (!canWriteProject) return null;

    switch (activeTab) {
      case 'checks':
        return (
          <Space wrap>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate(`/projects/${projectId}/tests/new`)}>
              {t('project.newCheck')}
            </Button>
            <Upload
              accept=".ts,.js"
              showUploadList={false}
              disabled={!canWriteProject}
              beforeUpload={(file) => {
                void handleImport(file);
                return false;
              }}
            >
              <Button icon={<UploadOutlined />} loading={importing}>{t('project.importSpec')}</Button>
            </Upload>
            <Button icon={<PlayCircleOutlined />} onClick={openRunSuiteModal}>{t('project.runSuite')}</Button>
          </Space>
        );
      case 'runs':
        return <Button type="primary" icon={<PlayCircleOutlined />} onClick={openRunSuiteModal}>{t('project.runSuite')}</Button>;
      case 'schedules':
        return canManageSchedules ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={openScheduleCreate}>{t('project.newSchedule')}</Button>
        ) : null;
      case 'environments':
        return canManageEnvironments ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={openEnvironmentCreate}>{t('environments.new')}</Button>
        ) : null;
      case 'alerts':
        return (
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'telegram', label: t('alerts.addTelegram') },
                { key: 'slack', label: t('alerts.addSlack') }
              ],
              onClick: ({ key }) => openChannelCreate(key === 'slack' ? 'slack' : 'telegram')
            }}
          >
            <Button type="primary" icon={<PlusOutlined />}>{t('alerts.addChannel')} <DownOutlined /></Button>
          </Dropdown>
        );
      case 'members':
        return canManageMembers ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={openMemberInvite}>{t('members.createAccess')}</Button>
        ) : null;
      default:
        return null;
    }
  })();

  const checkColumns = [
    {
      title: t('project.check'),
      dataIndex: 'name',
      width: 280,
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
            {row.url} · {t('project.stepCount', { count: row.steps.length })} · {t('project.runCount', { count: row.runCount })}
          </Text>
        </div>
      )
    },
    {
      title: t('project.status'),
      width: 110,
      render: (_: unknown, row: ProjectCheck) =>
        row.lastRunStatus ? <RunStatusBadge status={row.lastRunStatus} /> : <Tag color="default">{t('project.neverRun')}</Tag>
    },
    {
      title: t('project.lastRun'),
      width: 160,
      responsive: ['lg'] as const,
      render: (_: unknown, row: ProjectCheck) =>
        row.lastRunAt ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <Text>{formatRelativeTime(row.lastRunAt, t, locale)}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatDurationLabel(row.lastRunDurationMs)} · {formatShortTimestamp(row.lastRunAt, locale)}
            </Text>
          </div>
        ) : (
          <Text type="secondary">{t('project.never')}</Text>
        )
    },
    {
      title: t('project.schedule'),
      width: 130,
      responsive: ['xl'] as const,
      render: (_: unknown, row: ProjectCheck) => <Tag color="purple">{formatScheduleSummary(row, schedules)}</Tag>
    },
    {
      title: t('project.device'),
      width: 120,
      responsive: ['xl'] as const,
      render: (_: unknown, row: ProjectCheck) =>
        row.device ? (
          <Tag icon={<MobileOutlined />} color="blue">
            {row.device}
          </Tag>
        ) : (
          <Tag>{t('project.desktop')}</Tag>
        )
    },
    {
      title: t('project.runsCount'),
      width: 70,
      responsive: ['xl'] as const,
      render: (_: unknown, row: ProjectCheck) => <Tag>{row.runCount}</Tag>
    },
    {
      title: t('project.actions'),
      width: 170,
      fixed: 'right' as const,
      render: (_: unknown, row: ProjectCheck) => (
        <Space onClick={(event) => event.stopPropagation()} size={8}>
          {canWriteProject ? (
            <Button size="small" type="primary" onClick={(event) => void handleRunCheck(row.id, event)}>
              {t('project.run')}
            </Button>
          ) : null}
          <Button size="small" onClick={() => openCheck(row.id)}>
            {t('project.open')}
          </Button>
          {canWriteProject ? (
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'edit', icon: <EditOutlined />, label: t('project.edit') },
                  { key: 'duplicate', icon: <CopyOutlined />, label: t('project.duplicate') },
                  { key: 'export', icon: <ExportOutlined />, label: t('project.exportSpec') },
                  { type: 'divider' },
                  { key: 'delete', icon: <DeleteOutlined />, label: t('project.delete'), danger: true }
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
                      title: t('project.deleteCheckTitle'),
                      content: t('project.deleteCheckDescription', { name: row.name }),
                      okText: t('project.delete'),
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
          ) : null}
        </Space>
      )
    }
  ];

  return (
    <Layout style={{ minHeight: 'auto', background: 'transparent' }}>
      {confirmModalContextHolder}
      <AppHeader />
      <Content className="wt-surface-page" style={{ width: '100%', minWidth: 0 }}>
        <Row gutter={[24, 24]}>
          <Col span={24}>
            <PageHeader
              title={sectionTitle}
              description={projectHeaderDescription}
              breadcrumbs={[
                { key: 'projects', label: t('nav.projects'), href: '/projects' },
                { key: 'project', label: project?.name ?? shellProject.name, href: `/projects/${projectId}/checks` },
                { key: 'section', label: sectionTitle }
              ]}
              actions={projectHeaderActions}
            />
            {isViewer ? (
              <Alert
                type="info"
                showIcon
                message={t('common.readOnly')}
                description={t('projectDescription.readOnly')}
                style={{ marginTop: 16 }}
              />
            ) : null}
            {project && activeTab === 'overview' ? <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>{t('projects.projectCreatedDate', { date: new Date(project.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) })}</Text> : null}
          </Col>

          {activeTab === 'overview' && <Col span={24}>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} lg={8}><StatCard title={t('project.checksTitle')} value={summary?.checksCount ?? 0} description={t('project.checksCount')} /></Col>
              <Col xs={24} sm={12} lg={8}><StatCard title={t('project.lastResult')} value={summary?.lastResult ? <RunStatusBadge status={summary.lastResult} /> : t('common.noRunsYet')} description={summary?.lastRunAt ? formatRelativeTime(summary.lastRunAt, t, locale) : t('projects.notEvaluated')} /></Col>
              <Col xs={24} sm={12} lg={8}><StatCard title={t('project.passRate')} value={summary?.passRate30d == null ? '—' : `${summary.passRate30d}%`} description={summary?.totalRuns30d ? t('project.passRateDetail', { passed: summary.passedRuns30d, total: summary.totalRuns30d }) : summary?.lastRunAt ? t('dashboard.noRecentRunsInPeriod') : t('project.noRunsYet')} /></Col>
              <Col xs={24} sm={12} lg={8}><StatCard title={t('project.activeSchedules')} value={summary?.activeSchedulesCount ?? 0} description={t('project.projectSchedules')} /></Col>
              <Col xs={24} sm={12} lg={8}><StatCard title={t('project.alertChannels')} value={summary?.alertChannelsCount ?? 0} description={t('project.telegramSlack')} /></Col>
              <Col xs={24} sm={12} lg={8}><StatCard title={t('project.avgDuration')} value={summary?.avgDurationMs != null ? formatDuration(summary.avgDurationMs) : '—'} description={!hasRunHistory ? t('project.notEvaluated') : summary?.failedChecks ? t('project.failingChecks', { count: summary.failedChecks }) : t('project.acrossRecentRuns')} /></Col>
            </Row>
          </Col>}

          {activeTab === 'overview' && (
            <Col span={24}>
              <Row gutter={[24, 24]}>
                <Col xs={24} xxl={14}>
                  <Card
                    style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
                    title={t('project.recentResults')}
                    extra={summary?.totalRuns30d ? <Tag color="blue">{t('project.runsInDays', { count: summary.totalRuns30d })}</Tag> : <Tag color="default">{summary?.lastRunAt ? t('dashboard.noRecentRunsInPeriod') : t('project.noRunsYet')}</Tag>}
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
                          <div style={{ minWidth: 0 }}>{t('project.check')}</div>
                          <div style={{ minWidth: 0 }}>{t('project.status')}</div>
                          <div style={{ minWidth: 0 }}>{t('project.lastRun')}</div>
                          <div style={{ minWidth: 0 }}>{t('project.open')}</div>
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
                                {row.lastRunStatus ? <RunStatusBadge status={row.lastRunStatus} /> : <Tag>{t('project.neverRun')}</Tag>}
                              </div>
                              <div style={{ minWidth: 0 }}>
                                {row.lastRunAt ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                                    <Text>{formatRelativeTime(row.lastRunAt, t, locale)}</Text>
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                      {formatDurationLabel(row.lastRunDurationMs)} · {formatShortTimestamp(row.lastRunAt, locale)}
                                    </Text>
                                  </div>
                                ) : (
                                  <Text type="secondary">{t('project.never')}</Text>
                                )}
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <Button size="small" onClick={() => openCheck(row.id)}>
                                  {t('project.open')}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <EmptyState
                        className="wt-empty-state--contained"
                        title={t('project.noRunsYet')}
                        description={t('project.runScheduleForResults')}
                        action={(
                          <Space wrap>
                          <Button type="primary" onClick={openRunSuiteModal} disabled={!canWriteProject}>
                            {t('project.runSuite')}
                          </Button>
                          <Button onClick={() => navigate(`/projects/${projectId}/checks`)}>{t('project.goToChecks')}</Button>
                          </Space>
                        )}
                      />
                    )}
                  </Card>
                </Col>
                <Col xs={24} xxl={10}>
                  <Card
                    style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
                    title={t('project.needsAttention')}
                    extra={
                      !hasRunHistory
                        ? <Tag>{t('project.notEvaluated')}</Tag>
                        : summary?.flakyChecks
                          ? <Tag color="gold">{t('project.flakyCount', { count: summary.flakyChecks })}</Tag>
                          : <Tag color="green">{t('project.allClear')}</Tag>
                    }
                  >
                    {attentionChecks.filter((check) => check.lastRunStatus === 'FAILED').length > 0 ? (
                      <Table<ProjectCheck>
                        dataSource={attentionChecks.filter((check) => check.lastRunStatus === 'FAILED')}
                        rowKey="id"
                        pagination={false}
                        columns={[
                          {
                            title: t('project.check'),
                            dataIndex: 'name',
                            render: (value: string, row: ProjectCheck) => (
                              <Button type="link" style={{ padding: 0, textAlign: 'left', fontWeight: 600 }} onClick={() => openCheck(row.id)}>
                                {value}
                              </Button>
                            )
                          },
                          {
                            title: t('project.status'),
                            render: (_: unknown, row: ProjectCheck) =>
                              row.lastRunStatus ? <RunStatusBadge status={row.lastRunStatus} /> : <Tag>{t('project.neverRun')}</Tag>
                          },
                          {
                            title: t('project.lastFailure'),
                            render: (_: unknown, row: ProjectCheck) =>
                              row.lastRunAt ? <Text>{formatCompactDateTime(row.lastRunAt, locale)}</Text> : <Text type="secondary">—</Text>
                          },
                          {
                            title: t('project.errorSummary'),
                            render: (_: unknown, row: ProjectCheck) => (
                              <Text type="secondary" ellipsis={{ tooltip: row.latestRun?.error ?? t('project.noErrorSummary') }} style={{ maxWidth: 220, display: 'inline-block' }}>
                                {row.latestRun?.error ?? t('project.noErrorSummary')}
                              </Text>
                            )
                          },
                          {
                            title: t('project.actions'),
                            render: (_: unknown, row: ProjectCheck) => (
                              <Space>
                                <Button size="small" onClick={() => openCheck(row.id)}>
                                  {t('project.openResultAction')}
                                </Button>
                                <Button size="small" onClick={() => void handleRunCheck(row.id)}>
                                  {t('project.rerun')}
                                </Button>
                              </Space>
                            )
                          }
                        ]}
                      />
                    ) : !hasRunHistory ? (
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Title level={5} style={{ margin: 0 }}>{t('project.noRunsYet')}</Title>
                        <Text type="secondary">{t('project.noRunsHealthDescription')}</Text>
                      </Space>
                    ) : (
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Title level={5} style={{ margin: 0 }}>{t('project.noActiveFailures')}</Title>
                        <Text type="secondary">{t('project.allChecksPassing')}</Text>
                        {summary?.flakyChecks ? (
                          <Text type="secondary">{t('project.flakyRecent', { count: summary.flakyChecks })}</Text>
                        ) : null}
                      </Space>
                    )}
                  </Card>
                </Col>
                <Col span={24}>
                  <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
                    <Title level={4}>{t('project.projectSetup')}</Title>
                    <Row gutter={[16, 16]}>
                      {projectSetupItems.map((item) => (
                        <Col key={item.label} xs={24} sm={12} xl={6}>
                          <Space align="start">
                            {item.done ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : <WarningOutlined style={{ color: '#8c8c8c' }} />}
                            <div>
                              <Text strong>{item.label}</Text>
                              <br />
                              <Text type="secondary">{item.done ? t('project.configured') : t('project.notConfigured')}</Text>
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
                  <EmptyState
                    className="wt-empty-state--contained"
                    title={t('project.noBrowserChecks')}
                    description={t('project.noBrowserChecksDescription')}
                  />
                )}
              </Card>
            </Col>
          )}

          {activeTab === 'runs' && (
            <Col span={24}>
              <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }} title={t('project.recentResults')}>
                {latestChecks.some((check) => check.lastRunAt) ? (
                  <Table<ProjectCheck>
                    dataSource={latestChecks.filter((check) => check.lastRunAt)}
                    rowKey="id"
                    pagination={false}
                    columns={[
                      {
                        title: t('project.check'),
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
                        title: t('project.status'),
                        render: (_: unknown, row: ProjectCheck) =>
                          row.lastRunStatus ? <RunStatusBadge status={row.lastRunStatus} /> : <Tag>{t('project.neverRun')}</Tag>
                      },
                      {
                        title: t('project.lastRun'),
                        render: (_: unknown, row: ProjectCheck) =>
                          row.lastRunAt ? (
                            <Space direction="vertical" size={0}>
                              <Text>{formatRelativeTime(row.lastRunAt, t, locale)}</Text>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {formatDurationLabel(row.lastRunDurationMs)} · {formatShortTimestamp(row.lastRunAt, locale)}
                              </Text>
                            </Space>
                          ) : (
                            <Text type="secondary">{t('project.never')}</Text>
                          )
                      },
                      {
                        title: t('project.open'),
                        render: (_: unknown, row: ProjectCheck) => (
                          <Button size="small" onClick={() => openCheck(row.id)}>
                            {t('project.open')}
                          </Button>
                        )
                      }
                    ]}
                  />
                ) : (
                  <EmptyState
                    className="wt-empty-state--contained"
                    title={t('project.noRunsYet')}
                    description={t('project.runHistoryEmpty')}
                  />
                )}
              </Card>
            </Col>
          )}

          {activeTab === 'schedules' && (
            <Col span={24}>
              <Card
                style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
              >
                <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 16 }}>
                  <Text type="secondary">{t('project.schedulesDescription')}</Text>
                </Space>

                {schedules.length === 0 ? (
                  <EmptyState
                    className="wt-empty-state--contained"
                    title={t('project.noSchedules')}
                    description={t('project.noSchedulesDescription')}
                  />
                ) : (
                  <Table<Schedule>
                    dataSource={schedules}
                    rowKey="id"
                    loading={loading}
                    pagination={false}
                    rowClassName={() => (canManageSchedules ? 'clickable-row' : '')}
                    onRow={(row) => (canManageSchedules ? { onClick: () => openScheduleEdit(row) } : {})}
                    columns={[
                      {
                        title: t('project.schedule'),
                        dataIndex: 'name',
                        render: (value: string, row: Schedule) => (
                          <Space direction="vertical" size={0}>
                            {canManageSchedules ? (
                              <Button type="link" style={{ padding: 0, textAlign: 'left', fontWeight: 600 }} onClick={() => openScheduleEdit(row)}>
                                {value}
                              </Button>
                            ) : (
                              <Text strong>{value}</Text>
                            )}
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {describeCron(row.cron)}
                            </Text>
                          </Space>
                        )
                      },
                      {
                        title: t('project.target'),
                        render: (_: unknown, row) => (
                          <Space direction="vertical" size={0}>
                            <Text strong>{row.suite?.name ?? row.test?.name ?? '—'}</Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {row.environment?.name ?? t('project.noEnvironment')}
                            </Text>
                          </Space>
                        )
                      },
                      {
                        title: t('project.cron'),
                        dataIndex: 'cron',
                        render: (value: string) => <Tag color="blue"><code>{value}</code></Tag>
                      },
                      {
                        title: t('project.status'),
                        render: (_: unknown, row) => (row.enabled ? <Tag color="green">{t('project.active')}</Tag> : <Tag>{t('project.paused')}</Tag>)
                      },
                      {
                        title: t('project.lastRun'),
                        render: (_: unknown, row) =>
                          row.lastRunAt ? (
                            <Space direction="vertical" size={0}>
                              <Text>{formatRelativeTime(row.lastRunAt, t, locale)}</Text>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {formatCompactDateTime(row.lastRunAt, locale)}
                              </Text>
                            </Space>
                          ) : (
                            <Text type="secondary">{t('project.never')}</Text>
                          )
                      },
                      {
                        title: t('project.nextRun'),
                        render: (_: unknown, row) =>
                          row.enabled ? (
                            formatScheduleNextRun(row).overdue ? (
                              <Space direction="vertical" size={0}>
                                <Text>{formatScheduleNextRun(row).primary}</Text>
                                <Tag color="orange" style={{ width: 'fit-content', marginTop: 2 }}>
                                  {t('project.overdue')}
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
                            <Text type="secondary">{t('project.paused')}</Text>
                          )
                      },
                      {
                        title: t('project.actions'),
                        render: (_: unknown, row) => (
                          <Space onClick={(event) => event.stopPropagation()} size={8}>
                            <Button size="small" onClick={() => navigate(`/schedules/${row.id}/history`)}>
                              {t('project.history')}
                            </Button>
                            {canManageSchedules ? (
                              <>
                                <Button size="small" onClick={() => void runScheduleNow(row)}>
                                  {t('project.runNow')}
                                </Button>
                                <Button size="small" onClick={() => openScheduleEdit(row)}>
                                  {t('project.edit')}
                                </Button>
                                <Dropdown
                                  trigger={['click']}
                                  menu={{
                                    items: [
                                      { key: 'toggle', label: row.enabled ? t('common.pause') : t('project.resume') },
                                      { type: 'divider' },
                                      { key: 'delete', label: t('project.delete'), danger: true }
                                    ],
                                    onClick: ({ key, domEvent }) => {
                                      domEvent.stopPropagation();
                                      if (key === 'toggle') {
                                        void toggleSchedule(row);
                                      }
                                      if (key === 'delete') {
                                        confirmModal.confirm({
                                          title: t('project.deleteScheduleTitle'),
                                          content: t('project.deleteScheduleDescription', { name: row.name }),
                                          okText: t('project.delete'),
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
                              </>
                            ) : (
                              <Text type="secondary">{t('environments.readOnly')}</Text>
                            )}
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
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginBottom: 16 }}>
                  <Text type="secondary">{t('environments.description')}</Text>
                  <Text type="secondary">{t('environments.variableUsage')}</Text>
                </div>

                {environments.length === 0 ? (
                  <EmptyState
                    className="wt-empty-state--contained"
                    title={t('environments.emptyTitle')}
                    description={t('environments.emptyDescription')}
                  />
                ) : (
                  <Table<Environment & { usedByChecks: number }>
                    dataSource={environmentUsage}
                    rowKey="id"
                    loading={loading}
                    pagination={false}
                    rowClassName={() => (canManageEnvironments ? 'clickable-row' : '')}
                    onRow={(row) => (canManageEnvironments ? { onClick: () => openEnvironmentEdit(row) } : {})}
                    columns={[
                      {
                        title: t('environments.name'),
                        dataIndex: 'name',
                        render: (value: string, row) => (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, alignItems: 'flex-start' }}>
                            {canManageEnvironments ? (
                              <Button
                                type="link"
                                style={{
                                  padding: 0,
                                  height: 'auto',
                                  lineHeight: '20px',
                                  textAlign: 'left',
                                  fontWeight: 600,
                                  display: 'inline-flex',
                                  alignItems: 'center'
                                }}
                                onClick={() => openEnvironmentEdit(row)}
                              >
                                {value}
                              </Button>
                            ) : (
                              <Text strong style={{ lineHeight: '20px' }}>
                                {value}
                              </Text>
                            )}
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {t('environments.variableCount', { count: Object.keys(row.variables).length })}
                            </Text>
                          </div>
                        )
                      },
                      {
                        title: t('environments.variables'),
                        render: (_: unknown, row) => <Tag color="purple">{Object.keys(row.variables).length}</Tag>
                      },
                      {
                        title: t('environments.usedByChecks'),
                        render: (_: unknown, row) => <Tag color={row.usedByChecks > 0 ? 'blue' : 'default'}>{row.usedByChecks}</Tag>
                      },
                      {
                        title: t('environments.created'),
                        dataIndex: 'createdAt',
                        render: (value: string) => formatDateOnly(value, locale)
                      },
                      {
                        title: t('environments.actions'),
                        render: (_: unknown, row) => (
                          <Space onClick={(event) => event.stopPropagation()} size={8}>
                            {canManageEnvironments ? (
                              <>
                                <Button size="small" onClick={() => openEnvironmentEdit(row)}>
                                  {t('environments.edit')}
                                </Button>
                                <Dropdown
                                  trigger={['click']}
                                  menu={{
                                    items: [
                                      { key: 'duplicate', icon: <CopyOutlined />, label: t('environments.duplicate') },
                                      { type: 'divider' },
                                      { key: 'delete', icon: <DeleteOutlined />, label: t('environments.delete'), danger: true }
                                    ],
                                    onClick: ({ key, domEvent }) => {
                                      domEvent.stopPropagation();
                                      if (key === 'duplicate') {
                                        void duplicateEnvironment(row);
                                      }
                                      if (key === 'delete') {
                                        confirmModal.confirm({
                                          title: t('environments.deleteConfirm'),
                                          content: t('environments.deleteDescription', { name: row.name }),
                                          okText: t('environments.delete'),
                                          okButtonProps: { danger: true },
                                          centered: true,
                                          onOk: async () => {
                                            await deleteEnvironment(row.id);
                                            message.success(t('environments.deletedToast'));
                                            await load();
                                          }
                                        });
                                      }
                                    }
                                  }}
                                >
                                  <Button size="small" icon={<EllipsisOutlined />} />
                                </Dropdown>
                              </>
                            ) : (
                              <Text type="secondary">{t('environments.readOnly')}</Text>
                            )}
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
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginBottom: 16 }}>
                  <Text type="secondary">{t('alerts.description')}</Text>
                </div>

                {channels.length === 0 ? (
                  <EmptyState
                    className="wt-empty-state--contained"
                    title={t('alerts.emptyTitle')}
                    description={t('alerts.emptyDescription')}
                  />
                ) : (
                  <Table<NotificationChannel>
                    dataSource={channels}
                    rowKey="id"
                    loading={loading}
                    pagination={false}
                    rowClassName={() => (canWriteProject ? 'clickable-row' : '')}
                    onRow={(row) => (canWriteProject ? { onClick: () => openChannelEdit(row) } : {})}
                    columns={[
                      {
                        title: t('alerts.alert'),
                        dataIndex: 'name',
                        render: (value: string, row) => (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, alignItems: 'flex-start' }}>
                            {canWriteProject ? (
                              <Button
                                type="link"
                                style={{
                                  padding: 0,
                                  height: 'auto',
                                  lineHeight: '20px',
                                  textAlign: 'left',
                                  fontWeight: 600,
                                  display: 'inline-flex',
                                  alignItems: 'center'
                                }}
                                onClick={() => openChannelEdit(row)}
                              >
                                {value}
                              </Button>
                            ) : (
                              <Text strong style={{ lineHeight: '20px' }}>
                                {value}
                              </Text>
                            )}
                          </div>
                        )
                      },
                      {
                        title: t('alerts.type'),
                        dataIndex: 'type',
                        render: (value: string) => <Tag color={value === 'telegram' ? 'blue' : 'gold'}>{value === 'telegram' ? 'Telegram' : 'Slack'}</Tag>
                      },
                      {
                        title: t('alerts.rules'),
                        render: (_: unknown, row) => (
                          <Space wrap>
                            {formatAlertRules(row, t).map((rule) => (
                              <Tag key={rule} color="purple">
                                {rule}
                              </Tag>
                            ))}
                          </Space>
                        )
                      },
                      {
                        title: t('common.status'),
                        render: (_: unknown, row) => (row.enabled ? <Tag color="green">{t('common.active')}</Tag> : <Tag color="default">{t('common.paused')}</Tag>)
                      },
                      {
                        title: t('alerts.lastTest'),
                        render: (_: unknown, row) =>
                          row.lastTestAt ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                              <Text>{formatRelativeTime(row.lastTestAt, t, locale)}</Text>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                              {formatCompactDateTime(row.lastTestAt, locale)}
                              </Text>
                            </div>
                        ) : (
                          <Text type="secondary">{t('common.never')}</Text>
                        )
                      },
                      {
                        title: t('common.actions'),
                        render: (_: unknown, row) => (
                          <Space onClick={(event) => event.stopPropagation()} size={8}>
                            {canWriteProject ? (
                              <>
                                <Button size="small" onClick={() => openChannelEdit(row)}>
                                  {t('common.edit')}
                                </Button>
                                <Button size="small" onClick={() => void testExistingChannel(row)}>
                                  {t('alerts.sendTest')}
                                </Button>
                                <Dropdown
                                  trigger={['click']}
                                  menu={{
                                    items: [
                                      { key: 'toggle', label: row.enabled ? t('common.pause') : t('common.activate') },
                                      { key: 'delete', label: t('common.delete'), danger: true }
                                    ],
                                    onClick: ({ key, domEvent }) => {
                                      domEvent.stopPropagation();
                                      if (key === 'toggle') {
                                        void toggleChannelEnabled(row);
                                      }
                                      if (key === 'delete') {
                                        confirmModal.confirm({
                                          title: t('alerts.deleteTitle'),
                                          content: t('alerts.deleteDescription', { name: row.name }),
                                          okText: t('common.delete'),
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
                              </>
                            ) : (
                              <Text type="secondary">{t('common.readOnly')}</Text>
                            )}
                          </Space>
                        )
                      }
                    ]}
                  />
                )}
              </Card>
            </Col>
          )}

          {(activeTab === 'settings' || activeTab === 'authentication') && (
            <Col span={24}>
              <Space direction="vertical" size={24} style={{ width: '100%' }}>
                {activeTab === 'settings' && <Row gutter={[24, 24]}>
                  <Col xs={24} xl={14}>
                    <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }} title={t('projectSettings.title')}>
                      <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Row gutter={[16, 16]}>
                          <Col xs={24} md={12}>
                            <div>
                              <Text type="secondary">{t('projectSettings.name')}</Text>
                              <Input
                                value={projectName}
                                disabled={isViewer}
                                onChange={(event) => {
                                  setProjectName(event.target.value);
                                  if (event.target.value.trim()) setProjectNameError(null);
                                }}
                                placeholder={t('projectSettings.projectNamePlaceholder')}
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
                              <Text type="secondary">{t('projectSettings.defaultEnvironment')}</Text>
                              <Select
                                value={environments.length === 0 ? '' : projectDefaultEnvironmentId}
                                disabled={isViewer || environments.length === 0}
                                onChange={(value) => setProjectDefaultEnvironmentId(value)}
                                placeholder={t('projectSettings.noDefaultEnvironment')}
                                style={{ marginTop: 8, width: '100%' }}
                                options={[
                                  { label: t('projectSettings.noDefaultEnvironment'), value: '' },
                                  ...environments.map((environment) => ({ label: environment.name, value: environment.id }))
                                ]}
                              />
                            </div>
                          </Col>
                          <Col xs={24} md={12}>
                            <div>
                              <Text type="secondary">{t('projectSettings.description')}</Text>
                              <Input.TextArea
                                value={projectDescription}
                                disabled={isViewer}
                                onChange={(event) => {
                                  setProjectDescription(event.target.value);
                                  if (event.target.value.length <= 500) setProjectDescriptionError(null);
                                }}
                                placeholder={t('projectSettings.descriptionPlaceholder')}
                                autoSize={{ minRows: 3, maxRows: 4 }}
                                maxLength={500}
                                style={{ marginTop: 8 }}
                                status={projectDescriptionError ? 'error' : undefined}
                              />
                              <Space direction="vertical" size={4} style={{ width: '100%', marginTop: 6 }}>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {t('projectSettings.optionalLimit')}
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
                              <Text type="secondary">{t('projectSettings.defaultDevice')}</Text>
                              <Select
                                value={projectDefaultDevice}
                                disabled={isViewer}
                                onChange={(value) => setProjectDefaultDevice(value)}
                                style={{ marginTop: 8, width: '100%' }}
                                options={DEFAULT_DEVICE_OPTIONS.map((device) => ({ label: device, value: device }))}
                              />
                            </div>
                          </Col>
                        </Row>
                        <Space wrap>
                        <Button type="primary" loading={savingProject} onClick={() => void handleSaveProject()} disabled={isViewer}>
                          {t('projectSettings.save')}
                        </Button>
                        <Button onClick={handleResetProjectSettings} disabled={!project || isViewer}>
                          {t('projectSettings.reset')}
                        </Button>
                        </Space>
                      </Space>
                    </Card>
                  </Col>
                  <Col xs={24} xl={10}>
                    <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }} title={t('projectSettings.metadata')}>
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
                            <Text type="secondary">{t('projectSettings.projectId')}</Text>
                            <Text code style={{ display: 'block', marginTop: 4, wordBreak: 'break-all' }}>
                              {project?.id ?? '—'}
                            </Text>
                          </div>
                        </Col>
                        <Col xs={24} sm={12}>
                          <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                            <Text type="secondary">{t('projectSettings.created')}</Text>
                            <Text style={{ display: 'block', marginTop: 4 }}>
                              {project ? formatDateTime(project.createdAt, locale) : '—'}
                            </Text>
                          </div>
                        </Col>
                        <Col xs={24} sm={12}>
                          <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                            <Text type="secondary">{t('projectSettings.checks')}</Text>
                            <Text style={{ display: 'block', marginTop: 4 }}>{summary?.checksCount ?? 0}</Text>
                          </div>
                        </Col>
                        <Col xs={24} sm={12}>
                          <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                            <Text type="secondary">{t('projectSettings.runs')}</Text>
                            <Text style={{ display: 'block', marginTop: 4 }}>
                              {summary?.totalRuns30d ?? projectChecks.reduce((count, check) => count + check.runCount, 0) ?? 0}
                            </Text>
                          </div>
                        </Col>
                        <Col xs={24} sm={12}>
                          <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                            <Text type="secondary">{t('projectSettings.schedules')}</Text>
                            <Text style={{ display: 'block', marginTop: 4 }}>{summary?.activeSchedulesCount ?? 0}</Text>
                          </div>
                        </Col>
                        <Col xs={24} sm={12}>
                          <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                            <Text type="secondary">{t('projectSettings.environments')}</Text>
                            <Text style={{ display: 'block', marginTop: 4 }}>{environments.length}</Text>
                          </div>
                        </Col>
                        <Col xs={24} sm={12}>
                          <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                            <Text type="secondary">{t('projectSettings.alertChannels')}</Text>
                            <Text style={{ display: 'block', marginTop: 4 }}>{channels.length}</Text>
                          </div>
                        </Col>
                        <Col xs={24} sm={12}>
                          <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                            <Text type="secondary">{t('projectSettings.lastRun')}</Text>
                            <Text style={{ display: 'block', marginTop: 4 }}>
                              {summary?.lastRunAt ? formatCompactDateTime(summary.lastRunAt, locale) : '—'}
                            </Text>
                          </div>
                        </Col>
                        <Col xs={24} sm={12}>
                          <div style={{ padding: '12px 14px', border: '1px solid #f1f5f9', borderRadius: 14 }}>
                            <Text type="secondary">{t('projectSettings.lastResult')}</Text>
                            <div style={{ marginTop: 4 }}>
                              {summary?.lastResult === 'PASSED' ? (
                                <Tag color="green">{t('projectSettings.passed')}</Tag>
                              ) : summary?.lastResult === 'FAILED' ? (
                                <Tag color="red">{t('projectSettings.failed')}</Tag>
                              ) : (
                                <Tag color="default">{t('projectSettings.noRuns')}</Tag>
                              )}
                            </div>
                          </div>
                        </Col>
                      </Row>
                    </Card>
                  </Col>
                </Row>}
                {activeTab === 'authentication' && <Card
                  style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
                  title={t('authSettings.title')}
                >
                  <Space direction="vertical" size={18} style={{ width: '100%' }}>
                    <Text type="secondary">
                      {t('authSettings.description')}
                    </Text>

                    {environments.length === 0 ? (
                      <Alert
                        type="warning"
                        showIcon
                        message={t('authSettings.environmentRequired')}
                      />
                    ) : (
                      <>
                        <Row gutter={[16, 16]}>
                          <Col xs={24} md={12}>
                            <Text type="secondary">{t('authSettings.environment')}</Text>
                            <Select
                              value={authEnvironmentId}
                              onChange={setAuthEnvironmentId}
                              style={{ width: '100%', marginTop: 8 }}
                              options={environments.map((environment) => ({
                                value: environment.id,
                                label: environment.name
                              }))}
                            />
                          </Col>
                          <Col xs={24} md={12}>
                            <Text type="secondary">{t('authSettings.check')}</Text>
                            <Select
                              value={authCheckId}
                              disabled={isViewer}
                              onChange={setAuthCheckId}
                              placeholder={t('authSettings.selectLoginCheck')}
                              style={{ width: '100%', marginTop: 8 }}
                              options={projectChecks.map((check) => ({
                                value: check.id,
                                label: check.name
                              }))}
                            />
                          </Col>
                        </Row>

                        <Checkbox
                          checked={authEnabled}
                          disabled={isViewer}
                          onChange={(event) => setAuthEnabled(event.target.checked)}
                        >
                          {t('authSettings.useForEnvironment')}
                        </Checkbox>

                        {selectedAuthCheck && !selectedAuthCheckHasAssertions ? (
                          <Alert
                            type="warning"
                            showIcon
                            message={t('authSettings.assertionRequired')}
                            description={t('authSettings.assertionHelp')}
                            action={<Link to={`/tests/${selectedAuthCheck.id}/edit`}>{t('authSettings.editCheck')}</Link>}
                          />
                        ) : null}

                        <div
                          style={{
                            padding: '14px 16px',
                            borderRadius: 14,
                            border: '1px solid #e2e8f0',
                            background: '#f8fafc'
                          }}
                        >
                          <Space direction="vertical" size={6}>
                            <Space>
                              <Text strong>{t('authSettings.status')}</Text>
                              <Tag color={authStatusPresentation.color}>{authStatusPresentation.label}</Tag>
                              {selectedAuthProfile && !selectedAuthProfile.enabled ? (
                                <Tag>{t('authSettings.disabled')}</Tag>
                              ) : null}
                              {selectedAuthProfile?.hasUsableState && authStatus === 'REFRESH_FAILED' ? (
                                <Tag color="blue">{t('authSettings.previousStateActive')}</Tag>
                              ) : null}
                            </Space>
                            <Text type="secondary">
                              {t('authSettings.lastRefreshed')}{' '}
                              {selectedAuthProfile?.refreshedAt
                                ? formatDateTime(selectedAuthProfile.refreshedAt)
                                : t('project.never')}
                            </Text>
                            {selectedAuthProfile?.refreshedRunId ? (
                              <Link to={`/runs/${selectedAuthProfile.refreshedRunId}`}>{t('authSettings.openRefreshRun')}</Link>
                            ) : null}
                          </Space>
                        </div>

                        {authStatus === 'REFRESH_FAILED' && selectedAuthProfile?.lastError ? (
                          <Alert
                            type="error"
                            showIcon
                            message={t('authSettings.refreshFailedTitle')}
                            description={`${selectedAuthProfile.lastError}${
                              selectedAuthProfile.hasUsableState
                                ? t('authSettings.previousStatePreserved')
                                : t('authSettings.noStateAvailable')
                            }`}
                          />
                        ) : null}

                        <Space wrap>
                          <Button
                            type="primary"
                            loading={authSaving}
                            disabled={isViewer || !authEnvironmentId || !authCheckId}
                            onClick={() => void handleSaveAuthentication()}
                          >
                            {t('authSettings.save')}
                          </Button>
                          <Button
                            icon={<PlayCircleOutlined />}
                            loading={authRefreshing || authStatus === 'REFRESHING'}
                            disabled={
                              isViewer ||
                              !selectedAuthProfile ||
                              !authDraftIsSaved ||
                              !selectedAuthCheckHasAssertions ||
                              authStatus === 'REFRESHING'
                            }
                            onClick={() => void handleRefreshAuthentication()}
                          >
                            {t('authSettings.refresh')}
                          </Button>
                          {selectedAuthProfile ? (
                            <Button
                              danger
                              disabled={isViewer || authStatus === 'REFRESHING'}
                              onClick={() => {
                                confirmModal.confirm({
                                  title: t('authSettings.removeTitle'),
                                  content: t('authSettings.removeDescription'),
                                  okText: t('environments.remove'),
                                  okButtonProps: { danger: true },
                                  onOk: handleDeleteAuthentication
                                });
                              }}
                            >
                              {t('authSettings.remove')}
                            </Button>
                          ) : null}
                        </Space>

                        {!authDraftIsSaved && selectedAuthProfile ? (
                          <Text type="warning">{t('authSettings.saveBeforeRefresh')}</Text>
                        ) : null}
                      </>
                    )}
                  </Space>
                </Card>}
                {activeTab === 'settings' && <Card
                  style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)', borderColor: '#fecaca' }}
                  title={t('projectSettings.dangerZone')}
                >
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <div>
                      <Text strong>{t('projectSettings.deleteProject')}</Text>
                      <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                        {t('projectSettings.deleteDescription')}
                      </Text>
                    </div>
                    <Button danger ghost onClick={openDeleteProjectModal} disabled={!isOwner}>
                      {t('projectSettings.deleteProject')}
                    </Button>
                  </Space>
                </Card>}
              </Space>
            </Col>
          )}

          {activeTab === 'members' && canManageMembers && (
            <Col span={24}>
              <Card
                style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
                title={t('members.title')}
              >
                <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 16 }}>
                  <Text type="secondary">{t('members.description')}</Text>
                </Space>

                <Table<ProjectMember>
                  dataSource={projectMembers}
                  rowKey="id"
                  pagination={false}
                  columns={[
                    {
                      title: t('members.nameEmail'),
                      render: (_: unknown, row) => (
                        <Space direction="vertical" size={2}>
                          <Text strong>{row.user?.email ?? row.email}</Text>
                          {isProtectedAdminMember(row) && (
                            <Tag color="red" style={{ width: 'fit-content', marginInlineEnd: 0 }}>
                              {t('members.systemAdmin')}
                            </Tag>
                          )}
                          <Text type="secondary" style={{ fontSize: 12 }}>{row.status === 'PENDING' ? t('members.pending') : t('members.active')}</Text>
                        </Space>
                      )
                    },
                    {
                      title: t('members.role'),
                      render: (_: unknown, row) => (
                          <Select
                          value={row.role}
                          style={{ width: 150 }}
                          options={[
                            { label: t('role.owner'), value: 'OWNER' },
                            { label: t('role.editor'), value: 'EDITOR' },
                            { label: t('role.viewer'), value: 'VIEWER' }
                          ]}
                          onChange={(value) => void handleChangeMemberRole(row, value)}
                          disabled={isProtectedAdminMember(row) || (row.role === 'OWNER' && projectMembers.filter((member) => member.role === 'OWNER').length <= 1)}
                        />
                      )
                    },
                    {
                      title: t('members.status'),
                      render: (_: unknown, row) =>
                        row.status === 'PENDING' ? (
                          <Tooltip title={t('members.pendingHelp')}>
                            <Tag color="gold">{t('members.pending')}</Tag>
                          </Tooltip>
                        ) : (
                          <Tag color="green">{t('members.active')}</Tag>
                        )
                    },
                    {
                      title: t('members.actions'),
                      render: (_: unknown, row) => (
                        <Space>
                          <Button
                            size="small"
                            danger
                            onClick={() => void handleRemoveMember(row)}
                            disabled={isProtectedAdminMember(row) || (row.role === 'OWNER' && projectMembers.filter((member) => member.role === 'OWNER').length <= 1)}
                          >
                            {t('members.remove')}
                          </Button>
                        </Space>
                      )
                    }
                  ]}
                />
              </Card>
            </Col>
          )}

          {activeTab === 'members' && !canManageMembers && (
            <Col span={24}>
              <ErrorState
                title={t('members.ownerAccessRequired')}
                description={t('members.ownerAccessDescription')}
              />
            </Col>
          )}
        </Row>
      </Content>

      <Modal
        title={t('authSettings.environment')}
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
          <Radio value="">{t('suites.noEnvironmentUseAsIs')}</Radio>
          {environments.map((environment) => (
            <Radio key={environment.id} value={environment.id}>
              {environment.name}
              <Tag style={{ marginLeft: 8 }}>{t('environments.variableCount', { count: Object.keys(environment.variables).length })}</Tag>
            </Radio>
          ))}
        </Radio.Group>
      </Modal>

      <Modal
        title={t('suites.runTitle')}
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
                <Text strong>{t('suites.emptyTitle')}</Text>
                <Text type="secondary">{t('suites.emptyRunDescription')}</Text>
              </Space>
            }
          >
            <Button type="primary" onClick={() => navigate(`/projects/${projectId}/suites`)}>
              {t('suites.create')}
            </Button>
          </Empty>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <div>
              <Text type="secondary">{t('suites.title')}</Text>
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
              <Text type="secondary">{t('authSettings.environment')}</Text>
              <Radio.Group
                style={{ display: 'grid', gap: 12, width: '100%', marginTop: 8 }}
                value={selectedEnvironmentId ?? ''}
                onChange={(event) => setSelectedEnvironmentId(event.target.value || undefined)}
              >
                <Radio value="">{t('suites.noEnvironmentUseAsIs')}</Radio>
                {environments.map((environment) => (
                  <Radio key={environment.id} value={environment.id}>
                    {environment.name}
                    <Tag style={{ marginLeft: 8 }}>{t('environments.variableCount', { count: Object.keys(environment.variables).length })}</Tag>
                  </Radio>
                ))}
              </Radio.Group>
            </div>
          </Space>
        )}
      </Modal>

      <Modal
        title={environmentMode === 'edit' ? t('environments.modalEdit', { name: editingEnvironment?.name ?? '' }) : t('environments.modalCreate')}
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
        okText={environmentMode === 'edit' ? t('projectSettings.save') : t('environments.create')}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Text type="secondary">{t('environments.nameLabel')}</Text>
            <Input
              value={environmentName}
              onChange={(event) => setEnvironmentName(event.target.value)}
              placeholder={t('environments.namePlaceholder')}
              disabled={!canManageEnvironments}
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
                {t('environments.variableName')}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('environments.value')}
              </Text>
              <Text type="secondary" style={{ fontSize: 12, textAlign: 'right' }}>
                {t('environments.actions')}
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
                    disabled={!canManageEnvironments}
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
                      disabled={!canManageEnvironments}
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
                      disabled={!canManageEnvironments}
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
                    disabled={!canManageEnvironments || environmentRows.length === 1}
                    style={{ justifySelf: 'end' }}
                  >
                    {t('environments.remove')}
                  </Button>
                </div>
              ))}
              <div style={{ display: 'grid', gap: 8 }}>
                <Button type="dashed" block onClick={() => setEnvironmentRows((current) => [...current, createEnvRow()])} disabled={!canManageEnvironments}>
                  {t('environments.addVariable')}
                </Button>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('environments.variableUsage')}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('environments.variableNameHelp')}
                </Text>
              </div>
            </Space>
          </div>
        </Space>
      </Modal>

      <Modal
        title={
          channelMode === 'edit'
            ? t(channelType === 'telegram' ? 'alerts.editTelegram' : 'alerts.editSlack')
            : t(channelType === 'telegram' ? 'alerts.addTelegram' : 'alerts.addSlack')
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
            <Button onClick={() => setChannelModalOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => void sendChannelDraftTest()} loading={channelTesting} disabled={!channelDraftReadyForTest || channelTesting}>
              {t('alerts.sendTestNotification')}
            </Button>
            <Button type="primary" onClick={() => void saveChannel()} loading={channelSaving}>
              {channelMode === 'edit' ? t('common.saveChanges') : t('alerts.create')}
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Text type="secondary">{t('alerts.name')}</Text>
            <Input
              value={channelForm.name}
              onChange={(event) => setChannelForm((current) => ({ ...current, name: event.target.value }))}
              placeholder={channelType === 'telegram' ? t('alerts.devPlaceholder') : t('alerts.productionPlaceholder')}
              style={{ marginTop: 8 }}
            />
          </div>

          {channelType === 'telegram' ? (
            <Row gutter={16}>
              <Col span={12}>
                <div>
                  <Text type="secondary">{t('alerts.botToken')}</Text>
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
                  <Text type="secondary">{t('alerts.chatId')}</Text>
                  <Input
                    value={channelForm.chatId}
                    onChange={(event) => setChannelForm((current) => ({ ...current, chatId: event.target.value }))}
                    placeholder="-1001234567890"
                    style={{ marginTop: 8 }}
                  />
                  <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                    {t('alerts.telegramHelp')}
                  </Text>
                </div>
              </Col>
            </Row>
          ) : (
            <div>
              <Text type="secondary">{t('alerts.webhookUrl')}</Text>
              {channelMode === 'edit' ? (
                <Input.Password
                  value={channelForm.webhookUrl}
                  onChange={(event) => setChannelForm((current) => ({ ...current, webhookUrl: event.target.value }))}
                  placeholder={t('alerts.replaceWebhook')}
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
                {t('alerts.slackHelp')}
              </Text>
            </div>
          )}

          <div style={{ display: 'grid', gap: 12 }}>
            <Text strong>{t('alerts.notificationRules')}</Text>
            {channelRuleDescriptions(t).map((rule) => {
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
        title={scheduleMode === 'edit'
          ? t('project.editScheduleTitle', { name: editingSchedule?.name ?? '' })
          : t('project.newScheduleTitle')}
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
        okText={scheduleMode === 'edit' ? t('project.saveChanges') : t('project.createSchedule')}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Text type="secondary">{t('project.scheduleName')}</Text>
            <Input
              value={scheduleForm.name}
              onChange={(event) => setScheduleForm((current) => ({ ...current, name: event.target.value }))}
              placeholder={t('project.nightlySmoke')}
              style={{ marginTop: 8 }}
            />
          </div>

          <div>
            <Text type="secondary">{t('project.cronPreset')}</Text>
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
              options={CRON_PRESETS.map(({ labelKey, value }) => ({ label: t(labelKey), value }))}
            />
            <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: '#fafafa', border: '1px solid #f0f0f0' }}>
              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                {t('project.cronExpression')}
              </Text>
              <Text strong style={{ display: 'block', fontFamily: 'monospace' }}>
                {scheduleFormCron || '—'}
              </Text>
              <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                {t('project.schedulePreview')}
              </Text>
              <Text style={{ display: 'block', marginTop: 2 }}>
                {describeCron(scheduleFormCron)} {scheduleFormCron ? APP_TIMEZONE : ''}
              </Text>
            </div>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                {t('project.timezone')}
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
          <Text type="secondary">{t('project.target')}</Text>
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
              <Radio value="suite">{t('project.suite')}</Radio>
              <Radio value="test">{t('project.check')}</Radio>
            </Radio.Group>
          </div>

          {scheduleForm.targetType === 'suite' ? (
            <div>
              <Text type="secondary">{t('project.suite')}</Text>
              <Select
                value={scheduleForm.suiteId}
                onChange={(value) => setScheduleForm((current) => ({ ...current, suiteId: value }))}
                style={{ width: '100%', marginTop: 8 }}
                placeholder={t('project.selectSuite')}
                options={suites.map((suite) => ({ value: suite.id, label: `${suite.name} • ${suite.testIds.length} checks` }))}
              />
            </div>
          ) : (
            <div>
              <Text type="secondary">{t('project.check')}</Text>
              <Select
                value={scheduleForm.testId}
                onChange={(value) => setScheduleForm((current) => ({ ...current, testId: value }))}
                style={{ width: '100%', marginTop: 8 }}
                placeholder={t('project.selectCheck')}
                options={projectChecks.map((check) => ({ value: check.id, label: check.name }))}
              />
            </div>
          )}

          <div>
            <Text type="secondary">{t('project.environment')}</Text>
            <Select
              allowClear
              value={scheduleForm.environmentId}
              onChange={(value) => setScheduleForm((current) => ({ ...current, environmentId: value }))}
              style={{ width: '100%', marginTop: 8 }}
              placeholder={t('project.noEnvironment')}
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
                message={t('project.noEnvironmentSelected')}
                description={t('project.environmentVariablesWarning')}
              />
            )}
          </div>

          <div>
            <Text type="secondary">{t('project.status')}</Text>
              <Radio.Group
                style={{ display: 'flex', gap: 12, marginTop: 8 }}
                value={scheduleForm.enabled ? 'active' : 'paused'}
                onChange={(event) =>
                  setScheduleForm((current) => ({ ...current, enabled: event.target.value === 'active' }))
                }
              >
                <Radio value="active">{t('project.active')}</Radio>
                <Radio value="paused">{t('project.paused')}</Radio>
              </Radio.Group>
            </div>
        </Space>
      </Modal>

      <Modal
        title={t('projectSettings.deleteTitle')}
        open={deleteProjectModalOpen}
        onCancel={() => setDeleteProjectModalOpen(false)}
        centered
        confirmLoading={deletingProject}
        footer={
          <Space wrap style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setDeleteProjectModalOpen(false)} disabled={deletingProject}>
              {t('common.cancel')}
            </Button>
            <Button
              danger
              onClick={() => void handleDeleteProject()}
              loading={deletingProject}
              disabled={!deleteProjectReady || deletingProject}
            >
              {t('projectSettings.deleteConfirmed')}
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Text type="secondary">
            {t('projectSettings.deleteWarning')}
          </Text>
          <div>
            <Text type="secondary">{t('projectSettings.typeName')}</Text>
            <Input
              value={deleteProjectConfirmText}
              onChange={(event) => setDeleteProjectConfirmText(event.target.value)}
              placeholder={project?.name ?? t('projectSettings.projectNamePlaceholder')}
              style={{ marginTop: 8 }}
            />
            <Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
              {t('projectSettings.typeNameHint', { name: project?.name ?? 'project' })}
            </Text>
          </div>
        </Space>
      </Modal>

      <Modal
        title={t('members.modalTitle')}
        open={memberModalOpen}
        onCancel={() => setMemberModalOpen(false)}
        confirmLoading={memberSaving}
        onOk={() => void handleCreateUserAccess()}
        okText={t('members.createAccessButton')}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Text type="secondary">{t('members.email')}</Text>
            <Input
              value={memberForm.email}
              onChange={(event) => setMemberForm((current) => ({ ...current, email: event.target.value }))}
              placeholder={t('members.emailPlaceholder')}
              style={{ marginTop: 8 }}
            />
            <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              {t('members.createAccountHelp')}
            </Text>
          </div>
          <div>
            <Text type="secondary">{t('members.password')}</Text>
            <Input.Password
              value={memberForm.password}
              onChange={(event) => setMemberForm((current) => ({ ...current, password: event.target.value }))}
              placeholder={memberUserExists === true ? t('members.passwordExistingPlaceholder') : t('members.passwordNewPlaceholder')}
              disabled={memberUserExists === true}
              style={{ marginTop: 8 }}
            />
            <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              {memberLookupLoading
                ? t('members.checkingUser')
                : memberUserExists === true
                  ? t('members.existingPasswordIgnored')
                  : memberUserExists === false
                    ? t('members.newPasswordHelp')
                    : t('members.passwordIgnored')}
            </Text>
          </div>
          <div>
            <Text type="secondary">{t('members.roleLabel')}</Text>
            <Select
              value={memberForm.role}
              onChange={(value) => setMemberForm((current) => ({ ...current, role: value as ProjectRole }))}
              style={{ width: '100%', marginTop: 8 }}
              options={[
                { label: t('members.ownerRoleDescription'), value: 'OWNER' },
                { label: t('members.editorRoleDescription'), value: 'EDITOR' },
                { label: t('members.viewerRoleDescription'), value: 'VIEWER' }
              ]}
            />
          </div>
        </Space>
      </Modal>
      <AppFooter />
    </Layout>
  );
}
