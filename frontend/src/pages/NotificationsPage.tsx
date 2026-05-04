import { useEffect, useState } from 'react';
import { Button, Card, Checkbox, Col, Form, Input, Layout, Modal, Popconfirm, Row, Space, Table, Tag, Typography, message } from 'antd';
import { CheckOutlined, DeleteOutlined, PlusOutlined, SendOutlined } from '@ant-design/icons';
import { Link, useParams } from 'react-router-dom';
import { createChannel, deleteChannel, getChannels, getProject, testChannel } from '../api/client';
import AppHeader from '../components/AppHeader';
import UserMenu from '../components/UserMenu';
import type { NotificationChannel, NotificationChannelType, Project } from '../types';

const { Content } = Layout;
const { Title, Text } = Typography;

type ChannelFormValues = {
  name: string;
  config: Record<string, string>;
  onFailed: boolean;
  onPassed: boolean;
};

export default function NotificationsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<NotificationChannelType>('telegram');
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<ChannelFormValues>();

  const load = async () => {
    setLoading(true);
    try {
      const [projectData, channelData] = await Promise.all([
        getProject(projectId!),
        getChannels(projectId!)
      ]);
      setProject(projectData);
      setChannels(channelData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  const openCreate = (type: NotificationChannelType) => {
    setModalType(type);
    form.resetFields();
    form.setFieldsValue({
      onFailed: true,
      onPassed: false,
      config: type === 'telegram' ? { botToken: '', chatId: '' } : { webhookUrl: '' }
    });
    setModalOpen(true);
  };

  const handleCreate = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await createChannel(projectId!, {
        type: modalType,
        name: values.name,
        config: values.config,
        onFailed: values.onFailed ?? true,
        onPassed: values.onPassed ?? false
      });
      message.success('Channel created');
      setModalOpen(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleTest = async (id: string) => {
    await testChannel(id);
    message.success('Test notification sent');
  };

  const handleDelete = async (id: string) => {
    await deleteChannel(id);
    message.success('Channel deleted');
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
                  <Text type="secondary">Notification channels for FAILED and PASSED runs.</Text>
                </div>
                <Space>
                  <Button icon={<PlusOutlined />} type="primary" onClick={() => openCreate('telegram')}>
                    Add Telegram
                  </Button>
                  <Button icon={<PlusOutlined />} onClick={() => openCreate('slack')}>
                    Add Slack
                  </Button>
                </Space>
              </Space>
            </Card>
          </Col>

          <Col span={24}>
            <Card style={{ borderRadius: 20, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)' }}>
              <Table
                dataSource={channels}
                rowKey="id"
                loading={loading}
                pagination={false}
                columns={[
                  { title: 'Name', dataIndex: 'name' },
                  {
                    title: 'Type',
                    dataIndex: 'type',
                    render: (value: NotificationChannelType) => <Tag color={value === 'telegram' ? 'blue' : 'gold'}>{value}</Tag>
                  },
                  {
                    title: 'On Failed',
                    dataIndex: 'onFailed',
                    render: (value: boolean) => (value ? <CheckOutlined style={{ color: '#52c41a' }} /> : <span>—</span>)
                  },
                  {
                    title: 'On Passed',
                    dataIndex: 'onPassed',
                    render: (value: boolean) => (value ? <CheckOutlined style={{ color: '#52c41a' }} /> : <span>—</span>)
                  },
                  {
                    title: 'Actions',
                    render: (_, row) => (
                      <Space>
                        <Button icon={<SendOutlined />} size="small" onClick={() => void handleTest(row.id)}>
                          Test
                        </Button>
                        <Popconfirm title="Delete channel?" onConfirm={() => void handleDelete(row.id)}>
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
        title={modalType === 'telegram' ? 'Add Telegram Channel' : 'Add Slack Channel'}
        open={modalOpen}
        onOk={() => void handleCreate()}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        width={640}
      >
        <Form form={form} layout="vertical" initialValues={{ onFailed: true, onPassed: false }}>
          <Form.Item name="name" label="Channel name" rules={[{ required: true, message: 'Channel name is required' }]}>
            <Input placeholder="Dev alerts" />
          </Form.Item>

          {modalType === 'telegram' ? (
            <>
              <Form.Item name={['config', 'botToken']} label="Bot Token" rules={[{ required: true, message: 'Bot token is required' }]}>
                <Input.Password placeholder="1234567890:ABC..." />
              </Form.Item>
              <Form.Item name={['config', 'chatId']} label="Chat ID" rules={[{ required: true, message: 'Chat ID is required' }]}>
                <Input placeholder="-1001234567890" />
              </Form.Item>
            </>
          ) : (
            <Form.Item name={['config', 'webhookUrl']} label="Webhook URL" rules={[{ required: true, message: 'Webhook URL is required' }, { type: 'url', message: 'Enter a valid URL' }]}>
              <Input placeholder="https://hooks.slack.com/services/..." />
            </Form.Item>
          )}

          <Form.Item name="onFailed" valuePropName="checked">
            <Checkbox defaultChecked>Notify on FAILED</Checkbox>
          </Form.Item>
          <Form.Item name="onPassed" valuePropName="checked">
            <Checkbox>Notify on PASSED</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
