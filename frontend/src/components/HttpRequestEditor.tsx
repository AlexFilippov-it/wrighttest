import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Checkbox, Input, InputNumber, Select, Space, Tabs, Tag, Typography } from 'antd';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { EditorView } from '@codemirror/view';
import { useTranslation } from 'react-i18next';
import type { Step } from '../types';
import VariableAutocompleteInput from './VariableAutocompleteInput';

const { Text } = Typography;
type HttpConfig = NonNullable<Step['http']>;

export default function HttpRequestEditor({ step, variableNames, readOnly, onChange }: {
  step: Step;
  variableNames: string[];
  readOnly: boolean;
  onChange: (config: HttpConfig) => void;
}) {
  const { t } = useTranslation();
  const config = step.http ?? { method: 'GET' as const, url: '', body: { type: 'none' as const }, auth: { type: 'none' as const }, headers: [], queryParams: [], assertions: [], capture: [], timeoutMs: 15000, followRedirects: true };
  const update = (patch: Partial<HttpConfig>) => onChange({ ...config, ...patch });
  const renderRows = (kind: 'headers' | 'queryParams') => {
    const rows = config[kind] ?? [];
    return <div style={{ display: 'grid', gap: 8 }}>
      {rows.map((row, index) => <div key={`${kind}-${index}`} style={{ display: 'grid', gridTemplateColumns: kind === 'headers' ? 'auto minmax(90px, 1fr) minmax(120px, 2fr) auto auto' : 'auto minmax(90px, 1fr) minmax(120px, 2fr) auto', gap: 8, alignItems: 'center', minWidth: 0 }} className="wt-http-row">
        <Checkbox checked={row.enabled} disabled={readOnly} aria-label={t('http.enabled')} onChange={(event) => update({ [kind]: rows.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item) })} />
        <Input aria-label={t('http.key')} placeholder={t(kind === 'headers' ? 'http.headerName' : 'http.paramName')} value={row.key} disabled={readOnly} onChange={(event) => update({ [kind]: rows.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item) })} />
        <VariableAutocompleteInput aria-label={t('http.value')} placeholder={t('http.value')} value={row.value} variableNames={variableNames} disabled={readOnly} onValueChange={(value) => update({ [kind]: rows.map((item, itemIndex) => itemIndex === index ? { ...item, value } : item) })} />
        {kind === 'headers' && <Checkbox checked={'secret' in row && Boolean(row.secret)} disabled={readOnly} onChange={(event) => update({ headers: (config.headers ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, secret: event.target.checked } : item) })}>{t('http.secret')}</Checkbox>}
        <Button type="text" danger icon={<DeleteOutlined />} aria-label={t('http.removeRow')} disabled={readOnly} onClick={() => update({ [kind]: rows.filter((_, itemIndex) => itemIndex !== index) })} />
      </div>)}
      <Button type="dashed" icon={<PlusOutlined />} disabled={readOnly} onClick={() => update({ [kind]: [...rows, { key: '', value: '', enabled: true, ...(kind === 'headers' ? { secret: false } : {}) }] })}>{t(kind === 'headers' ? 'http.addHeader' : 'http.addParam')}</Button>
    </div>;
  };

  const assertionRows = config.assertions ?? [];
  const captureRows = config.capture ?? [];
  const body = config.body ?? { type: 'none' as const };

  return <div className="wt-http-request-editor" style={{ display: 'grid', gap: 12, minWidth: 0, flex: '1 1 100%' }}>
    <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr)', gap: 8, minWidth: 0 }} className="wt-http-request-line">
      <Select aria-label={t('http.method')} value={config.method} disabled={readOnly} options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((method) => ({ value: method, label: method }))} onChange={(method: HttpConfig['method']) => update({ method })} />
      <VariableAutocompleteInput aria-label={t('http.url')} placeholder={t('http.urlPlaceholder')} value={config.url} variableNames={variableNames} disabled={readOnly} onValueChange={(url) => update({ url })} />
    </div>
    <Space wrap>
      <Text type="secondary">{t('http.timeout')}</Text>
      <InputNumber min={100} max={120000} value={config.timeoutMs ?? 15000} disabled={readOnly} onChange={(timeoutMs) => timeoutMs && update({ timeoutMs })} />
      <Checkbox checked={config.followRedirects !== false} disabled={readOnly} onChange={(event) => update({ followRedirects: event.target.checked })}>{t('http.followRedirects')}</Checkbox>
      <Tag>{t('http.privateNetworkPolicy')}</Tag>
    </Space>
    <Tabs size="small" items={[
      { key: 'params', label: t('http.params'), children: renderRows('queryParams') },
      { key: 'headers', label: t('http.headers'), children: <div style={{ display: 'grid', gap: 10 }}>{renderRows('headers')}<div style={{ display: 'grid', gridTemplateColumns: '180px minmax(0, 1fr)', gap: 8 }} className="wt-http-row"><Select value={config.auth?.type ?? 'none'} disabled={readOnly} options={['none', 'bearer', 'basic', 'apiKey'].map((type) => ({ value: type, label: t(`http.auth.${type}`) }))} onChange={(type: NonNullable<HttpConfig['auth']>['type']) => update({ auth: type === 'bearer' ? { type, token: '' } : type === 'basic' ? { type, username: '', password: '' } : type === 'apiKey' ? { type, apiKeyName: 'X-API-Key', apiKeyValue: '', apiKeyLocation: 'header' } : { type: 'none' } })} />
        {config.auth?.type === 'bearer' && <VariableAutocompleteInput aria-label={t('http.token')} placeholder={t('http.token')} value={config.auth.token ?? ''} variableNames={variableNames} disabled={readOnly} onValueChange={(token) => update({ auth: { ...config.auth!, token } })} />}
        {config.auth?.type === 'basic' && <Space.Compact style={{ width: '100%' }}><VariableAutocompleteInput aria-label={t('http.username')} placeholder={t('http.username')} value={config.auth.username ?? ''} variableNames={variableNames} disabled={readOnly} onValueChange={(username) => update({ auth: { ...config.auth!, username } })} /><VariableAutocompleteInput aria-label={t('http.password')} placeholder={t('http.password')} value={config.auth.password ?? ''} variableNames={variableNames} disabled={readOnly} onValueChange={(password) => update({ auth: { ...config.auth!, password } })} /></Space.Compact>}
        {config.auth?.type === 'apiKey' && <Space.Compact style={{ width: '100%' }}><Input placeholder={t('http.headerName')} value={config.auth.apiKeyName ?? ''} disabled={readOnly} onChange={(event) => update({ auth: { ...config.auth!, apiKeyName: event.target.value } })} /><VariableAutocompleteInput aria-label={t('http.apiKey')} placeholder={t('http.apiKey')} value={config.auth.apiKeyValue ?? ''} variableNames={variableNames} disabled={readOnly} onValueChange={(apiKeyValue) => update({ auth: { ...config.auth!, apiKeyValue } })} /></Space.Compact>}
      </div></div> },
      { key: 'body', label: t('http.body'), children: <div style={{ display: 'grid', gap: 8, minWidth: 0 }}><Select value={body.type} disabled={readOnly} options={['none', 'json', 'text', 'form-urlencoded'].map((type) => ({ value: type, label: t(`http.bodyType.${type}`) }))} onChange={(type: NonNullable<HttpConfig['body']>['type']) => update({ body: { type, ...(type === 'json' ? { value: '{\n  \n}' } : {}) } })} />{body.type === 'form-urlencoded' ? <div style={{ display: 'grid', gap: 8 }}>{(body.fields ?? []).map((field, index) => <div key={index} className="wt-http-row" style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) minmax(0, 2fr) auto', gap: 8 }}><Checkbox checked={field.enabled} disabled={readOnly} onChange={(event) => update({ body: { ...body, fields: body.fields?.map((item, itemIndex) => index === itemIndex ? { ...item, enabled: event.target.checked } : item) } })} /><Input placeholder={t('http.key')} value={field.key} disabled={readOnly} onChange={(event) => update({ body: { ...body, fields: body.fields?.map((item, itemIndex) => index === itemIndex ? { ...item, key: event.target.value } : item) } })} /><VariableAutocompleteInput aria-label={t('http.value')} value={field.value} variableNames={variableNames} disabled={readOnly} onValueChange={(value) => update({ body: { ...body, fields: body.fields?.map((item, itemIndex) => index === itemIndex ? { ...item, value } : item) } })} /><Button type="text" danger icon={<DeleteOutlined />} aria-label={t('http.removeRow')} onClick={() => update({ body: { ...body, fields: body.fields?.filter((_, itemIndex) => itemIndex !== index) } })} /></div>)}<Button type="dashed" icon={<PlusOutlined />} disabled={readOnly} onClick={() => update({ body: { ...body, fields: [...(body.fields ?? []), { key: '', value: '', enabled: true }] } })}>{t('http.addField')}</Button></div> : body.type !== 'none' && <>{body.type === 'json' ? <CodeMirror value={body.value ?? ''} extensions={[json(), EditorView.lineWrapping]} editable={!readOnly} basicSetup={{ foldGutter: false, highlightActiveLine: false, autocompletion: false }} aria-label={t('http.body')} minHeight="120px" maxHeight="320px" style={{ fontSize: 13 }} onChange={(value) => update({ body: { ...body, value } })} /> : <Input.TextArea rows={6} value={body.value ?? ''} disabled={readOnly} onChange={(event) => update({ body: { ...body, value: event.target.value } })} />}{body.type === 'json' && <Text type={body.value?.trim() ? (() => { try { JSON.parse(body.value); return 'secondary'; } catch { return 'danger'; } })() : 'secondary'}>{body.value?.trim() ? (() => { try { JSON.parse(body.value); return t('http.validJson'); } catch { return t('http.invalidJson'); } })() : t('http.jsonHelp')}</Text>}</>}</div> },
      { key: 'assertions', label: t('http.assertions'), children: <div style={{ display: 'grid', gap: 8 }}>{assertionRows.map((assertion, index) => {
        const type = String(assertion.type ?? 'statusEquals');
        const needsTarget = type.startsWith('header') || type.startsWith('jsonPath');
        const expectedValue = assertion.expected;
        const updateAssertion = (patch: Record<string, unknown>) => update({ assertions: assertionRows.map((item, itemIndex) => index === itemIndex ? { ...item, ...patch } : item) });
        return <div key={index} className="wt-http-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) auto', gap: 8 }}>
        <Select value={type} disabled={readOnly} options={['statusEquals', 'statusIn', 'responseTimeLessThan', 'headerExists', 'headerEquals', 'headerContains', 'jsonPathExists', 'jsonPathEquals', 'jsonPathContains', 'jsonPathType', 'jsonArrayLength', 'textContains', 'textEquals'].map((item) => ({ value: item, label: t(`http.assertion.${item}`) }))} onChange={(nextType) => updateAssertion({ type: nextType, expected: nextType === 'statusEquals' ? 200 : nextType === 'statusIn' ? [200] : nextType === 'responseTimeLessThan' ? 1000 : nextType === 'jsonArrayLength' ? 0 : nextType === 'headerExists' || nextType === 'jsonPathExists' || nextType === 'jsonPathType' ? undefined : '', expectedType: nextType === 'jsonPathType' ? 'string' : undefined })} />
          {needsTarget && <Input aria-label={t('http.pathOrHeader')} value={String(assertion.name ?? assertion.path ?? '')} placeholder={t('http.pathOrHeader')} disabled={readOnly} onChange={(event) => updateAssertion(type.startsWith('header') ? { name: event.target.value } : { path: event.target.value })} />}
          {type === 'jsonPathType' ? <Select aria-label={t('http.expectedType')} value={assertion.expectedType as string | undefined} disabled={readOnly} placeholder={t('http.expectedType')} options={['string', 'number', 'boolean', 'object', 'array', 'null'].map((value) => ({ value, label: value }))} onChange={(expectedType) => updateAssertion({ expectedType })} /> : <Input aria-label={t('http.expected')} value={Array.isArray(expectedValue) ? expectedValue.join(',') : String(expectedValue ?? '')} placeholder={type === 'statusIn' ? t('http.statusList') : t('http.expected')} disabled={readOnly || type === 'headerExists' || type === 'jsonPathExists'} onChange={(event) => {
            let value: unknown = event.target.value;
            if (['statusEquals', 'responseTimeLessThan', 'jsonArrayLength'].includes(type)) value = event.target.value === '' ? undefined : Number(event.target.value);
            if (type === 'statusIn') value = event.target.value.split(',').map((item) => Number(item.trim())).filter(Number.isInteger);
            if (type === 'jsonPathEquals') {
              try { value = JSON.parse(event.target.value); } catch { /* Preserve a plain string or variable reference. */ }
            }
            updateAssertion({ expected: value });
          }} />}
          <Button type="text" danger icon={<DeleteOutlined />} aria-label={t('http.removeRow')} disabled={readOnly} onClick={() => update({ assertions: assertionRows.filter((_, itemIndex) => index !== itemIndex) })} />
        </div>;
      })}<Button type="dashed" icon={<PlusOutlined />} disabled={readOnly} onClick={() => update({ assertions: [...assertionRows, { type: 'statusEquals', expected: 200 }] })}>{t('http.addAssertion')}</Button></div> },
      { key: 'capture', label: t('http.capture'), children: <div style={{ display: 'grid', gap: 8 }}>{captureRows.map((capture, index) => <div key={index} className="wt-http-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, 1fr) minmax(100px, 1fr) minmax(120px, 1fr) auto auto', gap: 8 }}><Select value={capture.source} disabled={readOnly} options={['jsonPath', 'responseHeader', 'status', 'responseTime', 'textBody'].map((source) => ({ value: source, label: t(`http.captureSource.${source}`) }))} onChange={(source) => update({ capture: captureRows.map((item, itemIndex) => index === itemIndex ? { ...item, source: source as NonNullable<HttpConfig['capture']>[number]['source'] } : item) })} /><Input placeholder={t('http.pathOrHeader')} value={capture.path ?? capture.headerName ?? ''} disabled={readOnly || !['jsonPath', 'responseHeader'].includes(capture.source)} onChange={(event) => update({ capture: captureRows.map((item, itemIndex) => index === itemIndex ? { ...item, ...(capture.source === 'jsonPath' ? { path: event.target.value } : { headerName: event.target.value }) } : item) })} /><Input placeholder={t('http.variableName')} value={capture.saveAs} disabled={readOnly} onChange={(event) => update({ capture: captureRows.map((item, itemIndex) => index === itemIndex ? { ...item, saveAs: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') } : item) })} /><Checkbox checked={Boolean(capture.secret)} disabled={readOnly} onChange={(event) => update({ capture: captureRows.map((item, itemIndex) => index === itemIndex ? { ...item, secret: event.target.checked } : item) })}>{t('http.secret')}</Checkbox><Button type="text" danger icon={<DeleteOutlined />} aria-label={t('http.removeRow')} disabled={readOnly} onClick={() => update({ capture: captureRows.filter((_, itemIndex) => index !== itemIndex) })} /></div>)}<Button type="dashed" icon={<PlusOutlined />} disabled={readOnly} onClick={() => update({ capture: [...captureRows, { source: 'jsonPath', path: '$.id', saveAs: 'RESPONSE_VALUE', secret: false }] })}>{t('http.addCapture')}</Button></div> }
    ]} />
  </div>;
}
