import { useEffect, useState } from 'react';
import axios from 'axios';
import { Button, Descriptions, Dropdown, Form, Input, Modal, Space, Tag, Typography, message } from 'antd';
import { InfoCircleOutlined, LogoutOutlined, ProfileOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  APP_BUILD_DATE,
  APP_DESCRIPTION,
  APP_ENVIRONMENT,
  APP_GIT_COMMIT,
  APP_NAME,
  APP_RELEASE_NOTES,
  APP_VERSION,
  formatBuildDate
} from '../utils/appMeta';

const { Text } = Typography;

type AboutHealthState = {
  api: 'checking' | 'healthy' | 'unavailable';
  database: 'checking' | 'healthy' | 'unavailable';
};

function getApiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const apiError = error.response?.data as { error?: string } | undefined;
    if (typeof apiError?.error === 'string' && apiError.error.trim()) return apiError.error;
    if (typeof error.message === 'string' && error.message.trim()) return error.message;
  }

  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export default function UserMenu() {
  const { email, logout, changePassword } = useAuth();
  const navigate = useNavigate();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [health, setHealth] = useState<AboutHealthState>({ api: 'checking', database: 'checking' });
  const [form] = Form.useForm<{ currentPassword: string; newPassword: string; confirmPassword: string }>();

  useEffect(() => {
    if (!aboutOpen) return;

    let cancelled = false;
    setHealth({ api: 'checking', database: 'checking' });

    async function loadHealth() {
      try {
        await api.get('/health');
        if (!cancelled) {
          setHealth((current) => ({ ...current, api: 'healthy' }));
        }
      } catch {
        if (!cancelled) {
          setHealth((current) => ({ ...current, api: 'unavailable' }));
        }
      }

      try {
        await api.get('/health/db');
        if (!cancelled) {
          setHealth((current) => ({ ...current, database: 'healthy' }));
        }
      } catch {
        if (!cancelled) {
          setHealth((current) => ({ ...current, database: 'unavailable' }));
        }
      }
    }

    void loadHealth();

    return () => {
      cancelled = true;
    };
  }, [aboutOpen]);

  const handleChangePassword = async () => {
    const values = await form.validateFields();

    setSaving(true);
    try {
      await changePassword(values.currentPassword, values.newPassword);
      message.success('Password changed');
      setChangeOpen(false);
      form.resetFields();
    } catch (error) {
      message.error(getApiErrorMessage(error, 'Failed to change password'));
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const aboutItems = [
    { label: 'Product', children: APP_NAME },
    { label: 'Description', children: APP_DESCRIPTION },
    { label: 'Version', children: APP_VERSION },
    { label: 'Git commit', children: APP_GIT_COMMIT || 'Unavailable' },
    { label: 'Build date', children: formatBuildDate(APP_BUILD_DATE) || 'Unavailable' },
    { label: 'Environment', children: APP_ENVIRONMENT },
    { label: 'Current user', children: email ?? 'Unknown user' },
    {
      label: 'Backend/API status',
      children:
        health.api === 'checking'
          ? 'Checking...'
          : health.api === 'healthy'
            ? 'Healthy'
            : 'Unavailable'
    },
    {
      label: 'Database status',
      children:
        health.database === 'checking'
          ? 'Checking...'
          : health.database === 'healthy'
            ? 'Healthy'
            : 'Unavailable'
    },
    {
      label: 'Runner status',
      children:
        health.api === 'healthy' && health.database === 'healthy'
          ? 'Available'
          : health.api === 'checking' || health.database === 'checking'
            ? 'Checking...'
            : 'Unavailable'
    }
  ];

  return (
    <>
      <Dropdown
        placement="bottomRight"
        trigger={['click']}
        menu={{
          items: [
            {
              key: 'signed-in-as',
              disabled: true,
              label: (
                <div style={{ minWidth: 220, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Text type="secondary" style={{ fontSize: 11, opacity: 0.72 }}>
                    Signed in as
                  </Text>
                  <Text strong style={{ color: 'rgba(15, 23, 42, 0.88)' }}>{email ?? 'Unknown user'}</Text>
                </div>
              )
            },
            { type: 'divider' },
            { key: 'about', icon: <InfoCircleOutlined />, label: 'About WrightTest' },
            { key: 'release-notes', icon: <ProfileOutlined />, label: 'Release notes' },
            { key: 'change-password', icon: <UserOutlined />, label: 'Change password' },
            { type: 'divider' },
            { key: 'logout', icon: <LogoutOutlined />, label: 'Logout', danger: true }
          ],
          onClick: ({ key }) => {
            if (key === 'about') setAboutOpen(true);
            if (key === 'release-notes') setReleaseNotesOpen(true);
            if (key === 'change-password') setChangeOpen(true);
            if (key === 'logout') handleLogout();
          }
        }}
      >
        <Button type="text" style={{ color: '#fff', paddingInline: 10 }}>
          <Space>
            <UserOutlined />
            <span>{email ?? 'Account'}</span>
          </Space>
        </Button>
      </Dropdown>

      <Modal
        title="About WrightTest"
        open={aboutOpen}
        onCancel={() => setAboutOpen(false)}
        footer={
          <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space wrap>
              <Button onClick={() => { setAboutOpen(false); navigate('/dashboard'); }}>Dashboard</Button>
              <Button onClick={() => { setAboutOpen(false); navigate('/projects'); }}>Projects</Button>
              <Button onClick={() => { setAboutOpen(false); navigate('/runs'); }}>Runs</Button>
            </Space>
            <Button type="primary" onClick={() => setAboutOpen(false)}>
              Close
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions
            size="small"
            column={1}
            bordered
            items={aboutItems}
          />
        </Space>
      </Modal>

      <Modal
        title="Release notes"
        open={releaseNotesOpen}
        onCancel={() => setReleaseNotesOpen(false)}
        footer={
          <Button type="primary" onClick={() => setReleaseNotesOpen(false)}>
            Close
          </Button>
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Text strong>{APP_RELEASE_NOTES.version}</Text>
          </div>
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {APP_RELEASE_NOTES.items.map((item) => (
              <div key={item} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <Tag color="blue" style={{ marginRight: 0 }}>New</Tag>
                <Text>{item}</Text>
              </div>
            ))}
          </Space>
        </Space>
      </Modal>

      <Modal
        title="Change password"
        open={changeOpen}
        onCancel={() => {
          setChangeOpen(false);
          form.resetFields();
        }}
        footer={
          <Space wrap style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button
              onClick={() => {
                setChangeOpen(false);
                form.resetFields();
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="primary" onClick={() => void handleChangePassword()} loading={saving} disabled={saving}>
              {saving ? 'Changing...' : 'Change password'}
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="currentPassword"
            label="Current password"
            rules={[{ required: true, message: 'Current password is required' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="New password"
            rules={[{ required: true, message: 'New password is required' }, { min: 8, message: 'New password must be at least 8 characters' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="Confirm new password"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: 'Please confirm new password' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('Passwords do not match'));
                }
              })
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
