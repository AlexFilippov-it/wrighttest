import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Checkbox, Input, Layout, Modal, Popconfirm, Radio, Space, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { createSuite, deleteSuite, getEnvironments, getSuites, runSuite, updateSuite } from '../api/client';
import AppHeader from '../components/AppHeader';
import AppFooter from '../components/AppFooter';
import { EmptyState, PageHeader } from '../design-system';
import { useProjectShell } from '../shell/ProjectShellContext';
import type { Environment, Suite, Test } from '../types';

const { Content } = Layout;
const { Text } = Typography;

function formatTime(value?: string | null, locale?: string) {
  return value ? new Date(value).toLocaleString(locale) : '—';
}

function suiteTestNames(suite: Suite, tests: Test[]) {
  const byId = new Map(tests.map((test) => [test.id, test.name]));
  return Array.isArray(suite.testIds) ? suite.testIds.map((id) => byId.get(id) ?? id) : [];
}

export default function SuitesPage() {
  const { t, i18n } = useTranslation();
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
      message.error(t('suites.nameRequired'));
      return;
    }

    if (selectedTestIds.length === 0) {
      message.error(t('suites.selectTestRequired'));
      return;
    }

    setSaving(true);
    try {
      const payload = { name: name.trim(), testIds: selectedTestIds };
      if (editingSuite) {
        await updateSuite(editingSuite.id, payload);
        message.success(t('suites.updatedToast'));
      } else {
        await createSuite(projectId!, payload);
        message.success(t('suites.createdToast'));
      }
      setModalOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteSuite(id);
    message.success(t('suites.deletedToast'));
    await load();
  };

  const handleRun = async (suiteId: string) => {
    if (environments.length === 0) {
      await runSuite(suiteId);
      message.success(t('suites.queuedToast'));
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
      message.success(t('suites.queuedToast'));
      navigate('/dashboard');
    } catch {
      message.error(t('suites.runFailed'));
    } finally {
      setRunLoading(false);
    }
  };

  return (
    <Layout style={{ minHeight: 'auto', background: 'transparent' }}>
      <AppHeader />
      <Content className="wt-surface-page" style={{ width: '100%', minWidth: 0 }}>
        <Space direction="vertical" size={24} style={{ width: '100%' }}>
          <PageHeader
            title={t('suites.title')}
            description={t('suites.description')}
            breadcrumbs={[
              { key: 'projects', label: t('nav.projects'), href: '/projects' },
              { key: 'project', label: project.name, href: `/projects/${projectId}/checks` },
              { key: 'suites', label: t('suites.title') }
            ]}
            actions={canWriteProject ? (
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                  {t('suites.new')}
                </Button>
            ) : undefined}
          />

          {!canWriteProject ? (
            <Alert type="info" showIcon message={t('suites.readOnly')} description={t('suites.readOnlyDescription')} />
          ) : null}

          {suites.length === 0 && !loading ? (
            <EmptyState
              title={t('suites.emptyTitle')}
              description={t('suites.emptyDescription')}
            />
          ) : (
            <Card className="wt-content-surface">
              <Table
                dataSource={suites}
                rowKey="id"
                loading={loading}
                pagination={false}
                columns={[
                  { title: t('suites.name'), dataIndex: 'name' },
                  {
                    title: t('suites.tests'),
                    render: (_, row) => (
                      <Space wrap>
                        <Tag color="blue">{t('suites.testCount', { count: Array.isArray(row.testIds) ? row.testIds.length : 0 })}</Tag>
                        {suiteTestNames(row, projectTests).slice(0, 3).map((testName) => (
                          <Tag key={testName}>{testName}</Tag>
                        ))}
                      </Space>
                    )
                  },
                  {
                    title: t('suites.schedules'),
                    dataIndex: ['_count', 'schedules'],
                    render: (value: number | undefined) => <Tag color="purple">{value ?? 0}</Tag>
                  },
                  {
                    title: t('suites.updated'),
                    dataIndex: 'updatedAt',
                    render: (value: string) => formatTime(value, i18n.language)
                  },
                  {
                    title: t('suites.actions'),
                    render: (_, row) => canWriteProject ? (
                      <Space onClick={(event) => event.stopPropagation()}>
                        <Button icon={<PlayCircleOutlined />} size="small" type="primary" onClick={() => void handleRun(row.id)}>
                          {t('suites.run')}
                        </Button>
                        <Button icon={<EditOutlined />} size="small" onClick={() => openEdit(row)}>
                          {t('suites.edit')}
                        </Button>
                        <Popconfirm title={t('suites.deleteConfirm')} onConfirm={() => void handleDelete(row.id)}>
                          <Button danger icon={<DeleteOutlined />} size="small">
                            {t('suites.delete')}
                          </Button>
                        </Popconfirm>
                      </Space>
                    ) : <Text type="secondary">{t('suites.readOnlyLabel')}</Text>
                  }
                ]}
              />
            </Card>
          )}
        </Space>
      </Content>

      <Modal
        title={editingSuite ? t('suites.editTitle', { name: editingSuite.name }) : t('suites.newTitle')}
        open={modalOpen}
        onOk={() => void handleSave()}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        width={840}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <div>
            <Text type="secondary">{t('suites.suiteName')}</Text>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('suites.namePlaceholder')} />
          </div>

          <div>
            <Text type="secondary">{t('suites.selectTests')}</Text>
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
        title={t('suites.runTitle')}
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
          <Radio value="">{t('suites.noEnvironmentUseAsIs')}</Radio>
          {environments.map((environment) => (
            <Radio key={environment.id} value={environment.id}>
              {environment.name}
              <Tag style={{ marginLeft: 8 }}>{t('suites.variableCount', { count: Object.keys(environment.variables).length })}</Tag>
            </Radio>
          ))}
        </Radio.Group>
      </Modal>
      <AppFooter />
    </Layout>
  );
}
