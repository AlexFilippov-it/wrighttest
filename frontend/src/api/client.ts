import axios from 'axios';
import type {
  Environment,
  NotificationChannel,
  NotificationChannelType,
  Project,
  Schedule,
  ScheduleHistoryResponse,
  Suite,
  Step,
  Test,
  TestRun,
  ValidationReport
} from '../types';

export const api = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000'
});

export const getProjects = () =>
  api.get<Project[]>('/projects').then((r) => r.data);

export const getDashboard = (days: number) =>
  api.get(`/dashboard?days=${days}`).then((r) => r.data);

export const getFlakyTests = () =>
  api.get('/dashboard/flaky').then((r) => r.data);

export const createProject = (name: string) =>
  api.post<Project>('/projects', { name }).then((r) => r.data);

export const deleteProject = (id: string) =>
  api.delete(`/projects/${id}`);

export const getProject = (id: string) =>
  api.get<Project & { tests: Test[] }>(`/projects/${id}`).then((r) => r.data);

export const getDevices = () =>
  api.get<{ label: string; value: string }[]>('/devices').then((r) => r.data);

export const getSuites = (projectId: string) =>
  api.get<Suite[]>(`/projects/${projectId}/suites`).then((r) => r.data);

export const createSuite = (
  projectId: string,
  data: { name: string; testIds: string[] }
) => api.post<Suite>(`/projects/${projectId}/suites`, data).then((r) => r.data);

export const updateSuite = (
  id: string,
  data: Partial<{ name: string; testIds: string[] }>
) => api.patch<Suite>(`/suites/${id}`, data).then((r) => r.data);

export const deleteSuite = (id: string) =>
  api.delete(`/suites/${id}`);

export const runSuite = (id: string, environmentId?: string) =>
  api.post<{ suiteId: string; queued: number; jobs: { testRunId: string; testId: string }[] }>(
    `/suites/${id}/run`,
    environmentId ? { environmentId } : {}
  ).then((r) => r.data);

export const getSchedules = (projectId: string) =>
  api.get<Schedule[]>(`/projects/${projectId}/schedules`).then((r) => r.data);

export const getScheduleHistory = (scheduleId: string, page = 1, limit = 20) =>
  api.get<ScheduleHistoryResponse>(`/schedules/${scheduleId}/history`, {
    params: { page, limit }
  }).then((r) => r.data);

export const createSchedule = (
  projectId: string,
  data: {
    name: string;
    cron: string;
    suiteId?: string;
    testId?: string;
    environmentId?: string;
    enabled: boolean;
  }
) => api.post<Schedule>(`/projects/${projectId}/schedules`, data).then((r) => r.data);

export const updateSchedule = (
  id: string,
  data: Partial<{
    name: string;
    cron: string;
    suiteId: string | null;
    testId: string | null;
    environmentId: string | null;
    enabled: boolean;
  }>
) => api.patch<Schedule>(`/schedules/${id}`, data).then((r) => r.data);

export const deleteSchedule = (id: string) =>
  api.delete(`/schedules/${id}`);

export const getEnvironments = (projectId: string) =>
  api.get<Environment[]>(`/projects/${projectId}/environments`).then((r) => r.data);

export const createEnvironment = (projectId: string, data: { name: string; variables: Record<string, string> }) =>
  api.post<Environment>(`/projects/${projectId}/environments`, data).then((r) => r.data);

export const updateEnvironment = (
  id: string,
  data: Partial<{ name: string; variables: Record<string, string> }>
) => api.patch<Environment>(`/environments/${id}`, data).then((r) => r.data);

export const deleteEnvironment = (id: string) =>
  api.delete(`/environments/${id}`);

export const getChannels = (projectId: string) =>
  api.get<NotificationChannel[]>(`/projects/${projectId}/channels`).then((r) => r.data);

export const createChannel = (
  projectId: string,
  data: {
    type: NotificationChannelType;
    name: string;
    config: Record<string, string>;
    onFailed: boolean;
    onPassed: boolean;
  }
) => api.post<NotificationChannel>(`/projects/${projectId}/channels`, data).then((r) => r.data);

export const deleteChannel = (id: string) =>
  api.delete(`/channels/${id}`);

export const testChannel = (id: string) =>
  api.post<{ ok: boolean }>(`/channels/${id}/test`).then((r) => r.data);

export const createTest = (
  projectId: string,
  data: Omit<Test, 'id' | 'projectId' | 'createdAt' | '_count'>
) => api.post<Test>(`/projects/${projectId}/tests`, data).then((r) => r.data);

export const updateTest = (id: string, data: Partial<Test>) =>
  api.patch<Test>(`/tests/${id}`, data).then((r) => r.data);

export const getTest = (id: string) =>
  api.get<Test>(`/tests/${id}`).then((r) => r.data);

export const deleteTest = (id: string) =>
  api.delete(`/tests/${id}`);

export const importTestSpec = (projectId: string, code: string, name?: string) =>
  api.post<{ test: Test; parsedSteps: number }>(`/projects/${projectId}/import`, { code, name }).then((r) => r.data);

export const runTest = (testId: string) =>
  api
    .post<{ testRunId: string; jobId?: string; status: string }>(`/tests/${testId}/run`)
    .then((r) => r.data);

export const runTestWithEnvironment = (testId: string, environmentId?: string) =>
  api
    .post<{ testRunId: string; jobId?: string; status: string }>(`/tests/${testId}/run`, {
      environmentId
    })
    .then((r) => r.data);

export const triggerWebhook = (payload: {
  testId?: string;
  projectId?: string;
  environmentId?: string;
}) => api.post<{ queued: number; jobs: { testRunId: string; testId: string }[] }>(
  '/webhooks/trigger',
  payload
).then((r) => r.data);

export const getRun = (runId: string) =>
  api.get<TestRun>(`/runs/${runId}`).then((r) => r.data);

export const getTestRuns = (testId: string) =>
  api.get<TestRun[]>(`/tests/${testId}/runs`).then((r) => r.data);

export const validateTestSteps = (url: string, steps: Step[], device?: string | null) =>
  api.post<ValidationReport>('/tests/validate', {
    url,
    steps,
    device: device || undefined
  }).then((r) => r.data);

export const startRecording = (url: string, environmentId?: string, device?: string) =>
  api.post<{ sessionId: string; status: string }>('/recordings/start', {
    url,
    environmentId,
    device
  }).then((r) => r.data);

export const stopRecording = (sessionId: string) =>
  api.post<{ steps: Step[] }>(`/recordings/${sessionId}/stop`).then((r) => r.data);
