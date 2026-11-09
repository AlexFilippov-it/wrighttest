export type RunStatus = 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED';
export type RunMode = 'NORMAL' | 'AUTH_REFRESH';
export type AuthStateStatus = 'UNAVAILABLE' | 'REFRESHING' | 'AVAILABLE' | 'REFRESH_FAILED';

export type StepAction =
  | 'goto'
  | 'click'
  | 'fill'
  | 'press'
  | 'keyboardPress'
  | 'selectOption'
  | 'assertVisible'
  | 'assertHidden'
  | 'assertText'
  | 'assertValue'
  | 'assertURL'
  | 'assertTitle'
  | 'assertChecked'
  | 'assertCount'
  | 'waitForSelector'
  | 'executeSql'
  | 'assertDatabaseResult'
  | 'generateData'
  | 'captureValue'
  | 'httpRequest';

export interface Step {
  action: StepAction;
  generator?: 'username' | 'email' | 'password' | 'uuid' | 'string' | 'number' | 'boolean' | 'date' | 'timestamp' | 'pattern';
  generatorOptions?: Record<string, string | number | boolean>;
  saveAs?: string;
  captureSource?: 'text' | 'input' | 'attribute' | 'url' | 'count';
  attributeName?: string;
  secret?: boolean;
  replace?: boolean;
  selector?: string;
  selectorCandidates?: string[];
  elementText?: string;
  elementTag?: string;
  value?: string;
  expected?: string;
  databaseConnectionId?: string;
  sql?: string;
  parameters?: Record<string, string | number | boolean | null>;
  assertion?: {
    type: 'rowCountEquals' | 'rowCountGreaterThan' | 'empty' | 'notEmpty' | 'columnEquals' | 'columnContains' | 'columnNotNull' | 'affectedRowsEquals';
    expected?: string;
    column?: string;
    rowIndex?: number;
  };
  waitForResult?: { timeoutMs: number; pollIntervalMs: number };
  saveResultAs?: string;
  saveResultType?: 'column' | 'rowCount' | 'affectedRows';
  saveRowIndex?: number;
  saveColumn?: string;
  captureRows?: boolean;
  http?: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
    url: string;
    headers?: Array<{ key: string; value: string; enabled: boolean; secret?: boolean }>;
    queryParams?: Array<{ key: string; value: string; enabled: boolean }>;
    body?: { type: 'none' | 'json' | 'text' | 'form-urlencoded'; value?: string; fields?: Array<{ key: string; value: string; enabled: boolean }> };
    timeoutMs?: number;
    followRedirects?: boolean;
    auth?: { type: 'none' | 'bearer' | 'basic' | 'apiKey'; token?: string; username?: string; password?: string; apiKeyName?: string; apiKeyValue?: string; apiKeyLocation?: 'header' };
    assertions?: Array<Record<string, unknown>>;
    capture?: Array<{ source: 'jsonPath' | 'responseHeader' | 'status' | 'responseTime' | 'textBody'; path?: string; headerName?: string; saveAs: string; secret?: boolean; replace?: boolean }>;
  };
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

export interface TestDataCase {
  name: string;
  enabled: boolean;
  variables: Record<string, string | { kind: 'literal'; value: unknown } | { kind: 'reference'; name: string; source?: 'project' | 'environment' } | { kind: 'generated'; generator: string; options?: Record<string, string | number | boolean>; secret?: boolean }>;
}

export interface ValidationReport {
  valid: boolean;
  results: StepValidationResult[];
  traceUrl?: string;
  traceViewerUrl?: string;
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
  currentUserRole?: ProjectRole;
  members?: ProjectMember[];
}

export type ProjectHealth = 'passing' | 'failing' | 'flaky' | 'no_runs';

export type ProjectRole = 'OWNER' | 'EDITOR' | 'VIEWER';
export type ProjectMemberStatus = 'ACTIVE' | 'PENDING';

export interface ProjectMember {
  id: string;
  projectId: string;
  userId?: string | null;
  email: string;
  role: ProjectRole;
  status: ProjectMemberStatus;
  createdAt: string;
  updatedAt: string;
  user?: { email: string } | null;
  isSystemAdmin?: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentUserRole?: ProjectRole | null;
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
  executionMode: 'INDEPENDENT' | 'SEQUENTIAL';
  executionConfig: {
    orderedTestIds: string[];
    mappings: Array<{
      sourceTestId: string; outputVariable: string; targetTestId: string;
      targetVariable: string; required: boolean; expectedType?: 'string' | 'number' | 'boolean' | 'json' | 'null';
    }>;
    dataCaseIndexes: Record<string, number>;
  };
  createdAt: string;
  updatedAt: string;
  _count?: { schedules: number };
}

