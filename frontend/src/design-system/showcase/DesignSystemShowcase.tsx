import { useState } from 'react';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  WarningOutlined
} from '@ant-design/icons';
import { Button, Input, Modal, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ConfirmAction,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionCard,
  StatCard,
  StatusBadge,
  TableActions,
  TechnicalDetails,
  designTokens
} from '..';

type CheckRow = {
  key: string;
  name: string;
  status: 'Passed' | 'Running' | 'Failed';
  duration: string;
  updated: string;
};

const palette = [
  ['Background', designTokens.color.background],
  ['Surface', designTokens.color.surface],
  ['Border', designTokens.color.border],
  ['Text', designTokens.color.text],
  ['Muted', designTokens.color.muted],
  ['Primary', designTokens.color.primary],
  ['Success', designTokens.color.success],
  ['Warning', designTokens.color.warning],
  ['Danger', designTokens.color.danger]
] as const;

const rows: CheckRow[] = [
  { key: '1', name: 'Checkout smoke', status: 'Passed', duration: '8.4s', updated: '2 min ago' },
  { key: '2', name: 'Reusable authentication', status: 'Running', duration: '12.1s', updated: 'Now' },
  { key: '3', name: 'Search results', status: 'Failed', duration: '4.7s', updated: '18 min ago' }
];

