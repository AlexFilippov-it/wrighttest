import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Layout, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import AppHeader from '../components/AppHeader';
import AppFooter from '../components/AppFooter';
import RunStatusBadge from '../components/RunStatusBadge';
import UserMenu from '../components/UserMenu';
import { StatCard } from '../design-system';
import { getProjects, getRunHistory } from '../api/client';
import type { DashboardRecentRun, ProjectSummary, RunsResponse } from '../types';

const { Content } = Layout;
const { Title, Text } = Typography;

const PAGE_SIZE = 20;
const SLOW_RUN_THRESHOLD_MS = 30_000;

function formatRelativeTime(value: string, t: TFunction) {
  const diffMs = Date.now() - new Date(value).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return t('time.justNow');
  if (diffMs < hour) return t('time.minutesAgo', { count: Math.round(diffMs / minute) });
  if (diffMs < day) return t('time.hoursAgo', { count: Math.round(diffMs / hour) });
  return t('time.daysAgo', { count: Math.round(diffMs / day) });
}

function formatShortDate(value: string, locale: string) {
  return new Date(value).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDuration(ms: number | null | undefined, locale: string) {
  if (ms === null || ms === undefined) return '—';
  const digits = ms >= 10000 ? 1 : 2;
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(ms / 1000)}s`;
}

function formatDurationCompact(ms: number | null | undefined, locale: string) {
  if (ms === null || ms === undefined) return '—';
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ms / 1000)}s`;
}

function formatProjectFilters(projects: ProjectSummary[], projectId: string | undefined, t: TFunction) {
  if (!projectId) return t('common.allProjects');
  return projects.find((project) => project.id === projectId)?.name ?? t('common.allProjects');
}

function formatFilterSummary(
  projects: ProjectSummary[],
  t: TFunction,
  projectId?: string,
  days = 30,
  status: 'all' | 'passed' | 'failed' = 'all',
  trigger: 'all' | 'manual' | 'schedule' = 'all'
) {
  const period = days === 24 ? t('common.last24Hours')
    : days === 7 ? t('common.last7Days')
      : days === 0 ? t('common.allTime') : t('common.last30Days');
  const statusLabel = status === 'passed' ? t('common.passed') : status === 'failed' ? t('common.failed') : t('common.allStatuses');
  const triggerLabel = trigger === 'manual' ? t('common.manual') : trigger === 'schedule' ? t('common.schedule') : t('common.allTriggers');
  return t('runs.filterSummary', {
    project: formatProjectFilters(projects, projectId, t), period, status: statusLabel, trigger: triggerLabel
  });
}

function runsHaveNoFilters(projectId?: string, days = 30, status: 'all' | 'passed' | 'failed' = 'all', trigger: 'all' | 'manual' | 'schedule' = 'all') {
  return !projectId && days === 30 && status === 'all' && trigger === 'all';
}

