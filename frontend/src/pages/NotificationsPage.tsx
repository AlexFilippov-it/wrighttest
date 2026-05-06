import { useEffect, useState } from 'react';
import { Button, Card, Checkbox, Col, Form, Input, Layout, Modal, Popconfirm, Row, Space, Table, Tag, Typography, message } from 'antd';
import { CheckOutlined, DeleteOutlined, PlusOutlined, SendOutlined } from '@ant-design/icons';
import { Link, useParams } from 'react-router-dom';
import { createChannel, deleteChannel, getChannels, getProject, testChannel } from '../api/client';
import AppHeader from '../components/AppHeader';
import AppFooter from '../components/AppFooter';
import UserMenu from '../components/UserMenu';
import type { NotificationChannel, NotificationChannelType, Project } from '../types';

const { Content } = Layout;
const { Title, Text } = Typography;

type ChannelFormValues = {
  name: string;
  config: Record<string, string>;
  onFailed: boolean;
  onRecovered: boolean;
  onPassed: boolean;
  enabled: boolean;
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
      onRecovered: true,
      onPassed: false,
      enabled: true,
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
        onRecovered: values.onRecovered ?? true,
        onPassed: values.onPassed ?? false,
        enabled: values.enabled ?? true
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
      <AppHeader actions={[<UserMenu key="menu" />]} />
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
        title={modalType === 'telegram' ? 'Add Telegram alert' : 'Add Slack alert'}
        open={modalOpen}
        onOk={() => void handleCreate()}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        width={640}
      >
        <Form form={form} layout="vertical" initialValues={{ onFailed: true, onRecovered: true, onPassed: false, enabled: true }}>
          <Form.Item name="name" label="Alert name" rules={[{ required: true, message: 'Alert name is required' }]}>
            <Input placeholder={modalType === 'telegram' ? 'Dev alerts' : 'Production alerts'} />
          </Form.Item>

          {modalType === 'telegram' ? (
            <>
              <Form.Item name={['config', 'botToken']} label="Bot token" rules={[{ required: true, message: 'Bot token is required' }]}>
                <Input.Password placeholder="123456789:AA..." autoComplete="new-password" />
              </Form.Item>
              <Form.Item name={['config', 'chatId']} label="Chat ID" rules={[{ required: true, message: 'Chat ID is required' }]}>
                <Input placeholder="-1001234567890" />
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                  Add the bot to your Telegram chat or channel, then paste the chat ID here.
                </Typography.Text>
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item name={['config', 'webhookUrl']} label="Webhook URL" rules={[{ required: true, message: 'Webhook URL is required' }, { type: 'url', message: 'Enter a valid URL' }, { validator: async (_, value) => {
                if (value && !String(value).startsWith('https://hooks.slack.com/services/')) {
                  throw new Error('Webhook URL must start with https://hooks.slack.com/services/');
                }
              } }]}>
                <Input placeholder="https://hooks.slack.com/services/..." autoComplete="off" />
              </Form.Item>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: -8, marginBottom: 8 }}>
                Paste an incoming webhook URL from your Slack workspace.
              </Typography.Text>
            </>
          )}

          <Typography.Title level={5} style={{ marginTop: 8 }}>Notification rules</Typography.Title>
          <Form.Item name="onFailed" valuePropName="checked">
            <Checkbox>Failed runs</Checkbox>
          </Form.Item>
          <Form.Item name="onRecovered" valuePropName="checked">
            <Checkbox>Recovered runs</Checkbox>
          </Form.Item>
          <Form.Item name="onPassed" valuePropName="checked">
            <Checkbox>Passed runs</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
      <AppFooter />
    </Layout>
  );
}
