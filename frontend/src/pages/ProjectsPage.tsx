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
  Table,
  Tag,
  Tooltip,
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
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import AppHeader from '../components/AppHeader';
import AppFooter from '../components/AppFooter';
import UserMenu from '../components/UserMenu';
import { useAuth } from '../context/AuthContext';
import { StatCard } from '../design-system';
import { createProject, deleteProject, getProjects, updateProject } from '../api/client';
import { getProjectDescription } from '../utils/projectSettings';
import type { ProjectHealth, ProjectSummary } from '../types';

const { Content } = Layout;
const { Title, Text } = Typography;

function formatCreatedLabel(value: string, locale: string, t: TFunction) {
  return t('projects.projectCreatedDate', { date: new Date(value).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }) });
}

function formatRelativeTime(value: string, t: TFunction, locale: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes < 1) return t('time.justNow');
  if (diffMinutes < 60) return t('time.minutesAgo', { count: diffMinutes });

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return t('time.hoursAgo', { count: diffHours });

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return t('time.daysAgo', { count: diffDays });

  return new Date(value).toLocaleString(locale);
}

function healthMeta(health: ProjectHealth, t: TFunction) {
  switch (health) {
    case 'passing':
      return { color: 'green', text: t('common.passing'), icon: <CheckCircleOutlined /> };
    case 'failing':
      return { color: 'red', text: t('common.failing'), icon: <ExclamationCircleOutlined /> };
    case 'flaky':
      return { color: 'gold', text: t('common.flaky'), icon: <ClockCircleOutlined /> };
    default:
      return { color: 'default', text: t('common.noRunsYet'), icon: <ClockCircleOutlined /> };
  }
}

