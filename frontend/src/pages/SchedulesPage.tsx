import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Dropdown, Input, Layout, Modal, Radio, Row, Select, Space, Table, Tag, Typography, message } from 'antd';
import { AppstoreOutlined, EllipsisOutlined, FileTextOutlined, HistoryOutlined, PlusOutlined } from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createSchedule, deleteSchedule, getEnvironments, getProject, getSchedules, getSuites, runSuite, runTestWithEnvironment, updateSchedule } from '../api/client';
import AppHeader from '../components/AppHeader';
import UserMenu from '../components/UserMenu';
import RunStatusBadge from '../components/RunStatusBadge';
import type { Environment, ProjectWorkspace, Schedule, Suite, Test } from '../types';

const { Content } = Layout;
const { Title, Text } = Typography;

const CRON_PRESETS = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every day 9am', value: '0 9 * * *' },
  { label: 'Every day 2am', value: '0 2 * * *' },
  { label: 'Every Monday', value: '0 9 * * 1' },
  { label: 'Custom...', value: 'custom' }
];

const APP_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function formatCompactDateTime(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
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

function formatRelativeFutureTime(value: string) {
  const diffMs = new Date(value).getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absMs < minute) return diffMs >= 0 ? 'in a moment' : 'just now';
  if (absMs < hour) return diffMs >= 0 ? `in ${Math.round(absMs / minute)} min` : `${Math.round(absMs / minute)} min ago`;
  if (absMs < day) {
    const amount = Math.round(absMs / hour);
    return diffMs >= 0 ? `in ${amount} hour${amount === 1 ? '' : 's'}` : `${amount} hour${amount === 1 ? '' : 's'} ago`;
  }
  const amount = Math.round(absMs / day);
  return diffMs >= 0 ? `in ${amount} day${amount === 1 ? '' : 's'}` : `${amount} day${amount === 1 ? '' : 's'} ago`;
}

function formatNextRun(schedule: Schedule) {
  if (!schedule.enabled) {
    return { primary: 'Paused', secondary: '', overdue: false };
  }
  if (!schedule.nextRunAt) {
    return { primary: '—', secondary: '', overdue: false };
  }

  const nextRunAt = new Date(schedule.nextRunAt).getTime();
  if (nextRunAt <= Date.now()) {
    return {
      primary: formatCompactDateTime(schedule.nextRunAt),
      secondary: '',
      overdue: true
    };
  }

  return {
    primary: formatRelativeFutureTime(schedule.nextRunAt),
    secondary: formatCompactDateTime(schedule.nextRunAt),
    overdue: false
  };
}

function describeCron(cron: string) {
  const map: Record<string, string> = {
    '* * * * *': 'Runs every minute',
    '*/15 * * * *': 'Runs every 15 minutes',
    '0 * * * *': 'Runs every hour',
    '0 2 * * *': 'Runs every day at 02:00',
    '0 9 * * *': 'Runs every day at 09:00',
    '0 9 * * 1': 'Runs every Monday at 09:00'
  };

  if (map[cron]) return map[cron];

  const dailyMatch = cron.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (dailyMatch) {
    const hour = String(Number(dailyMatch[2])).padStart(2, '0');
    const minute = String(Number(dailyMatch[1])).padStart(2, '0');
    return `Runs every day at ${hour}:${minute}`;
  }

  return 'Custom cron schedule';
}

function usesVariables(value?: string | null) {
  return Boolean(value && /{{\s*[\w.-]+\s*}}/.test(value));
}

function testUsesVariables(test?: Test | null) {
  if (!test) return false;
  if (usesVariables(test.url)) return true;
  return test.steps.some((step) => usesVariables(step.selector) || usesVariables(step.value) || usesVariables(step.expected));
}

function getScheduleTargetSummary(schedule: Schedule) {
  if (schedule.suite) {
    return {
      title: `${schedule.suite.name} · ${schedule.suite.testIds.length} checks`,
      subtitle: schedule.environment?.name ?? 'No environment selected'
    };
  }

  if (schedule.test) {
    const device = schedule.test.device?.trim() ? schedule.test.device : 'Desktop';
    const stepsCount = schedule.test.steps?.length ?? 0;
    return {
      title: `${schedule.test.name} · ${device} · ${stepsCount} steps`,
      subtitle: schedule.environment?.name ?? 'No environment selected'
    };
  }

  return {
    title: '—',
    subtitle: 'No environment selected'
  };
}