export interface SuiteRun {
  id: string;
  suiteId: string;
  projectId: string;
  suiteName: string;
  executionMode: 'INDEPENDENT' | 'SEQUENTIAL';
  status: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED';
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  currentOrder: number;
  outputMetadata: Array<{ sourceTestId: string; outputVariable: string; targetTestId: string; targetVariable: string; type: string; secret: boolean }>;
  orderedChecks: Array<{ testId: string; name: string; order: number }>;
  testRuns: Array<{ id: string; testId: string; suiteOrder: number; status: string; startedAt: string; finishedAt: string | null; durationMs: number | null; error: string | null; dataCaseName: string | null; dataCaseIndex: number | null; test: { name: string } }>;
}

export interface Environment {
  id: string;
  name: string;
  projectId: string;
  variables: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export type DatabaseProvider = 'POSTGRESQL' | 'MYSQL' | 'SUPABASE';
export type DatabaseAccessMode = 'READ_ONLY' | 'READ_WRITE';
export interface DatabaseConnection {
  id: string;
  projectId: string;
  name: string;
  provider: DatabaseProvider;
  host: string;
  port: number;
  database: string;
  username: string;
  ssl: boolean;
  accessMode: DatabaseAccessMode;
  lastCheckedAt: string | null;
  lastSuccessfulCheckAt: string | null;
  lastCheckStatus: 'CONNECTED' | 'FAILED' | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectAuthProfile {
  id: string;
  projectId: string;
  environmentId: string;
  authCheckId: string;
  enabled: boolean;
  status: AuthStateStatus;
  refreshedAt?: string | null;
  refreshedRunId?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
  hasUsableState: boolean;
  environment: Pick<Environment, 'id' | 'name'>;
  authCheck: Pick<Test, 'id' | 'name'>;
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
  useProjectAuthentication: boolean;
  steps: Step[];
  testData: TestDataCase[];
  projectId: string;
  createdAt: string;
  _count?: { runs: number };
}

export interface TestRun {
  id: string;
  status: RunStatus;
  runMode?: RunMode;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
  tracePath?: string;
  traceUnavailableReason?: string | null;
  dataCaseName?: string | null;
  dataCaseIndex?: number | null;
  dataCaseVariables?: Record<string, unknown> | null;
  variableSnapshot?: Array<{ name: string; source: string; type: string; secret: boolean; value?: unknown }>;
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
    generated?: { variableName: string; generator: string; secret: boolean; value?: string | number | boolean };
    captured?: { variableName: string; source: string; type: string; secret: boolean; createdByStep: number; value?: string | number | boolean | null | Record<string, unknown> | unknown[] };
    database?: {
      connectionName: string;
      rowCount: number;
      affectedRows?: number;
      rowLimitReached: boolean;
      columns: string[];
      rows?: Record<string, string | number | boolean | null>[];
      assertion?: { type: NonNullable<Step['assertion']>['type']; passed: boolean };
    };
    http?: {
      method: string;
      url: string;
      status: number;
      durationMs: number;
      responseBytes: number;
      requestHeaderNames: string[];
      responseHeaderNames: string[];
      assertions: Array<{ type: string; passed: boolean; message: string }>;
      captures: Array<{ variableName: string; type: string; secret: boolean }>;
    };
  }>;
  test?: (Test & {
    project?: Project | null;
  }) | null;
  environment?: Environment | null;
  schedule?: Schedule | null;
}

export interface TestRunBatch {
  id: string;
  status: RunStatus;
  totalCases: number;
  completedCases: number;
  passedCases: number;
  failedCases: number;
  startedAt: string;
  finishedAt?: string | null;
  test: {
    id: string;
    name: string;
    projectId: string;
  };
  environment?: {
    id: string;
    name: string;
  } | null;
  runs: Array<{
    id: string;
    status: RunStatus;
    dataCaseName?: string | null;
    dataCaseIndex?: number | null;
    batchOrder?: number | null;
    durationMs?: number | null;
    error?: string | null;
    startedAt: string;
    finishedAt?: string | null;
    currentStep?: number | null;
    totalSteps?: number | null;
  }>;
}