export default function DesignSystemShowcase() {
  const [modalOpen, setModalOpen] = useState(false);
  const columns: ColumnsType<CheckRow> = [
    {
      title: 'Check',
      dataIndex: 'name',
      key: 'name',
      render: (value: string) => <Typography.Text strong>{value}</Typography.Text>
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (value: CheckRow['status']) => <StatusBadge status={value} label={value} />
    },
    { title: 'Duration', dataIndex: 'duration', key: 'duration', width: 110 },
    { title: 'Updated', dataIndex: 'updated', key: 'updated', width: 120 },
    {
      title: '',
      key: 'actions',
      width: 140,
      align: 'right',
      render: () => (
        <TableActions
          moreLabel="More check actions"
          menu={{
            items: [
              { key: 'duplicate', label: 'Duplicate' },
              { key: 'delete', label: 'Delete', danger: true }
            ]
          }}
        >
          <Button size="small">Open</Button>
        </TableActions>
      )
    }
  ];

  return (
    <main className="wt-showcase">
      <div className="wt-showcase__canvas">
        <PageHeader
          breadcrumbs={[
            { key: 'foundation', label: 'Foundation' },
            { key: 'showcase', label: 'Component showcase' }
          ]}
          title="WrightTest design system"
          description="A compact, calm foundation for long-running QA workflows. This development-only page does not change product screens."
          actions={(
            <>
              <Button icon={<ReloadOutlined />}>Secondary action</Button>
              <Button type="primary" icon={<PlusOutlined />} data-testid="primary-button" className="wt-pressable">
                Primary action
              </Button>
            </>
          )}
        />

        <SectionCard title="Color palette" description="Semantic colors shared by Ant Design and custom layout primitives.">
          <div className="wt-showcase__palette">
            {palette.map(([name, value]) => (
              <div className="wt-showcase__swatch" key={name}>
                <span className="wt-showcase__swatch-color" style={{ background: value }} />
                <span className="wt-showcase__swatch-name">{name}</span>
                <code>{value}</code>
              </div>
            ))}
          </div>
        </SectionCard>

        <div className="wt-showcase__split">
          <SectionCard title="Typography" description="Compact hierarchy with system-native rendering.">
            <div className="wt-showcase__type">
              <span className="wt-showcase__display">Display 30 / Semibold</span>
              <span className="wt-showcase__heading">Page heading 24 / Semibold</span>
              <span className="wt-showcase__subheading">Section heading 20 / Semibold</span>
              <span>Body 14 / Regular for product content and tables.</span>
              <span className="wt-showcase__muted">Muted 14 / Regular for supporting context.</span>
              <span className="wt-showcase__caption">Caption 12 / Medium for metadata.</span>
            </div>
          </SectionCard>

          <SectionCard title="Controls" description="Ant Design controls mapped to WrightTest tokens.">
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space wrap>
                <Button type="primary" className="wt-pressable">Run check</Button>
                <Button>Save draft</Button>
                <Button danger>Delete</Button>
                <Button disabled>Unavailable</Button>
              </Space>
              <div className="wt-showcase__form-row">
                <Input aria-label="Check name example" placeholder="Check name" />
                <Select
                  aria-label="Environment example"
                  placeholder="Environment"
                  options={[
                    { value: 'dev', label: 'Development' },
                    { value: 'staging', label: 'Staging' }
                  ]}
                />
              </div>
              <Button onClick={() => setModalOpen(true)}>Open modal</Button>
            </Space>
          </SectionCard>
        </div>

        <div className="wt-showcase__stats">
          <StatCard title="Checks" value="24" meta="Across 4 projects" />
          <StatCard title="Pass rate" value="96.4%" meta="Last 30 days" />
          <StatCard title="Active schedules" value="7" meta="All healthy" />
          <StatCard title="Open failures" value="2" meta="Needs attention" />
        </div>

        <SectionCard title="Status language" description="One visual grammar for checks, runs, authentication, schedules, and members.">
          <Space wrap size={[8, 8]}>
            <StatusBadge status="PENDING" label="Pending" icon={<ClockCircleOutlined />} />
            <StatusBadge status="RUNNING" label="Running" icon={<ClockCircleOutlined />} />
            <StatusBadge status="PASSED" label="Passed" icon={<CheckCircleOutlined />} />
            <StatusBadge tone="warning" label="Needs attention" icon={<WarningOutlined />} />
            <StatusBadge status="FAILED" label="Failed" icon={<WarningOutlined />} />
          </Space>
        </SectionCard>

        <SectionCard title="Compact table" description="Dense enough for operational work without sacrificing scanability.">
          <div className="wt-showcase__table">
            <Table<CheckRow>
              columns={columns}
              dataSource={rows}
              pagination={false}
              size="small"
              scroll={{ x: 720 }}
            />
          </div>
        </SectionCard>

        <div className="wt-showcase__states">
          <EmptyState
            title="No checks yet"
            description="Create a check or import an existing Playwright spec."
            action={<Button type="primary" icon={<PlusOutlined />}>Create check</Button>}
          />
          <LoadingState label="Loading project data" rows={2} />
          <ErrorState
            title="Runs could not be loaded"
            description="The current data remains unchanged. Try the request again."
            retryLabel="Retry"
            onRetry={() => undefined}
          />
        </div>

        <SectionCard title="Safe destructive actions" description="Confirmation copy is supplied by the product surface, not the universal component.">
          <ConfirmAction
            title="Delete this check?"
            description="Run history and artifacts will also be removed."
            confirmLabel="Delete check"
            cancelLabel="Cancel"
            onConfirm={() => undefined}
          >
            <Button danger icon={<DeleteOutlined />}>Delete check</Button>
          </ConfirmAction>
        </SectionCard>

        <TechnicalDetails title="Technical details">
          <div className="wt-showcase__technical-copy">
            <code>page.getByRole('button', {'{ name: \'Run check\' }'})</code>
            <span>Trace ID: run-cmw0-foundation</span>
          </div>
        </TechnicalDetails>
      </div>

      <Modal
        title="Create environment"
        open={modalOpen}
        okText="Create environment"
        cancelText="Cancel"
        onOk={() => setModalOpen(false)}
        onCancel={() => setModalOpen(false)}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            Modal copy remains owned by the feature so it can be localized later.
          </Typography.Text>
          <Input aria-label="Environment name example" placeholder="Environment name" />
        </Space>
      </Modal>
    </main>
  );
}
