import { useEffect, useState } from 'react';
import { Button, Card, Col, Form, Input, Layout, Modal, Popconfirm, Row, Space, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Link, useParams } from 'react-router-dom';
import { createEnvironment, deleteEnvironment, getEnvironments, getProject, updateEnvironment } from '../api/client';
import AppHeader from '../components/AppHeader';
import AppFooter from '../components/AppFooter';
import UserMenu from '../components/UserMenu';
import type { Environment, Project } from '../types';

const { Content } = Layout;
const { Title, Text } = Typography;

type VariableRow = { id: string; key: string; value: string };

function createRow(key = '', value = ''): VariableRow {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    key,
    value
  };
}

function isSecretKey(key: string) {
  return /password|token|secret|api_key|key/i.test(key);
}

function isEmptyRow(row: VariableRow) {
  return !row.key.trim() && !row.value.trim();
}

function toRows(variables: Record<string, string>): VariableRow[] {
  const entries = Object.entries(variables);
  return entries.length > 0 ? entries.map(([key, value]) => createRow(key, value)) : [createRow()];
}

function toRecord(rows: VariableRow[]) {
  return Object.fromEntries(
    rows
      .filter((row) => row.key.trim() && row.value.trim())
      .map((row) => [row.key.trim(), row.value.trim()])
  );
}

function validateRows(name: string, rows: VariableRow[]) {
  if (!name.trim()) return 'Environment name is required';

  const used = new Set<string>();
  for (const row of rows) {
    if (isEmptyRow(row)) continue;

    const key = row.key.trim();
    const value = row.value.trim();
    if (!key) return 'Variable name is required';
    if (!value) return 'Variable value is required';
    if (!/^[A-Z0-9_]+$/.test(key)) return 'Variable names should use uppercase letters, numbers, and underscores';
    if (used.has(key)) return `Variable name "${key}" must be unique`;
    used.add(key);
  }

  return null;
}

export default function EnvironmentsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingEnvironment, setEditingEnvironment] = useState<Environment | null>(null);
  const [name, setName] = useState('');
  const [rows, setRows] = useState<VariableRow[]>([createRow()]);

  const load = async () => {
    setLoading(true);
    try {
      const [projectData, envs] = await Promise.all([
        getProject(projectId!),
        getEnvironments(projectId!)
      ]);
      setProject(projectData);
      setEnvironments(envs);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  const openCreate = () => {
    setEditingEnvironment(null);
    setName('');
    setRows([createRow()]);
    setModalOpen(true);
  };

  const openEdit = (environment: Environment) => {
    setEditingEnvironment(environment);
    setName(environment.name);
    setRows(toRows(environment.variables));
    setModalOpen(true);
  };

  const addRow = () => setRows((current) => [...current, createRow()]);
  const removeRow = (index: number) =>
    setRows((current) => {
      if (current.length === 1) return current;
      return current.filter((_, idx) => idx !== index);
    });
  const updateRow = (index: number, field: keyof Omit<VariableRow, 'id'>, value: string) =>
    setRows((current) => current.map((row, idx) => (idx === index ? { ...row, [field]: value } : row)));

  const handleSave = async () => {
    const validationError = validateRows(name, rows);
    if (validationError) {
      message.error(validationError);
      return;
    }

    setSaving(true);
    try {
      const payload = { name, variables: toRecord(rows) };
      if (editingEnvironment) {
        await updateEnvironment(editingEnvironment.id, payload);
        message.success('Environment updated');
      } else {
        await createEnvironment(projectId!, payload);
        message.success('Environment created');
      }
      setModalOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (environmentId: string) => {
    await deleteEnvironment(environmentId);
    message.success('Environment deleted');
    await load();
  };

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 55%, #ffffff 100%)' }}>
      <AppHeader actions={[<UserMenu key="menu" />]} />
      <Content style={{ padding: 32, maxWidth: 1280, width: '100%', margin: '0 auto' }}>
        <Row gutter={[24, 24]}>
          <Col span={24}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Text type="secondary">
                    <Link to={`/projects/${projectId}`}>Back to project</Link>
                    <Link to="/dashboard" style={{ marginLeft: 16 }}>Dashboard</Link>
                  </Text>
                  <Title level={2} style={{ margin: 0 }}>{project?.name ?? 'Loading...'}</Title>
                </div>
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                  New Environment
                </Button>
              </Space>
            </Card>
          </Col>

          <Col span={24}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <Table
                dataSource={environments}
                rowKey="id"
                loading={loading}
                pagination={false}
                columns={[
                  { title: 'Name', dataIndex: 'name' },
                  {
                    title: 'Variables count',
                    render: (_, row) => <Tag color="purple">{Object.keys(row.variables).length}</Tag>
                  },
                  {
                    title: 'Actions',
                    render: (_, row) => (
                      <Space>
                        <Button icon={<EditOutlined />} size="small" onClick={() => openEdit(row)}>
                          Edit
                        </Button>
                        <Popconfirm title="Delete environment?" onConfirm={() => void handleDelete(row.id)}>
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
        title={editingEnvironment ? `Edit Environment: ${editingEnvironment.name}` : 'New Environment'}
        open={modalOpen}
        onOk={() => void handleSave()}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        width={920}
        centered
        style={{ top: 24 }}
        styles={{
          body: { maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }
        }}
      >
        <Form layout="vertical">
          <Form.Item label="Environment name" required>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Dev" />
          </Form.Item>

          <Form.Item label="Variables">
            <div style={{ display: 'grid', gap: 12 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '240px minmax(0, 1fr) 112px',
                  gap: 12,
                  padding: '0 4px'
                }}
              >
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Variable name
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Value
                </Text>
                <Text type="secondary" style={{ fontSize: 12, textAlign: 'right' }}>
                  Actions
                </Text>
              </div>

              {rows.map((row, index) => {
                const removeDisabled = rows.length === 1;
                return (
                  <div
                    key={row.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '240px minmax(0, 1fr) 112px',
                      gap: 12,
                      alignItems: 'start'
                    }}
                  >
                    <Input
                      value={row.key}
                      onChange={(event) => updateRow(index, 'key', event.target.value)}
                      placeholder="BASE_URL"
                      style={{ width: '100%' }}
                    />
                    {isSecretKey(row.key) ? (
                      <Input.Password
                        value={row.value}
                        onChange={(event) => updateRow(index, 'value', event.target.value)}
                        placeholder="https://dev.example.com"
                        style={{ width: '100%' }}
                      />
                    ) : (
                      <Input
                        value={row.value}
                        onChange={(event) => updateRow(index, 'value', event.target.value)}
                        placeholder="https://dev.example.com"
                        style={{ width: '100%' }}
                      />
                    )}
                  <Button danger onClick={() => removeRow(index)} disabled={removeDisabled} style={{ justifySelf: 'end' }}>
                    Remove
                  </Button>
                  </div>
                );
              })}

              <div style={{ display: 'grid', gap: 8 }}>
                <Button type="dashed" onClick={addRow} block>
                  Add variable
                </Button>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Use variables in checks as {'{{BASE_URL}}'}, {'{{USERNAME}}'}, or {'{{PASSWORD}}'}.
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Variable names should use uppercase letters, numbers, and underscores.
                </Text>
              </div>
            </div>
          </Form.Item>
        </Form>
      </Modal>
      <AppFooter />
    </Layout>
  );
}
