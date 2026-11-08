import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Form, Input, message, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useOutletContext, useParams } from 'react-router-dom';
import { createProjectVariable, deleteProjectVariable, getProjectVariables, updateProjectVariable, type ProjectVariable, type ProjectVariableInput } from '../api/client';
import { PageHeader, SectionCard } from '../design-system';
import type { ProjectShellOutletContext } from '../shell/ProjectShellContext';

type FormValues = { name: string; type: ProjectVariable['type']; value: string; secret: boolean; description: string };
const { Text } = Typography;

function serializeValue(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null);
}

function parseValue(type: ProjectVariable['type'], value: string): unknown {
  if (type === 'string') return value;
  if (type === 'null') return null;
  if (type === 'boolean' && value !== 'true' && value !== 'false') throw new Error('Use true or false for a Boolean value.');
  if (type === 'number' || type === 'boolean' || type === 'json') {
    const parsed: unknown = JSON.parse(value);
    if (type === 'number' && (typeof parsed !== 'number' || !Number.isFinite(parsed))) throw new Error('Enter a valid number.');
    if (type === 'boolean' && typeof parsed !== 'boolean') throw new Error('Enter true or false.');
    if (type === 'json' && (parsed === null || typeof parsed !== 'object')) throw new Error('Enter a JSON object or array.');
    return parsed;
  }
  return value;
}

