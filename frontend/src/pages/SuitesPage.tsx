import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Checkbox, Input, Layout, Modal, Popconfirm, Radio, Space, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { createSuite, deleteSuite, getEnvironments, getSuites, runSuite, updateSuite } from '../api/client';
import AppHeader from '../components/AppHeader';
import AppFooter from '../components/AppFooter';
import { EmptyState, PageHeader } from '../design-system';
import { useProjectShell } from '../shell/ProjectShellContext';
import type { Environment, Suite, Test } from '../types';

const { Content } = Layout;
const { Text } = Typography;

function formatTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '—';
}

function suiteTestNames(suite: Suite, tests: Test[]) {
  const byId = new Map(tests.map((test) => [test.id, test.name]));
  return Array.isArray(suite.testIds) ? suite.testIds.map((id) => byId.get(id) ?? id) : [];
}

export default function SuitesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { project } = useProjectShell();
  const [suites, setSuites] = useState<Suite[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingSuite, setEditingSuite] = useState<Suite | null>(null);
  const [name, setName] = useState('');
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [runSuiteId, setRunSuiteId] = useState<string | null>(null);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | undefined>(undefined);
  const [runLoading, setRunLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [suiteData, environmentData] = await Promise.all([
        getSuites(projectId!),
        getEnvironments(projectId!)
      ]);
      setSuites(suiteData);
      setEnvironments(environmentData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  const projectTests = useMemo(() => project.tests ?? [], [project.tests]);
  const canWriteProject = project.currentUserRole === 'OWNER' || project.currentUserRole === 'EDITOR';

  const openCreate = () => {
    setEditingSuite(null);
    setName('');
    setSelectedTestIds([]);
    setModalOpen(true);
  };

  const openEdit = (suite: Suite) => {
    setEditingSuite(suite);
    setName(suite.name);
    setSelectedTestIds(Array.isArray(suite.testIds) ? suite.testIds : []);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      message.error('Suite name is required');
      return;
    }

    if (selectedTestIds.length === 0) {
      message.error('Select at least one test');
      return;
    }

    setSaving(true);
    try {
      const payload = { name: name.trim(), testIds: selectedTestIds };
      if (editingSuite) {
        await updateSuite(editingSuite.id, payload);
        message.success('Suite updated');
      } else {
        await createSuite(projectId!, payload);
        message.success('Suite created');
      }
      setModalOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteSuite(id);
    message.success('Suite deleted');
    await load();
  };

  const handleRun = async (suiteId: string) => {
    if (environments.length === 0) {
      await runSuite(suiteId);
      message.success('Suite queued');
      navigate('/dashboard');
      return;
    }

    setRunSuiteId(suiteId);
    setSelectedEnvironmentId(undefined);
    setRunModalOpen(true);
  };

  const handleConfirmRun = async () => {
    if (!runSuiteId) return;

    setRunLoading(true);
    try {
      await runSuite(runSuiteId, selectedEnvironmentId);
      setRunModalOpen(false);
      message.success('Suite queued');
      navigate('/dashboard');
    } catch {
      message.error('Failed to run suite');
    } finally {
      setRunLoading(false);
    }
  };

  return (
    <Layout style={{ minHeight: 'auto', background: 'transparent' }}>
      <AppHeader />
      <Content style={{ width: '100%', minWidth: 0 }}>
        <Space direction="vertical" size={24} style={{ width: '100%' }}>
          <PageHeader
            title="Suites"
            description="Reusable groups of checks that can be run together."
            breadcrumbs={[
              { key: 'projects', label: 'Projects', href: '/projects' },
              { key: 'project', label: project.name, href: `/projects/${projectId}/checks` },
              { key: 'suites', label: 'Suites' }
            ]}
            actions={canWriteProject ? (
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                  New Suite
                </Button>
            ) : undefined}
          />

          {!canWriteProject ? (
            <Alert type="info" showIcon message="Read-only access" description="You can view suites, but you cannot change or run them." />
          ) : null}

          <Card style={{ borderRadius: 12, boxShadow: 'var(--wt-shadow-subtle)' }}>
            {suites.length === 0 && !loading ? (
              <EmptyState
                title="No suites yet"
                description="Create a suite to run a reusable group of checks."
                action={canWriteProject ? <Button type="primary" onClick={openCreate}>New Suite</Button> : undefined}
              />
            ) : (
              <Table
                dataSource={suites}
                rowKey="id"
                loading={loading}
                pagination={false}
                columns={[
                  { title: 'Name', dataIndex: 'name' },
                  {
                    title: 'Tests',
                    render: (_, row) => (
                      <Space wrap>
                        <Tag color="blue">{Array.isArray(row.testIds) ? row.testIds.length : 0} tests</Tag>
                        {suiteTestNames(row, projectTests).slice(0, 3).map((testName) => (
                          <Tag key={testName}>{testName}</Tag>
                        ))}
                      </Space>
                    )
                  },
                  {
                    title: 'Schedules',
                    dataIndex: ['_count', 'schedules'],
                    render: (value: number | undefined) => <Tag color="purple">{value ?? 0}</Tag>
                  },
                  {
                    title: 'Updated',
                    dataIndex: 'updatedAt',
                    render: (value: string) => formatTime(value)
                  },
                  {
                    title: 'Actions',
                    render: (_, row) => canWriteProject ? (
                      <Space onClick={(event) => event.stopPropagation()}>
                        <Button icon={<PlayCircleOutlined />} size="small" type="primary" onClick={() => void handleRun(row.id)}>
                          Run
                        </Button>
                        <Button icon={<EditOutlined />} size="small" onClick={() => openEdit(row)}>
                          Edit
                        </Button>
                        <Popconfirm title="Delete suite?" onConfirm={() => void handleDelete(row.id)}>
                          <Button danger icon={<DeleteOutlined />} size="small">
                            Delete
                          </Button>
                        </Popconfirm>
                      </Space>
                    ) : <Text type="secondary">Read-only</Text>
                  }
                ]}
              />
            )}
          </Card>
        </Space>
      </Content>

      <Modal
        title={editingSuite ? `Edit Suite: ${editingSuite.name}` : 'New Suite'}
        open={modalOpen}
        onOk={() => void handleSave()}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        width={840}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <div>
            <Text type="secondary">Suite name</Text>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Smoke tests" />
          </div>

          <div>
            <Text type="secondary">Select tests</Text>
            <div style={{ marginTop: 8 }}>
              <Checkbox.Group value={selectedTestIds} onChange={(values) => setSelectedTestIds(values as string[])}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  {projectTests.map((test) => (
                    <Checkbox key={test.id} value={test.id}>
                      {test.name}
                      <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                        {test.url}
                      </Typography.Text>
                    </Checkbox>
                  ))}
                </Space>
              </Checkbox.Group>
            </div>
          </div>
        </Space>
      </Modal>

      <Modal
        title="Run Suite"
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
          {environments.map((environment) => (
            <Radio key={environment.id} value={environment.id}>
              {environment.name}
              <Tag style={{ marginLeft: 8 }}>{Object.keys(environment.variables).length} variables</Tag>
            </Radio>
          ))}
        </Radio.Group>
      </Modal>
      <AppFooter />
    </Layout>
  );
}
