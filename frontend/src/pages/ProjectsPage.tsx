import { useEffect, useState } from 'react';
import { Button, Card, Col, Form, Input, Layout, Modal, Row, Space, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { createProject, deleteProject, getProjects } from '../api/client';
import AppHeader from '../components/AppHeader';
import UserMenu from '../components/UserMenu';
import type { Project } from '../types';

const { Content } = Layout;
const { Title, Text } = Typography;

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
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

  const handleCreate = async () => {
    const { name } = await form.validateFields();
    setSubmitting(true);
    try {
      await createProject(name);
      message.success('Project created');
      setModalOpen(false);
      form.resetFields();
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteProject(id);
    message.success('Project deleted');
    await load();
  };

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f7f3ff 0%, #eef4ff 55%, #ffffff 100%)' }}>
      <AppHeader
        actions={[
          <Link key="dashboard" to="/dashboard" style={{ color: '#fff' }}>Dashboard</Link>,
          <UserMenu key="menu" />,
          <Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            New Project
          </Button>
        ]}
      />
      <Content style={{ padding: 32, maxWidth: 1280, width: '100%', margin: '0 auto' }}>
        <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
          <Col xs={24} md={16}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                <Title level={2} style={{ margin: 0 }}>Projects</Title>
                <Text type="secondary">Create projects and drill into their tests.</Text>
              </div>
              <Table
                dataSource={projects}
                rowKey="id"
                loading={loading}
                pagination={false}
                onRow={(row) => ({ onClick: () => navigate(`/projects/${row.id}`) })}
                rowClassName={() => 'clickable-row'}
                columns={[
                  { title: 'Name', dataIndex: 'name', key: 'name' },
                  {
                    title: 'Tests',
                    dataIndex: ['_count', 'tests'],
                    key: 'tests',
                    render: (value: number | undefined) => <Tag color="blue">{value ?? 0}</Tag>
                  },
                  {
                    title: 'Created',
                    dataIndex: 'createdAt',
                    key: 'createdAt',
                    render: (value: string) => new Date(value).toLocaleString()
                  },
                  {
                    title: 'Actions',
                    key: 'actions',
                    render: (_, row) => (
                      <Button
                        danger
                        size="small"
                        onClick={async (event) => {
                          event.stopPropagation();
                          await handleDelete(row.id);
                        }}
                      >
                        Delete
                      </Button>
                    )
                  }
                ]}
              />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card style={{ borderRadius: 20, height: '100%', boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Title level={4} style={{ margin: 0 }}>What you can do here</Title>
                <Text type="secondary">Create a project, then add tests with steps, run them, and inspect traces and screenshots.</Text>
              </div>
            </Card>
          </Col>
        </Row>
      </Content>
      <Modal
        title="New Project"
        open={modalOpen}
        onOk={handleCreate}
        confirmLoading={submitting}
        onCancel={() => setModalOpen(false)}
        okText="Create"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Project name" rules={[{ required: true, message: 'Project name is required' }]}>
            <Input placeholder="My app" />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
