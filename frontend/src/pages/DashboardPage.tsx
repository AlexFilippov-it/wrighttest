import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Card, Col, Layout, Row, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import AppHeader from '../components/AppHeader';
import AppFooter from '../components/AppFooter';
import UserMenu from '../components/UserMenu';
import RunStatusBadge from '../components/RunStatusBadge';
import { EmptyState as DesignEmptyState, StatCard } from '../design-system';
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

function formatRelativeTime(value: string, t: TFunction) {
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

function formatDuration(ms: number | null | undefined, locale: string) {
  if (ms === null || ms === undefined) return '—';
  const digits = ms >= 10000 ? 1 : 2;
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(ms / 1000)}s`;
}

function formatShortDate(value: string, locale: string) {
  return new Date(value).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function EmptyState({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <DesignEmptyState
      className="wt-empty-state--contained"
      title={title}
      description={description}
      action={actions}
    />
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
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
      { value: 'all', label: t('common.allProjects') },
      ...projects.map((project) => ({ value: project.id, label: project.name }))
    ],
    [projects, t]
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
      <Content className="wt-surface-page" style={{ padding: 32, maxWidth: 1440, width: '100%', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, marginBottom: 24 }}>
          <div>
            <Title level={2} style={{ margin: 0 }}>{t('dashboard.title')}</Title>
            <Text type="secondary">{t('dashboard.description')}</Text>
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
              options={[7, 30, 90].map((value) => ({
                value,
                label: t(value === 7 ? 'common.last7Days' : value === 30 ? 'common.last30Days' : 'common.last90Days')
              }))}
            />
          </Space>
        </div>

        {loading || !data ? (
          <Card style={{ borderRadius: 20 }}>
            <Text type="secondary">{t('dashboard.loading')}</Text>
          </Card>
        ) : (
          <>
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
              <Col xs={24} sm={12} lg={8}>
                <StatCard
                  title={t('dashboard.totalRuns')}
                  value={data.summary.total}
                  description={t('dashboard.selectedPeriod')}
                />
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <StatCard
                  title={t('dashboard.passRate')}
                  value={data.summary.total ? `${data.summary.passRate}%` : '—'}
                  description={data.summary.total ? t('dashboard.passRateDetail', { passed: data.summary.passed, total: data.summary.total, days }) : t('dashboard.noRunsYet')}
                />
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <StatCard
                  title={t('dashboard.activeFailures')}
                  value={data.summary.activeFailures}
                  description={data.summary.activeFailures > 0 ? t('dashboard.latestRunFailed') : hasRuns ? t('dashboard.noActiveFailures') : t('dashboard.notEvaluated')}
                  status={data.summary.activeFailures > 0 ? <Tag color="red">{t('dashboard.actionNeeded')}</Tag> : undefined}
                />
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <StatCard
                  title={t('dashboard.failedRuns')}
                  value={data.summary.failed}
                  description={t('dashboard.failedInPeriod')}
                  status={data.summary.failed > 0 ? <Tag color="red">{t('common.failed')}</Tag> : undefined}
                />
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <StatCard
                  title={t('dashboard.flakyChecks')}
                  value={data.summary.flakyChecks}
                  description={data.summary.flakyChecks > 0 ? t('dashboard.passedAndFailed') : t('dashboard.noFlaky')}
                  status={data.summary.flakyChecks > 0 ? <Tag color="gold">{t('common.flaky')}</Tag> : undefined}
                />
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <StatCard
                  title={t('dashboard.avgDuration')}
                  value={data.summary.avgDurationMs ? formatDuration(data.summary.avgDurationMs, locale) : '—'}
                  description={data.summary.avgDurationMs ? t('dashboard.averageRunDuration') : t('dashboard.notEvaluated')}
                />
              </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
              <Col xs={24} xl={12}>
                <Card
                  title={t('dashboard.needsAttention')}
                  style={{ borderRadius: 20, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' }}
                >
                  {activeFailures.length === 0 && flakyChecks.length === 0 ? (
                    <div style={{ padding: '28px 0' }}>
                      <EmptyState
                        title={t('dashboard.noActiveFailures')}
                        description={t('dashboard.allChecksPassing')}
                      />
                      {data.summary.failed > 0 && (
                        <div style={{ marginTop: 12, textAlign: 'center' }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {t('dashboard.earlierFailures')}
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
                          title: t('common.check'),
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
                          title: t('common.status'),
                          dataIndex: 'status',
                          render: (value: DashboardIssue['status']) => {
                            const color = value === 'Flaky' ? 'gold' : 'red';
                            return <Tag color={color}>{value === 'Flaky' ? t('common.flaky') : t('common.failed')}</Tag>;
                          }
                        },
                        {
                          title: t('dashboard.lastFailureOrRun'),
                          render: (_: unknown, row: DashboardIssue) => (
                            <Space direction="vertical" size={0}>
                              <Text>{row.errorSummary ?? t('dashboard.latestRunFailed')}</Text>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {formatRelativeTime(row.latestRunAt, t)}
                              </Text>
                            </Space>
                          )
                        },
                        {
                          title: t('common.actions'),
                          render: (_: unknown, row: DashboardIssue) => (
                            <Space wrap>
                              <Button size="small" onClick={() => handleOpenRun(row.latestFailedRunId)}>
                                {t('common.openResult')}
                              </Button>
                              <Button size="small" onClick={() => void handleRerun(row)} loading={rerunning === row.testId}>
                                {t('dashboard.rerun')}
                              </Button>
                              <Button size="small" onClick={() => handleOpenCheck(row.testId)}>
                                {t('dashboard.editCheck')}
                              </Button>
                            </Space>
                          )
                        }
                        ]}
                      />
                    {hasMoreIssues && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                        <Button onClick={handleOpenRuns}>{t('dashboard.viewAllIssues')}</Button>
                      </div>
                    )}
                    </>
                  )}
                </Card>
              </Col>

              <Col xs={24} xl={12}>
                <Card
                  title={t('dashboard.recentRuns')}
                  style={{ borderRadius: 20, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t('dashboard.latestRuns', { count: 5 })}
                    </Text>
                  </div>
                  {recentRunsMissing ? (
                    <EmptyState
                      title={t('dashboard.recentRunsLoadError')}
                      description={t('dashboard.recentRunsUnavailable')}
                      actions={
                        <Button onClick={() => setReloadTick((current) => current + 1)} type="primary">
                          {t('dashboard.refresh')}
                        </Button>
                      }
                    />
                  ) : recentRuns.length === 0 ? (
                    <EmptyState
                      title={hasRuns ? t('dashboard.noRecentRunsInPeriod') : t('dashboard.noRunsYet')}
                      description={
                        hasRuns
                          ? t('dashboard.runOrScheduleForRecent')
                          : t('dashboard.runOrScheduleForDashboard')
                      }
                      actions={
                        <Space wrap>
                          <Button onClick={() => navigate('/projects')}>{t('common.goProjects')}</Button>
                          <Button type="primary" onClick={() => navigate('/projects')}>
                            {t('dashboard.createCheck')}
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
                          title: t('common.check'),
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
                            title: t('common.status'),
                            dataIndex: 'status',
                            render: (status: DashboardRecentRun['status']) => <RunStatusBadge status={status} />
                          },
                          {
                            title: t('common.duration'),
                            dataIndex: 'durationMs',
                            render: (value: number | null) => formatDuration(value, locale)
                          },
                          {
                            title: t('common.started'),
                            dataIndex: 'startedAt',
                            render: (value: string) => (
                              <Space direction="vertical" size={0}>
                                <Text>{formatRelativeTime(value, t)}</Text>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {formatShortDate(value, locale)}
                                </Text>
                              </Space>
                            )
                          },
                          {
                            title: t('common.trigger'),
                            dataIndex: 'trigger',
                            render: (value: string, row: DashboardRecentRun) => (
                              <Tooltip title={row.scheduleName ?? undefined}>
                                <Tag color={row.trigger === 'Schedule' ? 'blue' : 'default'}>{row.trigger === 'Schedule' ? t('common.schedule') : t('common.manual')}</Tag>
                              </Tooltip>
                            )
                          },
                          {
                            title: t('common.actions'),
                            render: (_: unknown, row: DashboardRecentRun) => (
                              <Button size="small" onClick={() => handleOpenRun(row.runId)}>
                                {t('common.open')}
                              </Button>
                            )
                          }
                        ]}
                      />
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                        <Button onClick={handleOpenRuns}>{t('dashboard.viewAllRuns')}</Button>
                      </div>
                    </>
                  )}
                </Card>
              </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
              <Col xs={24} xl={12}>
                <Card
                  title={t('dashboard.passRateOverTime')}
                  extra={<Text type="secondary">{t('dashboard.dailyPassRate')}</Text>}
                  style={{ borderRadius: 20, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' }}
                >
                  {chart.length === 0 ? (
                    <EmptyState
                      title={t('dashboard.noRunsSelectedPeriod')}
                      description={t('dashboard.widerRangeHint')}
                    />
                  ) : (
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={chart}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
                        <RechartsTooltip formatter={(value) => `${value}%`} />
                        <Line type="linear" dataKey="passRate" name={t('dashboard.passRate')} stroke="#52c41a" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </Col>

              <Col xs={24} xl={12}>
                <Card
                  title={t('dashboard.runsPerDay')}
                  extra={<Text type="secondary">{t('dashboard.passedFailedByDay')}</Text>}
                  style={{ borderRadius: 20, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' }}
                >
                  {chart.length === 0 ? (
                    <EmptyState
                      title={t('dashboard.noRunsSelectedPeriod')}
                      description={t('dashboard.widerRangeHint')}
                    />
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={chart}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis />
                        <RechartsTooltip />
                        <Area type="linear" dataKey="passed" name={t('common.passed')} stroke="#52c41a" fill="#e6f7e6" />
                        <Area type="linear" dataKey="failed" name={t('common.failed')} stroke="#ff4d4f" fill="#fff1f0" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </Col>
            </Row>

            <Card
              title={t('dashboard.flakyChecks')}
              style={{ borderRadius: 20, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' }}
            >
              {flakyChecks.length === 0 ? (
                <EmptyState
                  title={t('dashboard.noFlaky')}
                  description={t('dashboard.noFlakyInRange')}
                />
              ) : (
                <Table
                  dataSource={flakyChecks}
                  rowKey="testId"
                  pagination={false}
                  size="small"
                  columns={[
                    {
                      title: t('common.check'),
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
                    { title: t('common.project'), dataIndex: 'projectName' },
                    { title: t('dashboard.totalRuns'), dataIndex: 'totalRuns' },
                    { title: t('common.passed'), dataIndex: 'passed' },
                    { title: t('common.failed'), dataIndex: 'failed' },
                    { title: t('dashboard.passRate'), dataIndex: 'passRate', render: (value: number) => `${value}%` },
                    {
                      title: t('dashboard.lastFailure'),
                      dataIndex: 'lastFailure',
                      render: (value: string | null) => (value ? formatRelativeTime(value, t) : '—')
                    },
                    {
                      title: t('common.actions'),
                      render: (_: unknown, row: DashboardFlakyCheck) => (
                        <Space wrap>
                          <Button size="small" onClick={() => handleOpenCheck(row.testId)}>
                            {t('dashboard.openCheck')}
                          </Button>
                          <Button size="small" onClick={() => handleOpenRun(row.latestFailedRunId)}>
                            {t('dashboard.openLatestFailedResult')}
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
      <AppFooter />
    </Layout>
  );
}
