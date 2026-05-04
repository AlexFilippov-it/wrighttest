import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login, token, ready } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!ready) {
    return null;
  }

  if (token) {
    return <Navigate to="/projects" replace />;
  }

  const handleSubmit = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError('');
    try {
      await login(values.email, values.password);
      navigate('/projects');
    } catch {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 48%, #e2e8f0 100%)',
      padding: 24
    }}>
      <Card style={{ width: 400, borderRadius: 24, boxShadow: '0 30px 80px rgba(15, 23, 42, 0.35)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Typography.Title level={3} style={{ margin: 0 }}>
            WrightTest
          </Typography.Title>
          <Typography.Text type="secondary">
            Sign in to manage tests and schedules
          </Typography.Text>
        </div>

        {error && (
          <Alert message={error} type="error" style={{ marginBottom: 16 }} showIcon />
        )}

        <Form layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input prefix={<UserOutlined />} placeholder="admin@wrighttest.com" size="large" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Password" size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={loading}>
            Sign In
          </Button>
        </Form>
      </Card>
    </div>
  );
}