export default function RunsPage() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
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
      { value: 'all', label: t('common.allProjects') },
      ...projects.map((project) => ({ value: project.id, label: project.name }))
    ],
    [projects, t]
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
        setError(t('runs.latestRunsError'));
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
  const tableSubtitle = totalRuns > 0 ? t('runs.latestRuns', { count: Math.min(PAGE_SIZE, totalRuns) }) : '';
  const filterSummary = formatFilterSummary(projects, t, projectId, days, status, trigger);

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
      <Content className="wt-surface-page" style={{ padding: 32, maxWidth: 1440, width: '100%', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, marginBottom: 24, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 280 }}>
            <Title level={2} style={{ margin: 0 }}>
              {t('runs.title')}
            </Title>
            <Text type="secondary">{t('runs.description')}</Text>
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
              options={[
                { value: 24, label: t('common.last24Hours') },
                { value: 7, label: t('common.last7Days') },
                { value: 30, label: t('common.last30Days') },
                { value: 0, label: t('common.allTime') }
              ]}
            />
            <Select
              value={status}
              onChange={handleStatusChange}
              style={{ width: 160 }}
              options={[
                { value: 'all', label: t('common.allStatuses') },
                { value: 'passed', label: t('common.passed') },
                { value: 'failed', label: t('common.failed') }
              ]}
            />
            <Select
              value={trigger}
              onChange={handleTriggerChange}
              style={{ width: 160 }}
              options={[
                { value: 'all', label: t('common.allTriggers') },
                { value: 'manual', label: t('common.manual') },
                { value: 'schedule', label: t('common.schedule') }
              ]}
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
          <Col xs={24} sm={12} lg={8} xxl={4}><StatCard title={t('runs.totalRuns')} value={summary?.total ?? 0} description={filterSummary} loading={loading} /></Col>
          <Col xs={24} sm={12} lg={8} xxl={4}><StatCard title={t('common.passed')} value={summary?.passed ?? 0} description={summary?.total ? t('common.ofSelectedRuns', { percent: Math.round((summary.passed / summary.total) * 100) }) : t('common.noData')} loading={loading} /></Col>
          <Col xs={24} sm={12} lg={8} xxl={4}><StatCard title={t('common.failed')} value={summary?.failed ?? 0} description={summary?.total ? t('common.ofSelectedRuns', { percent: Math.round((summary.failed / summary.total) * 100) }) : t('common.noData')} status={(summary?.failed ?? 0) > 0 ? <Tag color="red">{t('common.failed')}</Tag> : undefined} loading={loading} /></Col>
          <Col xs={24} sm={12} lg={8} xxl={4}><StatCard title={t('dashboard.avgDuration')} value={summary?.avgDurationMs ? formatDurationCompact(summary.avgDurationMs, locale) : '—'} description={t('runs.acrossSelectedRuns')} loading={loading} /></Col>
          <Col xs={24} sm={12} xl={8}>
            <StatCard
              title={t('runs.longestRun')}
              value={summary?.slowestRun ? formatDurationCompact(summary.slowestRun.durationMs, locale) : '—'}
              description={summary?.slowestRun?.checkName ?? t('common.noData')}
              status={summary?.slowestRun && (summary.slowestRun.durationMs ?? 0) > SLOW_RUN_THRESHOLD_MS ? <Tag color="orange">{t('common.slow')}</Tag> : undefined}
              loading={loading}
            />
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
                  {t('runs.recentRuns')}
                </Title>
                {tableSubtitle ? <Text type="secondary">{tableSubtitle}</Text> : null}
              </div>
              <Space wrap>
                {hasCustomFilters && totalRuns > 0 ? <Button onClick={resetFilters}>{t('runs.resetFilters')}</Button> : null}
              </Space>
            </div>

            {loading && runs.length === 0 ? (
              <Text type="secondary">{t('runs.loading')}</Text>
            ) : error ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
                <Alert type="error" showIcon message={t('runs.latestRunsError')} />
              </div>
            ) : totalRuns === 0 ? (
              filtersEmpty ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
                  <div>
                    <Text strong>{t('common.noRunsYet')}</Text>
                    <Text type="secondary" style={{ display: 'block' }}>
                      {t('runs.noRunsDescription')}
                    </Text>
                  </div>
                  <Button type="primary" onClick={() => navigate('/projects')}>
                    {t('common.goProjects')}
                  </Button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
                  <div>
                    <Text strong>{t('runs.noMatches')}</Text>
                    <Text type="secondary" style={{ display: 'block' }}>
                      {filterSummary}
                    </Text>
                    <Text type="secondary" style={{ display: 'block' }}>
                      {t('runs.changeFiltersHint')}
                    </Text>
                  </div>
                  <Button onClick={resetFilters}>{t('runs.resetFilters')}</Button>
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
                  scroll={{ x: 'max-content' }}
                  rowClassName={(row) => (row.status === 'FAILED' ? 'run-row-failed' : '')}
                  tableLayout="fixed"
                  columns={[
                    {
                      title: t('common.check'),
                      dataIndex: 'checkName',
                      width: 260,
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
                      title: t('common.status'),
                      dataIndex: 'status',
                      width: 100,
                      render: (value: DashboardRecentRun['status']) => <RunStatusBadge status={value} />
                    },
                    {
                      title: t('common.duration'),
                      dataIndex: 'durationMs',
                      width: 100,
                      render: (value: number | null) => {
                        const isSlow = typeof value === 'number' && value > SLOW_RUN_THRESHOLD_MS;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            <Text style={isSlow ? { color: '#b45309', fontWeight: 600 } : undefined}>
                              {formatDuration(value, locale)}
                            </Text>
                            {isSlow ? (
                              <Tag color="orange" style={{ width: 'fit-content', marginTop: 2 }}>
                                {t('common.slow')}
                              </Tag>
                            ) : null}
                          </div>
                        );
                      }
                    },
                    {
                      title: t('common.started'),
                      dataIndex: 'startedAt',
                      width: 160,
                      responsive: ['xl'],
                      render: (value: string) => (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                          <Text>{formatRelativeTime(value, t)}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {formatShortDate(value, locale)}
                          </Text>
                        </div>
                      )
                    },
                    {
                      title: t('common.trigger'),
                      dataIndex: 'trigger',
                      width: 110,
                      responsive: ['xl'],
                      render: (value: string) => <Tag color={value === 'Schedule' ? 'blue' : 'default'}>{value === 'Schedule' ? t('common.schedule') : t('common.manual')}</Tag>
                    },
                    {
                      title: t('runs.result'),
                      width: 120,
                      render: (_: unknown, row: DashboardRecentRun) => (
                        <Button size="small" onClick={() => navigate(`/runs/${row.runId}`)}>
                          {t('common.openResult')}
                        </Button>
                      )
                    }
                  ]}
                />

                <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <Text type="secondary">
                    {t('runs.showingCount', { visible: visibleRuns, total: totalRuns })}
                  </Text>
                  {hasMore ? (
                    <Button onClick={loadMore} loading={loading}>
                      {t('runs.loadMore')}
                    </Button>
                  ) : (
                    <Text type="secondary">{t('runs.allShown')}</Text>
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