export default function ProjectsPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  const { canCreateProject } = useAuth();
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
  const createProjectButtonStyle = canCreateProject
    ? undefined
    : {
        opacity: 1,
        color: '#64748b',
        background: '#f8fafc',
        borderColor: '#cbd5e1',
        boxShadow: 'none'
      };

  const handleCreate = async () => {
    const { name } = await createForm.validateFields();
    setCreating(true);
    try {
      await createProject(name);
      message.success(t('projects.created'));
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
      message.success(t('projects.renamed'));
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
    message.success(t('projects.deleted'));
    await load();
  };

  const createMenu = (project: ProjectSummary): MenuProps => ({
    items: [
      {
        key: 'rename',
        icon: <EditOutlined />,
        label: t('projects.rename')
      },
      {
        key: 'settings',
        icon: <SettingOutlined />,
        label: t('project.settings')
      },
      {
        type: 'divider'
      },
      {
        key: 'delete',
        icon: <DeleteOutlined />,
        label: t('language.delete'),
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
          title: t('projects.deleteTitle'),
          content: t('projects.deleteDescription', { name: project.name }),
          okText: t('language.delete'),
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
          <Button
            key="new"
            type={canCreateProject ? 'primary' : 'default'}
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
            disabled={!canCreateProject}
            style={createProjectButtonStyle}
          >
            {t('projects.newProject')}
          </Button>
        ]}
      />
      <Content className="wt-surface-page" style={{ padding: 32, maxWidth: 1560, width: '100%', margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'stretch', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 860px', minWidth: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Title level={2} style={{ margin: 0 }}>{t('projects.title')}</Title>
                <Text type="secondary">{t('projects.description')}</Text>
              </div>

              <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} xl={6}><StatCard title={t('projects.title')} value={hasLoaded ? projects.length : '—'} description={t('projects.totalProjects')} loading={loading} /></Col>
                <Col xs={24} sm={12} xl={6}><StatCard title={t('projects.browserChecks')} value={hasLoaded ? totals.checks : '—'} description={t('projects.acrossAllProjects')} loading={loading} /></Col>
                <Col xs={24} sm={12} xl={6}>
                  <StatCard title={t('projects.passRate')} value={totals.passRate === null ? '—' : `${totals.passRate}%`} description={totals.totalRuns > 0 ? t('projects.totalRunsPassRate', { passed: totals.passedRuns, total: totals.totalRuns }) : t('projects.noRuns')} loading={loading} />
                </Col>
                <Col xs={24} sm={12} xl={6}>
                  <StatCard title={t('projects.failedChecks')} value={hasLoaded ? totals.failedChecks : '—'} description={totals.totalRuns > 0 ? t('projects.latestRunFailed') : t('projects.notEvaluated')} status={totals.failedChecks > 0 ? <Tag color="red">{t('common.failed')}</Tag> : undefined} loading={loading} />
                </Col>
              </Row>

              <Card
                className={!hasProjects && !loading ? 'wt-content-surface wt-content-surface--empty' : 'wt-content-surface'}
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
                        <Text strong style={{ fontSize: 16 }}>{t('projects.noProjects')}</Text>
                        <Text type="secondary">
                          {t('projects.emptyDescription')}
                        </Text>
                      </Space>
                    }
                  >
                    {!canCreateProject ? (
                      <Text type="secondary">{t('projects.readOnlyCreateUnavailable')}</Text>
                    ) : null}
                  </Empty>
                ) : (
                  <Table<ProjectSummary>
                    dataSource={projects}
                    rowKey="id"
                    loading={loading}
                    pagination={false}
                    tableLayout="fixed"
                    rowClassName={() => 'clickable-row'}
                    onRow={(row) => ({
                      onClick: () => navigate(`/projects/${row.id}`)
                    })}
                    columns={[
                      {
                        title: t('common.project'),
                        width: 240,
                        key: 'project',
                        render: (_, row) => {
                          const description = getProjectDescription(row.id);

                          return (
                            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <Tooltip title={row.name} placement="topLeft">
                                <Link
                                  to={`/projects/${row.id}`}
                                  onClick={(event) => event.stopPropagation()}
                                  style={{
                                    display: 'block',
                                    fontWeight: 600,
                                    minWidth: 0,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                  }}
                                >
                                  {row.name}
                                </Link>
                              </Tooltip>
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
                                <Text type="secondary">{formatCreatedLabel(row.createdAt, locale, t)}</Text>
                              )}
                            </div>
                          );
                        }
                      },
                      {
                        title: t('projects.checks'),
                        dataIndex: 'checksCount',
                        key: 'checksCount',
                        width: 84,
                        render: (value: number) => <Tag color="blue">{value}</Tag>
                      },
                      {
                        title: t('projects.health'),
                        dataIndex: 'health',
                        key: 'health',
                        width: 122,
                        render: (value: ProjectHealth) => {
                          const meta = healthMeta(value, t);
                          return <Tag color={meta.color} icon={meta.icon}>{meta.text}</Tag>;
                        }
                      },
                      {
                        title: t('projects.passRate'),
                        width: 100,
                        key: 'passRate',
                        responsive: ['xl'],
                        render: (_, row) =>
                          row.passRate30d === null ? (
                            <Text type="secondary">—</Text>
                          ) : (
                            <Tag color={row.passRate30d >= 80 ? 'green' : 'red'}>{row.passRate30d}%</Tag>
                          )
                      },
                      {
                        title: t('projects.lastRun'),
                        width: 140,
                        key: 'lastRunAt',
                        responsive: ['xl'],
                        render: (_, row) =>
                          row.lastRunAt ? (
                            <Space direction="vertical" size={0}>
                              <Text style={{ lineHeight: 1.2 }}>{formatRelativeTime(row.lastRunAt, t, locale)}</Text>
                              <Text type="secondary">
                                {new Date(row.lastRunAt).toLocaleString(locale, {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit'
                                })}
                              </Text>
                            </Space>
                          ) : (
                            <Text type="secondary">{t('common.never')}</Text>
                          )
                      },
                      {
                        title: t('projects.schedules'),
                        key: 'schedules',
                        width: 120,
                        responsive: ['xxl'],
                        render: (_, row) => (
                          <Tag color="default">{t('projects.activeSchedules', { count: row.activeSchedulesCount })}</Tag>
                        )
                      },
                      {
                        title: t('projects.alerts'),
                        key: 'alerts',
                        width: 160,
                        responsive: ['xxl'],
                        render: (_, row) => {
                          if (row.alertChannelsCount === 0) {
                            return <Tag color="default">{t('common.notConfigured')}</Tag>;
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

                          return <Tag color="default">{t('projects.alertChannels', { count: row.alertChannelsCount })}</Tag>;
                        }
                      },
                      {
                        title: t('projects.actions'),
                        key: 'actions',
                        width: 136,
                        align: 'right',
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
                              {t('projects.open')}
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
              className="wt-content-surface"
              style={{
                borderRadius: 20,
                height: '100%',
                boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)'
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <Title level={4} style={{ margin: 0 }}>{t('projects.gettingStarted')}</Title>
                  <Text type="secondary">{t('projects.gettingStartedDescription')}</Text>
                </div>

                <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 10 }}>
                  <li>{t('projects.create')}</li>
                  <li>{t('projects.addOrImportCheck')}</li>
                  <li>{t('projects.runManually')}</li>
                  <li>{t('projects.scheduleRuns')}</li>
                  <li>{t('projects.addAlerts')}</li>
                </ol>

                <Button
                  type={canCreateProject ? 'primary' : 'default'}
                  icon={<PlusOutlined />}
                  onClick={() => setCreateOpen(true)}
                  disabled={!canCreateProject}
                  style={createProjectButtonStyle}
                >
                  {t('projects.newProject')}
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </Content>

      <Modal
        title={t('projects.newProject')}
        open={createOpen}
        onOk={() => void handleCreate()}
        confirmLoading={creating}
        onCancel={() => setCreateOpen(false)}
        okText={t('projects.createTitle')}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="name" label={t('projects.projectName')} rules={[{ required: true, message: t('projects.nameRequired') }]}>
            <Input placeholder={t('projects.namePlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('projects.renameTitle')}
        open={renameOpen}
        onOk={() => void handleRename()}
        confirmLoading={renaming}
        onCancel={() => {
          setRenameOpen(false);
          setSelectedProject(null);
          renameForm.resetFields();
        }}
        okText={t('projects.save')}
      >
        <Form form={renameForm} layout="vertical">
          <Form.Item name="name" label={t('projects.projectName')} rules={[{ required: true, message: t('projects.nameRequired') }]}>
            <Input placeholder={t('projects.projectName')} />
          </Form.Item>
        </Form>
      </Modal>
      <AppFooter />
    </Layout>
  );
}
