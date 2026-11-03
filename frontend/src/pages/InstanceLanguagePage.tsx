import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Input, Modal, Progress, Select, Space, Table, Tag, Typography, Upload, message } from 'antd';
import { DeleteOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../design-system/PageHeader';
import {
  applyLanguagePack,
  deleteLanguagePack,
  exportLanguagePack,
  getLanguageSettings,
  getLanguageTemplate,
  setInstanceLocale,
  validateLanguagePack,
  type LanguageImportPreview,
  type LanguagePackage,
  type LanguagePackSummary
} from '../api/client';
import { loadInstanceLocale } from '../localization/i18n';

const MAX_IMPORT_BYTES = 1024 * 1024;

function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

export default function InstanceLanguagePage() {
  const { t } = useTranslation();
  const { isSystemAdmin } = useAuth();
  const [packs, setPacks] = useState<LanguagePackSummary[]>([]);
  const [activeLocale, setActiveLocale] = useState('en');
  const [selectedLocale, setSelectedLocale] = useState('en');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateLocale, setTemplateLocale] = useState('');
  const [pendingImport, setPendingImport] = useState<LanguagePackage | null>(null);
  const [preview, setPreview] = useState<LanguageImportPreview | null>(null);
  const [validating, setValidating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [fileName, setFileName] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const result = await getLanguageSettings();
      setPacks(result.packs);
      setActiveLocale(result.activeLocale);
      setSelectedLocale(result.activeLocale);
    } catch {
      message.error(t('language.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const options = useMemo(() => packs.map((pack) => ({
    value: pack.locale,
    label: `${pack.displayName} (${pack.locale})`
  })), [packs]);

  const handleApplyLocale = async () => {
    setSaving(true);
    try {
      await setInstanceLocale(selectedLocale);
      await loadInstanceLocale();
      setActiveLocale(selectedLocale);
      message.success(t('language.saved'));
    } catch {
      message.error(t('language.loadError'));
    } finally {
      setSaving(false);
    }
  };

  const exportPack = async (locale: string) => {
    try {
      const pack = await exportLanguagePack(locale);
      downloadJson(pack, `wrighttest-${locale}.json`);
    } catch {
      message.error(t('language.loadError'));
    }
  };

  const downloadTemplate = async () => {
    const locale = templateLocale.trim();
    if (!locale) return;
    try {
      const pack = await getLanguageTemplate(locale);
      downloadJson(pack, `wrighttest-${locale}-template.json`);
      setTemplateOpen(false);
      setTemplateLocale('');
    } catch {
      message.error(t('language.validationError'));
    }
  };

  const validateFile = async (file: File) => {
    setValidating(true);
    setPendingImport(null);
    setPreview(null);
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error(t('language.fileTooLarge'));
      if (!file.name.toLowerCase().endsWith('.json')) throw new Error(t('language.invalidJson'));
      const parsed = JSON.parse(await file.text()) as LanguagePackage;
      const result = await validateLanguagePack(parsed);
      setPendingImport(parsed);
      setPreview(result);
      setFileName(file.name);
    } catch (error) {
      const description = error instanceof Error && error.message !== 'Request failed with status code 400'
        ? error.message
        : t('language.validationError');
      Modal.error({ title: t('language.validationError'), content: description });
    } finally {
      setValidating(false);
    }
    return Upload.LIST_IGNORE;
  };

  const handleImport = async () => {
    if (!pendingImport) return;
    setApplying(true);
    try {
      await applyLanguagePack(pendingImport);
      setPendingImport(null);
      setPreview(null);
      message.success(t('language.imported'));
      await load();
    } catch {
      message.error(t('language.validationError'));
    } finally {
      setApplying(false);
    }
  };

  const handleDelete = (locale: string) => {
    Modal.confirm({
      title: t('language.confirmDelete'),
      content: t('language.confirmDeleteDescription'),
      okText: t('language.delete'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: async () => {
        const result = await deleteLanguagePack(locale);
        if (result.activeLocale !== activeLocale) await loadInstanceLocale();
        message.success(t('language.deleted'));
        await load();
      }
    });
  };

  const columns = [
    {
      title: t('language.language'),
      dataIndex: 'displayName',
      key: 'language',
      render: (_: string, pack: LanguagePackSummary) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{pack.displayName}</Typography.Text>
          {pack.hasCustomPack && pack.isBuiltIn ? <Typography.Text type="secondary">{t('language.customOverride')}</Typography.Text> : null}
        </Space>
      )
    },
    { title: t('language.locale'), dataIndex: 'locale', key: 'locale' },
    {
      title: t('language.translated'),
      key: 'translated',
      render: (_: unknown, pack: LanguagePackSummary) => (
        <Space>
          <Typography.Text>{pack.translated}/{pack.total}</Typography.Text>
          {pack.stale > 0 ? <Tag color="warning">{pack.stale} {t('language.needsReview')}</Tag> : null}
        </Space>
      )
    },
    {
      title: t('language.status'),
      key: 'status',
      render: (_: unknown, pack: LanguagePackSummary) => (
        <Tag color={pack.status === 'needs-review' ? 'warning' : pack.isBuiltIn ? 'blue' : 'green'}>
          {pack.status === 'needs-review' ? t('language.needsReview') : pack.isBuiltIn ? t('language.builtIn') : t('language.installed')}
        </Tag>
      )
    },
    {
      title: t('language.actions'),
      key: 'actions',
      render: (_: unknown, pack: LanguagePackSummary) => (
        <Space wrap>
          <Button size="small" onClick={() => void exportPack(pack.locale)}>{t('language.export')}</Button>
          {pack.locale !== 'en' && (pack.isBuiltIn || pack.hasCustomPack) ? (
            <Upload accept=".json,application/json" showUploadList={false} beforeUpload={(file) => validateFile(file)}>
              <Button size="small" loading={validating}>{pack.hasCustomPack ? t('language.update') : t('language.importLanguage')}</Button>
            </Upload>
          ) : null}
          {pack.hasCustomPack ? <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(pack.locale)}>{t('language.delete')}</Button> : null}
        </Space>
      )
    }
  ];

  if (!isSystemAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <PageHeader
        title={t('language.pageTitle')}
        description={t('language.pageDescription')}
        breadcrumbs={[{ key: 'settings', label: t('nav.system') }, { key: 'language', label: t('nav.language') }]}
      />

      <Card title={t('language.interfaceLanguage')}>
        <Space direction="vertical" size={12} style={{ width: '100%', maxWidth: 560 }}>
          <Typography.Text type="secondary">{t('language.interfaceLanguageHelp')}</Typography.Text>
          <Select value={selectedLocale} options={options} onChange={setSelectedLocale} loading={loading} />
          <Button type="primary" loading={saving} disabled={selectedLocale === activeLocale} onClick={() => void handleApplyLocale()}>
            {t('language.apply')}
          </Button>
        </Space>
      </Card>

      <Card
        title={t('language.packs')}
        extra={(
          <Space wrap>
            <Button icon={<DownloadOutlined />} onClick={() => setTemplateOpen(true)}>{t('language.downloadTemplate')}</Button>
            <Upload accept=".json,application/json" showUploadList={false} beforeUpload={(file) => validateFile(file)}>
              <Button icon={<UploadOutlined />} loading={validating}>{t('language.importLanguage')}</Button>
            </Upload>
          </Space>
        )}
      >
        <Table rowKey="locale" dataSource={packs} columns={columns} loading={loading} pagination={false} scroll={{ x: 'max-content' }} />
      </Card>

      <Modal
        title={t('language.importTitle')}
        open={Boolean(preview && pendingImport)}
        onCancel={() => { setPreview(null); setPendingImport(null); }}
        onOk={() => void handleImport()}
        okText={t('language.applyImport')}
        cancelText={t('common.cancel')}
        confirmLoading={applying}
      >
        {preview ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Text><strong>{t('language.file')}:</strong> {fileName}</Typography.Text>
            <Typography.Text><strong>{t('language.language')}:</strong> {preview.displayName} ({preview.locale})</Typography.Text>
            <Progress percent={preview.total ? Math.round((preview.translated / preview.total) * 100) : 100} />
            <Typography.Text>{t('language.translatedCount', { count: preview.translated })} / {preview.total}</Typography.Text>
            <Typography.Text>{t('language.missing')}: {preview.missing}</Typography.Text>
            <Typography.Text>{t('language.stale')}: {preview.stale}</Typography.Text>
            <Typography.Text>{t('language.unknown')}: {preview.unknown}</Typography.Text>
            {preview.unknown > 0 ? <Alert type="warning" showIcon message={preview.unknownKeys.slice(0, 10).join(', ')} /> : null}
            <Typography.Text type="secondary">{t('language.mergeHelp')}</Typography.Text>
          </Space>
        ) : null}
      </Modal>

      <Modal
        title={t('language.downloadTemplate')}
        open={templateOpen}
        onCancel={() => setTemplateOpen(false)}
        onOk={() => void downloadTemplate()}
        okText={t('language.downloadTemplate')}
        cancelText={t('common.cancel')}
      >
        <Input value={templateLocale} onChange={(event) => setTemplateLocale(event.target.value)} placeholder="ru-RU, de-DE, fr-FR" />
      </Modal>
    </Space>
  );
}
