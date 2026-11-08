import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Breadcrumb,
  Card,
  Col,
  Collapse,
  Image,
  Layout,
  Progress,
  Row,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Descriptions
} from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getRun, runTest, runTestWithEnvironment } from '../api/client';
import AppHeader from '../components/AppHeader';
import AppFooter from '../components/AppFooter';
import UserMenu from '../components/UserMenu';
import RunStatusBadge from '../components/RunStatusBadge';
import '../components/database-testing.css';
import type { RunStatus, Step, StepAction, TestRun } from '../types';
import { BACKEND_URL } from '../utils/runtimeConfig';
import { useAppShell } from '../shell/ShellContext';
import { isSecretVariableName } from '../utils/secret-variable';

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;

type StepResultRow = {
  key: number;
  step: number;
  action: string;
  target: string;
  status: 'passed' | 'failed' | 'pending';
  durationMs?: number | null;
  screenshot?: string | null;
  error?: string | null;
  database?: NonNullable<NonNullable<TestRun['stepResults']>[number]['database']>;
  generated?: NonNullable<NonNullable<TestRun['stepResults']>[number]['generated']>;
  captured?: NonNullable<NonNullable<TestRun['stepResults']>[number]['captured']>;
  stepDefinition?: Step;
};

function resolveBackendUrl(value?: string) {
  if (!value) return undefined;
  return value.startsWith('http') ? value : `${BACKEND_URL}${value}`;
}

function humanizeAction(action: StepAction | string, t: (key: string) => string) {
  const key = `step.action.${action}`;
  const translated = t(key);
  return translated === key ? action : translated;
}

function formatDuration(ms?: number | null) {
  if (!ms && ms !== 0) return '—';
  return `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}s`;
}

function formatTimestamp(value: string | null | undefined, locale: string) {
  if (!value) return '—';
  return new Date(value).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatRelativeTime(value: string | null | undefined, t: (key: string, options?: { count: number }) => string) {
  if (!value) return t('common.never');
  const diffMs = Date.now() - new Date(value).getTime();
  const abs = Math.max(0, diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < minute) return t('time.justNow');
  if (abs < hour) return t('time.minutesAgo', { count: Math.round(abs / minute) });
  if (abs < day) return t('time.hoursAgo', { count: Math.round(abs / hour) });
  return t('time.daysAgo', { count: Math.round(abs / day) });
}

function extractCompactStepTarget(step: { selector?: string; value?: string; expected?: string }) {
  return step.selector ?? step.value ?? step.expected ?? '—';
}

function buildStepRows(run: TestRun, t: (key: string) => string): StepResultRow[] {
  if (run.stepResults?.length) {
    return run.stepResults.map((stepResult, index) => ({
      key: index + 1,
      step: index + 1,
      action: humanizeAction(stepResult.action, t),
      target: stepResult.target || '—',
      status: stepResult.status,
      durationMs: stepResult.durationMs,
      screenshot: stepResult.screenshot ?? undefined,
      error: stepResult.error ?? undefined,
      database: stepResult.database,
      generated: stepResult.generated,
      captured: stepResult.captured,
      stepDefinition: run.test?.steps?.[stepResult.index]
    }));
  }

  const fallbackSteps = run.test?.steps ?? [];
  const failedIndex = (run.currentStep ?? 0) > 0 ? run.currentStep ?? 0 : null;
  return fallbackSteps.map((step, index) => ({
    key: index + 1,
    step: index + 1,
    action: humanizeAction(step.action, t),
    target: extractCompactStepTarget(step),
    status:
      run.status === 'FAILED' && failedIndex === index + 1
        ? 'failed'
        : index + 1 < (run.currentStep ?? 0)
          ? 'passed'
          : 'pending',
    durationMs: null,
    screenshot: run.screenshots[index],
    error: undefined,
    stepDefinition: fallbackSteps[index]
  }));
}

function parseFailureSummary(error?: string) {
  if (!error) return null;
  const raw = error.replace(/\r/g, '').trim();
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);

  const expectedMatch =
    raw.match(/Expected(?: pattern)?:\s*(.+)/i) ??
    raw.match(/Expected:\s*(.+)/i) ??
    raw.match(/expected:\s*(.+)/i);
  const receivedMatch =
    raw.match(/Received(?: string)?:\s*(.+)/i) ??
    raw.match(/Received:\s*(.+)/i) ??
    raw.match(/received:\s*(.+)/i);
  const timeoutMatch =
    raw.match(/Timeout\s+(\d+(?:\.\d+)?)ms/i) ??
    raw.match(/timeout\s+(\d+(?:\.\d+)?)ms/i) ??
    raw.match(/Timeout:\s*(\d+(?:\.\d+)?)ms/i);

  const cleanup = (value?: string) => {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  };

  return {
    summary: lines[0] ?? 'Check failed',
    expected: cleanup(expectedMatch?.[1]),
    received: cleanup(receivedMatch?.[1]),
    timeout: timeoutMatch ? `${timeoutMatch[1]}ms` : undefined,
    raw
  };
}

