import { useEffect, useState, type MouseEvent } from 'react';
import { Button, Card, Descriptions, Layout, Modal, Popconfirm, Radio, Space, Table, Tag, Typography, Upload, message } from 'antd';
import { BellOutlined, CalendarOutlined, DesktopOutlined, EnvironmentOutlined, MobileOutlined, PartitionOutlined, PlayCircleOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteTest, getEnvironments, getProject, importTestSpec, runTestWithEnvironment } from '../api/client';
import AppHeader from '../components/AppHeader';
import UserMenu from '../components/UserMenu';
import type { Environment, Project, Test } from '../types';

const { Content } = Layout;
const { Title, Text } = Typography;

function formatTestUrl(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<(Project & { tests: Test[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [runTestId, setRunTestId] = useState<string | null>(null);
  const [runEnvironments, setRunEnvironments] = useState<Environment[]>([]);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | undefined>(undefined);
  const [runLoading, setRunLoading] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      setProject(await getProject(projectId!));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  const handleRun = async (testId: string, event: MouseEvent) => {
    event.stopPropagation();
    try {
      const environments = await getEnvironments(projectId!);

      if (environments.length === 0) {
        const { testRunId } = await runTestWithEnvironment(testId);
        message.success('Test started');
        navigate(`/runs/${testRunId}`);
        return;
      }

      setRunTestId(testId);
      setRunEnvironments(environments);
      setSelectedEnvironmentId(undefined);
      setRunModalOpen(true);
    } catch {
      message.error('Failed to load environments');
    }
  };

  const handleDelete = async (testId: string) => {
    await deleteTest(testId);
    message.success('Test deleted');
    await load();
  };

  const handleConfirmRun = async () => {
    if (!runTestId) return;

    setRunLoading(true);
    try {
      const { testRunId } = await runTestWithEnvironment(runTestId, selectedEnvironmentId);
      setRunModalOpen(false);
      message.success('Test started');
      navigate(`/runs/${testRunId}`);
    } catch {
      message.error('Failed to start test');
    } finally {
      setRunLoading(false);
    }
  };

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 55%, #ffffff 100%)' }}>
      <AppHeader actions={[<UserMenu key="menu" />]} />
      <Content style={{ padding: 32, maxWidth: 1280, width: '100%', margin: '0 auto' }}>
        <Card style={{ borderRadius: 20, marginBottom: 24, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text type="secondary">
                  <Link to="/projects">Projects</Link>
                  <Link to="/dashboard" style={{ marginLeft: 16 }}>Dashboard</Link>
                </Text>
                <Title level={2} style={{ margin: 0 }}>{project?.name ?? 'Loading...'}</Title>
              </div>
                <Space wrap>
                  <Upload
                    accept=".ts,.js"
                    showUploadList={false}
                  beforeUpload={async (file) => {
                    const code = await file.text();
                    try {
                      const { test, parsedSteps } = await importTestSpec(projectId!, code);
                      message.success(`Imported "${test.name}" — ${parsedSteps} steps`);
                      await load();
                    } catch (error) {
                      const responseError = error && typeof error === 'object' && 'response' in error
                        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
                        : null;
                      message.error(typeof responseError === 'string' ? responseError : 'Import failed');
                    }
                    return false;
                  }}
                >
                  <Button icon={<UploadOutlined />}>Import .spec.ts</Button>
                </Upload>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => navigate(`/projects/${projectId}/tests/new`)}
                >
                  New Test
                </Button>
                <Button
                  icon={<EnvironmentOutlined />}
                  onClick={() => navigate(`/projects/${projectId}/environments`)}
                >
                  Environments
                </Button>
                <Button
                  icon={<BellOutlined />}
                  onClick={() => navigate(`/projects/${projectId}/notifications`)}
                >
                  Notifications
                </Button>
                <Button
                  icon={<PartitionOutlined />}
                  onClick={() => navigate(`/projects/${projectId}/suites`)}
                >
                  Suites
                </Button>
                <Button
                  icon={<CalendarOutlined />}
                  onClick={() => navigate(`/projects/${projectId}/schedules`)}
                >
                  Schedules
                </Button>
              </Space>
            </div>
            <Descriptions size="small" column={2}>
              <Descriptions.Item label="Project ID">{project?.id}</Descriptions.Item>
              <Descriptions.Item label="Tests">{project?.tests.length ?? 0}</Descriptions.Item>
            </Descriptions>
          </div>
        </Card>

        <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
          <Table
            dataSource={project?.tests ?? []}
            rowKey="id"
            loading={loading}
            pagination={false}
            onRow={(row) => ({ onClick: () => navigate(`/tests/${row.id}/edit`) })}
            rowClassName={() => 'clickable-row'}
            columns={[
              { title: 'Name', dataIndex: 'name' },
              {
                title: 'URL',
                dataIndex: 'url',
                render: (value: string) => <Tag>{formatTestUrl(value)}</Tag>
              },
              {
                title: 'Steps',
                dataIndex: 'steps',
                render: (value: unknown[]) => value.length
              },
              {
                title: 'Runs',
                dataIndex: ['_count', 'runs'],
                render: (value: number | undefined) => <Tag color="purple">{value ?? 0}</Tag>
              },
              {
                title: 'Device',
                dataIndex: 'device',
                render: (device: string | null | undefined) =>
                  device ? (
                    <Tag icon={<MobileOutlined />} color="blue">
                      {device}
                    </Tag>
                  ) : (
                    <Tag icon={<DesktopOutlined />}>Desktop</Tag>
                  )
              },
              {
                title: 'Actions',
                render: (_, row) => (
                  <Space onClick={(event) => event.stopPropagation()}>
                    <Button
                      icon={<PlayCircleOutlined />}
                      type="primary"
                      size="small"
                      onClick={(event) => void handleRun(row.id, event)}
                    >
                      Run
                    </Button>
                    <Popconfirm title="Delete test?" onConfirm={() => void handleDelete(row.id)}>
                      <Button danger size="small">Delete</Button>
                    </Popconfirm>
                  </Space>
                )
              }
            ]}
          />
        </Card>
      </Content>
      <Modal
        title="Select Environment"
        open={runModalOpen}
        onOk={() => void handleConfirmRun()}
        onCancel={() => setRunModalOpen(false)}
        confirmLoading={runLoading}
      >
        <Radio.Group
          style={{ display: 'grid', gap: 12, width: '100%' }}
          value={selectedEnvironmentId ?? ''}
          onChange={(event) => setSelectedEnvironmentId(event.target.value || undefined)}
        >
          <Radio value="">No environment (use values as-is)</Radio>
          {runEnvironments.map((environment) => (
            <Radio key={environment.id} value={environment.id}>
              {environment.name}
              <Tag style={{ marginLeft: 8 }}>{Object.keys(environment.variables).length} variables</Tag>
            </Radio>
          ))}
        </Radio.Group>
      </Modal>
    </Layout>
  );
}
