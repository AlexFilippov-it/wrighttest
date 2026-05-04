import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Checkbox, Col, Input, Layout, Modal, Popconfirm, Radio, Row, Select, Space, Table, Tag, Typography, message } from 'antd';
import { AppstoreOutlined, DeleteOutlined, EditOutlined, FileTextOutlined, HistoryOutlined, PlusOutlined } from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createSchedule, deleteSchedule, getEnvironments, getProject, getSchedules, getSuites, updateSchedule } from '../api/client';
import AppHeader from '../components/AppHeader';
import UserMenu from '../components/UserMenu';
import RunStatusBadge from '../components/RunStatusBadge';
import type { Environment, Project, Schedule, Suite, Test } from '../types';

const { Content } = Layout;
const { Title, Text } = Typography;

const CRON_PRESETS = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every day 9am', value: '0 9 * * *' },
  { label: 'Every day 2am', value: '0 2 * * *' },
  { label: 'Every Monday', value: '0 9 * * 1' },
  { label: 'Custom...', value: 'custom' }
];

function formatTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '—';
}

function formatRelativeTime(value?: string | null) {
  if (!value) return 'Never';

  const diffMs = Date.now() - new Date(value).getTime();
  if (diffMs < 60_000) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function resolveTarget(schedule: Schedule) {
  if (schedule.suite) return schedule.suite.name;
  if (schedule.test) return schedule.test.name;
  return '—';
}

export default function SchedulesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<(Project & { tests: Test[] }) | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [name, setName] = useState('');
  const [cronPreset, setCronPreset] = useState<string>('0 2 * * *');
  const [isCustomCron, setIsCustomCron] = useState(false);
  const [customCron, setCustomCron] = useState('0 2 * * *');
  const [targetType, setTargetType] = useState<'suite' | 'test'>('suite');
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | undefined>(undefined);
  const [selectedTestId, setSelectedTestId] = useState<string | undefined>(undefined);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | undefined>(undefined);
  const [enabled, setEnabled] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [projectData, scheduleData, suiteData, environmentData] = await Promise.all([
        getProject(projectId!),
        getSchedules(projectId!),
        getSuites(projectId!),
        getEnvironments(projectId!)
      ]);
      setProject(projectData);
      setSchedules(scheduleData);
      setSuites(suiteData);
      setEnvironments(environmentData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  const projectTests = useMemo(() => project?.tests ?? [], [project]);

  const resetForm = () => {
    setEditingSchedule(null);
    setName('');
    setCronPreset('0 2 * * *');
    setIsCustomCron(false);
    setCustomCron('0 2 * * *');
    setTargetType('suite');
    setSelectedSuiteId(suites[0]?.id);
    setSelectedTestId(projectTests[0]?.id);
    setSelectedEnvironmentId(undefined);
    setEnabled(true);
  };

  const openCreate = () => {
    resetForm();
    setModalOpen(true);
  };

  const openEdit = (schedule: Schedule) => {
    setEditingSchedule(schedule);
    setName(schedule.name);
    setEnabled(schedule.enabled);
    setSelectedEnvironmentId(schedule.environmentId ?? undefined);

    if (schedule.suiteId) {
      setTargetType('suite');
      setSelectedSuiteId(schedule.suiteId);
      setSelectedTestId(undefined);
    } else {
      setTargetType('test');
      setSelectedTestId(schedule.testId ?? undefined);
      setSelectedSuiteId(undefined);
    }

    const preset = CRON_PRESETS.find((item) => item.value === schedule.cron)?.value ?? 'custom';
    setCronPreset(preset);
    setIsCustomCron(preset === 'custom');
    setCustomCron(schedule.cron);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      message.error('Schedule name is required');
      return;
    }

    const cron = isCustomCron ? customCron.trim() : cronPreset;
    if (!cron.trim()) {
      message.error('Cron is required');
      return;
    }

    const targetSuiteId = targetType === 'suite' ? selectedSuiteId : undefined;
    const targetTestId = targetType === 'test' ? selectedTestId : undefined;

    if (!targetSuiteId && !targetTestId) {
      message.error('Select a suite or a test');
      return;
    }

    setSaving(true);
    try {
      if (editingSchedule) {
        await updateSchedule(editingSchedule.id, {
          name: name.trim(),
          cron: cron.trim(),
          suiteId: targetSuiteId ?? null,
          testId: targetTestId ?? null,
          environmentId: selectedEnvironmentId ?? null,
          enabled
        });
        message.success('Schedule updated');
      } else {
        await createSchedule(projectId!, {
          name: name.trim(),
          cron: cron.trim(),
          suiteId: targetSuiteId ?? undefined,
          testId: targetTestId ?? undefined,
          environmentId: selectedEnvironmentId ?? undefined,
          enabled
        });
        message.success('Schedule created');
      }

      setModalOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteSchedule(id);
    message.success('Schedule deleted');
    await load();
  };

  const handleToggleEnabled = async (schedule: Schedule) => {
    await updateSchedule(schedule.id, { enabled: !schedule.enabled });
    message.success(schedule.enabled ? 'Schedule disabled' : 'Schedule enabled');
    await load();
  };

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 55%, #ffffff 100%)' }}>
      <AppHeader
        actions={[
          <Link key="dashboard" to="/dashboard" style={{ color: '#fff' }}>Dashboard</Link>,
          <Link key="project" to={`/projects/${projectId}`} style={{ color: '#fff' }}>Back to project</Link>,
          <UserMenu key="menu" />
        ]}
      />
      <Content style={{ padding: 32, maxWidth: 1280, width: '100%', margin: '0 auto' }}>
        <Row gutter={[24, 24]}>
          <Col span={24}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Text type="secondary">
                    <Link to={`/projects/${projectId}`}>Project</Link>
                    <Link to="/dashboard" style={{ marginLeft: 16 }}>Dashboard</Link>
                  </Text>
                  <Title level={2} style={{ margin: 0 }}>{project?.name ?? 'Loading...'}</Title>
                  <Text type="secondary">Cron-based schedules for suites or single tests.</Text>
                </div>
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                  New Schedule
                </Button>
              </Space>
            </Card>
          </Col>

          <Col span={24}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <Table
                dataSource={schedules}
                rowKey="id"
                loading={loading}
                pagination={false}
                columns={[
                  { title: 'Name', dataIndex: 'name' },
                  {
                    title: 'Cron',
                    dataIndex: 'cron',
                    render: (value: string) => <Tag color="blue"><code>{value}</code></Tag>
                  },
                  {
                    title: 'Target',
                    render: (_, row) => (
                      <Space>
                        {row.suite ? <AppstoreOutlined /> : <FileTextOutlined />}
                        <span>{resolveTarget(row)}</span>
                      </Space>
                    )
                  },
                  {
                    title: 'Environment',
                    render: (_, row) => row.environment ? row.environment.name : '—'
                  },
                  {
                    title: 'Last Run',
                    dataIndex: 'lastRunAt',
                    render: (value: string | null) => formatRelativeTime(value)
                  },
                  {
                    title: 'Last Status',
                    render: (_, row) => (
                      row.lastRunStatus ? <RunStatusBadge status={row.lastRunStatus} /> : <Typography.Text type="secondary">—</Typography.Text>
                    )
                  },
                  {
                    title: 'Status',
                    render: (_, row) => (
                      <Badge status={row.enabled ? 'processing' : 'default'} text={row.enabled ? 'Active' : 'Disabled'} />
                    )
                  },
                  {
                    title: 'Actions',
                    render: (_, row) => (
                      <Space onClick={(event) => event.stopPropagation()}>
                        <Button icon={<HistoryOutlined />} size="small" onClick={() => navigate(`/schedules/${row.id}/history`)}>
                          History
                        </Button>
                        <Button icon={<EditOutlined />} size="small" onClick={() => openEdit(row)}>
                          Edit
                        </Button>
                        <Button size="small" onClick={() => void handleToggleEnabled(row)}>
                          {row.enabled ? 'Disable' : 'Enable'}
                        </Button>
                        <Popconfirm title="Delete schedule?" onConfirm={() => void handleDelete(row.id)}>
                          <Button danger icon={<DeleteOutlined />} size="small">
                            Delete
                          </Button>
                        </Popconfirm>
                      </Space>
                    )
                  }
                ]}
              />
            </Card>
          </Col>
        </Row>
      </Content>

      <Modal
        title={editingSchedule ? `Edit Schedule: ${editingSchedule.name}` : 'New Schedule'}
        open={modalOpen}
        onOk={() => void handleSave()}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        width={780}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <div>
            <Text type="secondary">Schedule name</Text>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nightly smoke" />
          </div>

          <div>
            <Text type="secondary">Cron preset</Text>
            <Select
              value={cronPreset}
              style={{ width: '100%', marginTop: 8 }}
              options={CRON_PRESETS}
              onChange={(value) => {
                setCronPreset(value);
                if (value === 'custom') {
                  setIsCustomCron(true);
                } else {
                  setIsCustomCron(false);
                  setCustomCron(value);
                }
              }}
            />
          </div>

          {isCustomCron && (
            <div>
              <Text type="secondary">Custom cron</Text>
              <Input
                value={customCron}
                onChange={(event) => setCustomCron(event.target.value)}
                placeholder="0 9 * * *"
                style={{ marginTop: 8 }}
              />
            </div>
          )}

          <div>
            <Text type="secondary">Target type</Text>
            <Radio.Group
              style={{ display: 'block', marginTop: 8 }}
              value={targetType}
              onChange={(event) => setTargetType(event.target.value)}
            >
              <Space>
                <Radio value="suite">Suite</Radio>
                <Radio value="test">Test</Radio>
              </Space>
            </Radio.Group>
          </div>

          {targetType === 'suite' ? (
            <div>
              <Text type="secondary">Select suite</Text>
              <Select
                style={{ width: '100%', marginTop: 8 }}
                placeholder="Smoke tests"
                value={selectedSuiteId}
                onChange={setSelectedSuiteId}
                options={suites.map((suite) => ({
                  value: suite.id,
                  label: suite.name
                }))}
              />
            </div>
          ) : (
            <div>
              <Text type="secondary">Select test</Text>
              <Select
                style={{ width: '100%', marginTop: 8 }}
                placeholder="Check homepage title"
                value={selectedTestId}
                onChange={setSelectedTestId}
                options={projectTests.map((test) => ({
                  value: test.id,
                  label: test.name
                }))}
              />
            </div>
          )}

          <div>
            <Text type="secondary">Environment</Text>
            <Select
              style={{ width: '100%', marginTop: 8 }}
              placeholder="No environment"
              allowClear
              value={selectedEnvironmentId}
              onChange={(value) => setSelectedEnvironmentId(value)}
              options={environments.map((environment) => ({
                value: environment.id,
                label: environment.name
              }))}
            />
          </div>

          <Checkbox checked={enabled} onChange={(event) => setEnabled(event.target.checked)}>
            Enabled
          </Checkbox>
        </Space>
      </Modal>
    </Layout>
  );
}
