import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Space, Table, Tag, Typography } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cancelSuiteRun, getSuiteRun } from '../api/client';
import type { SuiteRun } from '../types';
import { PageHeader } from '../design-system';
import { useProjectShell } from '../shell/ProjectShellContext';

function statusColor(status: string) {
  if (status === 'PASSED') return 'success';
  if (status === 'FAILED') return 'error';
  if (status === 'CANCELLED') return 'default';
  return 'processing';
}

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
          <Descriptions.Item label={t('suiteRun.status')}><Tag color={statusColor(run.status)}>{t(`suiteRun.status.${run.status}`)}</Tag></Descriptions.Item>
          <Descriptions.Item label={t('suiteRun.mode')}>{t(run.executionMode === 'SEQUENTIAL' ? 'suites.sequential' : 'suites.independent')}</Descriptions.Item>
          <Descriptions.Item label={t('suiteRun.started')}>{run.startedAt ? new Date(run.startedAt).toLocaleString(i18n.language) : '—'}</Descriptions.Item>
          <Descriptions.Item label={t('suiteRun.duration')}>{run.startedAt && run.finishedAt ? `${((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(2)}s` : '—'}</Descriptions.Item>
        </Descriptions>
        {run.error ? <Alert style={{ marginTop: 16 }} type="error" showIcon message={run.error} /> : null}
      </Card>
      <Card className="wt-content-surface" title={t('suiteRun.checkResults')}>
        <Table
          rowKey="id"
          pagination={false}
          dataSource={run.testRuns}
          columns={[
            { title: t('suiteRun.order'), dataIndex: 'suiteOrder', render: (value: number) => value + 1 },
            { title: t('suiteRun.check'), dataIndex: ['test', 'name'] },
            { title: t('suiteRun.status'), dataIndex: 'status', render: (value: string) => <Tag color={statusColor(value)}>{t(`suiteRun.status.${value}`, value)}</Tag> },
            { title: t('suiteRun.dataCase'), dataIndex: 'dataCaseName', render: (value: string | null) => value ?? '—' },
            { title: t('suiteRun.duration'), dataIndex: 'durationMs', render: (value: number | null) => value === null ? '—' : `${(value / 1000).toFixed(2)}s` },
            { title: t('suiteRun.result'), render: (_: unknown, row: SuiteRun['testRuns'][number]) => <Button onClick={() => navigate(`/runs/${row.id}`)}>{t('suiteRun.openResult')}</Button> }
          ]}
        />
      </Card>
      {run.executionMode === 'SEQUENTIAL' ? <Card className="wt-content-surface" title={t('suiteRun.handoff')}>
        {run.outputMetadata.length ? <Table
          rowKey={(item) => `${item.sourceTestId}-${item.outputVariable}-${item.targetTestId}-${item.targetVariable}`}
          pagination={false}
          dataSource={run.outputMetadata}
          columns={[
            { title: t('suiteRun.source'), render: (_: unknown, item) => `${run.testRuns.find((entry) => entry.testId === item.sourceTestId)?.test.name ?? item.sourceTestId}.${item.outputVariable}` },
            { title: t('suiteRun.target'), render: (_: unknown, item) => `${run.testRuns.find((entry) => entry.testId === item.targetTestId)?.test.name ?? item.targetTestId}.${item.targetVariable}` },
            { title: t('suiteRun.type'), dataIndex: 'type' },
            { title: t('suiteRun.secret'), dataIndex: 'secret', render: (value: boolean) => <Tag>{value ? t('suiteRun.secretYes') : t('suiteRun.secretNo')}</Tag> },
            { title: t('suiteRun.value'), render: () => <Typography.Text type="secondary">{t('suiteRun.valuesHidden')}</Typography.Text> }
          ]}
        /> : <Typography.Text type="secondary">{t('suiteRun.noHandoffs')}</Typography.Text>}
      </Card> : null}
    </> : null}
  </Space>;
}
