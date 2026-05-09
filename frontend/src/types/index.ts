export type RunStatus = 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED';

export type StepAction =
  | 'goto'
  | 'click'
  | 'fill'
  | 'press'
  | 'selectOption'
  | 'assertVisible'
  | 'assertHidden'
  | 'assertText'
  | 'assertValue'
  | 'assertURL'
  | 'assertTitle'
  | 'assertChecked'
  | 'assertCount'
  | 'waitForSelector';

export interface Step {
  action: StepAction;
  selector?: string;
  selectorCandidates?: string[];
  elementText?: string;
  elementTag?: string;
  value?: string;
  expected?: string;
  options?: {
    exact?: boolean;
    timeout?: number;
    nth?: number;
  };
}

export interface StepValidationResult {
  index: number;
  status: 'ok' | 'ambiguous' | 'not_found' | 'action_failed' | 'skipped';
  selector?: string;
  resolvedCount?: number;
  suggestion?: string;
  error?: string;
}

export interface ValidationReport {
  valid: boolean;
  results: StepValidationResult[];
  tracePath?: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  _count?: { tests: number };
}

export interface ProjectWorkspaceSummary {
  checksCount: number;
  lastResult: RunStatus | null;
  lastRunAt: string | null;
  passRate30d: number | null;
  totalRuns30d: number;
  passedRuns30d: number;
  failedRuns30d: number;
  activeSchedulesCount: number;
  alertChannelsCount: number;
  avgDurationMs: number | null;
  failedChecks: number;
  flakyChecks: number;
}

export interface ProjectCheckSchedule {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
}

export interface ProjectCheckLatestRun {
  id: string;
  status: RunStatus;
  startedAt: string;
  durationMs?: number | null;
  error?: string | null;
  tracePath?: string | null;
}

export interface ProjectCheck extends Test {
  runCount: number;
  lastRunAt: string | null;
  lastRunStatus: RunStatus | null;
  lastRunDurationMs: number | null;
  latestRun?: ProjectCheckLatestRun | null;
  scheduleCount: number;
  schedules: ProjectCheckSchedule[];
}

export interface ProjectWorkspace extends Project {
  updatedAt: string;
  summary: ProjectWorkspaceSummary;
  tests: ProjectCheck[];
  suites?: Array<Suite & { schedules: ProjectCheckSchedule[] }>;
}

export type ProjectHealth = 'passing' | 'failing' | 'flaky' | 'no_runs';

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  checksCount: number;
  activeSchedulesCount: number;
  alertChannelsCount: number;
  alertChannelTypes: string[];
  lastRunAt: string | null;
  lastRunStatus: RunStatus | null;
  passRate30d: number | null;
  totalRuns30d: number;
  passedRuns30d: number;
  failedRuns30d: number;
  failedChecks: number;
  flakyChecks: number;
  health: ProjectHealth;
}

export interface DashboardChartPoint {
  date: string;
  passed: number;
  failed: number;
  total: number;
  passRate: number;
}

export interface DashboardSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  avgDurationMs: number;
  activeFailures: number;
  flakyChecks: number;
}

export interface DashboardRecentRun {
  runId: string;
  testId: string;
  checkName: string;
  projectId: string;
  projectName: string;
  status: RunStatus;
  durationMs: number | null;
  startedAt: string;
  trigger: 'Manual' | 'Schedule';
  scheduleName: string | null;
  environmentId: string | null;
}

export interface RunsSummarySlowestRun {
  runId: string;
  testId: string;
  checkName: string;
  projectId: string;
  projectName: string;
  durationMs: number | null;
}

export interface RunsSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  avgDurationMs: number | null;
  slowestRun: RunsSummarySlowestRun | null;
}

export interface DashboardIssue {
  testId: string;
  checkName: string;
  projectId: string;
  projectName: string;
  status: 'Failed' | 'Flaky' | 'Failing repeatedly';
  latestRunId: string;
  latestRunAt: string;
  latestFailedRunId: string;
  latestFailedAt: string;
  latestRunStatus: RunStatus;
  errorSummary: string | null;
  environmentId: string | null;
  passedRuns: number;
  failedRuns: number;
  totalRuns: number;
}

export interface DashboardFlakyCheck {
  testId: string;
  checkName: string;
  projectId: string;
  projectName: string;
  totalRuns: number;
  passed: number;
  failed: number;
  passRate: number;
  lastFailure: string | null;
  latestFailedRunId: string;
  errorSummary: string | null;
  latestRunId: string;
}

export interface DashboardResponse {
  summary: DashboardSummary;
  recentRuns: DashboardRecentRun[];
  activeIssues: DashboardIssue[];
  flakyChecks: DashboardFlakyCheck[];
  chart: DashboardChartPoint[];
}

export interface RunsResponse {
  runs: DashboardRecentRun[];
  total: number;
  days: number;
  limit: number;
  summary: RunsSummary;
}

export interface Suite {
  id: string;
  name: string;
  projectId: string;
  testIds: string[];
  createdAt: string;
  updatedAt: string;
  _count?: { schedules: number };
}

export interface Environment {
  id: string;
  name: string;
  projectId: string;
  variables: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export type NotificationChannelType = 'telegram' | 'slack';

export interface NotificationChannel {
  id: string;
  projectId: string;
  type: NotificationChannelType;
  name: string;
  config: Record<string, string>;
  onFailed: boolean;
  onRecovered: boolean;
  onPassed: boolean;
  enabled: boolean;
  lastTestAt?: string | null;
  lastTestStatus?: RunStatus | null;
  createdAt: string;
}

export interface Schedule {
  id: string;
  name: string;
  cron: string;
  projectId: string;
  suiteId?: string | null;
  suite?: Suite | null;
  testId?: string | null;
  test?: Test | null;
  environmentId?: string | null;
  environment?: Environment | null;
  enabled: boolean;
  lastRunAt?: string | null;
  lastRunStatus?: RunStatus | null;
  nextRunAt?: string | null;
  createdAt: string;
}

export interface ScheduleHistoryRun {
  id: string;
  testName: string;
  status: RunStatus;
  durationMs?: number | null;
  startedAt: string;
  error?: string | null;
}

export interface ScheduleHistoryBatch {
  tick: string;
  status: RunStatus;
  summary: string;
  durationMs: number;
  runs: ScheduleHistoryRun[];
}

export interface ScheduleHistoryResponse {
  schedule: {
    id: string;
    name: string;
    cron: string;
    projectId: string;
    target: string;
    lastRunAt?: string | null;
  };
  batches: ScheduleHistoryBatch[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export interface Test {
  id: string;
  name: string;
  url: string;
  device?: string | null;
  environmentId?: string | null;
  steps: Step[];
  projectId: string;
  createdAt: string;
  _count?: { runs: number };
}

export interface TestRun {
  id: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
  tracePath?: string;
  traceUnavailableReason?: string | null;
  trace?: {
    available: boolean;
    downloadUrl?: string;
    viewerUrl?: string;
    reason?: string;
  };
  screenshots: string[];
  currentStep?: number | null;
  totalSteps?: number | null;
  testId: string;
  environmentId?: string | null;
  stepResults?: Array<{
    index: number;
    action: StepAction;
    target: string;
    status: 'passed' | 'failed';
    durationMs: number;
    screenshot?: string | null;
    error?: string | null;
  }>;
  test?: (Test & {
    project?: Project | null;
  }) | null;
  environment?: Environment | null;
  schedule?: Schedule | null;
}
