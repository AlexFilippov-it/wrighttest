import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Navigate, useNavigate } from 'react-router-dom';
import appLogo from '../assets/wrighttest_logo.png';
import { useAuth } from '../context/AuthContext';
import { APP_BUILD_DATE, APP_GIT_COMMIT, APP_VERSION, formatBuildDate } from '../utils/appMeta';
import './LoginPage.css';

export default function LoginPage() {
  const { login, token, ready } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!ready) {
    return null;
  }

  if (token) {
    return <Navigate to="/dashboard" replace />;
  }

  const buildDateLabel = formatBuildDate(APP_BUILD_DATE);

  const handleSubmit = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError('');
    try {
      await login(values.email, values.password);
      navigate('/dashboard');
    } catch {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="wt-login-page">
      <div className="wt-login-page__main">
        <Card className="wt-login-card" bordered>
          <div className="wt-login-card__brand">
            <img src={appLogo} alt="WrightTest" />
          </div>
          <div className="wt-login-card__heading">
            <Typography.Title level={1}>Welcome back</Typography.Title>
            <Typography.Text type="secondary">Sign in to continue to your workspace.</Typography.Text>
          </div>

          {error && (
            <Alert className="wt-login-card__alert" message={error} type="error" showIcon />
          )}

          <Form className="wt-login-form" layout="vertical" onFinish={handleSubmit}>
            <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
              <Input autoComplete="username" prefix={<UserOutlined />} placeholder="Email" size="large" />
            </Form.Item>
            <Form.Item name="password" label="Password" rules={[{ required: true }]}>
              <Input.Password autoComplete="current-password" prefix={<LockOutlined />} placeholder="Password" size="large" />
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
              Sign In
            </Button>
          </Form>
        </Card>
      </div>
      <footer className="wt-login-page__footer">
        <span>WrightTest</span>
        <span>{APP_VERSION}</span>
        {APP_GIT_COMMIT ? <span>{APP_GIT_COMMIT}</span> : null}
        {buildDateLabel ? <span>{buildDateLabel}</span> : null}
      </footer>
    </main>
  );
}
