import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Space, Table, Tag, Typography } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cancelSuiteRun, getSuiteRun } from '../api/client';
import type { SuiteRun } from '../types';
import { PageHeader, StatusBadge } from '../design-system';
import { useProjectShell } from '../shell/ProjectShellContext';

export default function SuiteRunResultPage() {
  const { t, i18n } = useTranslation();
  const { suiteRunId } = useParams<{ suiteRunId: string }>();
  const navigate = useNavigate();
  const { project } = useProjectShell();
  const [run, setRun] = useState<SuiteRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const canWrite = project.currentUserRole === 'OWNER' || project.currentUserRole === 'EDITOR';

  const load = useCallback(async () => {
    if (!suiteRunId) return;
    try { setRun(await getSuiteRun(suiteRunId)); }
    finally { setLoading(false); }
  }, [suiteRunId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!run || !['PENDING', 'RUNNING'].includes(run.status)) return;
    const timer = window.setInterval(() => { void load(); }, 1500);
    return () => window.clearInterval(timer);
  }, [run, load]);

  const handleCancel = async () => {
    if (!suiteRunId) return;
    setCancelling(true);
    try { await cancelSuiteRun(suiteRunId); await load(); }
    finally { setCancelling(false); }
  };

  const checkResults = run?.orderedChecks.map((check) => {
    const testRun = run.testRuns.find((entry) => entry.testId === check.testId);
    const notStartedStatus = run.status === 'CANCELLED'
      ? 'CANCELLED'
      : run.status === 'FAILED' && check.order > run.currentOrder
        ? 'SKIPPED'
        : 'PENDING';
    return { ...check, testRun, status: testRun?.status ?? notStartedStatus };
  }) ?? [];

  const mobileResults = <div className="wt-suite-run-mobile-cards">
    {checkResults.map((item) => <article className="wt-suite-run-mobile-card" key={item.testId}>
      <div className="wt-suite-run-mobile-card__heading">
        <span className="wt-suite-run-mobile-card__order">{t('suiteRun.order')} {item.order + 1}</span>
        <StatusBadge status={item.status} label={t(`suiteRun.status.${item.status}`, item.status)} />
      </div>
      <Typography.Text strong className="wt-suite-run-mobile-card__check">{item.name}</Typography.Text>
      <div className="wt-suite-run-mobile-card__details">
        <div><span>{t('suiteRun.dataCase')}</span><strong>{item.testRun?.dataCaseName ?? '—'}</strong></div>
        <div><span>{t('suiteRun.duration')}</span><strong>{item.testRun?.durationMs == null ? '—' : `${(item.testRun.durationMs / 1000).toFixed(2)}s`}</strong></div>
      </div>
      {item.testRun?.id
        ? <Button className="wt-suite-run-mobile-card__action" onClick={() => navigate(`/runs/${item.testRun!.id}`)}>{t('suiteRun.openResult')}</Button>
        : <Typography.Text type="secondary" className="wt-suite-run-mobile-card__waiting">{t('suiteRun.waitingToStart')}</Typography.Text>}
    </article>)}
  </div>;

  const mobileHandoffs = <div className="wt-suite-run-mobile-cards">
    {run?.outputMetadata.map((item) => {
      const sourceName = run.orderedChecks.find((entry) => entry.testId === item.sourceTestId)?.name ?? item.sourceTestId;
      const targetName = run.orderedChecks.find((entry) => entry.testId === item.targetTestId)?.name ?? item.targetTestId;
      return <article className="wt-suite-run-mobile-card wt-suite-run-mobile-card--handoff" key={`${item.sourceTestId}-${item.outputVariable}-${item.targetTestId}-${item.targetVariable}`}>
        <div className="wt-suite-run-mobile-card__details">
          <div><span>{t('suiteRun.source')}</span><strong>{sourceName}</strong></div>
          <div><span>{t('suiteRun.sourceVariable')}</span><strong>{item.outputVariable}</strong></div>
          <div><span>{t('suiteRun.target')}</span><strong>{targetName}</strong></div>
          <div><span>{t('suiteRun.targetVariable')}</span><strong>{item.targetVariable}</strong></div>
          <div><span>{t('suiteRun.type')}</span><strong>{item.type}</strong></div>
          <div><span>{t('suiteRun.secret')}</span><Tag>{item.secret ? t('suiteRun.secretYes') : t('suiteRun.secretNo')}</Tag></div>
        </div>
        <Typography.Text type="secondary">{t('suiteRun.valuesHidden')}</Typography.Text>
      </article>;
    })}
  </div>;

  if (!run && !loading) return <Alert type="error" showIcon message={t('suiteRun.notFound')} />;
  return <Space direction="vertical" size="large" style={{ width: '100%' }}>
    <PageHeader
      title={run?.suiteName ?? t('suiteRun.title')}
      description={t('suiteRun.description')}
      breadcrumbs={[
        { key: 'projects', label: t('nav.projects'), href: '/projects' },
        { key: 'suite', label: run?.suiteName ?? t('suites.title'), href: `/projects/${project.id}/suites` },
        { key: 'run', label: t('suiteRun.title') }
      ]}
      actions={run && canWrite && ['PENDING', 'RUNNING'].includes(run.status)
        ? <Button danger loading={cancelling} onClick={() => void handleCancel()}>{t('suiteRun.cancel')}</Button>
        : undefined}
    />
    {run ? <>
      <Card className="wt-content-surface" loading={loading}>
        <Descriptions size="small" column={{ xs: 1, sm: 2, md: 4 }}>
          <Descriptions.Item label={t('suiteRun.status')}><StatusBadge status={run.status} label={t(`suiteRun.status.${run.status}`, run.status)} /></Descriptions.Item>
          <Descriptions.Item label={t('suiteRun.mode')}>{t(run.executionMode === 'SEQUENTIAL' ? 'suites.sequential' : 'suites.independent')}</Descriptions.Item>
          <Descriptions.Item label={t('suiteRun.started')}>{run.startedAt ? new Date(run.startedAt).toLocaleString(i18n.language) : '—'}</Descriptions.Item>
          <Descriptions.Item label={t('suiteRun.duration')}>{run.startedAt && run.finishedAt ? `${((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(2)}s` : '—'}</Descriptions.Item>
        </Descriptions>
        {run.error ? <Alert style={{ marginTop: 16 }} type="error" showIcon message={run.error} /> : null}
      </Card>
      <Card className="wt-content-surface" title={t('suiteRun.checkResults')}>
        <div className="wt-suite-run-desktop-table"><Table
          rowKey="id"
          pagination={false}
          scroll={{ x: 'max-content' }}
          dataSource={run.testRuns}
          columns={[
            { title: t('suiteRun.order'), dataIndex: 'suiteOrder', width: 80, render: (value: number) => value + 1 },
            { title: t('suiteRun.check'), dataIndex: ['test', 'name'], width: 220 },
            { title: t('suiteRun.status'), dataIndex: 'status', width: 130, render: (value: string) => <StatusBadge status={value} label={t(`suiteRun.status.${value}`, value)} /> },
            { title: t('suiteRun.dataCase'), dataIndex: 'dataCaseName', width: 180, render: (value: string | null) => value ?? '—' },
            { title: t('suiteRun.duration'), dataIndex: 'durationMs', width: 120, render: (value: number | null) => value === null ? '—' : `${(value / 1000).toFixed(2)}s` },
            { title: t('suiteRun.result'), render: (_: unknown, row: SuiteRun['testRuns'][number]) => <Button onClick={() => navigate(`/runs/${row.id}`)}>{t('suiteRun.openResult')}</Button> }
          ]}
        /></div>
        {mobileResults}
      </Card>
      {run.executionMode === 'SEQUENTIAL' ? <Card className="wt-content-surface" title={t('suiteRun.handoff')}>
        {run.outputMetadata.length ? <>
        <div className="wt-suite-run-desktop-table"><Table
          rowKey={(item) => `${item.sourceTestId}-${item.outputVariable}-${item.targetTestId}-${item.targetVariable}`}
          pagination={false}
          scroll={{ x: 'max-content' }}
          dataSource={run.outputMetadata}
          columns={[
            { title: t('suiteRun.source'), width: 240, render: (_: unknown, item) => `${run.testRuns.find((entry) => entry.testId === item.sourceTestId)?.test.name ?? item.sourceTestId}.${item.outputVariable}` },
            { title: t('suiteRun.target'), width: 240, render: (_: unknown, item) => `${run.testRuns.find((entry) => entry.testId === item.targetTestId)?.test.name ?? item.targetTestId}.${item.targetVariable}` },
            { title: t('suiteRun.type'), dataIndex: 'type', width: 120 },
            { title: t('suiteRun.secret'), dataIndex: 'secret', width: 120, render: (value: boolean) => <Tag>{value ? t('suiteRun.secretYes') : t('suiteRun.secretNo')}</Tag> },
            { title: t('suiteRun.value'), width: 180, render: () => <Typography.Text type="secondary">{t('suiteRun.valuesHidden')}</Typography.Text> }
          ]}
        /></div>
        {mobileHandoffs}
        </> : <Typography.Text type="secondary">{t('suiteRun.noHandoffs')}</Typography.Text>}
      </Card> : null}
    </> : null}
  </Space>;
}
