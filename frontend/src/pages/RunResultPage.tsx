import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
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
  Typography
} from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getRun, runTest, runTestWithEnvironment } from '../api/client';
import AppHeader from '../components/AppHeader';
import AppFooter from '../components/AppFooter';
import UserMenu from '../components/UserMenu';
import RunStatusBadge from '../components/RunStatusBadge';
import type { RunStatus, StepAction, TestRun } from '../types';

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000';

type StepResultRow = {
  key: number;
  step: number;
  action: string;
  target: string;
  status: 'passed' | 'failed' | 'pending';
  durationMs?: number | null;
  screenshot?: string | null;
  error?: string | null;
};

function resolveBackendUrl(value?: string) {
  if (!value) return undefined;
  return value.startsWith('http') ? value : `${BACKEND_URL}${value}`;
}

function humanizeAction(action: StepAction | string) {
  const labels: Record<string, string> = {
    goto: 'Navigate to URL',
    click: 'Click element',
    fill: 'Fill input',
    press: 'Press key',
    selectOption: 'Select option',
    waitForSelector: 'Wait for element',
    assertVisible: 'Assert visible',
    assertHidden: 'Assert hidden',
    assertText: 'Assert text',
    assertValue: 'Assert value',
    assertURL: 'Assert URL',
    assertTitle: 'Assert title',
    assertChecked: 'Assert checked',
    assertCount: 'Assert count'
  };
  return labels[action] ?? action;
}

function formatDuration(ms?: number | null) {
  if (!ms && ms !== 0) return '—';
  return `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}s`;
}

