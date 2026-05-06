import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Layout, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import AppFooter from '../components/AppFooter';
import RunStatusBadge from '../components/RunStatusBadge';
import UserMenu from '../components/UserMenu';
import { getProjects, getRunHistory } from '../api/client';
import type { DashboardRecentRun, ProjectSummary, RunsResponse } from '../types';

const { Content } = Layout;
const { Title, Text } = Typography;

const PERIOD_OPTIONS = [
  { value: 24, label: 'Last 24 hours' },
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 0, label: 'All time' }
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' }
];

const TRIGGER_OPTIONS = [
  { value: 'all', label: 'All triggers' },
  { value: 'manual', label: 'Manual' },
  { value: 'schedule', label: 'Schedule' }
];

const PAGE_SIZE = 20;
const SLOW_RUN_THRESHOLD_MS = 30_000;

function formatRelativeTime(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return 'just now';
  if (diffMs < hour) return `${Math.round(diffMs / minute)} min ago`;
  if (diffMs < day) return `${Math.round(diffMs / hour)} hour${Math.round(diffMs / hour) === 1 ? '' : 's'} ago`;
  return `${Math.round(diffMs / day)} day${Math.round(diffMs / day) === 1 ? '' : 's'} ago`;
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDuration(ms?: number | null) {
  if (ms === null || ms === undefined) return '—';
  return `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}s`;
}

function formatDurationCompact(ms?: number | null) {
  if (ms === null || ms === undefined) return '—';
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatProjectFilters(projects: ProjectSummary[], projectId?: string) {
  if (!projectId) return 'All projects';
  return projects.find((project) => project.id === projectId)?.name ?? 'All projects';
}

function formatFilterSummary(
  projects: ProjectSummary[],
  projectId?: string,
  days = 30,
  status: 'all' | 'passed' | 'failed' = 'all',
  trigger: 'all' | 'manual' | 'schedule' = 'all'
) {
  return [
    formatProjectFilters(projects, projectId),
    PERIOD_OPTIONS.find((option) => option.value === days)?.label ?? 'Last 30 days',
    STATUS_OPTIONS.find((option) => option.value === status)?.label ?? 'All statuses',
    TRIGGER_OPTIONS.find((option) => option.value === trigger)?.label ?? 'All triggers'
  ].join(' · ');
}

function runsHaveNoFilters(projectId?: string, days = 30, status: 'all' | 'passed' | 'failed' = 'all', trigger: 'all' | 'manual' | 'schedule' = 'all') {
  return !projectId && days === 30 && status === 'all' && trigger === 'all';
}

export default function RunsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [days, setDays] = useState(30);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<'all' | 'passed' | 'failed'>('all');
  const [trigger, setTrigger] = useState<'all' | 'manual' | 'schedule'>('all');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [runs, setRuns] = useState<DashboardRecentRun[]>([]);
  const [summary, setSummary] = useState<RunsResponse['summary'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const projectOptions = useMemo(
    () => [
      { value: 'all', label: 'All projects' },
      ...projects.map((project) => ({ value: project.id, label: project.name }))
    ],
    [projects]
  );

  useEffect(() => {
    void getProjects().then(setProjects).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    void getRunHistory({
      days,
      projectId,
      status,
      trigger,
      limit
    })
      .then((response) => {
        if (cancelled) return;
        setRuns(response.runs);
        setSummary(response.summary);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Recent runs could not be loaded');
        setRuns([]);
        setSummary(null);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [days, projectId, status, trigger, limit]);

  const totalRuns = summary?.total ?? 0;
  const visibleRuns = runs.length;
  const filtersEmpty = runsHaveNoFilters(projectId, days, status, trigger);
  const hasMore = totalRuns > visibleRuns;
  const hasCustomFilters = !filtersEmpty;
  const tableSubtitle = totalRuns > 0 ? `Latest ${Math.min(PAGE_SIZE, totalRuns)} runs` : '';
  const filterSummary = formatFilterSummary(projects, projectId, days, status, trigger);

  const handleProjectChange = (value: string) => {
    setProjectId(value === 'all' ? undefined : value);
    setLimit(PAGE_SIZE);
  };

  const handleDaysChange = (value: number) => {
    setDays(value);
    setLimit(PAGE_SIZE);
  };

  const handleStatusChange = (value: 'all' | 'passed' | 'failed') => {
    setStatus(value);
    setLimit(PAGE_SIZE);
  };

  const handleTriggerChange = (value: 'all' | 'manual' | 'schedule') => {
    setTrigger(value);
    setLimit(PAGE_SIZE);
  };

  const loadMore = () => setLimit((current) => current + PAGE_SIZE);

  const resetFilters = () => {
    setProjectId(undefined);
    setDays(30);
    setStatus('all');
    setTrigger('all');
    setLimit(PAGE_SIZE);
  };

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f7f3ff 0%, #eef4ff 55%, #ffffff 100%)' }}>
      <AppHeader actions={[<UserMenu key="menu" />]} />
      <Content style={{ padding: 32, maxWidth: 1440, width: '100%', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, marginBottom: 24, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 280 }}>
            <Title level={2} style={{ margin: 0 }}>
              Runs
            </Title>
            <Text type="secondary">Latest run history across projects, browser checks, schedules, and manual executions.</Text>
          </div>
          <Space wrap align="start">
            <Select
              value={projectId ?? 'all'}
              onChange={handleProjectChange}
              style={{ width: 220 }}
              options={projectOptions}
            />
            <Select
              value={days}
              onChange={handleDaysChange}
              style={{ width: 170 }}
              options={PERIOD_OPTIONS}
            />
            <Select
              value={status}
              onChange={handleStatusChange}
              style={{ width: 160 }}
              options={STATUS_OPTIONS}
            />
            <Select
              value={trigger}
              onChange={handleTriggerChange}
              style={{ width: 160 }}
              options={TRIGGER_OPTIONS}
            />
          </Space>
        </div>

        {error ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 24, borderRadius: 16 }}
            message={error}
          />
        ) : null}

        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={12} xl={4}>
            <Card style={{ borderRadius: 20, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text type="secondary">Total runs</Text>
                <Text strong style={{ fontSize: 32, lineHeight: 1, color: summary?.total ? undefined : undefined }}>
                  {summary?.total ?? 0}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>{filterSummary}</Text>
              </div>
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={4}>
            <Card style={{ borderRadius: 20, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text type="secondary">Passed</Text>
                <Text strong style={{ fontSize: 32, lineHeight: 1, color: (summary?.passed ?? 0) > 0 ? '#16a34a' : undefined }}>
                  {summary?.passed ?? 0}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {summary && summary.total ? `${Math.round((summary.passed / summary.total) * 100)}% of selected runs` : 'No data'}
                </Text>
              </div>
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={4}>
            <Card style={{ borderRadius: 20, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text type="secondary">Failed</Text>
                <Text strong style={{ fontSize: 32, lineHeight: 1, color: (summary?.failed ?? 0) > 0 ? '#dc2626' : undefined }}>
                  {summary?.failed ?? 0}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {summary && summary.total ? `${Math.round((summary.failed / summary.total) * 100)}% of selected runs` : 'No data'}
                </Text>
              </div>
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={4}>
            <Card style={{ borderRadius: 20, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text type="secondary">Avg duration</Text>
                <Text strong style={{ fontSize: 32, lineHeight: 1 }}>
                  {summary?.avgDurationMs ? formatDurationCompact(summary.avgDurationMs) : '—'}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Across selected runs
                </Text>
              </div>
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={8}>
            <Card style={{ borderRadius: 20, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text type="secondary">Longest run</Text>
                {summary?.slowestRun ? (
                  <>
                    <Text strong style={{ fontSize: 24, lineHeight: 1.1 }}>
                      {formatDurationCompact(summary.slowestRun.durationMs)}
                    </Text>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <Text type="secondary" style={{ display: 'block' }}>
                        {summary.slowestRun.checkName}
                      </Text>
                      {(summary.slowestRun.durationMs ?? 0) > SLOW_RUN_THRESHOLD_MS ? (
                        <Tag color="orange" style={{ width: 'fit-content', marginTop: 2 }}>
                          Slow
                        </Tag>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <>
                    <Text strong style={{ fontSize: 24, lineHeight: 1.1 }}>
                      —
                    </Text>
                    <Text type="secondary" style={{ display: 'block' }}>
                      No data
                    </Text>
                  </>
                )}
              </div>
            </Card>
          </Col>
        </Row>

        <Card
          style={{ borderRadius: 20, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' }}
          styles={{ body: { paddingTop: 16 } }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <Title level={4} style={{ margin: 0 }}>
                  Recent runs
                </Title>
                {tableSubtitle ? <Text type="secondary">{tableSubtitle}</Text> : null}
              </div>
              <Space wrap>
                {hasCustomFilters && totalRuns > 0 ? <Button onClick={resetFilters}>Reset filters</Button> : null}
              </Space>
            </div>

            {loading && runs.length === 0 ? (
              <Text type="secondary">Loading runs...</Text>
            ) : error ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
                <Alert type="error" showIcon message={error} />
              </div>
            ) : totalRuns === 0 ? (
              filtersEmpty ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
                  <div>
                    <Text strong>No runs yet</Text>
                    <Text type="secondary" style={{ display: 'block' }}>
                      Run a check manually or create a schedule to start collecting execution history.
                    </Text>
                  </div>
                  <Button type="primary" onClick={() => navigate('/projects')}>
                    Go to projects
                  </Button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
                  <div>
                    <Text strong>No runs match these filters</Text>
                    <Text type="secondary" style={{ display: 'block' }}>
                      {filterSummary}
                    </Text>
                    <Text type="secondary" style={{ display: 'block' }}>
                      Try changing the project, period, status, or trigger.
                    </Text>
                  </div>
                  <Button onClick={resetFilters}>Reset filters</Button>
                </div>
              )
            ) : (
              <>
                <Table
                  dataSource={runs}
                  rowKey="runId"
                  loading={loading}
                  pagination={false}
                  size="small"
                  rowClassName={(row) => (row.status === 'FAILED' ? 'run-row-failed' : '')}
                  tableLayout="fixed"
                  columns={[
                    {
                      title: 'Check',
                      dataIndex: 'checkName',
                      width: 340,
                      ellipsis: true,
                      render: (value: string, row: DashboardRecentRun) => (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0, minWidth: 0 }}>
                          <Button
                            type="link"
                            style={{ padding: 0, height: 'auto', textAlign: 'left', fontWeight: 600, display: 'inline-flex', justifyContent: 'flex-start' }}
                            onClick={() => navigate(`/tests/${row.testId}/edit`)}
                          >
                            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {value}
                            </span>
                          </Button>
                          <Text type="secondary" style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.projectName}
                          </Text>
                        </div>
                      )
                    },
                    {
                      title: 'Status',
                      dataIndex: 'status',
                      width: 110,
                      render: (value: DashboardRecentRun['status']) => <RunStatusBadge status={value} />
                    },
                    {
                      title: 'Duration',
                      dataIndex: 'durationMs',
                      width: 130,
                      render: (value: number | null) => {
                        const isSlow = typeof value === 'number' && value > SLOW_RUN_THRESHOLD_MS;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            <Text style={isSlow ? { color: '#b45309', fontWeight: 600 } : undefined}>
                              {formatDuration(value)}
                            </Text>
                            {isSlow ? (
                              <Tag color="orange" style={{ width: 'fit-content', marginTop: 2 }}>
                                Slow
                              </Tag>
                            ) : null}
                          </div>
                        );
                      }
                    },
                    {
                      title: 'Started',
                      dataIndex: 'startedAt',
                      width: 170,
                      render: (value: string) => (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                          <Text>{formatRelativeTime(value)}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {formatShortDate(value)}
                          </Text>
                        </div>
                      )
                    },
                    {
                      title: 'Trigger',
                      dataIndex: 'trigger',
                      width: 120,
                      render: (value: string) => <Tag color={value === 'Schedule' ? 'blue' : 'default'}>{value}</Tag>
                    },
                    {
                      title: 'Result',
                      width: 120,
                      render: (_: unknown, row: DashboardRecentRun) => (
                        <Button size="small" onClick={() => navigate(`/runs/${row.runId}`)}>
                          Open result
                        </Button>
                      )
                    }
                  ]}
                />

                <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <Text type="secondary">
                    Showing {visibleRuns} of {totalRuns} runs
                  </Text>
                  {hasMore ? (
                    <Button onClick={loadMore} loading={loading}>
                      Load more
                    </Button>
                  ) : (
                    <Text type="secondary">All runs are shown</Text>
                  )}
                </div>
              </>
            )}
          </div>
        </Card>
      </Content>
      <AppFooter />
    </Layout>
  );
}
