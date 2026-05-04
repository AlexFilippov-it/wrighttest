import { useEffect, useState } from 'react';
import { AppstoreOutlined, FileTextOutlined, HistoryOutlined } from '@ant-design/icons';
import { Breadcrumb, Button, Card, Col, Layout, Row, Space, Table, Tag, Typography } from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getScheduleHistory } from '../api/client';
import AppHeader from '../components/AppHeader';
import RunStatusBadge from '../components/RunStatusBadge';
import type { ScheduleHistoryResponse } from '../types';

const { Content } = Layout;
const { Title, Text } = Typography;

function formatTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '—';
}

export default function ScheduleHistoryPage() {
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ScheduleHistoryResponse | null>(null);

  useEffect(() => {
    if (!scheduleId) return;
    void getScheduleHistory(scheduleId).then(setData);
  }, [scheduleId]);

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 55%, #ffffff 100%)' }}>
      <AppHeader
        actions={[
          <Link key="dashboard" to="/dashboard" style={{ color: '#fff' }}>Dashboard</Link>,
          <Link key="projects" to="/projects" style={{ color: '#fff' }}>Projects</Link>
        ]}
      />
      <Content style={{ padding: 32, maxWidth: 1280, width: '100%', margin: '0 auto' }}>
        <Breadcrumb
          style={{ marginBottom: 16 }}
          items={[
            { title: <Link to="/projects">Projects</Link> },
            { title: data?.schedule.projectId ? <Link to={`/projects/${data.schedule.projectId}/schedules`}>Schedules</Link> : 'Schedules' },
            { title: 'History' }
          ]}
        />

        <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)', marginBottom: 24 }}>
          <Row gutter={[24, 24]}>
            <Col xs={24} md={8}>
              <Title level={5} style={{ marginTop: 0 }}>Schedule</Title>
              <div>{data?.schedule.name ?? 'Loading...'}</div>
            </Col>
            <Col xs={24} md={8}>
              <Title level={5} style={{ marginTop: 0 }}>Cron</Title>
              <Tag color="blue"><code>{data?.schedule.cron ?? '—'}</code></Tag>
            </Col>
            <Col xs={24} md={8}>
              <Title level={5} style={{ marginTop: 0 }}>Target</Title>
              <div>{data?.schedule.target ?? '—'}</div>
            </Col>
          </Row>
        </Card>

        <Space align="center" style={{ marginBottom: 16 }}>
          <HistoryOutlined />
          <Title level={4} style={{ margin: 0 }}>Run History</Title>
        </Space>

        {!data || data.batches.length === 0 ? (
          <Card
            size="small"
            style={{ borderRadius: 16, marginBottom: 12 }}
            styles={{ body: { padding: '16px 20px' } }}
          >
            <Typography.Text type="secondary" style={{ display: 'block', lineHeight: 1.6 }}>
              No runs yet.
            </Typography.Text>
            <Typography.Text type="secondary" style={{ display: 'block', lineHeight: 1.6 }}>
              Schedule will trigger automatically.
            </Typography.Text>
          </Card>
        ) : (
          data.batches.map((batch) => (
            <Card
              key={batch.tick}
              size="small"
              style={{ marginBottom: 12, borderRadius: 16 }}
              title={
                <Space wrap>
                  <RunStatusBadge status={batch.status} />
                  <span>{formatTime(batch.tick)}</span>
                  <Tag>{batch.summary}</Tag>
                  <Tag color="geekblue">{(batch.durationMs / 1000).toFixed(1)}s total</Tag>
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
                    title: 'Test',
                    dataIndex: 'testName',
                    render: (value: string) => (
                      <Space>
                        {data.schedule.target.includes(value) ? <AppstoreOutlined /> : <FileTextOutlined />}
                        <span>{value}</span>
                      </Space>
                    )
                  },
                  {
                    title: 'Status',
                    dataIndex: 'status',
                    render: (status) => <RunStatusBadge status={status} />
                  },
                  {
                    title: 'Duration',
                    dataIndex: 'durationMs',
                    render: (value: number | null) => (value ? `${(value / 1000).toFixed(2)}s` : '—')
                  },
                  {
                    title: 'Started',
                    dataIndex: 'startedAt',
                    render: (value: string) => formatTime(value)
                  },
                  {
                    title: 'Error',
                    dataIndex: 'error',
                    render: (value: string | null | undefined) => (value ? <Typography.Text type="danger">{value}</Typography.Text> : '—')
                  },
                  {
                    title: '',
                    render: (_, run) => (
                      <Button size="small" onClick={() => navigate(`/runs/${run.id}`)}>
                        View
                      </Button>
                    )
                  }
                ]}
              />
            </Card>
          ))
        )}
      </Content>
    </Layout>
  );
}
