import { Alert, Button, Collapse, Descriptions, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import StatusBadge from '../design-system/StatusBadge';
import type { Step, TestRun } from '../types';
import { safeHttpUrl } from '../utils/safe-display';

type Result = Omit<NonNullable<TestRun['stepResults']>[number], 'status'> & { status: 'passed' | 'failed' | 'pending' };

type Props = {
  result: Result;
  stepNumber: number;
  stepDefinition?: Step;
  actionLabel: string;
  target: string;
  statusLabel: string;
  screenshotUrl?: string;
  highlighted?: boolean;
  expanded: boolean;
  onToggle: () => void;
};

function sqlCount(database: NonNullable<Result['database']>, sql: string | undefined, t: (key: string, options?: { count: number }) => string) {
  const query = sql?.trim().replace(/^(?:--[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*/, '').split(/\s+/, 1)[0]?.toLowerCase();
  if (query === 'select' || database.rowCount > 0 || database.columns.length > 0) {
    return `${t('connections.rowsReturned', { count: database.rowCount })}${database.rowLimitReached ? '+' : ''}`;
  }
  if (database.affectedRows !== undefined) return t('connections.rowsAffected', { count: database.affectedRows });
  return t('connections.noRowCount');
}

function duration(ms: number | null | undefined) {
  if (ms == null) return '—';
  return `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}s`;
}

export default function RunStepResultCard({ result, stepNumber, stepDefinition, actionLabel, target, statusLabel, screenshotUrl, highlighted = false, expanded, onToggle }: Props) {
  const { t } = useTranslation();
  const http = result.http;
  const database = result.database;
  const canExpand = Boolean(result.generated || result.captured || database || http || result.error || screenshotUrl || stepDefinition?.sql);
  const summary = http
    ? `${http.method} · ${http.status} · ${duration(http.durationMs)}`
    : database
      ? database.connectionName
      : target;

  return <article className={`wt-run-step-card${result.status === 'failed' ? ' wt-run-step-card--failed' : ''}${highlighted ? ' wt-run-step-card--highlighted' : ''}`} data-run-step={stepNumber}>
    <div className="wt-run-step-card__topline">
      <Typography.Text strong>{t('runResult.stepNumber', { number: stepNumber })}</Typography.Text>
      <StatusBadge status={result.status} label={statusLabel} />
    </div>
    <Typography.Text strong className="wt-run-step-card__action">{actionLabel}</Typography.Text>
    <Typography.Text type="secondary" className="wt-run-step-card__target">{summary}</Typography.Text>
    <div className="wt-run-step-card__meta">
      <span>{t('common.duration')}: {duration(result.durationMs)}</span>
      {http && <span>{t('http.assertionCount', { count: http.assertions.length })} · {t('http.captureCount', { count: http.captures.length })}</span>}
      {database && <span>{sqlCount(database, stepDefinition?.sql, t)}</span>}
    </div>
    {result.error && <Alert className="wt-run-step-card__error" type="error" showIcon message={result.error} />}
    {canExpand && <Button type="link" className="wt-run-step-card__toggle" aria-expanded={expanded} onClick={onToggle}>
      {t(expanded ? 'runResult.hideDetails' : 'runResult.showDetails')}
    </Button>}
    {expanded && <div className="wt-run-step-card__details">
      {http && <>
        <Descriptions size="small" column={1} items={[
          { key: 'method', label: t('http.method'), children: http.method },
          { key: 'url', label: t('http.url'), children: <span className="wt-run-breakable">{safeHttpUrl(http.url)}</span> },
          { key: 'status', label: t('http.status'), children: http.status },
          { key: 'duration', label: t('http.responseTime'), children: duration(http.durationMs) },
          { key: 'size', label: t('http.responseSize'), children: `${http.responseBytes} B` },
          { key: 'headers', label: t('http.responseHeaders'), children: http.responseHeaderNames.join(', ') || '—' }
        ]} />
        {http.assertions.length > 0 && <div><Typography.Text type="secondary">{t('http.assertions')}</Typography.Text>{http.assertions.map((assertion, index) => <div className="wt-run-step-card__detail-line" key={index}><StatusBadge status={assertion.passed ? 'PASSED' : 'FAILED'} label={t(assertion.passed ? 'common.passed' : 'common.failed')} /><Typography.Text className="wt-run-breakable">{assertion.message}</Typography.Text></div>)}</div>}
        {http.captures.length > 0 && <div><Typography.Text type="secondary">{t('http.capture')}</Typography.Text>{http.captures.map((capture) => <div className="wt-run-step-card__detail-line" key={capture.variableName}><Typography.Text code>{capture.variableName}</Typography.Text><Typography.Text>{capture.type}</Typography.Text>{capture.secret && <Tag>{t('testData.secret')}</Tag>}</div>)}</div>}
      </>}
      {database && <>
        <Descriptions size="small" column={1} items={[
          { key: 'connection', label: t('connections.connection'), children: database.connectionName },
          { key: 'query', label: t('connections.queryType'), children: stepDefinition?.sql?.trim().split(/\s+/)[0]?.toUpperCase() ?? '—' },
          { key: 'rows', label: t('connections.databaseResult'), children: sqlCount(database, stepDefinition?.sql, t) }
        ]} />
        {database.assertion && <div className="wt-run-step-card__detail-line"><StatusBadge status={database.assertion.passed ? 'PASSED' : 'FAILED'} label={t(database.assertion.passed ? 'connections.assertionPassed' : 'connections.assertionFailed')} />{t(`connections.assertion.${database.assertion.type}`)}</div>}
        {stepDefinition?.sql && <pre className="wt-run-sql-query">{stepDefinition.sql}</pre>}
      </>}
      {result.generated && <Descriptions size="small" column={1} items={[
        { key: 'variable', label: t('testData.variable'), children: result.generated.variableName },
        { key: 'source', label: t('capture.results.source'), children: t('capture.results.generated') },
        { key: 'type', label: t('capture.results.type'), children: typeof result.generated.value },
        { key: 'secret', label: t('capture.results.secret'), children: result.generated.secret ? t('testData.yes') : t('testData.no') },
        { key: 'value', label: t('capture.results.value'), children: result.generated.secret ? '••••••••' : String(result.generated.value ?? '—') }
      ]} />}
      {result.captured && <Descriptions size="small" column={1} items={[
        { key: 'variable', label: t('capture.results.name'), children: result.captured.variableName },
        { key: 'source', label: t('capture.results.source'), children: result.action === 'captureValue' ? t('capture.variableSource.browser') : result.action === 'executeSql' ? t('capture.variableSource.sql') : result.action === 'httpRequest' ? t('capture.variableSource.http') : result.captured.source },
        { key: 'type', label: t('capture.results.type'), children: result.captured.type },
        { key: 'step', label: t('capture.results.step'), children: result.captured.createdByStep },
        { key: 'secret', label: t('capture.results.secret'), children: result.captured.secret ? t('testData.yes') : t('testData.no') },
        { key: 'value', label: t('capture.results.value'), children: result.captured.secret ? '••••••••' : String(result.captured.value ?? '—') }
      ]} />}
      {!http && !database && <Space direction="vertical" size={8} className="wt-run-step-card__browser-details">
        <div><Typography.Text type="secondary">{t('runResult.target')}: </Typography.Text><span className="wt-run-breakable">{target}</span></div>
        {screenshotUrl && <a href={screenshotUrl} target="_blank" rel="noreferrer">{t('runResult.screenshot')}</a>}
      </Space>}
      {result.error && <Collapse size="small" items={[{ key: 'diagnostic', label: t('runResult.errorSummary'), children: <Typography.Text className="wt-run-breakable">{result.error}</Typography.Text> }]} />}
    </div>}
  </article>;
}