export default function SchedulesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectWorkspace | null>(null);
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
  const selectedSuite = useMemo(() => suites.find((suite) => suite.id === selectedSuiteId), [selectedSuiteId, suites]);
  const selectedTest = useMemo(() => projectTests.find((test) => test.id === selectedTestId), [projectTests, selectedTestId]);
  const selectedCron = isCustomCron ? customCron.trim() : cronPreset;
  const selectedTargetRequiresEnvironment = useMemo(() => {
    if (targetType === 'suite') {
      if (!selectedSuite) return false;
      return selectedSuite.testIds.some((testId) => testUsesVariables(projectTests.find((test) => test.id === testId)));
    }

    return testUsesVariables(selectedTest);
  }, [projectTests, selectedSuite, selectedTest, targetType]);
  const environmentWarning = selectedTargetRequiresEnvironment && !selectedEnvironmentId;

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

  const openDuplicate = (schedule: Schedule) => {
    setEditingSchedule(null);
    setName(`${schedule.name} Copy`);
    setEnabled(true);
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

  const runScheduleNow = async (schedule: Schedule) => {
    try {
      if (schedule.suiteId) {
        const result = await runSuite(schedule.suiteId, schedule.environmentId ?? undefined);
        if (result.jobs.length > 0) {
          navigate(`/runs/${result.jobs[0].testRunId}`);
        }
      } else if (schedule.testId) {
        const result = await runTestWithEnvironment(schedule.testId, schedule.environmentId ?? undefined);
        navigate(`/runs/${result.testRunId}`);
      }
      message.success('Schedule run started');
    } catch {
      message.error('Failed to run schedule');
    }
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

    if (selectedTargetRequiresEnvironment && !selectedEnvironmentId) {
      message.error('Select an environment for checks that use variables');
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
    message.success(schedule.enabled ? 'Schedule paused' : 'Schedule resumed');
    await load();
  };

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 55%, #ffffff 100%)' }}>
      <AppHeader
        actions={[
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
                rowClassName={() => 'clickable-row'}
                onRow={(row) => ({ onClick: () => openEdit(row) })}
                columns={[
                  {
                    title: 'Schedule',
                    dataIndex: 'name',
                    render: (value: string, row: Schedule) => (
                      <Space direction="vertical" size={0}>
                        <Button type="link" style={{ padding: 0, textAlign: 'left', fontWeight: 600 }} onClick={() => openEdit(row)}>
                          {value}
                        </Button>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {describeCron(row.cron)}
                        </Text>
                      </Space>
                    )
                  },
                  {
                    title: 'Cron',
                    dataIndex: 'cron',
                    render: (value: string) => <Tag color="blue"><code>{value}</code></Tag>
                  },
                  {
                    title: 'Target',
                    render: (_, row) => {
                      const summary = getScheduleTargetSummary(row);
                      return (
                        <Space>
                          {row.suite ? <AppstoreOutlined /> : <FileTextOutlined />}
                          <Space direction="vertical" size={0}>
                            <Text strong>{summary.title}</Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {summary.subtitle}
                            </Text>
                          </Space>
                        </Space>
                      );
                    }
                  },
                  {
                    title: 'Last Run',
                    dataIndex: 'lastRunAt',
                    render: (value: string | null) =>
                      value ? (
                        <Space direction="vertical" size={0}>
                          <Text>{formatRelativeTime(value)}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {formatCompactDateTime(value)}
                          </Text>
                        </Space>
                      ) : (
                        <Text type="secondary">Never</Text>
                      )
                  },
                  {
                    title: 'Next Run',
                    render: (_, row) =>
                      row.enabled ? (
                        row.nextRunAt ? (
                          <Space direction="vertical" size={0}>
                            <Text>{formatNextRun(row).primary}</Text>
                            {formatNextRun(row).overdue ? (
                              <Tag color="orange" style={{ width: 'fit-content', marginTop: 2 }}>
                                Overdue
                              </Tag>
                            ) : (
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {formatNextRun(row).secondary}
                              </Text>
                            )}
                          </Space>
                        ) : (
                          <Text type="secondary">—</Text>
                        )
                      ) : (
                        <Tag>Paused</Tag>
                      )
                  },
                  {
                    title: 'Status',
                    render: (_, row) => (
                      <Badge status={row.enabled ? 'success' : 'default'} text={row.enabled ? 'Active' : 'Paused'} />
                    )
                  },
                  {
                    title: 'Actions',
                    render: (_, row) => (
                      <Space onClick={(event) => event.stopPropagation()} size={8}>
                        <Button size="small" onClick={() => void runScheduleNow(row)}>
                          Run now
                        </Button>
                        <Button size="small" icon={<HistoryOutlined />} onClick={() => navigate(`/schedules/${row.id}/history`)}>
                          History
                        </Button>
                        <Button size="small" onClick={() => openEdit(row)}>
                          Edit
                        </Button>
                        <Dropdown
                          trigger={['click']}
                          menu={{
                            items: [
                              { key: 'toggle', label: row.enabled ? 'Pause' : 'Resume' },
                              { key: 'duplicate', label: 'Duplicate' },
                              { type: 'divider' },
                              { key: 'delete', label: 'Delete', danger: true }
                            ],
                            onClick: ({ key, domEvent }) => {
                              domEvent.stopPropagation();
                              if (key === 'toggle') {
                                void handleToggleEnabled(row);
                              }
                              if (key === 'duplicate') {
                                openDuplicate(row);
                              }
                              if (key === 'delete') {
                                Modal.confirm({
                                  title: 'Delete schedule?',
                                  content: `This will remove "${row.name}" and stop automatic runs.`,
                                  okText: 'Delete',
                                  okButtonProps: { danger: true },
                                  centered: true,
                                  onOk: async () => {
                                    await handleDelete(row.id);
                                  }
                                });
                              }
                            }
                          }}
                        >
                          <Button size="small" icon={<EllipsisOutlined />} />
                        </Dropdown>
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
        centered
        style={{ top: 24 }}
        styles={{
          body: { maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }
        }}
        okText={editingSchedule ? 'Save changes' : 'Create schedule'}
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
            <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: '#fafafa', border: '1px solid #f0f0f0' }}>
              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                Cron expression
              </Text>
              <Text strong style={{ display: 'block', fontFamily: 'monospace' }}>
                {selectedCron || '—'}
              </Text>
              <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                {describeCron(selectedCron)} {selectedCron ? APP_TIMEZONE : ''}
              </Text>
            </div>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                Timezone
              </Text>
              <Tag style={{ marginTop: 4 }}>{APP_TIMEZONE}</Tag>
            </div>
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
                <Radio value="test">Check</Radio>
              </Space>
            </Radio.Group>
          </div>

          {targetType === 'suite' ? (
            <div>
              <Text type="secondary">Select suite</Text>
              <Select
                style={{ width: '100%', marginTop: 8 }}
                placeholder="Select a suite"
                value={selectedSuiteId}
                onChange={setSelectedSuiteId}
                options={suites.map((suite) => ({
                  value: suite.id,
                  label: `${suite.name} · ${suite.testIds.length} checks`
                }))}
              />
            </div>
          ) : (
            <div>
              <Text type="secondary">Select check</Text>
              <Select
                style={{ width: '100%', marginTop: 8 }}
                placeholder="Select a check"
                value={selectedTestId}
                onChange={setSelectedTestId}
                options={projectTests.map((test) => ({
                  value: test.id,
                  label: `${test.name} · ${test.device?.trim() ? test.device : 'Desktop'} · ${test.steps.length} steps`
                }))}
              />
            </div>
          )}

          <div>
            <Text type="secondary">Environment</Text>
            <Select
              style={{ width: '100%', marginTop: 8 }}
              placeholder="No environment selected"
              allowClear
              value={selectedEnvironmentId}
              onChange={(value) => setSelectedEnvironmentId(value)}
              options={environments.map((environment) => ({
                value: environment.id,
                label: `${environment.name} · ${Object.keys(environment.variables).length} variables`
              }))}
            />
            {environmentWarning && (
              <Alert
                style={{ marginTop: 12 }}
                type="warning"
                showIcon
                message="No environment selected"
                description="Checks using variables like {{BASE_URL}} may fail."
              />
            )}
          </div>

          <div>
            <Text type="secondary">Status</Text>
            <Radio.Group
              style={{ display: 'flex', gap: 12, marginTop: 8 }}
              value={enabled ? 'active' : 'paused'}
              onChange={(event) => setEnabled(event.target.value === 'active')}
            >
              <Radio value="active">Active</Radio>
              <Radio value="paused">Paused</Radio>
            </Radio.Group>
          </div>
        </Space>
      </Modal>
    </Layout>
  );
}
