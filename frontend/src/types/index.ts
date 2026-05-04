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
  status: 'ok' | 'ambiguous' | 'not_found' | 'skipped';
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
  onPassed: boolean;
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
  screenshots: string[];
  currentStep?: number | null;
  totalSteps?: number | null;
  testId: string;
  environmentId?: string | null;
}