export default function RunResultPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { runId } = useParams<{ runId: string }>();
  const { setProject: setShellProject } = useAppShell();
  const [run, setRun] = useState<TestRun | null>(null);
  const [rerunning, setRerunning] = useState(false);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      const data = await getRun(runId!);
      setRun(data);
      if (data.status !== 'PENDING' && data.status !== 'RUNNING' && interval) {
        clearInterval(interval);
      }
    };

    void poll();
    interval = setInterval(() => {
      void poll();
    }, 2000);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [runId]);

  useEffect(() => {
    const project = run?.test?.project;
    if (!project) return;
    setShellProject({ id: project.id, name: project.name });
    return () => {
      setShellProject((current) => (current?.id === project.id ? null : current));
    };
  }, [run?.test?.project, setShellProject]);

  const isActive = run?.status === 'PENDING' || run?.status === 'RUNNING';
  const totalSteps = run?.totalSteps ?? run?.screenshots.length ?? run?.stepResults?.length ?? 0;
  const currentStep = run?.currentStep ?? (run?.screenshots.length ?? 0);
  const progressPercent = totalSteps > 0 ? Math.min(100, Math.round((currentStep / totalSteps) * 100)) : 0;
  const trace = run?.trace;
  const traceAvailable = Boolean(trace?.available);
  const traceDownloadUrl = traceAvailable
    ? resolveBackendUrl(trace?.downloadUrl ?? (run?.tracePath ? `/api/traces/${run.tracePath}` : undefined))
    : undefined;
  const traceViewerUrl = traceAvailable
    ? resolveBackendUrl(
        trace?.viewerUrl ?? (run?.tracePath ? `/trace-viewer/?trace=${encodeURIComponent(`${BACKEND_URL}/api/traces/${run.tracePath}`)}` : undefined)
      )
    : undefined;

  const stepRows = useMemo(() => (run ? buildStepRows(run, t) : []), [run, t]);
  const variableRows = useMemo(() => {
    if (!run) return [];
    const rows: Array<{ key: string; name: string; source: string; type: string; step?: number; secret: boolean; value?: string }> = [];
    if (run.dataCaseName) rows.push({ key: 'case', name: t('capture.results.dataCase'), source: run.dataCaseName, type: '—', secret: false });
    if (run.variableSnapshot?.length) {
      for (const variable of run.variableSnapshot) rows.push({
        key: `snapshot:${variable.source}:${variable.name}`,
        name: variable.name,
        source: variable.source === 'project' || variable.source === 'environment' ? t(`capture.variableSource.${variable.source}`) : variable.source === 'generated' ? t('capture.results.generated') : t('capture.results.dataCase'),
        type: variable.type,
        secret: variable.secret,
        value: variable.secret ? '••••••••' : variable.value === null ? 'null' : typeof variable.value === 'object' ? JSON.stringify(variable.value) : String(variable.value ?? '—')
      });
    } else {
      for (const [name, value] of Object.entries(run.dataCaseVariables ?? {})) {
        const secret = isSecretVariableName(name);
        rows.push({ key: `data:${name}`, name, source: t('capture.results.dataCase'), type: value === null ? 'null' : typeof value, secret, value: secret ? '••••••••' : String(value ?? '—') });
      }
    }
    for (const result of run.stepResults ?? []) {
      if (result.generated) rows.push({
        key: `generated:${result.index}:${result.generated.variableName}`,
        name: result.generated.variableName,
        source: t('capture.results.generated'),
        type: typeof result.generated.value,
        step: result.index + 1,
        secret: result.generated.secret,
        value: result.generated.secret ? '••••••••' : String(result.generated.value ?? '—')
      });
      if (result.captured) rows.push({
        key: `captured:${result.index}:${result.captured.variableName}`,
        name: result.captured.variableName,
        source: result.captured.source === 'sql' ? t('connections.sqlQuery') : t(`capture.source.${result.captured.source}`),
        type: result.captured.type,
        step: result.captured.createdByStep,
        secret: result.captured.secret,
        value: result.captured.secret ? '••••••••' : result.captured.value === null ? 'null' : typeof result.captured.value === 'object' ? JSON.stringify(result.captured.value) : String(result.captured.value ?? '—')
      });
    }
    return rows;
  }, [run, t]);

  const failedStepIndex = useMemo(() => {
    if (!run) return null;
    const failedResult = run.stepResults?.find((stepResult) => stepResult.status === 'failed');
    if (failedResult) return failedResult.index + 1;
    if (run.status === 'FAILED' && run.currentStep) return run.currentStep;
    return null;
  }, [run]);

  const failedStep = useMemo(() => {
    if (!run || !failedStepIndex) return null;
    return run.stepResults?.find((stepResult) => stepResult.index + 1 === failedStepIndex) ?? null;
  }, [run, failedStepIndex]);

  const failedTestStep = useMemo(() => {
    if (!run?.test?.steps || !failedStepIndex) return null;
    return run.test.steps[failedStepIndex - 1] ?? null;
  }, [run, failedStepIndex]);

  const failureSummary = useMemo(() => parseFailureSummary(run?.error), [run?.error]);

  const failedScreenshotName = failedStep?.screenshot ?? (failedStepIndex ? run?.screenshots[failedStepIndex - 1] : undefined);
  const failedScreenshotUrl = resolveBackendUrl(failedScreenshotName ? `/screenshots/${failedScreenshotName}` : undefined);

  const runContext = useMemo(() => {
    if (!run) return [];
    const parts = [
      run.test?.name,
      run.test?.project?.name,
      run.environment?.name,
      run.dataCaseName ? `Test data case: ${run.dataCaseName}` : undefined,
      run.test?.device,
      run.schedule?.name ?? 'Manual run'
    ].filter(Boolean) as string[];
    return parts;
  }, [run]);

  const handleRerun = async () => {
    if (!run) return;
    setRerunning(true);
    try {
      const nextRun = run.environmentId
        ? await runTestWithEnvironment(run.testId, run.environmentId, run.dataCaseIndex ?? undefined)
        : await runTest(run.testId, run.dataCaseIndex ?? undefined);
      navigate(`/runs/${nextRun.testRunId}`);
    } finally {
      setRerunning(false);
    }
  };

  const traceSummaryCard = (
    <Card
      size="small"
      style={{ borderRadius: 16, height: '100%' }}
      bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 132 }}
      title={t('runResult.trace')}
    >
      {traceAvailable ? (
        <>
          <Tag color="green">{t('runResult.available')}</Tag>
          <Space wrap size={8}>
            {traceViewerUrl && (
              <Button type="link" href={traceViewerUrl} target="_blank" rel="noreferrer" style={{ paddingInline: 0 }}>
                {t('runResult.openTrace')}
              </Button>
            )}
            {traceDownloadUrl && (
              <Button type="link" href={traceDownloadUrl} target="_blank" rel="noreferrer" style={{ paddingInline: 0 }}>
                {t('runResult.downloadTrace')}
              </Button>
            )}
          </Space>
        </>
      ) : (
        <>
          <Tag color="default">{t('runResult.unavailable')}</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {trace?.reason ?? run?.traceUnavailableReason ?? t('runResult.traceUnavailable')}
          </Text>
        </>
      )}
    </Card>
  );

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #ffffff 100%)' }}>
      <AppHeader actions={[<UserMenu key="menu" />]} />
      <Content className="wt-surface-page" style={{ padding: 32, maxWidth: 1440, width: '100%', margin: '0 auto' }}>
        <Row gutter={[24, 24]}>
          <Col span={24}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Breadcrumb
                  items={[
                    { title: <Link to="/projects">{t('nav.projects')}</Link> },
                    ...(run?.test?.project ? [
                      { title: <Link to={`/projects/${run.test.project.id}/checks`}>{run.test.project.name}</Link> },
                      { title: <Link to={`/projects/${run.test.project.id}/runs`}>{t('project.runs')}</Link> }
                    ] : []),
                    { title: t('runResult.title') }
                  ]}
                />
                <Space wrap align="center" size={[12, 12]}>
                  <div>
                    <Space wrap align="center" size={10}>
                      <Title level={2} style={{ margin: 0 }}>
                        {t('runResult.title')}
                      </Title>
                      {run && <RunStatusBadge status={run.status} />}
                    </Space>
                    <Text type="secondary">
                      {t('runResult.description')}
                    </Text>
                    {runContext.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <Text type="secondary" style={{ fontSize: 13 }}>
                          {runContext.join(' · ')}
                        </Text>
                      </div>
                    )}
                  </div>
                  {isActive && <Tag color="processing">{t('runResult.livePolling')}</Tag>}
                </Space>
              </div>
            </Card>
          </Col>

          <Col span={24}>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} md={8} lg={4}>
                <Card size="small" style={{ borderRadius: 16 }} bodyStyle={{ minHeight: 116 }}>
                  <Text type="secondary">{t('common.status')}</Text>
                  <div style={{ marginTop: 10 }}>
                    {run ? <RunStatusBadge status={run.status} /> : <Skeleton.Input active size="small" />}
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={8} lg={4}>
                <Card size="small" style={{ borderRadius: 16 }} bodyStyle={{ minHeight: 116 }}>
                  <Text type="secondary">{t('runResult.progress')}</Text>
                  <div style={{ marginTop: 10 }}>
                    <Text strong>{totalSteps > 0 ? t('runResult.stepProgress', { current: currentStep, total: totalSteps }) : '—'}</Text>
                    <Progress percent={progressPercent} size="small" status={run?.status === 'FAILED' ? 'exception' : 'active'} />
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={8} lg={4}>
                <Card size="small" style={{ borderRadius: 16 }} bodyStyle={{ minHeight: 116 }}>
                  <Text type="secondary">{t('common.duration')}</Text>
                  <div style={{ marginTop: 10 }}>
                    <Title level={4} style={{ margin: 0 }}>
                      {run?.durationMs ? formatDuration(run.durationMs) : '—'}
                    </Title>
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={8} lg={4}>
                <Card size="small" style={{ borderRadius: 16 }} bodyStyle={{ minHeight: 116 }}>
                  <Text type="secondary">{t('common.started')}</Text>
                  <div style={{ marginTop: 10 }}>
                    <Text>{formatTimestamp(run?.startedAt, i18n.resolvedLanguage ?? 'en')}</Text>
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={8} lg={4}>
                <Card size="small" style={{ borderRadius: 16 }} bodyStyle={{ minHeight: 116 }}>
                  <Text type="secondary">{t('runResult.finished')}</Text>
                  <div style={{ marginTop: 10 }}>
                    <Text>{formatTimestamp(run?.finishedAt, i18n.resolvedLanguage ?? 'en')}</Text>
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={8} lg={4}>
                {traceSummaryCard}
              </Col>
            </Row>
          </Col>

          {variableRows.length > 0 && <Col span={24}>
            <Card title={t('capture.results.title')}>
              <Table
                size="small"
                pagination={false}
                rowKey="key"
                dataSource={variableRows}
                scroll={{ x: true }}
                columns={[
                  { title: t('capture.results.name'), dataIndex: 'name' },
                  { title: t('capture.results.source'), dataIndex: 'source' },
                  { title: t('capture.results.type'), dataIndex: 'type' },
                  { title: t('capture.results.step'), dataIndex: 'step', render: (value?: number) => value ?? '—' },
                  { title: t('capture.results.secret'), dataIndex: 'secret', render: (value: boolean) => value ? t('testData.yes') : t('testData.no') },
                  { title: t('capture.results.value'), dataIndex: 'value', render: (value?: string) => value ?? '—' }
                ]}
              />
            </Card>
          </Col>}

          {run?.status === 'FAILED' && (
            <Col span={24}>
              <Card
                title={t('runResult.failureSummary')}
                style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
                extra={
                  <Space wrap>
                    {traceViewerUrl && (
                      <Button href={traceViewerUrl} target="_blank" rel="noreferrer">
                        {t('runResult.openTrace')}
                      </Button>
                    )}
                    {failedScreenshotUrl && (
                      <Button href={failedScreenshotUrl} target="_blank" rel="noreferrer">
                        {t('runResult.viewFailedScreenshot')}
                      </Button>
                    )}
                    {run.testId && (
                      <Button onClick={() => void handleRerun()} loading={rerunning}>
                        {t('dashboard.rerun')}
                      </Button>
                    )}
                    {run.testId && (
                      <Button href={`/tests/${run.testId}/edit`}>
                        {t('dashboard.editCheck')}
                      </Button>
                    )}
                  </Space>
                }
              >
                <Space orientation="vertical" size={12} style={{ width: '100%' }}>
                  <Title level={4} style={{ margin: 0 }}>
                    {t('runResult.failedAtStep', { step: failedStepIndex ?? run.currentStep ?? '—' })} —{' '}
                    {humanizeAction(failedStep?.action ?? failedTestStep?.action ?? 'step', t)}
                  </Title>
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={8}>
                      <Card size="small" bordered={false} style={{ background: '#fafafa' }}>
                        <Text type="secondary">{t('runResult.expected')}</Text>
                        <div style={{ marginTop: 4 }}>
                          <Text>{failureSummary?.expected ?? '—'}</Text>
                        </div>
                      </Card>
                    </Col>
                    <Col xs={24} md={8}>
                      <Card size="small" bordered={false} style={{ background: '#fafafa' }}>
                        <Text type="secondary">{t('runResult.received')}</Text>
                        <div style={{ marginTop: 4 }}>
                          <Text>{failureSummary?.received ?? '—'}</Text>
                        </div>
                      </Card>
                    </Col>
                    <Col xs={24} md={8}>
                      <Card size="small" bordered={false} style={{ background: '#fafafa' }}>
                        <Text type="secondary">{t('runResult.timeout')}</Text>
                        <div style={{ marginTop: 4 }}>
                          <Text>{failureSummary?.timeout ?? '—'}</Text>
                        </div>
                      </Card>
                    </Col>
                  </Row>
                  <Card size="small" bordered={false} style={{ background: '#fafafa' }}>
                    <Text type="secondary">{t('runResult.errorSummary')}</Text>
                    <div style={{ marginTop: 4 }}>
                      <Text>{failureSummary?.summary ?? t('runResult.checkFailed')}</Text>
                    </div>
                  </Card>
                  <Collapse ghost>
                    <Collapse.Panel header={t('runResult.showRawError')} key="raw">
                      <Paragraph
                        copyable
                        style={{
                          whiteSpace: 'pre-wrap',
                          marginBottom: 0,
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          fontSize: 12
                        }}
                      >
                        {run.error}
                      </Paragraph>
                    </Collapse.Panel>
                  </Collapse>
                </Space>
              </Card>
            </Col>
          )}

          <Col span={24}>
            <Card
              title={t('runResult.stepResults')}
              style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
              extra={totalSteps > 0 ? <Text type="secondary">{t('runResult.stepCount', { count: totalSteps })}</Text> : null}
            >
              {!run ? (
                <Skeleton active />
              ) : stepRows.length === 0 ? (
                <Text type="secondary">{t('runResult.noStepResults')}</Text>
              ) : (
                <Table
                  dataSource={stepRows}
                  rowKey="key"
                  size="small"
                  pagination={false}
                  rowClassName={(record?: StepResultRow) => (record?.status === 'failed' ? 'run-step-row-failed' : '')}
                  expandable={{
                    expandedRowRender: (record) => {
                      if (!record) return null;
                      const step = record.stepDefinition;
                      const parameters = Object.entries(step?.parameters ?? {}).map(([name, value]) => ({
                        key: name,
                        label: name,
                        children: typeof value === 'string' && /^\{\{[A-Z][A-Z0-9_]*\}\}$/.test(value) ? value : '••••••'
                      }));
                      return <div className="wt-run-sql-details">
                        {record.generated && <div>
                          <Text type="secondary">{t('testData.generatedDetails')}</Text>
                          <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
                            { key: 'variable', label: t('testData.variable'), children: `{{${record.generated.variableName}}}` },
                            { key: 'generator', label: t('testData.generatorLabel'), children: t(`testData.generator.${record.generated.generator}`) },
                            { key: 'scope', label: t('testData.scope'), children: t('testData.currentRun') },
                            { key: 'secret', label: t('testData.secret'), children: record.generated.secret ? t('testData.yes') : t('testData.no') },
                            { key: 'value', label: t('testData.value'), children: record.generated.secret ? '••••••••' : String(record.generated.value ?? '—') }
                          ]} />
                        </div>}
                        {record.captured && <div>
                          <Text type="secondary">{t('capture.results.captured')}</Text>
                          <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
                            { key: 'variable', label: t('capture.results.name'), children: `{{${record.captured.variableName}}}` },
                            { key: 'source', label: t('capture.results.source'), children: record.captured.source === 'sql' ? t('connections.sqlQuery') : t(`capture.source.${record.captured.source}`) },
                            { key: 'type', label: t('capture.results.type'), children: record.captured.type },
                            { key: 'step', label: t('capture.results.step'), children: record.captured.createdByStep },
                            { key: 'secret', label: t('capture.results.secret'), children: record.captured.secret ? t('testData.yes') : t('testData.no') },
                            { key: 'value', label: t('capture.results.value'), children: record.captured.secret ? '••••••••' : record.captured.value === null ? 'null' : typeof record.captured.value === 'object' ? JSON.stringify(record.captured.value) : String(record.captured.value ?? '—') }
                          ]} />
                        </div>}
                        {step?.sql && <div>
                          <Text type="secondary">{t('connections.sqlQuery')}</Text>
                          <pre className="wt-run-sql-query">{step.sql}</pre>
                        </div>}
                        {parameters.length > 0 && <div>
                          <Text type="secondary">{t('connections.parameters')}</Text>
                          <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} items={parameters} />
                        </div>}
                        {step?.assertion && <div>
                          <Text type="secondary">{t('connections.assertion')}</Text>
                          <Space wrap>
                            <Tag>{t(`connections.assertion.${step.assertion.type}`)}</Tag>
                            {step.assertion.column && <Text>{t('connections.column')}: {step.assertion.column}</Text>}
                            {step.assertion.expected !== undefined && <Text>{t('connections.expected')}: {/^\{\{[A-Z][A-Z0-9_]*\}\}$/.test(step.assertion.expected) ? step.assertion.expected : '••••••'}</Text>}
                          </Space>
                        </div>}
                        {record.database && <div>
                          <Space wrap>
                            <Text>{t('connections.rowsReturned', { count: record.database.rowCount })}{record.database.rowLimitReached ? '+' : ''}</Text>
                            <Text>{t('connections.rowsAffected', { count: record.database.affectedRows })}</Text>
                            {record.database.assertion && <Tag color={record.database.assertion.passed ? 'success' : 'error'}>{t(record.database.assertion.passed ? 'connections.assertionPassed' : 'connections.assertionFailed')}</Tag>}
                          </Space>
                          {record.database.rows && record.database.rows.length > 0 ? <Table
                            size="small"
                            pagination={false}
                            rowKey={(_, index) => String(index)}
                            dataSource={record.database.rows}
                            columns={record.database.columns.map((column) => ({ title: column, dataIndex: column, render: (value: unknown) => String(value ?? '—') }))}
                            scroll={{ x: true }}
                          /> : <Text type="secondary">{t('connections.noCapturedRows')}</Text>}
                          {record.database.rowLimitReached && <Text type="secondary">{t('connections.resultTruncated')}</Text>}
                        </div>}
                        {record.error && <Alert type="error" showIcon message={record.error} />}
                      </div>;
                    },
                    rowExpandable: (record) => Boolean(record && (record.captured || record.stepDefinition?.action === 'executeSql' || record.database || record.stepDefinition?.sql))
                  }}
                  columns={[
                    {
                      title: t('runResult.step'),
                      dataIndex: 'step',
                      width: 80
                    },
                    {
                      title: t('runResult.action'),
                      dataIndex: 'action',
                      width: 180
                    },
                    {
                      title: t('runResult.target'),
                      dataIndex: 'target',
                      render: (value: string) => (
                        <Tooltip title={value} placement="topLeft">
                          <Text style={{ maxWidth: 360 }} ellipsis>
                            {value}
                          </Text>
                        </Tooltip>
                      )
                    },
                    {
                      title: t('connections.databaseResult'),
                      dataIndex: 'database',
                      width: 230,
                      render: (database?: StepResultRow['database']) => database ? <Space orientation="vertical" size={0}>
                        <Text>{database.connectionName}</Text>
                        <Text type="secondary">{t('connections.rowsReturned', { count: database.rowCount })}{database.rowLimitReached ? '+' : ''} · {t('connections.rowsAffected', { count: database.affectedRows })}</Text>
                        {database.assertion && <Tag color={database.assertion.passed ? 'success' : 'error'}>{t(database.assertion.passed ? 'connections.assertionPassed' : 'connections.assertionFailed')}</Tag>}
                      </Space> : '—'
                    },
                    {
                      title: t('common.status'),
                      dataIndex: 'status',
                      width: 120,
                      render: (status: StepResultRow['status']) => {
                        const color =
                          status === 'passed' ? 'green' : status === 'failed' ? 'red' : 'default';
                        const label =
                          status === 'passed' ? t('common.passed') : status === 'failed' ? t('common.failed') : t('status.pending');
                        return <Tag color={color}>{label}</Tag>;
                      }
                    },
                    {
                      title: t('runResult.error'),
                      dataIndex: 'error',
                      render: (error?: string | null, record?: StepResultRow) =>
                        error ? (
                          <Tooltip title={error} placement="topLeft">
                            <Text
                              style={{
                                maxWidth: 420,
                                color: record?.status === 'failed' ? '#cf1322' : undefined
                              }}
                              ellipsis
                            >
                              {error}
                            </Text>
                          </Tooltip>
                        ) : (
                          '—'
                        )
                    },
                    {
                      title: t('common.duration'),
                      dataIndex: 'durationMs',
                      width: 120,
                      render: (durationMs?: number | null) => formatDuration(durationMs)
                    },
                    {
                      title: t('runResult.screenshot'),
                      dataIndex: 'screenshot',
                      width: 120,
                      render: (screenshot?: string | null) =>
                        screenshot ? (
                          <a href={resolveBackendUrl(`/screenshots/${screenshot}`)} target="_blank" rel="noreferrer">
                            {t('common.view')}
                          </a>
                        ) : (
                          '—'
                        )
                    }
                  ]}
                />
              )}
            </Card>
          </Col>

          {(run?.screenshots?.length ?? 0) > 0 && (
            <Col span={24}>
              <Card
                title={t('runResult.screenshots')}
                style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
              >
                <Space wrap>
                  {run?.screenshots.map((name, index) => (
                    <Card
                      key={name}
                      size="small"
                      style={{ width: 320, borderRadius: 16 }}
                      cover={
                        <Image
                          alt={t('runResult.stepNumber', { number: index + 1 })}
                          src={`${BACKEND_URL}/screenshots/${name}`}
                          preview
                        />
                      }
                    >
                      <Card.Meta title={t('runResult.stepNumber', { number: index + 1 })} description={name} />
                    </Card>
                  ))}
                </Space>
              </Card>
            </Col>
          )}

          {traceAvailable && traceViewerUrl && (
            <Col span={24}>
              <Card
                title={t('runResult.traceViewer')}
                style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
                extra={
                  <Space wrap>
                    <a href={traceViewerUrl} target="_blank" rel="noreferrer">
                      {t('runResult.openInNewTab')}
                    </a>
                    {traceDownloadUrl && (
                      <a href={traceDownloadUrl} target="_blank" rel="noreferrer">
                        {t('runResult.downloadTrace')}
                      </a>
                    )}
                  </Space>
                }
              >
                <iframe
                  src={traceViewerUrl}
                  style={{
                    width: '100%',
                    minHeight: 720,
                    border: '1px solid #d9d9d9',
                    borderRadius: 12,
                    background: '#fff'
                  }}
                  title={t('runResult.traceViewerFrameTitle')}
                />
              </Card>
            </Col>
          )}

          {run?.status !== 'FAILED' && run?.error && (
            <Col span={24}>
              <Alert
                type="error"
                showIcon
                message={t('runResult.runFailed')}
                description={run.error}
              />
            </Col>
          )}
        </Row>
      </Content>
      <style>{`
        .run-step-row-failed td {
          background: #fff1f0 !important;
        }
      `}</style>
      <AppFooter />
    </Layout>
  );
}
