import { useState } from 'react';
import { Button, Dropdown, Form, Input, Modal, Space, message } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function UserMenu() {
  const { email, logout, changePassword } = useAuth();
  const navigate = useNavigate();
  const [changeOpen, setChangeOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ currentPassword: string; newPassword: string; confirmPassword: string }>();

  const handleChangePassword = async () => {
    const values = await form.validateFields();
    if (values.newPassword !== values.confirmPassword) {
      message.error('Passwords do not match');
      return;
    }

    setSaving(true);
    try {
      await changePassword(values.currentPassword, values.newPassword);
      message.success('Password changed');
      setChangeOpen(false);
      form.resetFields();
    } catch {
      message.error('Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <>
      <Dropdown
        menu={{
          items: [
            { key: 'email', label: email ?? 'Unknown user', disabled: true },
            { key: 'change', label: 'Change password', onClick: () => setChangeOpen(true) },
            { key: 'logout', label: 'Logout', onClick: handleLogout, danger: true }
          ]
        }}
      >
        <Button type="text" style={{ color: '#fff' }}>
          <Space>
            <UserOutlined />
            <span>{email ?? 'Account'}</span>
          </Space>
        </Button>
      </Dropdown>

      <Modal
        title="Change password"
        open={changeOpen}
        onOk={() => void handleChangePassword()}
        onCancel={() => setChangeOpen(false)}
        confirmLoading={saving}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="currentPassword"
            label="Current password"
            rules={[{ required: true, message: 'Current password is required' }]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="New password"
            rules={[{ required: true, min: 8, message: 'New password must be at least 8 characters' }]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="Confirm new password"
            rules={[{ required: true, message: 'Please confirm new password' }]}
          >
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
