import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Layout, Row, Skeleton, Space, Table, Typography } from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getRunBatch } from '../api/client';
import AppFooter from '../components/AppFooter';
import AppHeader from '../components/AppHeader';
import RunStatusBadge from '../components/RunStatusBadge';
import UserMenu from '../components/UserMenu';
import type { TestRunBatch } from '../types';
import {
  formatRunBatchDuration,
  getErrorPreview,
  getRunBatchDurationMs,
  getRunBatchSummaryText,
  isRunBatchTerminal
} from '../utils/runBatch';

const { Content } = Layout;
const { Title, Text } = Typography;

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

function formatProgress(run: TestRunBatch['runs'][number]) {
  if (run.status === 'RUNNING') {
    const current = run.currentStep ?? 0;
    const total = run.totalSteps ?? 0;
    return total > 0 ? `${current} / ${total}` : 'Starting';
  }

  if (run.status === 'FAILED') {
    return getErrorPreview(run.error);
  }

  if (run.status === 'PENDING') {
    return 'Waiting';
  }

  return 'Completed';
}

export default function RunBatchResultPage() {
  const navigate = useNavigate();
  const { batchId } = useParams<{ batchId: string }>();
  const [batch, setBatch] = useState<TestRunBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!batchId) return undefined;

    let interval: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const data = await getRunBatch(batchId);
        if (cancelled) return;
        setBatch(data);
        setError(null);
        setLoading(false);

        if (isRunBatchTerminal(data.status) && interval) {
          clearInterval(interval);
          interval = undefined;
        }
      } catch (requestError: any) {
        if (cancelled) return;
        const status = requestError?.response?.status;
        setError(
          status === 404
            ? 'Run batch was not found.'
            : status === 403
              ? 'You do not have access to this run batch.'
              : 'Run batch could not be loaded.'
        );
        setLoading(false);
        if (interval) {
          clearInterval(interval);
          interval = undefined;
        }
      }
    };

    void poll();
    interval = setInterval(() => {
      void poll();
    }, 2000);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [batchId]);

  const durationMs = useMemo(() => (batch ? getRunBatchDurationMs(batch) : null), [batch]);

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #ffffff 100%)' }}>
      <AppHeader actions={[<UserMenu key="menu" />]} />
      <Content style={{ padding: 32, maxWidth: 1440, width: '100%', margin: '0 auto' }}>
        {loading && !batch ? (
          <Card style={{ borderRadius: 20 }}>
            <Skeleton active paragraph={{ rows: 8 }} />
          </Card>
        ) : error ? (
          <Card style={{ borderRadius: 20 }}>
            <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
            <Button onClick={() => navigate('/runs')}>Back to runs</Button>
          </Card>
        ) : batch ? (
          <Space direction="vertical" size={24} style={{ width: '100%' }}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Text type="secondary">
                  <Link to="/projects">Projects</Link> / Batch Result
                </Text>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                  <div>
                    <Space wrap align="center" size={10}>
                      <Title level={2} style={{ margin: 0 }}>
                        {batch.test.name}
                      </Title>
                      <RunStatusBadge status={batch.status} />
                    </Space>
                    <Text type="secondary">
                      Data-driven batch for {batch.totalCases} test cases
                      {batch.environment ? ` · ${batch.environment.name}` : ''}
                    </Text>
                  </div>
                  <Space wrap>
                    <Button onClick={() => navigate(`/tests/${batch.test.id}/edit`)}>Back to check</Button>
                    <Button onClick={() => navigate(`/projects/${batch.test.projectId}/runs`)}>Back to runs</Button>
                  </Space>
                </div>

                <Row gutter={[16, 16]}>
                  <Col xs={24} sm={12} lg={6}>
                    <Card size="small" style={{ borderRadius: 16 }}>
                      <Text type="secondary">Summary</Text>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>{batch.totalCases} cases</div>
                      <Text type="secondary">{getRunBatchSummaryText(batch)}</Text>
                    </Card>
                  </Col>
                  <Col xs={24} sm={12} lg={6}>
                    <Card size="small" style={{ borderRadius: 16 }}>
                      <Text type="secondary">Passed</Text>
                      <div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a' }}>{batch.passedCases}</div>
                      <Text type="secondary">Successful cases</Text>
                    </Card>
                  </Col>
                  <Col xs={24} sm={12} lg={6}>
                    <Card size="small" style={{ borderRadius: 16 }}>
                      <Text type="secondary">Failed</Text>
                      <div style={{ fontSize: 22, fontWeight: 700, color: '#dc2626' }}>{batch.failedCases}</div>
                      <Text type="secondary">Failed cases</Text>
                    </Card>
                  </Col>
                  <Col xs={24} sm={12} lg={6}>
                    <Card size="small" style={{ borderRadius: 16 }}>
                      <Text type="secondary">Timing</Text>
                      <div style={{ fontSize: 22, fontWeight: 700 }}>{formatRunBatchDuration(durationMs)}</div>
                      <Text type="secondary">Started {formatTimestamp(batch.startedAt)}</Text>
                    </Card>
                  </Col>
                </Row>
              </Space>
            </Card>

            <Card
              title="Test cases"
              style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
            >
              <Table
                rowKey="id"
                dataSource={batch.runs}
                locale={{ emptyText: 'No test case runs have been created for this batch yet.' }}
                pagination={false}
                columns={[
                  {
                    title: 'Case',
                    dataIndex: 'dataCaseName',
                    render: (value: string | null, run) => (
                      <Space direction="vertical" size={0}>
                        <Text strong>{value || `Case ${run.dataCaseIndex ?? ''}`}</Text>
                        <Text type="secondary">Order {run.batchOrder ?? '—'}</Text>
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
                    render: (value) => formatRunBatchDuration(value)
                  },
                  {
                    title: 'Progress / Failed step',
                    render: (_, run) => (
                      <Text type={run.status === 'FAILED' ? 'danger' : undefined}>
                        {formatProgress(run)}
                      </Text>
                    )
                  },
                  {
                    title: 'Started',
                    dataIndex: 'startedAt',
                    render: (value) => formatTimestamp(value)
                  },
                  {
                    title: 'Action',
                    render: (_, run) => (
                      <Link to={`/runs/${run.id}`}>View result</Link>
                    )
                  }
                ]}
              />
            </Card>
          </Space>
        ) : null}
      </Content>
      <AppFooter />
    </Layout>
  );
}
