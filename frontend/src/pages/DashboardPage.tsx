import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Button, Card, Col, Layout, Row, Select, Space, Statistic, Table, Tag, Tooltip, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import UserMenu from '../components/UserMenu';
import RunStatusBadge from '../components/RunStatusBadge';
import { getDashboard, getProjects, runTest, runTestWithEnvironment } from '../api/client';
import type {
  DashboardChartPoint,
  DashboardFlakyCheck,
  DashboardIssue,
  DashboardRecentRun,
  DashboardResponse,
  ProjectSummary
} from '../types';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis
} from 'recharts';

const { Content } = Layout;
const { Title, Text } = Typography;

const TIME_RANGE_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' }
];

function formatRelativeTime(value: string) {
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

function formatDuration(ms?: number | null) {
  if (ms === null || ms === undefined) return '—';
  return `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}s`;
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function EmptyState({
  title,
  description,
  actions
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div style={{ padding: '28px 0', textAlign: 'center' }}>
      <Title level={4} style={{ marginBottom: 8 }}>
        {title}
      </Title>
      <Text type="secondary">{description}</Text>
      {actions ? <div style={{ marginTop: 16 }}>{actions}</div> : null}
    </div>
  );
}

function StatCard({
  title,
  value,
  prefix,
  valueStyle,
  extra
}: {
  title: string;
  value: string | number;
  prefix?: ReactNode;
  valueStyle?: React.CSSProperties;
  extra?: string;
}) {
  return (
    <Card style={{ borderRadius: 20, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' }}>
      <Statistic title={title} value={value} prefix={prefix} valueStyle={valueStyle} />
      {extra && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {extra}
        </Text>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [reloadTick, setReloadTick] = useState(0);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [rerunning, setRerunning] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([getProjects(), getDashboard(days, projectId)])
      .then(([projectResponse, dashboardResponse]) => {
        setProjects(projectResponse);
        setData(dashboardResponse);
      })
      .finally(() => setLoading(false));
  }, [days, projectId, reloadTick]);

  const projectOptions = useMemo(
    () => [
      { value: 'all', label: 'All projects' },
      ...projects.map((project) => ({ value: project.id, label: project.name }))
    ],
    [projects]
  );

  const handleOpenRun = (runId: string) => navigate(`/runs/${runId}`);
  const handleOpenCheck = (testId: string) => navigate(`/tests/${testId}/edit`);
  const handleOpenRuns = () => navigate('/runs');

  const handleRerun = async (row: DashboardRecentRun | DashboardIssue) => {
    setRerunning(row.testId);
    try {
      const result = row.environmentId
        ? await runTestWithEnvironment(row.testId, row.environmentId)
        : await runTest(row.testId);
      navigate(`/runs/${result.testRunId}`);
    } finally {
      setRerunning(null);
    }
  };

  const activeIssues = data?.activeIssues ?? [];
  const activeFailures = activeIssues.filter((issue) => issue.latestRunStatus === 'FAILED');
  const flakyChecks = data?.flakyChecks ?? [];
  const recentRuns = (data?.recentRuns ?? []).slice(0, 5);
  const chart = data?.chart ?? [];
  const hasRuns = (data?.summary.total ?? 0) > 0;
  const recentRunsMissing = hasRuns && recentRuns.length === 0;
  const visibleIssues = activeIssues.slice(0, 4);
  const hasMoreIssues = activeIssues.length > visibleIssues.length;

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f7f3ff 0%, #eef4ff 55%, #ffffff 100%)' }}>
      <AppHeader actions={[<UserMenu key="menu" />]} />
      <Content style={{ padding: 32, maxWidth: 1440, width: '100%', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, marginBottom: 24 }}>
          <div>
            <Title level={2} style={{ margin: 0 }}>Dashboard</Title>
            <Text type="secondary">Global health across projects, browser checks, schedules, and runs.</Text>
          </div>
          <Space wrap align="start">
            <Select
              value={projectId ?? 'all'}
              onChange={(value) => setProjectId(value === 'all' ? undefined : value)}
              style={{ width: 220 }}
              options={projectOptions}
            />
            <Select
              value={days}
              onChange={setDays}
              style={{ width: 150 }}
              options={TIME_RANGE_OPTIONS}
            />
          </Space>
        </div>

        {loading || !data ? (
          <Card style={{ borderRadius: 20 }}>
            <Text type="secondary">Loading dashboard...</Text>
          </Card>
        ) : (
          <>
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
              <Col xs={24} sm={12} lg={8}>
                <StatCard
                  title="Total runs"
                  value={data.summary.total}
                  prefix={<ThunderboltOutlined />}
                  extra={`Selected period`}
                />
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <StatCard
                  title="Pass rate"
                  value={data.summary.total ? `${data.summary.passRate}%` : '—'}
                  prefix={<CheckCircleOutlined />}
                  valueStyle={{ color: data.summary.passRate >= 80 ? '#52c41a' : '#faad14' }}
                  extra={data.summary.total ? `${data.summary.passed} passed / ${data.summary.total} total` : 'No runs yet'}
                />
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <StatCard
                  title="Active failures"
                  value={data.summary.activeFailures}
                  prefix={<CloseCircleOutlined />}
                  valueStyle={{ color: data.summary.activeFailures > 0 ? '#ff4d4f' : '#8c8c8c' }}
                  extra={data.summary.activeFailures > 0 ? 'Checks whose latest run failed' : 'Latest runs are passing'}
                />
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <StatCard
                  title="Failed runs"
                  value={data.summary.failed}
                  prefix={<CloseCircleOutlined />}
                  valueStyle={{ color: data.summary.failed > 0 ? '#ff4d4f' : '#8c8c8c' }}
                  extra="Failed in selected period"
                />
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <StatCard
                  title="Flaky checks"
                  value={data.summary.flakyChecks}
                  prefix={<ExclamationCircleOutlined />}
                  valueStyle={{ color: data.summary.flakyChecks > 0 ? '#faad14' : '#8c8c8c' }}
                  extra={data.summary.flakyChecks > 0 ? 'Passed and failed in the selected period' : 'No flaky checks detected'}
                />
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <StatCard
                  title="Avg duration"
                  value={data.summary.avgDurationMs ? formatDuration(data.summary.avgDurationMs) : '—'}
                  extra={data.summary.avgDurationMs ? 'Average run duration' : 'No runs yet'}
                />
              </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
              <Col xs={24} xl={12}>
                <Card
                  title="Needs attention"
                  style={{ borderRadius: 20, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' }}
                >
                  {activeFailures.length === 0 && flakyChecks.length === 0 ? (
                    <div style={{ padding: '28px 0' }}>
                      <EmptyState
                        title="No active failures"
                        description="All browser checks are currently passing."
                      />
                      {data.summary.failed > 0 && (
                        <div style={{ marginTop: 12, textAlign: 'center' }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            Some runs failed earlier in this period. Review Recent runs for details.
                          </Text>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <Table
                        dataSource={visibleIssues}
                        rowKey={(row) => row.testId}
                        pagination={false}
                        size="small"
                        columns={[
                        {
                          title: 'Check',
                          dataIndex: 'checkName',
                          render: (value: string, row: DashboardIssue) => (
                            <Space direction="vertical" size={0}>
                      <Button type="link" style={{ padding: 0, height: 'auto' }} onClick={() => handleOpenCheck(row.testId)}>
                        {value}
                      </Button>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {row.projectName}
                              </Text>
                            </Space>
                          )
                        },
                        {
                          title: 'Status',
                          dataIndex: 'status',
                          render: (value: DashboardIssue['status']) => {
                            const color = value === 'Flaky' ? 'gold' : 'red';
                            return <Tag color={color}>{value}</Tag>;
                          }
                        },
                        {
                          title: 'Last failure / Last run',
                          render: (_: unknown, row: DashboardIssue) => (
                            <Space direction="vertical" size={0}>
                              <Text>{row.errorSummary ?? 'Failure detected'}</Text>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {formatRelativeTime(row.latestRunAt)}
                              </Text>
                            </Space>
                          )
                        },
                        {
                          title: 'Actions',
                          render: (_: unknown, row: DashboardIssue) => (
                            <Space wrap>
                              <Button size="small" onClick={() => handleOpenRun(row.latestFailedRunId)}>
                                Open result
                              </Button>
                              <Button size="small" onClick={() => void handleRerun(row)} loading={rerunning === row.testId}>
                                Rerun
                              </Button>
                              <Button size="small" onClick={() => handleOpenCheck(row.testId)}>
                                Edit check
                              </Button>
                            </Space>
                          )
                        }
                        ]}
                      />
                    {hasMoreIssues && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                        <Button onClick={handleOpenRuns}>View all issues</Button>
                      </div>
                    )}
                    </>
                  )}
                </Card>
              </Col>

              <Col xs={24} xl={12}>
                <Card
                  title="Recent runs"
                  style={{ borderRadius: 20, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Latest 5 runs
                    </Text>
                  </div>
                  {recentRunsMissing ? (
                    <EmptyState
                      title="Recent runs could not be loaded"
                      description="The dashboard has run data, but the recent runs list is temporarily unavailable."
                      actions={
                        <Button onClick={() => setReloadTick((current) => current + 1)} type="primary">
                          Refresh
                        </Button>
                      }
                    />
                  ) : recentRuns.length === 0 ? (
                    <EmptyState
                      title={hasRuns ? 'No recent runs found in this period' : 'No runs yet'}
                      description={
                        hasRuns
                          ? 'Run a check manually or create a schedule to start collecting recent run data.'
                          : 'Run a check manually or create a schedule to start collecting dashboard data.'
                      }
                      actions={
                        <Space wrap>
                          <Button onClick={() => navigate('/projects')}>Go to projects</Button>
                          <Button type="primary" onClick={() => navigate('/projects')}>
                            Create check
                          </Button>
                        </Space>
                      }
                    />
                  ) : (
                    <>
                      <Table
                        dataSource={recentRuns}
                        rowKey="runId"
                        pagination={false}
                        size="small"
                        columns={[
                          {
                            title: 'Check',
                            dataIndex: 'checkName',
                            render: (value: string, row: DashboardRecentRun) => (
                              <Space direction="vertical" size={0}>
                                <Button type="link" style={{ padding: 0, height: 'auto' }} onClick={() => handleOpenCheck(row.testId)}>
                                  {value}
                                </Button>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {row.projectName}
                                </Text>
                              </Space>
                            )
                          },
                          {
                            title: 'Status',
                            dataIndex: 'status',
                            render: (status: DashboardRecentRun['status']) => <RunStatusBadge status={status} />
                          },
                          {
                            title: 'Duration',
                            dataIndex: 'durationMs',
                            render: (value: number | null) => formatDuration(value)
                          },
                          {
                            title: 'Started',
                            dataIndex: 'startedAt',
                            render: (value: string) => (
                              <Space direction="vertical" size={0}>
                                <Text>{formatRelativeTime(value)}</Text>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {formatShortDate(value)}
                                </Text>
                              </Space>
                            )
                          },
                          {
                            title: 'Trigger',
                            dataIndex: 'trigger',
                            render: (value: string, row: DashboardRecentRun) => (
                              <Tooltip title={row.scheduleName ?? undefined}>
                                <Tag color={row.trigger === 'Schedule' ? 'blue' : 'default'}>{value}</Tag>
                              </Tooltip>
                            )
                          },
                          {
                            title: 'Actions',
                            render: (_: unknown, row: DashboardRecentRun) => (
                              <Button size="small" onClick={() => handleOpenRun(row.runId)}>
                                Open
                              </Button>
                            )
                          }
                        ]}
                      />
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                        <Button onClick={handleOpenRuns}>View all runs</Button>
                      </div>
                    </>
                  )}
                </Card>
              </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
              <Col xs={24} xl={12}>
                <Card
                  title="Pass rate over time"
                  extra={<Text type="secondary">Daily pass rate for selected runs.</Text>}
                  style={{ borderRadius: 20, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' }}
                >
                  {chart.length === 0 ? (
                    <EmptyState
                      title="No runs in selected period"
                      description="Choose a wider time range or run a check to populate the dashboard."
                    />
                  ) : (
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={chart}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
                        <RechartsTooltip formatter={(value) => `${value}%`} />
                        <Line type="linear" dataKey="passRate" name="Pass rate" stroke="#52c41a" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </Col>

              <Col xs={24} xl={12}>
                <Card
                  title="Runs per day"
                  extra={<Text type="secondary">Passed and failed runs grouped by day.</Text>}
                  style={{ borderRadius: 20, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' }}
                >
                  {chart.length === 0 ? (
                    <EmptyState
                      title="No runs in selected period"
                      description="Choose a wider time range or run a check to populate the dashboard."
                    />
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={chart}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis />
                        <RechartsTooltip />
                        <Area type="linear" dataKey="passed" name="Passed" stroke="#52c41a" fill="#e6f7e6" />
                        <Area type="linear" dataKey="failed" name="Failed" stroke="#ff4d4f" fill="#fff1f0" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </Col>
            </Row>

            <Card
              title="Flaky checks"
              style={{ borderRadius: 20, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' }}
            >
              {flakyChecks.length === 0 ? (
                <EmptyState
                  title="No flaky checks detected"
                  description="No checks had both passed and failed runs in the selected period."
                />
              ) : (
                <Table
                  dataSource={flakyChecks}
                  rowKey="testId"
                  pagination={false}
                  size="small"
                  columns={[
                    {
                      title: 'Check',
                      dataIndex: 'checkName',
                      render: (value: string, row: DashboardFlakyCheck) => (
                        <Space direction="vertical" size={0}>
                          <Button type="link" style={{ padding: 0, height: 'auto' }} onClick={() => handleOpenCheck(row.testId)}>
                            {value}
                          </Button>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {row.projectName}
                          </Text>
                        </Space>
                      )
                    },
                    { title: 'Project', dataIndex: 'projectName' },
                    { title: 'Total runs', dataIndex: 'totalRuns' },
                    { title: 'Passed', dataIndex: 'passed' },
                    { title: 'Failed', dataIndex: 'failed' },
                    { title: 'Pass rate', dataIndex: 'passRate', render: (value: number) => `${value}%` },
                    {
                      title: 'Last failure',
                      dataIndex: 'lastFailure',
                      render: (value: string | null) => (value ? formatRelativeTime(value) : '—')
                    },
                    {
                      title: 'Actions',
                      render: (_: unknown, row: DashboardFlakyCheck) => (
                        <Space wrap>
                          <Button size="small" onClick={() => handleOpenCheck(row.testId)}>
                            Open check
                          </Button>
                          <Button size="small" onClick={() => handleOpenRun(row.latestFailedRunId)}>
                            Open latest failed result
                          </Button>
                        </Space>
                      )
                    }
                  ]}
                />
              )}
            </Card>
          </>
        )}
      </Content>
    </Layout>
  );
}