function formatTimestamp(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatRelativeTime(value?: string | null) {
  if (!value) return 'Never';
  const diffMs = Date.now() - new Date(value).getTime();
  const abs = Math.max(0, diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < minute) return 'just now';
  if (abs < hour) return `${Math.round(abs / minute)} min ago`;
  if (abs < day) return `${Math.round(abs / hour)} hour${Math.round(abs / hour) === 1 ? '' : 's'} ago`;
  return `${Math.round(abs / day)} day${Math.round(abs / day) === 1 ? '' : 's'} ago`;
}

function extractCompactStepTarget(step: { selector?: string; value?: string; expected?: string }) {
  return step.selector ?? step.value ?? step.expected ?? '—';
}

function buildStepRows(run: TestRun): StepResultRow[] {
  if (run.stepResults?.length) {
    return run.stepResults.map((stepResult, index) => ({
      key: index + 1,
      step: index + 1,
      action: humanizeAction(stepResult.action),
      target: stepResult.target || '—',
      status: stepResult.status,
      durationMs: stepResult.durationMs,
      screenshot: stepResult.screenshot ?? undefined,
      error: stepResult.error ?? undefined
    }));
  }

  const fallbackSteps = run.test?.steps ?? [];
  const failedIndex = (run.currentStep ?? 0) > 0 ? run.currentStep ?? 0 : null;
  return fallbackSteps.map((step, index) => ({
    key: index + 1,
    step: index + 1,
    action: humanizeAction(step.action),
    target: extractCompactStepTarget(step),
    status:
      run.status === 'FAILED' && failedIndex === index + 1
        ? 'failed'
        : index + 1 < (run.currentStep ?? 0)
          ? 'passed'
          : 'pending',
    durationMs: null,
    screenshot: run.screenshots[index],
    error: undefined
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
  const navigate = useNavigate();
  const { runId } = useParams<{ runId: string }>();
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

  const isActive = run?.status === 'PENDING' || run?.status === 'RUNNING';
  const totalSteps = run?.totalSteps ?? run?.screenshots.length ?? run?.stepResults?.length ?? 0;
  const currentStep = run?.currentStep ?? (run?.screenshots.length ?? 0);
  const progressPercent = totalSteps > 0 ? Math.min(100, Math.round((currentStep / totalSteps) * 100)) : 0;
  const trace = run?.trace;
  const traceAvailable = Boolean(trace?.available);
  const traceDownloadUrl = traceAvailable
    ? resolveBackendUrl(trace?.downloadUrl ?? (run?.tracePath ? `/traces/${run.tracePath}` : undefined))
    : undefined;
  const traceViewerUrl = traceAvailable
    ? resolveBackendUrl(
        trace?.viewerUrl ?? (run?.tracePath ? `/trace-viewer/?trace=${encodeURIComponent(`${BACKEND_URL}/traces/${run.tracePath}`)}` : undefined)
      )
    : undefined;

  const stepRows = useMemo(() => (run ? buildStepRows(run) : []), [run]);

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
        ? await runTestWithEnvironment(run.testId, run.environmentId)
        : await runTest(run.testId);
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
      title="Trace"
    >
      {traceAvailable ? (
        <>
          <Tag color="green">Available</Tag>
          <Space wrap size={8}>
            {traceViewerUrl && (
              <Button type="link" href={traceViewerUrl} target="_blank" rel="noreferrer" style={{ paddingInline: 0 }}>
                Open trace
              </Button>
            )}
            {traceDownloadUrl && (
              <Button type="link" href={traceDownloadUrl} target="_blank" rel="noreferrer" style={{ paddingInline: 0 }}>
                Download trace.zip
              </Button>
            )}
          </Space>
        </>
      ) : (
        <>
          <Tag color="default">Unavailable</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {trace?.reason ?? run?.traceUnavailableReason ?? 'Trace is not available for this run.'}
          </Text>
        </>
      )}
    </Card>
  );

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #ffffff 100%)' }}>
      <AppHeader actions={[<UserMenu key="menu" />]} />
      <Content style={{ padding: 32, maxWidth: 1440, width: '100%', margin: '0 auto' }}>
        <Row gutter={[24, 24]}>
          <Col span={24}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Text type="secondary">
                  <Link to="/projects">Projects</Link> / Run Result
                </Text>
                <Space wrap align="center" size={[12, 12]}>
                  <div>
                    <Space wrap align="center" size={10}>
                      <Title level={2} style={{ margin: 0 }}>
                        Run Result
                      </Title>
                      {run && <RunStatusBadge status={run.status} />}
                    </Space>
                    <Text type="secondary">
                      Debug a browser check execution, step by step.
                    </Text>
                    {runContext.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <Text type="secondary" style={{ fontSize: 13 }}>
                          {runContext.join(' · ')}
                        </Text>
                      </div>
                    )}
                  </div>
                  {isActive && <Tag color="processing">Live polling</Tag>}
                </Space>
              </div>
            </Card>
          </Col>

          <Col span={24}>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} md={8} lg={4}>
                <Card size="small" style={{ borderRadius: 16 }} bodyStyle={{ minHeight: 116 }}>
                  <Text type="secondary">Status</Text>
                  <div style={{ marginTop: 10 }}>
                    {run ? <RunStatusBadge status={run.status} /> : <Skeleton.Input active size="small" />}
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={8} lg={4}>
                <Card size="small" style={{ borderRadius: 16 }} bodyStyle={{ minHeight: 116 }}>
                  <Text type="secondary">Progress</Text>
                  <div style={{ marginTop: 10 }}>
                    <Text strong>{totalSteps > 0 ? `${currentStep}/${totalSteps} steps` : '—'}</Text>
                    <Progress percent={progressPercent} size="small" status={run?.status === 'FAILED' ? 'exception' : 'active'} />
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={8} lg={4}>
                <Card size="small" style={{ borderRadius: 16 }} bodyStyle={{ minHeight: 116 }}>
                  <Text type="secondary">Duration</Text>
                  <div style={{ marginTop: 10 }}>
                    <Title level={4} style={{ margin: 0 }}>
                      {run?.durationMs ? formatDuration(run.durationMs) : '—'}
                    </Title>
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={8} lg={4}>
                <Card size="small" style={{ borderRadius: 16 }} bodyStyle={{ minHeight: 116 }}>
                  <Text type="secondary">Started</Text>
                  <div style={{ marginTop: 10 }}>
                    <Text>{formatTimestamp(run?.startedAt)}</Text>
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={8} lg={4}>
                <Card size="small" style={{ borderRadius: 16 }} bodyStyle={{ minHeight: 116 }}>
                  <Text type="secondary">Finished</Text>
                  <div style={{ marginTop: 10 }}>
                    <Text>{formatTimestamp(run?.finishedAt)}</Text>
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12} md={8} lg={4}>
                {traceSummaryCard}
              </Col>
            </Row>
          </Col>

          {run?.status === 'FAILED' && (
            <Col span={24}>
              <Card
                title="Failure summary"
                style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
                extra={
                  <Space wrap>
                    {traceViewerUrl && (
                      <Button href={traceViewerUrl} target="_blank" rel="noreferrer">
                        Open trace
                      </Button>
                    )}
                    {failedScreenshotUrl && (
                      <Button href={failedScreenshotUrl} target="_blank" rel="noreferrer">
                        View failed screenshot
                      </Button>
                    )}
                    {run.testId && (
                      <Button onClick={() => void handleRerun()} loading={rerunning}>
                        Rerun
                      </Button>
                    )}
                    {run.testId && (
                      <Button href={`/tests/${run.testId}/edit`}>
                        Edit check
                      </Button>
                    )}
                  </Space>
                }
              >
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Title level={4} style={{ margin: 0 }}>
                    Failed at Step {failedStepIndex ?? run.currentStep ?? '—'} —{' '}
                    {humanizeAction(failedStep?.action ?? failedTestStep?.action ?? 'step')}
                  </Title>
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={8}>
                      <Card size="small" bordered={false} style={{ background: '#fafafa' }}>
                        <Text type="secondary">Expected</Text>
                        <div style={{ marginTop: 4 }}>
                          <Text>{failureSummary?.expected ?? '—'}</Text>
                        </div>
                      </Card>
                    </Col>
                    <Col xs={24} md={8}>
                      <Card size="small" bordered={false} style={{ background: '#fafafa' }}>
                        <Text type="secondary">Received</Text>
                        <div style={{ marginTop: 4 }}>
                          <Text>{failureSummary?.received ?? '—'}</Text>
                        </div>
                      </Card>
                    </Col>
                    <Col xs={24} md={8}>
                      <Card size="small" bordered={false} style={{ background: '#fafafa' }}>
                        <Text type="secondary">Timeout</Text>
                        <div style={{ marginTop: 4 }}>
                          <Text>{failureSummary?.timeout ?? '—'}</Text>
                        </div>
                      </Card>
                    </Col>
                  </Row>
                  <Card size="small" bordered={false} style={{ background: '#fafafa' }}>
                    <Text type="secondary">Error summary</Text>
                    <div style={{ marginTop: 4 }}>
                      <Text>{failureSummary?.summary ?? 'Check failed'}</Text>
                    </div>
                  </Card>
                  <Collapse ghost>
                    <Collapse.Panel header="Show raw error" key="raw">
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
              title="Step results"
              style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
              extra={totalSteps > 0 ? <Text type="secondary">{totalSteps} step{totalSteps === 1 ? '' : 's'}</Text> : null}
            >
              {!run ? (
                <Skeleton active />
              ) : stepRows.length === 0 ? (
                <Text type="secondary">No step results available yet.</Text>
              ) : (
                <Table
                  dataSource={stepRows}
                  rowKey="key"
                  size="small"
                  pagination={false}
                  rowClassName={(record) => (record.status === 'failed' ? 'run-step-row-failed' : '')}
                  columns={[
                    {
                      title: 'Step',
                      dataIndex: 'step',
                      width: 80
                    },
                    {
                      title: 'Action',
                      dataIndex: 'action',
                      width: 180
                    },
                    {
                      title: 'Target',
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
                      title: 'Status',
                      dataIndex: 'status',
                      width: 120,
                      render: (status: StepResultRow['status']) => {
                        const color =
                          status === 'passed' ? 'green' : status === 'failed' ? 'red' : 'default';
                        const label =
                          status === 'passed' ? 'Passed' : status === 'failed' ? 'Failed' : 'Pending';
                        return <Tag color={color}>{label}</Tag>;
                      }
                    },
                    {
                      title: 'Duration',
                      dataIndex: 'durationMs',
                      width: 120,
                      render: (durationMs?: number | null) => formatDuration(durationMs)
                    },
                    {
                      title: 'Screenshot',
                      dataIndex: 'screenshot',
                      width: 120,
                      render: (screenshot?: string | null) =>
                        screenshot ? (
                          <a href={resolveBackendUrl(`/screenshots/${screenshot}`)} target="_blank" rel="noreferrer">
                            View
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
                title="Screenshots"
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
                          alt={`Step ${index + 1}`}
                          src={`${BACKEND_URL}/screenshots/${name}`}
                          preview
                        />
                      }
                    >
                      <Card.Meta title={`Step ${index + 1}`} description={name} />
                    </Card>
                  ))}
                </Space>
              </Card>
            </Col>
          )}

          {traceAvailable && traceViewerUrl && (
            <Col span={24}>
              <Card
                title="Trace Viewer"
                style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
                extra={
                  <Space wrap>
                    <a href={traceViewerUrl} target="_blank" rel="noreferrer">
                      Open in new tab
                    </a>
                    {traceDownloadUrl && (
                      <a href={traceDownloadUrl} target="_blank" rel="noreferrer">
                        Download trace.zip
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
                  title="Playwright Trace Viewer"
                />
              </Card>
            </Col>
          )}

          {run?.status !== 'FAILED' && run?.error && (
            <Col span={24}>
              <Alert
                type="error"
                showIcon
                message="Run failed"
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
