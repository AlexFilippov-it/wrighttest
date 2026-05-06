import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Dropdown,
  Empty,
  Form,
  Input,
  Layout,
  Modal,
  Skeleton,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message
} from 'antd';
import type { MenuProps } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  SettingOutlined
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import AppFooter from '../components/AppFooter';
import UserMenu from '../components/UserMenu';
import { createProject, deleteProject, getProjects, updateProject } from '../api/client';
import { getProjectDescription } from '../utils/projectSettings';
import type { ProjectHealth, ProjectSummary } from '../types';

const { Content } = Layout;
const { Title, Text } = Typography;

function formatCreatedLabel(value: string) {
  return `Created ${new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })}`;
}

function formatRelativeTime(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

  return new Date(value).toLocaleString();
}

function healthMeta(health: ProjectHealth) {
  switch (health) {
    case 'passing':
      return { color: 'green', text: 'Passing', icon: <CheckCircleOutlined /> };
    case 'failing':
      return { color: 'red', text: 'Failing', icon: <ExclamationCircleOutlined /> };
    case 'flaky':
      return { color: 'gold', text: 'Flaky', icon: <ClockCircleOutlined /> };
    default:
      return { color: 'default', text: 'No runs', icon: <ClockCircleOutlined /> };
  }
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null);
  const [createForm] = Form.useForm<{ name: string }>();
  const [renameForm] = Form.useForm<{ name: string }>();
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      setProjects(await getProjects());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const totals = useMemo(() => {
    const checks = projects.reduce((sum, project) => sum + project.checksCount, 0);
    const totalRuns = projects.reduce((sum, project) => sum + project.totalRuns30d, 0);
    const passedRuns = projects.reduce((sum, project) => sum + project.passedRuns30d, 0);
    const failedChecks = projects.reduce((sum, project) => sum + project.failedChecks, 0);
    const passRate = totalRuns > 0 ? Math.round((passedRuns / totalRuns) * 100) : null;

    return {
      checks,
      totalRuns,
      passedRuns,
      failedChecks,
      passRate
    };
  }, [projects]);
  const hasLoaded = !loading;

  const handleCreate = async () => {
    const { name } = await createForm.validateFields();
    setCreating(true);
    try {
      await createProject(name);
      message.success('Project created');
      setCreateOpen(false);
      createForm.resetFields();
      await load();
    } finally {
      setCreating(false);
    }
  };

  const openRenameModal = (project: ProjectSummary) => {
    setSelectedProject(project);
    renameForm.setFieldsValue({ name: project.name });
    setRenameOpen(true);
  };

  const handleRename = async () => {
    const { name } = await renameForm.validateFields();
    if (!selectedProject) return;

    setRenaming(true);
    try {
      await updateProject(selectedProject.id, { name });
      message.success('Project renamed');
      setRenameOpen(false);
      setSelectedProject(null);
      renameForm.resetFields();
      await load();
    } finally {
      setRenaming(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteProject(id);
    message.success('Project deleted');
    await load();
  };

  const createMenu = (project: ProjectSummary): MenuProps => ({
    items: [
      {
        key: 'rename',
        icon: <EditOutlined />,
        label: 'Rename'
      },
      {
        key: 'settings',
        icon: <SettingOutlined />,
        label: 'Settings'
      },
      {
        type: 'divider'
      },
      {
        key: 'delete',
        icon: <DeleteOutlined />,
        label: 'Delete',
        danger: true
      }
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();

      if (key === 'rename') {
        openRenameModal(project);
      }

      if (key === 'settings') {
        navigate(`/projects/${project.id}/environments`);
      }

      if (key === 'delete') {
        Modal.confirm({
          title: 'Delete project?',
          content: `This will remove "${project.name}" and all related tests, schedules, environments, and alerts.`,
          okText: 'Delete',
          okButtonProps: { danger: true },
          centered: true,
          onOk: async () => {
            await handleDelete(project.id);
          }
        });
      }
    }
  });

  const hasProjects = !loading && projects.length > 0;

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f7f3ff 0%, #eef4ff 55%, #ffffff 100%)' }}>
      <AppHeader
        actions={[
          <UserMenu key="menu" />,
          <Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            New Project
          </Button>
        ]}
      />
      <Content style={{ padding: 32, maxWidth: 1560, width: '100%', margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'stretch', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 860px', minWidth: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Title level={2} style={{ margin: 0 }}>Projects</Title>
                <Text type="secondary">
                  Track browser checks, schedules, alerts, and run history by project.
                </Text>
              </div>

              <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} xl={6}>
                  <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)', borderTop: '3px solid #1677ff' }}>
                    <Statistic title="Projects" value={hasLoaded ? projects.length : '—'} />
                    <Text type="secondary">Total projects</Text>
                  </Card>
                </Col>
                <Col xs={24} sm={12} xl={6}>
                  <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)', borderTop: '3px solid #13c2c2' }}>
                    <Statistic title="Browser checks" value={hasLoaded ? totals.checks : '—'} />
                    <Text type="secondary">Across all projects</Text>
                  </Card>
                </Col>
                <Col xs={24} sm={12} xl={6}>
                  <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)', borderTop: '3px solid #52c41a' }}>
                    <Statistic
                      title={<span style={{ whiteSpace: 'nowrap' }}>Pass rate</span>}
                      value={totals.passRate ?? '—'}
                      suffix={totals.passRate === null ? undefined : '%'}
                      valueStyle={{ color: totals.passRate === null ? '#8c8c8c' : totals.passRate >= 80 ? '#52c41a' : '#ff4d4f' }}
                    />
                    <Text type="secondary">
                      {totals.totalRuns > 0 ? `${totals.passedRuns}/${totals.totalRuns} runs in last 30 days` : 'No runs yet'}
                    </Text>
                  </Card>
                </Col>
                <Col xs={24} sm={12} xl={6}>
                  <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)', borderTop: '3px solid #ff4d4f' }}>
                    <Statistic
                      title="Failed checks"
                      value={hasLoaded ? totals.failedChecks : '—'}
                      valueStyle={{ color: totals.totalRuns > 0 && totals.failedChecks > 0 ? '#ff4d4f' : '#8c8c8c' }}
                    />
                    <Text type="secondary">{totals.totalRuns > 0 ? 'Latest run failed' : 'No runs yet'}</Text>
                  </Card>
                </Col>
              </Row>

              <Card
                title={<span style={{ fontSize: 18 }}>Projects</span>}
                style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}
                bodyStyle={{ padding: hasProjects ? 0 : 24 }}
              >
                {loading ? (
                  <Skeleton active paragraph={{ rows: 6 }} />
                ) : !hasProjects ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      <Space direction="vertical" size={6}>
                        <Text strong style={{ fontSize: 16 }}>No projects yet</Text>
                        <Text type="secondary">
                          Create a project to group browser checks, environments, schedules, and alerts.
                        </Text>
                      </Space>
                    }
                  >
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                      Create project
                    </Button>
                  </Empty>
                ) : (
                  <Table<ProjectSummary>
                    dataSource={projects}
                    rowKey="id"
                    loading={loading}
                    pagination={false}
                    rowClassName={() => 'clickable-row'}
                    onRow={(row) => ({
                      onClick: () => navigate(`/projects/${row.id}`)
                    })}
                    columns={[
                      {
                        title: 'Project',
                        width: 260,
                        key: 'project',
                        render: (_, row) => {
                          const description = getProjectDescription(row.id);

                          return (
                            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <Link
                                to={`/projects/${row.id}`}
                                onClick={(event) => event.stopPropagation()}
                                style={{ fontWeight: 600, minWidth: 0 }}
                              >
                                {row.name}
                              </Link>
                              {description ? (
                                <Text
                                  type="secondary"
                                  style={{
                                    minWidth: 0,
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                    lineHeight: 1.45
                                  }}
                                >
                                  {description}
                                </Text>
                              ) : (
                                <Text type="secondary">{formatCreatedLabel(row.createdAt)}</Text>
                              )}
                            </div>
                          );
                        }
                      },
                      {
                        title: 'Checks',
                        dataIndex: 'checksCount',
                        key: 'checksCount',
                        render: (value: number) => <Tag color="blue">{value}</Tag>
                      },
                      {
                        title: 'Health',
                        dataIndex: 'health',
                        key: 'health',
                        render: (value: ProjectHealth) => {
                          const meta = healthMeta(value);
                          return <Tag color={meta.color} icon={meta.icon}>{meta.text}</Tag>;
                        }
                      },
                      {
                        title: 'Pass rate',
                        width: 120,
                        key: 'passRate',
                        render: (_, row) =>
                          row.passRate30d === null ? (
                            <Text type="secondary">—</Text>
                          ) : (
                            <Tag color={row.passRate30d >= 80 ? 'green' : 'red'}>{row.passRate30d}%</Tag>
                          )
                      },
                      {
                        title: 'Last run',
                        width: 150,
                        key: 'lastRunAt',
                        render: (_, row) =>
                          row.lastRunAt ? (
                            <Space direction="vertical" size={0}>
                              <Text style={{ lineHeight: 1.2 }}>{formatRelativeTime(row.lastRunAt)}</Text>
                              <Text type="secondary">
                                {new Date(row.lastRunAt).toLocaleString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit'
                                })}
                              </Text>
                            </Space>
                          ) : (
                            <Text type="secondary">Never</Text>
                          )
                      },
                      {
                        title: 'Schedules',
                        key: 'schedules',
                        render: (_, row) => (
                          <Tag color="default">{row.activeSchedulesCount} active</Tag>
                        )
                      },
                      {
                        title: 'Alerts',
                        key: 'alerts',
                        render: (_, row) => {
                          if (row.alertChannelsCount === 0) {
                            return <Tag color="default">Not configured</Tag>;
                          }

                          if (row.alertChannelsCount <= 2) {
                            return (
                              <Space wrap size={4}>
                                {row.alertChannelTypes.map((type) => (
                                  <Tag key={type} color={type === 'telegram' ? 'blue' : 'geekblue'}>
                                    {type === 'telegram' ? 'Telegram' : 'Slack'}
                                  </Tag>
                                ))}
                              </Space>
                            );
                          }

                          return <Tag color="default">{row.alertChannelsCount} channels</Tag>;
                        }
                      },
                      {
                        title: 'Actions',
                        key: 'actions',
                        width: 136,
                        render: (_, row) => (
                          <Space size={8}>
                            <Button
                              type="primary"
                              size="small"
                              onClick={(event) => {
                                event.stopPropagation();
                                navigate(`/projects/${row.id}`);
                              }}
                            >
                              Open
                            </Button>
                            <Dropdown menu={createMenu(row)} trigger={['click']} placement="bottomRight">
                              <Button
                                size="small"
                                icon={<EllipsisOutlined />}
                                onClick={(event) => event.stopPropagation()}
                              />
                            </Dropdown>
                          </Space>
                        )
                      }
                    ]}
                  />
                )}
              </Card>
            </div>
          </div>

          <div style={{ flex: '0 0 360px', maxWidth: 360, width: '100%' }}>
            <Card
              style={{
                borderRadius: 20,
                height: '100%',
                boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)'
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <Title level={4} style={{ margin: 0 }}>Getting started</Title>
                  <Text type="secondary">Projects group checks, environments, schedules, and alert channels.</Text>
                </div>

                <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 10 }}>
                  <li>Create a project</li>
                  <li>Add or import a browser check</li>
                  <li>Run it manually</li>
                  <li>Schedule regular runs</li>
                  <li>Add Telegram or Slack alerts</li>
                </ol>

                <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                  New Project
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </Content>

      <Modal
        title="New Project"
        open={createOpen}
        onOk={() => void handleCreate()}
        confirmLoading={creating}
        onCancel={() => setCreateOpen(false)}
        okText="Create"
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="name" label="Project name" rules={[{ required: true, message: 'Project name is required' }]}>
            <Input placeholder="My browser checks" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Rename project"
        open={renameOpen}
        onOk={() => void handleRename()}
        confirmLoading={renaming}
        onCancel={() => {
          setRenameOpen(false);
          setSelectedProject(null);
          renameForm.resetFields();
        }}
        okText="Save"
      >
        <Form form={renameForm} layout="vertical">
          <Form.Item name="name" label="Project name" rules={[{ required: true, message: 'Project name is required' }]}>
            <Input placeholder="Project name" />
          </Form.Item>
        </Form>
      </Modal>
      <AppFooter />
    </Layout>
  );
}
