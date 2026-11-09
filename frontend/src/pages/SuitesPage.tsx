import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Checkbox, Input, Layout, Modal, Popconfirm, Radio, Select, Space, Table, Tag, Typography, message } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
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
  const [executionMode, setExecutionMode] = useState<Suite['executionMode']>('INDEPENDENT');
  const [mappings, setMappings] = useState<Suite['executionConfig']['mappings']>([]);
  const [dataCaseIndexes, setDataCaseIndexes] = useState<Record<string, number>>({});
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
    setExecutionMode('INDEPENDENT');
    setMappings([]);
    setDataCaseIndexes({});
    setModalOpen(true);
  };

  const openEdit = (suite: Suite) => {
    setEditingSuite(suite);
    setName(suite.name);
    setSelectedTestIds(Array.isArray(suite.testIds) ? suite.testIds : []);
    setExecutionMode(suite.executionMode ?? 'INDEPENDENT');
    setMappings(suite.executionConfig?.mappings ?? []);
    setDataCaseIndexes(suite.executionConfig?.dataCaseIndexes ?? {});
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
      const payload = {
        name: name.trim(), testIds: selectedTestIds,
        executionMode,
        executionConfig: {
          orderedTestIds: selectedTestIds,
          mappings: executionMode === 'SEQUENTIAL' ? mappings : [],
          dataCaseIndexes
        }
      };
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
      const result = await runSuite(runSuiteId, selectedEnvironmentId);
      setRunModalOpen(false);
      message.success(t('suites.queuedToast'));
      navigate(`/projects/${projectId}/suite-runs/${result.suiteRunId}`);
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
                  { title: t('suites.executionMode'), dataIndex: 'executionMode', render: (mode: Suite['executionMode']) => <Tag>{t(mode === 'SEQUENTIAL' ? 'suites.sequential' : 'suites.independent')}</Tag> },
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
              <Checkbox.Group value={selectedTestIds} onChange={(values) => {
                const selected = values as string[];
                const ordered = [
                  ...selectedTestIds.filter((id) => selected.includes(id)),
                  ...selected.filter((id) => !selectedTestIds.includes(id))
                ];
                setSelectedTestIds(ordered);
                setMappings((current) => current.filter((mapping) => ordered.includes(mapping.sourceTestId) && ordered.includes(mapping.targetTestId)));
                setDataCaseIndexes((current) => Object.fromEntries(Object.entries(current).filter(([id]) => ordered.includes(id))));
              }}>
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

          <div>
            <Text type="secondary">{t('suites.executionMode')}</Text>
            <Radio.Group value={executionMode} onChange={(event) => setExecutionMode(event.target.value)} style={{ display: 'flex', gap: 16, marginTop: 8 }}>
              <Radio value="INDEPENDENT">{t('suites.independent')}</Radio>
              <Radio value="SEQUENTIAL">{t('suites.sequential')}</Radio>
            </Radio.Group>
          </div>

          {selectedTestIds.filter((id) => (projectTests.find((item) => item.id === id)?.testData.length ?? 0) > 0).length > 0 ? <div>
            <Text strong>{t('suites.dataCaseSelection')}</Text>
            {selectedTestIds.filter((id) => (projectTests.find((item) => item.id === id)?.testData.length ?? 0) > 0).map((testId) => {
              const test = projectTests.find((item) => item.id === testId)!;
              const enabledCases = test.testData.map((item, originalIndex) => ({ ...item, originalIndex })).filter((item) => item.enabled);
              return <div key={testId} style={{ marginTop: 8 }}>
                <Text type="secondary">{test.name}</Text>
                <Select style={{ width: '100%' }} value={dataCaseIndexes[testId]} placeholder={t('suites.chooseDataCase')} options={enabledCases.map((item) => ({ value: item.originalIndex, label: item.name }))} onChange={(value) => setDataCaseIndexes((current) => ({ ...current, [testId]: value }))} />
              </div>;
            })}
          </div> : null}

          {executionMode === 'SEQUENTIAL' ? <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Alert type="info" showIcon message={t('suites.sequentialHelp')} />
            <Space direction="vertical" style={{ width: '100%' }}>
              {selectedTestIds.map((testId, index) => {
                const test = projectTests.find((item) => item.id === testId);
                return <Card size="small" key={testId} title={`${index + 1}. ${test?.name ?? testId}`} extra={<Space>
                  <Button aria-label={t('suites.moveUp')} size="small" disabled={index === 0} icon={<ArrowUpOutlined />} onClick={() => setSelectedTestIds((ids) => { const next = [...ids]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })} />
                  <Button aria-label={t('suites.moveDown')} size="small" disabled={index === selectedTestIds.length - 1} icon={<ArrowDownOutlined />} onClick={() => setSelectedTestIds((ids) => { const next = [...ids]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })} />
                </Space>} />;
              })}
            </Space>
            <div>
              <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                <Text strong>{t('suites.outputMappings')}</Text>
                <Button size="small" onClick={() => setMappings((current) => [...current, { sourceTestId: selectedTestIds[0] ?? '', outputVariable: '', targetTestId: selectedTestIds[1] ?? '', targetVariable: '', required: true }])}>{t('suites.addMapping')}</Button>
              </Space>
              {mappings.map((mapping, index) => <Space key={`${mapping.sourceTestId}-${index}`} wrap style={{ width: '100%', marginTop: 8 }}>
                <Select style={{ minWidth: 145 }} value={mapping.sourceTestId || undefined} placeholder={t('suites.sourceCheck')} options={selectedTestIds.slice(0, -1).map((id) => ({ value: id, label: projectTests.find((test) => test.id === id)?.name ?? id }))} onChange={(sourceTestId) => setMappings((items) => items.map((item, i) => i === index ? { ...item, sourceTestId } : item))} />
                <Input style={{ width: 125 }} placeholder={t('suites.outputVariable')} value={mapping.outputVariable} onChange={(event) => setMappings((items) => items.map((item, i) => i === index ? { ...item, outputVariable: event.target.value } : item))} />
                <span>→</span>
                <Select style={{ minWidth: 145 }} value={mapping.targetTestId || undefined} placeholder={t('suites.targetCheck')} options={selectedTestIds.slice(1).map((id) => ({ value: id, label: projectTests.find((test) => test.id === id)?.name ?? id }))} onChange={(targetTestId) => setMappings((items) => items.map((item, i) => i === index ? { ...item, targetTestId } : item))} />
                <Input style={{ width: 125 }} placeholder={t('suites.targetVariable')} value={mapping.targetVariable} onChange={(event) => setMappings((items) => items.map((item, i) => i === index ? { ...item, targetVariable: event.target.value } : item))} />
                <Checkbox checked={mapping.required} onChange={(event) => setMappings((items) => items.map((item, i) => i === index ? { ...item, required: event.target.checked } : item))}>{t('suites.required')}</Checkbox>
                <Select allowClear style={{ width: 135 }} value={mapping.expectedType} placeholder={t('suites.anyType')} options={['string', 'number', 'boolean', 'json', 'null'].map((value) => ({ value, label: value }))} onChange={(expectedType) => setMappings((items) => items.map((item, i) => i === index ? { ...item, expectedType } : item))} />
                <Button danger size="small" onClick={() => setMappings((items) => items.filter((_, i) => i !== index))}>{t('suites.removeMapping')}</Button>
              </Space>)}
            </div>
          </Space> : null}
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
