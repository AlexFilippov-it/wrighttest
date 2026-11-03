import { useEffect, useState } from 'react';
import { AppstoreOutlined, FileTextOutlined, HistoryOutlined } from '@ant-design/icons';
import { Breadcrumb, Button, Card, Col, Layout, Row, Space, Table, Tag, Typography } from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getScheduleHistory } from '../api/client';
import AppHeader from '../components/AppHeader';
import AppFooter from '../components/AppFooter';
import RunStatusBadge from '../components/RunStatusBadge';
import UserMenu from '../components/UserMenu';
import { EmptyState } from '../design-system';
import type { ScheduleHistoryResponse } from '../types';

const { Content } = Layout;
const { Title, Text } = Typography;

function formatTime(value: string | null | undefined, locale: string) {
  return value ? new Date(value).toLocaleString(locale) : '—';
}

export default function ScheduleHistoryPage() {
  const { t, i18n } = useTranslation();
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ScheduleHistoryResponse | null>(null);

  useEffect(() => {
    if (!scheduleId) return;
    void getScheduleHistory(scheduleId).then(setData);
  }, [scheduleId]);

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 55%, #ffffff 100%)' }}>
      <AppHeader actions={[<UserMenu key="menu" />]} />
      <Content className="wt-surface-page" style={{ padding: 32, maxWidth: 1280, width: '100%', margin: '0 auto' }}>
        <Breadcrumb
          style={{ marginBottom: 16 }}
          items={[
            { title: <Link to="/projects">{t('nav.projects')}</Link> },
            { title: data?.schedule.projectId ? <Link to={`/projects/${data.schedule.projectId}/schedules`}>{t('project.schedules')}</Link> : t('project.schedules') },
            { title: t('scheduleHistory.title') }
          ]}
        />

        <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)', marginBottom: 24 }}>
          <Row gutter={[24, 24]}>
            <Col xs={24} md={8}>
              <Title level={5} style={{ marginTop: 0 }}>{t('common.schedule')}</Title>
              <div>{data?.schedule.name ?? t('common.loading')}</div>
            </Col>
            <Col xs={24} md={8}>
              <Title level={5} style={{ marginTop: 0 }}>{t('scheduleHistory.cron')}</Title>
              <Tag color="blue"><code>{data?.schedule.cron ?? '—'}</code></Tag>
            </Col>
            <Col xs={24} md={8}>
              <Title level={5} style={{ marginTop: 0 }}>{t('scheduleHistory.target')}</Title>
              <div>{data?.schedule.target ?? '—'}</div>
            </Col>
          </Row>
        </Card>

        <Space align="center" style={{ marginBottom: 16 }}>
          <HistoryOutlined />
          <Title level={4} style={{ margin: 0 }}>{t('scheduleHistory.runHistory')}</Title>
        </Space>

        {!data || data.batches.length === 0 ? (
          <EmptyState
            title={t('common.noRunsYet')}
            description={t('scheduleHistory.emptyDescription')}
          />
        ) : (
          data.batches.map((batch) => (
            <Card
              key={batch.tick}
              size="small"
              style={{ marginBottom: 12, borderRadius: 16 }}
              title={
                <Space wrap>
                  <RunStatusBadge status={batch.status} />
                  <span>{formatTime(batch.tick, i18n.resolvedLanguage ?? 'en')}</span>
                  <Tag>{batch.summary}</Tag>
                  <Tag color="geekblue">{t('scheduleHistory.durationTotal', { duration: (batch.durationMs / 1000).toFixed(1) })}</Tag>
                </Space>
              }
            >
              <Table
                dataSource={batch.runs}
                rowKey="id"
                size="small"
                pagination={false}
                columns={[
                  {
                    title: t('scheduleHistory.check'),
                    dataIndex: 'testName',
                    render: (value: string) => (
                      <Space>
                        {data.schedule.target.includes(value) ? <AppstoreOutlined /> : <FileTextOutlined />}
                        <span>{value}</span>
                      </Space>
                    )
                  },
                  {
                    title: t('common.status'),
                    dataIndex: 'status',
                    render: (status) => <RunStatusBadge status={status} />
                  },
                  {
                    title: t('common.duration'),
                    dataIndex: 'durationMs',
                    render: (value: number | null) => (value ? `${(value / 1000).toFixed(2)}s` : '—')
                  },
                  {
                    title: t('common.started'),
                    dataIndex: 'startedAt',
                    render: (value: string) => formatTime(value, i18n.resolvedLanguage ?? 'en')
                  },
                  {
                    title: t('scheduleHistory.error'),
                    dataIndex: 'error',
                    render: (value: string | null | undefined) => (value ? <Typography.Text type="danger">{value}</Typography.Text> : '—')
                  },
                  {
                    title: '',
                    render: (_, run) => (
                      <Button size="small" onClick={() => navigate(`/runs/${run.id}`)}>
                        {t('common.view')}
                      </Button>
                    )
                  }
                ]}
              />
            </Card>
          ))
        )}
      </Content>
      <AppFooter />
    </Layout>
  );
}