export default function ProjectVariablesPage() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const { project } = useOutletContext<ProjectShellOutletContext>();
  const [variables, setVariables] = useState<ProjectVariable[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ProjectVariable | null>(null);
  const [open, setOpen] = useState(false);
  const loadVersion = useRef(0);
  const [form] = Form.useForm<FormValues>();
  const role = project.currentUserRole;
  const canEdit = role !== 'VIEWER';

  const load = useCallback(async () => {
    if (!projectId) return;
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const nextVariables = await getProjectVariables(projectId);
      if (version === loadVersion.current) setVariables(nextVariables);
    } catch {
      if (version === loadVersion.current) message.error(t('projectVariables.loadFailed'));
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [projectId, t]);
  useEffect(() => { void load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({ type: 'string', secret: false, value: '', name: '', description: '' });
    setOpen(true);
  };
  const openEdit = (variable: ProjectVariable) => {
    setEditing(variable);
    form.setFieldsValue({
      name: variable.name, type: variable.type, secret: variable.secret,
      value: variable.secret ? '' : serializeValue(variable.value), description: variable.description
    });
    setOpen(true);
  };
  const close = () => { setOpen(false); setEditing(null); form.resetFields(); };
  const submit = async (values: FormValues) => {
    if (!projectId) return;
    const mutationVersion = ++loadVersion.current;
    setSaving(true);
    try {
      const data: ProjectVariableInput = {
        name: values.name.trim(), type: values.type, secret: values.secret,
        description: values.description ?? '',
        ...((!editing || values.value !== '') ? { value: parseValue(values.type, values.value ?? '') } : {})
      };
      const saved = editing
        ? await updateProjectVariable(editing.id, data)
        : await createProjectVariable(projectId, data);
      if (mutationVersion === loadVersion.current) {
        setVariables((current) => {
          const next = current.filter((variable) => variable.id !== saved.id);
          next.push(saved);
          return next.sort((a, b) => a.name.localeCompare(b.name));
        });
      }
      message.success(t(editing ? 'projectVariables.updated' : 'projectVariables.created'));
      close();
      await load();
    } catch (error) {
      const apiMessage = error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: unknown } } }).response?.data?.error
        : undefined;
      message.error(typeof apiMessage === 'string' ? apiMessage : error instanceof Error ? error.message : t('projectVariables.saveFailed'));
    } finally { setSaving(false); }
  };
  const remove = async (variable: ProjectVariable) => {
    const mutationVersion = ++loadVersion.current;
    try {
      await deleteProjectVariable(variable.id);
      if (mutationVersion === loadVersion.current) setVariables((current) => current.filter((item) => item.id !== variable.id));
      message.success(t('projectVariables.deleted'));
      await load();
    }
    catch { message.error(t('projectVariables.deleteFailed')); }
  };

  const columns = [
    { title: t('projectVariables.name'), dataIndex: 'name', key: 'name', render: (name: string) => <Text code>{name}</Text> },
    { title: t('projectVariables.type'), dataIndex: 'type', key: 'type', render: (type: string) => <Tag>{type}</Tag> },
    { title: t('projectVariables.value'), key: 'value', render: (_: unknown, row: ProjectVariable) => row.secret ? <Text type="secondary">••••••</Text> : <Text>{serializeValue(row.value)}</Text> },
    { title: t('projectVariables.description'), dataIndex: 'description', key: 'description' },
    { title: t('projectVariables.lastUpdated'), dataIndex: 'updatedAt', key: 'updatedAt', render: (value: string) => new Date(value).toLocaleDateString() },
    { title: t('projectVariables.actions'), key: 'actions', render: (_: unknown, row: ProjectVariable) => {
      const canManageRow = canEdit && (role === 'OWNER' || !row.secret);
      return canManageRow ? <Space>
        <Button aria-label={t('projectVariables.edit')} icon={<EditOutlined />} onClick={() => openEdit(row)} />
        <Popconfirm title={t('projectVariables.deleteConfirm')} onConfirm={() => void remove(row)} okButtonProps={{ danger: true }}>
          <Button aria-label={t('projectVariables.delete')} danger icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space> : <Text type="secondary">{t('common.noActions')}</Text>;
    } }
  ];

  return <Space direction="vertical" size="large" style={{ width: '100%' }}>
    <PageHeader title={t('projectVariables.title')} description={t('projectVariables.subtitle')} actions={canEdit ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t('projectVariables.add')}</Button> : undefined} />
    <SectionCard title={t('projectVariables.section')}>
      <Text type="secondary">{t('projectVariables.help')}</Text>
      <Table rowKey="id" loading={loading} columns={columns} dataSource={variables} pagination={{ pageSize: 10 }} scroll={{ x: 760 }} locale={{ emptyText: t('projectVariables.empty') }} />
    </SectionCard>
    <Modal title={t(editing ? 'projectVariables.editTitle' : 'projectVariables.createTitle')} open={open} onCancel={close} onOk={() => void form.submit()} confirmLoading={saving} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={(values: FormValues) => void submit(values)}>
        <Form.Item label={t('projectVariables.name')} name="name" rules={[{ required: true }, { pattern: /^[A-Z][A-Z0-9_]{0,99}$/ }]}><Input disabled={Boolean(editing)} /></Form.Item>
        <Form.Item label={t('projectVariables.type')} name="type" rules={[{ required: true }]}><Select options={['string', 'number', 'boolean', 'json', 'null'].map((value) => ({ value, label: value }))} /></Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, next) => prev.type !== next.type || prev.secret !== next.secret}>{({ getFieldValue }) => {
          const secret = Boolean(getFieldValue('secret'));
          const needsValue = !editing || !secret || editing.secret !== secret;
          return <Form.Item label={t('projectVariables.value')} name="value" rules={needsValue ? [{ required: true }] : []} extra={editing && secret ? t('projectVariables.replaceSecretHint') : t('projectVariables.valueHint')}>
            <Input.TextArea rows={getFieldValue('type') === 'json' ? 4 : 2} placeholder={getFieldValue('type') === 'json' ? '{"key":"value"}' : ''} />
          </Form.Item>;
        }}</Form.Item>
        <Form.Item name="secret" valuePropName="checked"><Checkbox>{t('projectVariables.secret')}</Checkbox></Form.Item>
        <Form.Item label={t('projectVariables.description')} name="description"><Input.TextArea rows={2} maxLength={500} /></Form.Item>
      </Form>
    </Modal>
  </Space>;
}
