import { useEffect, useState } from 'react';
import { Alert, Card, Col, Descriptions, Image, Layout, Progress, Row, Skeleton, Space, Tag, Tooltip, Typography } from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getRun } from '../api/client';
import AppHeader from '../components/AppHeader';
import UserMenu from '../components/UserMenu';
import RunStatusBadge from '../components/RunStatusBadge';
import type { TestRun } from '../types';

const { Content } = Layout;
const { Title, Text } = Typography;
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000';
const TRACE_VIEWER_URL = `${BACKEND_URL}/trace-viewer/`;

export default function RunResultPage() {
  const { runId } = useParams<{ runId: string }>();
  const [run, setRun] = useState<TestRun | null>(null);

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
  const totalSteps = run?.totalSteps ?? run?.screenshots.length ?? 0;
  const currentStep = run?.currentStep ?? (run?.screenshots.length ?? 0);
  const progressPercent = totalSteps > 0 ? Math.min(100, Math.round((currentStep / totalSteps) * 100)) : 0;

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #ffffff 100%)' }}>
      <AppHeader
        actions={[
          <Link key="dashboard" to="/dashboard" style={{ color: '#fff' }}>Dashboard</Link>,
          <UserMenu key="menu" />
        ]}
      />
      <Content style={{ padding: 32, maxWidth: 1280, width: '100%', margin: '0 auto' }}>
        <Row gutter={[24, 24]}>
          <Col span={24}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Text type="secondary">
                  <Link to="/projects">Projects</Link> / Run Result
                </Text>
                <Space wrap>
                  <Title level={2} style={{ margin: 0 }}>Run Result</Title>
                  {isActive && <Tag color="processing">Live polling</Tag>}
                  {run && <RunStatusBadge status={run.status} />}
                </Space>
              </div>
            </Card>
          </Col>
          <Col span={24}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              {!run ? (
                <Skeleton active />
              ) : (
                <>
                  <Descriptions bordered column={2}>
                    <Descriptions.Item label="Status">
                      <RunStatusBadge status={run.status} />
                    </Descriptions.Item>
                    <Descriptions.Item label="Progress">
                      {totalSteps > 0 ? `${currentStep}/${totalSteps} steps` : '—'}
                    </Descriptions.Item>
                    <Descriptions.Item label="Duration">
                      {run.durationMs ? `${(run.durationMs / 1000).toFixed(2)}s` : '—'}
                    </Descriptions.Item>
                    <Descriptions.Item label="Started">
                      {new Date(run.startedAt).toLocaleString()}
                    </Descriptions.Item>
                    <Descriptions.Item label="Finished">
                      {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : '—'}
                    </Descriptions.Item>
                    <Descriptions.Item label="Trace" span={2}>
                      {run.tracePath ? (
                        <a href={`${BACKEND_URL}/traces/${run.tracePath}`} target="_blank" rel="noreferrer">
                          Download trace.zip
                        </a>
                      ) : (
                        '—'
                      )}
                    </Descriptions.Item>
                  </Descriptions>
                  {totalSteps > 0 && (
                    <div style={{ marginTop: 24 }}>
                      <Space direction="vertical" style={{ width: '100%' }} size={8}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text type="secondary">
                            {isActive ? 'Running step-by-step' : 'Execution summary'}
                          </Text>
                          <Text strong>
                            Step {Math.min(currentStep || 0, totalSteps)} of {totalSteps}
                          </Text>
                        </div>
                        <Progress percent={progressPercent} status={run.status === 'FAILED' ? 'exception' : 'active'} />
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {Array.from({ length: totalSteps }, (_, index) => {
                            const stepNumber = index + 1;
                            const status =
                              run.status === 'FAILED' && currentStep === stepNumber
                                ? 'exception'
                                : stepNumber < currentStep
                                  ? 'success'
                                  : stepNumber === currentStep && isActive
                                    ? 'processing'
                                    : 'default';

                            const color =
                              status === 'success'
                                ? '#52c41a'
                                : status === 'processing'
                                  ? '#1677ff'
                                  : status === 'exception'
                                    ? '#ff4d4f'
                                    : '#d9d9d9';

                            return (
                              <Tooltip key={stepNumber} title={`Step ${stepNumber}`}>
                                <span
                                  style={{
                                    width: 12,
                                    height: 12,
                                    borderRadius: '999px',
                                    display: 'inline-block',
                                    background: color,
                                    boxShadow: status === 'processing' ? '0 0 0 4px rgba(22, 119, 255, 0.12)' : 'none'
                                  }}
                                />
                              </Tooltip>
                            );
                          })}
                        </div>
                      </Space>
                    </div>
                  )}
                  {run.error && (
                    <Alert
                      type="error"
                      showIcon
                      style={{ marginTop: 24 }}
                      message="Run failed"
                      description={run.error}
                    />
                  )}
                  {run.screenshots.length > 0 && (
                    <div style={{ marginTop: 24 }}>
                      <Title level={4}>Screenshots</Title>
                      <Space wrap>
                        {run.screenshots.map((name, index) => (
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
                    </div>
                  )}
                  {run.tracePath && (
                    <div style={{ marginTop: 24 }}>
                      <Title level={4}>Trace Viewer</Title>
                      <iframe
                        src={`${TRACE_VIEWER_URL}?trace=${encodeURIComponent(
                          `${BACKEND_URL}/traces/${run.tracePath}`
                        )}`}
                        style={{
                          width: '100%',
                          height: 600,
                          border: '1px solid #d9d9d9',
                          borderRadius: 8
                        }}
                        title="Playwright Trace Viewer"
                      />
                    </div>
                  )}
                </>
              )}
            </Card>
          </Col>
        </Row>
      </Content>
    </Layout>
  );
}
