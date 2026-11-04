import { useEffect, useState } from 'react';
import axios from 'axios';
import { Alert, Button, Descriptions, Dropdown, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { CopyOutlined, DeleteOutlined, InfoCircleOutlined, KeyOutlined, LogoutOutlined, ProfileOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  api,
  createPersonalApiToken,
  getPersonalApiTokens,
  revokePersonalApiToken,
  type PersonalApiToken
} from '../api/client';
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

type UserMenuProps = {
  tone?: 'dark' | 'light';
  compact?: boolean;
};

export default function UserMenu({ tone = 'dark', compact = false }: UserMenuProps) {
  const { t } = useTranslation();
  const { email, logout, changePassword } = useAuth();
  const navigate = useNavigate();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [apiTokensOpen, setApiTokensOpen] = useState(false);
  const [apiTokens, setApiTokens] = useState<PersonalApiToken[]>([]);
  const [apiTokensLoading, setApiTokensLoading] = useState(false);
  const [apiTokenSaving, setApiTokenSaving] = useState(false);
  const [revokingTokenId, setRevokingTokenId] = useState<string | null>(null);
  const [apiTokenName, setApiTokenName] = useState('');
  const [apiTokenExpiry, setApiTokenExpiry] = useState('90');
  const [newlyCreatedToken, setNewlyCreatedToken] = useState<string | null>(null);
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

  useEffect(() => {
    if (!apiTokensOpen) return;
    let cancelled = false;
    setApiTokensLoading(true);
    void getPersonalApiTokens()
      .then((tokens) => { if (!cancelled) setApiTokens(tokens); })
      .catch((error) => { if (!cancelled) message.error(getApiErrorMessage(error, t('userMenu.apiTokensLoadFailed'))); })
      .finally(() => { if (!cancelled) setApiTokensLoading(false); });
    return () => { cancelled = true; };
  }, [apiTokensOpen, t]);

  const closeApiTokens = () => {
    setApiTokensOpen(false);
    setNewlyCreatedToken(null);
    setApiTokenName('');
  };

  const handleCreateApiToken = async () => {
    const name = apiTokenName.trim();
    if (!name) return;
    setApiTokenSaving(true);
    try {
      const created = await createPersonalApiToken({
        name,
        ...(apiTokenExpiry === 'never' ? {} : { expiresInDays: Number(apiTokenExpiry) })
      });
      setNewlyCreatedToken(created.token);
      setApiTokenName('');
      setApiTokens(await getPersonalApiTokens());
      message.success(t('userMenu.apiTokenCreated'));
    } catch (error) {
      message.error(getApiErrorMessage(error, t('userMenu.apiTokenCreateFailed')));
    } finally {
      setApiTokenSaving(false);
    }
  };

  const handleRevokeApiToken = async (tokenId: string) => {
    setRevokingTokenId(tokenId);
    try {
      await revokePersonalApiToken(tokenId);
      setApiTokens((tokens) => tokens.map((token) => token.id === tokenId ? { ...token, revokedAt: new Date().toISOString() } : token));
      message.success(t('userMenu.apiTokenRevoked'));
    } catch (error) {
      message.error(getApiErrorMessage(error, t('userMenu.apiTokenRevokeFailed')));
    } finally {
      setRevokingTokenId(null);
    }
  };

  const copyApiToken = async () => {
    if (!newlyCreatedToken) return;
    try {
      await navigator.clipboard.writeText(newlyCreatedToken);
      message.success(t('userMenu.apiTokenCopied'));
    } catch {
      message.error(t('userMenu.apiTokenCopyFailed'));
    }
  };

  const handleChangePassword = async () => {
    const values = await form.validateFields();

    setSaving(true);
    try {
      await changePassword(values.currentPassword, values.newPassword);
      message.success(t('userMenu.passwordChanged'));
      setChangeOpen(false);
      form.resetFields();
    } catch (error) {
      message.error(getApiErrorMessage(error, t('userMenu.passwordChangeFailed')));
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const aboutItems = [
    { label: t('userMenu.product'), children: APP_NAME },
    { label: t('userMenu.description'), children: APP_DESCRIPTION },
    { label: t('userMenu.version'), children: APP_VERSION },
    { label: t('userMenu.gitCommit'), children: APP_GIT_COMMIT || t('common.unavailable') },
    { label: t('userMenu.buildDate'), children: formatBuildDate(APP_BUILD_DATE) || t('common.unavailable') },
    { label: t('userMenu.environment'), children: APP_ENVIRONMENT },
    { label: t('userMenu.currentUser'), children: email ?? t('userMenu.unknownUser') },
    {
      label: t('userMenu.backendApiStatus'),
      children:
        health.api === 'checking'
          ? t('common.checking')
          : health.api === 'healthy'
            ? t('common.healthy')
            : t('common.unavailable')
    },
    {
      label: t('userMenu.databaseStatus'),
      children:
        health.database === 'checking'
          ? t('common.checking')
          : health.database === 'healthy'
            ? t('common.healthy')
            : t('common.unavailable')
    },
    {
      label: t('userMenu.runnerStatus'),
      children:
        health.api === 'healthy' && health.database === 'healthy'
          ? t('common.available')
          : health.api === 'checking' || health.database === 'checking'
            ? t('common.checking')
            : t('common.unavailable')
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
                    {t('userMenu.signedInAs', { email })}
                  </Text>
                  <Text strong style={{ color: 'rgba(15, 23, 42, 0.88)' }}>{email ?? 'Unknown user'}</Text>
                </div>
              )
            },
            { type: 'divider' },
            { key: 'about', icon: <InfoCircleOutlined />, label: t('userMenu.about') },
            { key: 'release-notes', icon: <ProfileOutlined />, label: t('userMenu.releaseNotes') },
            { key: 'change-password', icon: <UserOutlined />, label: t('userMenu.changePassword') },
            { key: 'api-tokens', icon: <KeyOutlined />, label: t('userMenu.apiTokens') },
            { type: 'divider' },
            { key: 'logout', icon: <LogoutOutlined />, label: t('common.logout'), danger: true }
          ],
          onClick: ({ key }) => {
            if (key === 'about') setAboutOpen(true);
            if (key === 'release-notes') setReleaseNotesOpen(true);
            if (key === 'change-password') setChangeOpen(true);
            if (key === 'api-tokens') setApiTokensOpen(true);
            if (key === 'logout') handleLogout();
          }
        }}
      >
        <Button
          type="text"
          aria-label={compact ? t('userMenu.openAccountMenu') : undefined}
          style={{ color: tone === 'dark' ? '#fff' : 'var(--wt-color-text)', paddingInline: 10 }}
        >
          <Space>
            <UserOutlined />
            {compact ? null : <span>{email ?? t('userMenu.account')}</span>}
          </Space>
        </Button>
      </Dropdown>

      <Modal
        title={t('userMenu.about')}
        open={aboutOpen}
        onCancel={() => setAboutOpen(false)}
        footer={
          <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space wrap>
              <Button onClick={() => { setAboutOpen(false); navigate('/dashboard'); }}>{t('nav.dashboard')}</Button>
              <Button onClick={() => { setAboutOpen(false); navigate('/projects'); }}>{t('nav.projects')}</Button>
              <Button onClick={() => { setAboutOpen(false); navigate('/runs'); }}>{t('project.runs')}</Button>
            </Space>
            <Button type="primary" onClick={() => setAboutOpen(false)}>
              {t('common.close')}
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
        title={t('userMenu.apiTokens')}
        open={apiTokensOpen}
        onCancel={closeApiTokens}
        footer={<Button type="primary" onClick={closeApiTokens}>{t('common.close')}</Button>}
        width={680}
        destroyOnHidden
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Text type="secondary">{t('userMenu.apiTokensDescription')}</Text>
          {newlyCreatedToken ? (
            <Alert
              type="success"
              showIcon
              message={t('userMenu.apiTokenOneTimeTitle')}
              description={(
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Text>{t('userMenu.apiTokenOneTimeHelp')}</Text>
                  <Input.Group compact>
                    <Input readOnly value={newlyCreatedToken} style={{ width: 'calc(100% - 112px)' }} />
                    <Button icon={<CopyOutlined />} onClick={() => void copyApiToken()}>{t('userMenu.apiTokenCopy')}</Button>
                  </Input.Group>
                </Space>
              )}
            />
          ) : null}

          <Space wrap style={{ width: '100%' }}>
            <Input
              aria-label={t('userMenu.apiTokenName')}
              placeholder={t('userMenu.apiTokenNamePlaceholder')}
              maxLength={80}
              value={apiTokenName}
              style={{ flex: '1 1 220px', minWidth: 180 }}
              onChange={(event) => setApiTokenName(event.target.value)}
              onPressEnter={() => void handleCreateApiToken()}
            />
            <Select
              aria-label={t('userMenu.apiTokenExpiry')}
              value={apiTokenExpiry}
              onChange={setApiTokenExpiry}
              style={{ width: 150, flex: '0 0 150px' }}
              options={[
                { value: '30', label: t('userMenu.apiTokenExpires30') },
                { value: '90', label: t('userMenu.apiTokenExpires90') },
                { value: '365', label: t('userMenu.apiTokenExpires365') },
                { value: 'never', label: t('userMenu.apiTokenNeverExpires') }
              ]}
            />
            <Button type="primary" loading={apiTokenSaving} disabled={!apiTokenName.trim()} onClick={() => void handleCreateApiToken()}>
              {t('userMenu.apiTokenCreate')}
            </Button>
          </Space>

          <Table<PersonalApiToken>
            rowKey="id"
            size="small"
            loading={apiTokensLoading}
            pagination={false}
            scroll={{ x: 560 }}
            dataSource={apiTokens.filter((token) => !token.revokedAt && (!token.expiresAt || new Date(token.expiresAt).getTime() > Date.now()))}
            locale={{ emptyText: t('userMenu.apiTokensEmpty') }}
            columns={[
              { title: t('userMenu.apiTokenName'), dataIndex: 'name', key: 'name' },
              { title: t('userMenu.apiTokenPrefix'), dataIndex: 'tokenPrefix', key: 'prefix', render: (value: string) => <Text code>{value}…</Text> },
              { title: t('userMenu.apiTokenExpiry'), dataIndex: 'expiresAt', key: 'expiresAt', render: (value: string | null) => value ? new Date(value).toLocaleDateString() : t('userMenu.apiTokenNeverExpires') },
              {
                title: t('common.actions'),
                key: 'actions',
                align: 'right',
                render: (_value: unknown, token: PersonalApiToken) => (
                  <Popconfirm title={t('userMenu.apiTokenRevokeConfirm')} onConfirm={() => void handleRevokeApiToken(token.id)}>
                    <Button danger icon={<DeleteOutlined />} loading={revokingTokenId === token.id}>
                      {t('userMenu.apiTokenRevoke')}
                    </Button>
                  </Popconfirm>
                )
              }
            ]}
          />
        </Space>
      </Modal>

      <Modal
        title={t('userMenu.releaseNotes')}
        open={releaseNotesOpen}
        onCancel={() => setReleaseNotesOpen(false)}
        footer={
          <Button type="primary" onClick={() => setReleaseNotesOpen(false)}>
            {t('common.close')}
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
                <Tag color="blue" style={{ marginRight: 0 }}>{t('common.new')}</Tag>
                <Text>{item}</Text>
              </div>
            ))}
          </Space>
        </Space>
      </Modal>

      <Modal
        title={t('userMenu.changePassword')}
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
              {t('common.cancel')}
            </Button>
            <Button type="primary" onClick={() => void handleChangePassword()} loading={saving} disabled={saving}>
              {saving ? t('userMenu.changingPassword') : t('userMenu.changePassword')}
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="currentPassword"
            label={t('userMenu.currentPassword')}
            rules={[{ required: true, message: t('userMenu.currentPasswordRequired') }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label={t('userMenu.newPassword')}
            rules={[{ required: true, message: t('userMenu.newPasswordRequired') }, { min: 8, message: t('userMenu.passwordMinLength') }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label={t('userMenu.confirmPassword')}
            dependencies={['newPassword']}
            rules={[
              { required: true, message: t('userMenu.confirmPasswordRequired') },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error(t('userMenu.passwordsDoNotMatch')));
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
