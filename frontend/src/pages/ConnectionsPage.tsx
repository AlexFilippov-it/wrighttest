import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Dropdown, Form, Grid, Input, InputNumber, Modal, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DatabaseOutlined, DeleteOutlined, EditOutlined, MoreOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { EmptyState, PageHeader, SectionCard } from '../design-system';
import {
  createDatabaseConnection,
  deleteDatabaseConnection,
  getDatabaseConnections,
  testDatabaseConnection,
  updateDatabaseConnection,
  type DatabaseConnectionInput
} from '../api/client';
import type { DatabaseConnection, DatabaseProvider } from '../types';
import type { ProjectShellOutletContext } from '../shell/ProjectShellContext';
import '../components/database-testing.css';

type FormValues = DatabaseConnectionInput;
const { Text } = Typography;
const DEFAULT_PORT: Record<DatabaseProvider, number> = { POSTGRESQL: 5432, MYSQL: 3306, SUPABASE: 5432 };

export default function ConnectionsPage() {
  const { t, i18n } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { project } = useOutletContext<ProjectShellOutletContext>();
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DatabaseConnection | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [form] = Form.useForm<FormValues>();
  const canManage = project.currentUserRole !== 'VIEWER';
  const screens = Grid.useBreakpoint();

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try { setConnections(await getDatabaseConnections(projectId)); }
    catch { message.error(t('connections.loadFailed')); }
    finally { setLoading(false); }
  }, [projectId, t]);

  useEffect(() => { void load(); }, [load]);

  const closeModal = () => { setModalOpen(false); setEditing(null); form.resetFields(); };
  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({ provider: 'POSTGRESQL', port: 5432, ssl: true, accessMode: 'READ_ONLY' } as FormValues);
    setModalOpen(true);
  };
  const openEdit = (connection: DatabaseConnection) => {
    setEditing(connection);
    form.setFieldsValue({ ...connection, password: '' } as FormValues);
    setModalOpen(true);
  };

  const submit = async (values: FormValues) => {
    if (!projectId) return;
    setSaving(true);
    try {
      if (editing) {
        const { password, ...fields } = values;
        await updateDatabaseConnection(editing.id, { ...fields, ...(password ? { password } : {}) });
      } else {
        await createDatabaseConnection(projectId, values);
      }
      message.success(t(editing ? 'connections.updated' : 'connections.created'));
      closeModal();
      await load();
    } catch { message.error(t('connections.saveFailed')); }
    finally { setSaving(false); }
  };

  const runTest = async (connection: DatabaseConnection) => {
    setTestingId(connection.id);
    try {
      const result = await testDatabaseConnection(connection.id);
      if (result.status === 'CONNECTED') message.success(t('connections.connected'));
      else message.error(result.error ?? t('connections.connectionFailed'));
    } catch { message.error(t('connections.connectionFailed')); }
    finally { setTestingId(null); await load(); }
  };

  const remove = async (connection: DatabaseConnection) => {
    try { await deleteDatabaseConnection(connection.id); message.success(t('connections.deleted')); await load(); }
    catch (error) {
      const responseMessage = error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: unknown } } }).response?.data?.error
        : undefined;
      message.error(responseMessage === 'This connection is used by one or more Checks. Update those Checks before deleting it.'
        ? t('connections.deleteInUse')
        : t('connections.deleteFailed'));
    }
  };

  const confirmRemove = (connection: DatabaseConnection) => Modal.confirm({
    title: t('connections.deleteConfirm'),
    content: t('connections.deleteConsequences'),
    okText: t('common.delete'),
    cancelText: t('common.cancel'),
    okButtonProps: { danger: true },
    onOk: () => remove(connection)
  });

  const renderActions = (connection: DatabaseConnection) => canManage ? <Space size={4} wrap={false} className="wt-connection-actions">
    <Tooltip title={t('connections.test')}><Button aria-label={t('connections.test')} size="small" icon={<ReloadOutlined />} loading={testingId === connection.id} onClick={() => void runTest(connection)} /></Tooltip>
    <Tooltip title={t('common.edit')}><Button aria-label={t('common.edit')} size="small" icon={<EditOutlined />} onClick={() => openEdit(connection)} /></Tooltip>
    <Dropdown trigger={['click']} menu={{ items: [
      { key: 'create-check', icon: <PlusOutlined />, label: t('connections.createCheck') },
      { type: 'divider' },
      { key: 'delete', icon: <DeleteOutlined />, label: t('common.delete'), danger: true }
    ], onClick: ({ key }) => {
      if (key === 'create-check' && projectId) navigate(`/projects/${projectId}/tests/new?databaseConnectionId=${encodeURIComponent(connection.id)}`);
      if (key === 'delete') confirmRemove(connection);
    } }}>
      <Button aria-label={t('connections.moreActions')} size="small" icon={<MoreOutlined />} />
    </Dropdown>
  </Space> : null;

  const columns = useMemo<ColumnsType<DatabaseConnection>>(() => [
    { title: t('connections.name'), dataIndex: 'name', key: 'name', render: (name: string, row) => <div className="wt-connection-name"><Space size={8}><DatabaseOutlined /><Text strong>{name}</Text></Space><Tag>{t(`connections.provider.${row.provider}`)}</Tag></div> },
    { title: t('connections.endpoint'), key: 'endpoint', render: (_, row) => <div className="wt-connection-endpoint"><Text>{row.host}:{row.port}</Text><Text type="secondary">{t('connections.database')}: {row.database}</Text></div> },
    { title: t('connections.accessMode'), dataIndex: 'accessMode', key: 'accessMode', render: (value: DatabaseConnection['accessMode']) => <Tag color={value === 'READ_ONLY' ? 'blue' : 'gold'}>{t(`connections.mode.${value}`)}</Tag> },
    { title: t('connections.lastTest'), dataIndex: 'lastCheckStatus', key: 'lastCheckStatus', render: (status: DatabaseConnection['lastCheckStatus'], row) => <Space orientation="vertical" size={2}>{status ? <Tag color={status === 'CONNECTED' ? 'success' : 'error'}>{t(`connections.status.${status}`)}</Tag> : <Tag>{t('connections.status.NEVER')}</Tag>}<Text type="secondary">{row.lastCheckedAt ? new Date(row.lastCheckedAt).toLocaleString(i18n.resolvedLanguage) : t('connections.notTestedYet')}</Text></Space> },
    ...(canManage ? [{ title: t('common.actions'), key: 'actions', render: (_: unknown, row: DatabaseConnection) => renderActions(row) }] : [])
  ], [i18n.resolvedLanguage, renderActions, t]);

  return <Space orientation="vertical" size={20} style={{ display: 'flex' }}>
    <PageHeader
      title={t('project.connections')}
      description={t('connections.description')}
      breadcrumbs={[{ key: 'projects', label: t('nav.projects'), href: '/projects' }, { key: 'project', label: project.name, href: `/projects/${project.id}/overview` }, { key: 'connections', label: t('project.connections') }]}
      actions={canManage ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t('connections.add')}</Button> : undefined}
    />
    <SectionCard title={t('connections.databaseConnections')}>
      {connections.length === 0 && !loading ? <EmptyState title={t('connections.emptyTitle')} description={t('connections.emptyDescription')} action={canManage ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t('connections.add')}</Button> : undefined} /> : screens.xs ? (
        <div className="wt-connection-card-list" aria-busy={loading}>
          {connections.map((connection) => <Card key={connection.id} size="small" className="wt-connection-card">
            <div className="wt-connection-card__heading">
              <div className="wt-connection-card__identity"><DatabaseOutlined /><Text strong>{connection.name}</Text></div>
              <Tag>{t(`connections.provider.${connection.provider}`)}</Tag>
            </div>
            <dl className="wt-connection-card__details">
              <div><dt>{t('connections.endpoint')}</dt><dd>{connection.host}:{connection.port}</dd></div>
              <div><dt>{t('connections.database')}</dt><dd>{connection.database}</dd></div>
              <div><dt>{t('connections.accessMode')}</dt><dd><Tag color={connection.accessMode === 'READ_ONLY' ? 'blue' : 'gold'}>{t(`connections.mode.${connection.accessMode}`)}</Tag></dd></div>
              <div><dt>{t('connections.lastTest')}</dt><dd><Space orientation="vertical" size={2}>
                {connection.lastCheckStatus ? <Tag color={connection.lastCheckStatus === 'CONNECTED' ? 'success' : 'error'}>{t(`connections.status.${connection.lastCheckStatus}`)}</Tag> : <Tag>{t('connections.status.NEVER')}</Tag>}
                <Text type="secondary">{connection.lastCheckedAt ? new Date(connection.lastCheckedAt).toLocaleString(i18n.resolvedLanguage) : t('connections.notTestedYet')}</Text>
              </Space></dd></div>
            </dl>
            {renderActions(connection)}
          </Card>)}
          {loading && <Card size="small" loading />}
        </div>
      ) : <Table rowKey="id" columns={columns} dataSource={connections} loading={loading} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 760 }} />}
    </SectionCard>
    <Modal className="wt-connection-modal" title={t(editing ? 'connections.editTitle' : 'connections.addTitle')} open={modalOpen} onCancel={closeModal} onOk={() => form.submit()} confirmLoading={saving} okText={t('common.saveChanges')} cancelText={t('common.cancel')} destroyOnHidden>
      <Form<FormValues> form={form} layout="vertical" onFinish={(values) => void submit(values)} initialValues={{ provider: 'POSTGRESQL', port: 5432, ssl: true, accessMode: 'READ_ONLY' }}>
        <Form.Item name="name" label={t('connections.name')} rules={[{ required: true, max: 100 }]}><Input /></Form.Item>
        <Form.Item name="provider" label={t('connections.providerLabel')} rules={[{ required: true }]}><Select options={(['POSTGRESQL', 'MYSQL', 'SUPABASE'] as DatabaseProvider[]).map((value) => ({ value, label: t(`connections.provider.${value}`) }))} onChange={(provider: DatabaseProvider) => form.setFieldValue('port', DEFAULT_PORT[provider])} /></Form.Item>
        <Space.Compact style={{ width: '100%' }}>
          <Form.Item name="host" label={t('connections.host')} rules={[{ required: true }]} style={{ width: '75%' }}><Input autoComplete="off" /></Form.Item>
          <Form.Item name="port" label={t('connections.port')} rules={[{ required: true }]} style={{ width: '25%' }}><InputNumber min={1} max={65535} style={{ width: '100%' }} /></Form.Item>
        </Space.Compact>
        <Form.Item name="database" label={t('connections.database')} rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="username" label={t('connections.username')} rules={[{ required: true }]}><Input autoComplete="username" /></Form.Item>
        <Form.Item name="password" label={t('connections.password')} rules={editing ? [] : [{ required: true }]} extra={editing ? t('connections.passwordKeepHint') : undefined}><Input.Password autoComplete={editing ? 'new-password' : 'current-password'} /></Form.Item>
        <Form.Item name="ssl" label={t('connections.tls')} rules={[{ required: true }]}><Select options={[{ value: true, label: t('common.enabled') }, { value: false, label: t('common.disabled') }]} /></Form.Item>
        <Form.Item name="accessMode" label={t('connections.accessMode')} rules={[{ required: true }]}><Select options={(['READ_ONLY', 'READ_WRITE'] as const).map((value) => ({ value, label: t(`connections.mode.${value}`) }))} /></Form.Item>
      </Form>
    </Modal>
  </Space>;
}
