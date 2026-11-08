import { lookup } from 'node:dns/promises';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import ipaddr from 'ipaddr.js';
import type { Step } from '../types/step';
import { VariableContext, type VariableValue } from '../utils/variable-context';

const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;
const BLOCKED_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'upgrade', 'expect']);
const SENSITIVE_HEADER = /authorization|cookie|token|secret|api[-_]?key|credential|password/i;

type HttpAssertion = NonNullable<NonNullable<Step['http']>['assertions']>[number];
type HttpCapture = NonNullable<NonNullable<Step['http']>['capture']>[number];

export type HttpExecutionSummary = {
  method: string;
  url: string;
  status: number;
  durationMs: number;
  responseBytes: number;
  requestHeaderNames: string[];
  responseHeaderNames: string[];
  assertions: Array<{ type: string; passed: boolean; message: string }>;
  captures: Array<{ variableName: string; type: string; secret: boolean }>;
};

export class HttpRequestError extends Error {
  constructor(message: string, readonly code: 'HTTP_SECURITY' | 'HTTP_TIMEOUT' | 'HTTP_NETWORK' | 'HTTP_ASSERTION' | 'HTTP_RESPONSE_TOO_LARGE' | 'HTTP_CONFIGURATION' = 'HTTP_NETWORK') {
    super(message);
    this.name = 'HttpRequestError';
  }
}

function addressRange(address: string) {
  if (!ipaddr.isValid(address)) return false;
  return ipaddr.parse(address).range();
}

async function resolveAllowedAddress(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new HttpRequestError('The request target resolves to a local network and is blocked.', 'HTTP_SECURITY');
  }
  const hardBlockedHosts = new Set(['169.254.169.254', '100.100.100.200', '168.63.129.16', 'metadata.google.internal']);
  if (hardBlockedHosts.has(host)) throw new HttpRequestError('Cloud metadata endpoints are blocked.', 'HTTP_SECURITY');
  const records = ipaddr.isValid(host)
    ? [{ address: host, family: ipaddr.parse(host).kind() === 'ipv4' ? 4 : 6 }]
    : await lookup(host, { all: true, verbatim: true }).catch(() => {
        throw new HttpRequestError('DNS lookup failed for the request host.', 'HTTP_NETWORK');
      });
  const trustedHosts = new Set((process.env.WRIGHTTEST_HTTP_ALLOWED_HOSTS ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean));
  const trustedPrivateHost = trustedHosts.has(host);
  const allowLoopbackInTests = process.env.NODE_ENV === 'test' && process.env.WRIGHTTEST_HTTP_TEST_ALLOW_LOOPBACK === '1';
  const hardBlockedRanges = new Set(['loopback', 'linkLocal', 'unspecified', 'broadcast', 'multicast', 'carrierGradeNat', 'reserved']);
  if (!records.length || records.some(({ address }) => {
    const range = addressRange(address);
    if (range === false || (hardBlockedRanges.has(range) && !(allowLoopbackInTests && range === 'loopback'))) return true;
    if (range === 'unicast') return false;
    return !((trustedPrivateHost && ['private', 'uniqueLocal'].includes(range)) || (allowLoopbackInTests && range === 'loopback'));
  })) {
    throw new HttpRequestError('The request target resolves to a private, local, or reserved address and is blocked.', 'HTTP_SECURITY');
  }
  return records[0];
}

function parseUrl(rawUrl: string) {
  if (rawUrl.length > 8_192) throw new HttpRequestError('Request URL exceeds the 8 KB limit.', 'HTTP_CONFIGURATION');
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new HttpRequestError('The resolved request URL is invalid.', 'HTTP_CONFIGURATION'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new HttpRequestError('Only HTTP/HTTPS URLs without embedded credentials are allowed.', 'HTTP_SECURITY');
  }
  url.hash = '';
  return url;
}

function safeUrl(url: URL, context: VariableContext) {
  const copy = new URL(url);
  for (const key of [...copy.searchParams.keys()]) copy.searchParams.set(key, '[redacted]');
  if (copy.pathname !== '/') copy.pathname = '/[redacted]';
  return context.redact(copy.toString());
}

function resolveJsonTemplates(value: unknown, context: VariableContext, stepIndex: number): unknown {
  if (typeof value === 'string') {
    const exact = value.match(/^\{\{([A-Z0-9_]+)\}\}$/);
    return exact ? context.resolveTyped(value, { stepIndex }) : context.interpolate(value, { stepIndex });
  }
  if (Array.isArray(value)) return value.map((item) => resolveJsonTemplates(item, context, stepIndex));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveJsonTemplates(item, context, stepIndex)]));
  }
  return value;
}

function parseJsonTemplate(raw: string, context: VariableContext, stepIndex: number): string {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new HttpRequestError('Request body is not valid JSON.', 'HTTP_CONFIGURATION'); }
  return JSON.stringify(resolveJsonTemplates(parsed, context, stepIndex));
}

function jsonPathValue(root: unknown, path: string): unknown {
  if (!/^\$(?:\.[A-Za-z_][A-Za-z\d_]*|\[(?:\d+|"[A-Za-z_][A-Za-z\d_]*"|'[A-Za-z_][A-Za-z\d_]*')\])*$/.test(path)) {
    throw new HttpRequestError('JSON path is invalid. Use simple paths such as $.user.id or $.items[0].', 'HTTP_CONFIGURATION');
  }
  const tokens = path.slice(1).match(/\.[A-Za-z_][A-Za-z\d_]*|\[(?:\d+|"[A-Za-z_][A-Za-z\d_]*"|'[A-Za-z_][A-Za-z\d_]*')\]/g) ?? [];
  let value = root;
  for (const token of tokens) {
    const key = token[0] === '.' ? token.slice(1) : token.slice(1, -1).replace(/^['"]|['"]$/g, '');
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function safeEqual(actual: unknown, expected: unknown) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function diagnosticType(value: unknown) {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array (${value.length} items)`;
  if (typeof value === 'string') return `string (${value.length} characters)`;
  if (typeof value === 'object') return 'object';
  return typeof value;
}

function diagnosticExpected(value: unknown, context: VariableContext) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return context.redact(raw).slice(0, 160);
}

function assertionFailureMessage(
  assertion: HttpAssertion,
  status: number,
  durationMs: number,
  headers: Record<string, string | string[] | undefined>,
  json: unknown,
  text: string,
  context: VariableContext
) {
  switch (assertion.type) {
    case 'statusEquals': return `Expected HTTP status ${assertion.expected}; received ${status}.`;
    case 'statusIn': return `Expected HTTP status in [${assertion.expected.join(', ')}]; received ${status}.`;
    case 'responseTimeLessThan': return `Expected response time below ${assertion.expected} ms; received ${durationMs} ms.`;
    case 'headerExists': return `Expected response header "${assertion.name}" to exist; it was missing.`;
    case 'headerEquals':
    case 'headerContains': {
      const present = Object.keys(headers).some((name) => name.toLowerCase() === assertion.name.toLowerCase());
      return present
        ? `Response header "${assertion.name}" did not match the expected ${assertion.type === 'headerEquals' ? 'value' : 'content'}.`
        : `Expected response header "${assertion.name}" to exist; it was missing.`;
    }
    case 'jsonPathExists': return `Expected JSON path ${assertion.path} to exist; the actual value was ${diagnosticType(jsonPathValue(json, assertion.path))}.`;
    case 'jsonPathEquals':
    case 'jsonPathContains': {
      const actual = jsonPathValue(json, assertion.path);
      const expected = context.resolveTyped(assertion.expected as VariableValue);
      return `JSON path ${assertion.path} did not match expected ${diagnosticExpected(expected, context)}; actual value was ${diagnosticType(actual)}.`;
    }
    case 'jsonPathType': return `JSON path ${assertion.path} expected type ${assertion.expectedType}; actual type was ${diagnosticType(jsonPathValue(json, assertion.path))}.`;
    case 'jsonArrayLength': {
      const actual = jsonPathValue(json, assertion.path);
      return `JSON path ${assertion.path} expected array length ${assertion.expected}; actual value was ${diagnosticType(actual)}.`;
    }
    case 'textContains':
    case 'textEquals': return `Response text did not satisfy ${assertion.type === 'textContains' ? 'contains' : 'equals'}; actual response length was ${text.length} characters.`;
  }
}

function valueType(value: unknown) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value === 'object' ? 'object' : typeof value;
}

function sanitizeHeaderEntries(items: NonNullable<NonNullable<Step['http']>['headers']>) {
  const headers: Record<string, string> = {};
  const names: string[] = [];
  for (const item of items) {
    if (!item.enabled) continue;
    const name = item.key.trim();
    if (!name || /[\r\n]/.test(name) || /[\r\n]/.test(item.value) || BLOCKED_HEADERS.has(name.toLowerCase())) {
      throw new HttpRequestError('A request header is invalid or not permitted.', 'HTTP_CONFIGURATION');
    }
    headers[name] = item.value;
    names.push(name);
  }
  return { headers, names };
}

async function sendOnce(url: URL, method: string, headers: Record<string, string>, body: string | undefined, deadline: number) {
  const address = await resolveAllowedAddress(url.hostname);
  const timeoutMs = deadline - Date.now();
  if (timeoutMs <= 0) throw new HttpRequestError('HTTP request timed out.', 'HTTP_TIMEOUT');
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const options: RequestOptions = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || undefined,
    path: `${url.pathname}${url.search}`,
    method,
    headers,
    timeout: timeoutMs,
    ...(ipaddr.isValid(url.hostname) ? {} : { servername: url.hostname }),
    lookup: ((_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
      callback(null, address.address, address.family);
    }) as RequestOptions['lookup']
  };
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer; bytes: number; location?: string }>((resolve, reject) => {
    const req = transport(url, options, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer | string) => {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += data.length;
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy(new HttpRequestError('Response exceeded the 1 MB limit.', 'HTTP_RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(data);
      });
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks),
        bytes: size,
        ...(typeof res.headers.location === 'string' ? { location: res.headers.location } : {})
      }));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new HttpRequestError('HTTP request timed out.', 'HTTP_TIMEOUT')));
    req.on('error', (error) => reject(error instanceof HttpRequestError ? error : new HttpRequestError('HTTP connection failed.', 'HTTP_NETWORK')));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function sendWithRedirects(url: URL, method: string, headers: Record<string, string>, body: string | undefined, timeoutMs: number, follow: boolean) {
  const deadline = Date.now() + timeoutMs;
  let current = url;
  let currentMethod = method;
  let currentBody = body;
  let currentHeaders = { ...headers };
  for (let redirects = 0; ; redirects += 1) {
    const response = await sendOnce(current, currentMethod, currentHeaders, currentBody, deadline);
    if (!follow || !response.location || ![301, 302, 303, 307, 308].includes(response.status)) return { response, finalUrl: current };
    if (redirects >= MAX_REDIRECTS) throw new HttpRequestError('The redirect limit was exceeded.', 'HTTP_SECURITY');
    const next = parseUrl(new URL(response.location, current).toString());
    await resolveAllowedAddress(next.hostname);
    if (next.origin !== current.origin) {
      if (currentBody !== undefined) throw new HttpRequestError('Cross-origin redirects are not followed for requests with a body.', 'HTTP_SECURITY');
      currentHeaders = Object.fromEntries(Object.entries(currentHeaders).filter(([name]) => ['accept', 'content-type', 'user-agent'].includes(name.toLowerCase())));
    }
    if ([301, 302, 303].includes(response.status) && currentMethod !== 'GET' && currentMethod !== 'HEAD') {
      currentMethod = 'GET'; currentBody = undefined;
      delete currentHeaders['content-type']; delete currentHeaders['Content-Type'];
    }
    current = next;
  }
}

function buildBody(http: NonNullable<Step['http']>, context: VariableContext, stepIndex: number) {
  const body = http.body ?? { type: 'none' as const };
  if (body.type === 'none') return undefined;
  if (body.type === 'json') return parseJsonTemplate(body.value ?? '{}', context, stepIndex);
  if (body.type === 'text') return context.interpolate(body.value ?? '', { stepIndex });
  const params = new URLSearchParams();
  for (const field of body.fields ?? []) if (field.enabled) params.append(context.interpolate(field.key, { stepIndex }), context.interpolate(field.value, { stepIndex }));
  return params.toString();
}

function buildAssertions(assertions: HttpAssertion[], status: number, durationMs: number, headers: Record<string, string | string[] | undefined>, json: unknown, text: string, context: VariableContext) {
  return assertions.map((assertion) => {
    let passed = false;
    switch (assertion.type) {
      case 'statusEquals': passed = status === assertion.expected; break;
      case 'statusIn': passed = assertion.expected.includes(status); break;
      case 'responseTimeLessThan': passed = durationMs < assertion.expected; break;
      case 'headerExists': passed = Object.keys(headers).some((key) => key.toLowerCase() === assertion.name.toLowerCase()); break;
      case 'headerEquals': {
        const key = Object.keys(headers).find((name) => name.toLowerCase() === assertion.name.toLowerCase());
        passed = key !== undefined && String(headers[key]) === context.interpolate(assertion.expected ?? ''); break;
      }
      case 'headerContains': {
        const key = Object.keys(headers).find((name) => name.toLowerCase() === assertion.name.toLowerCase());
        passed = key !== undefined && String(headers[key]).includes(context.interpolate(assertion.expected ?? '')); break;
      }
      case 'jsonPathExists': passed = jsonPathValue(json, assertion.path) !== undefined; break;
      case 'jsonPathEquals': passed = safeEqual(jsonPathValue(json, assertion.path), context.resolveTyped(assertion.expected as VariableValue)); break;
      case 'jsonPathContains': {
        const actual = jsonPathValue(json, assertion.path);
        const expected = typeof assertion.expected === 'string'
          ? context.interpolate(assertion.expected)
          : context.resolveTyped(assertion.expected as VariableValue);
        passed = typeof actual === 'string' ? actual.includes(String(expected)) : Array.isArray(actual) && actual.some((item) => safeEqual(item, expected)); break;
      }
      case 'jsonPathType': passed = valueType(jsonPathValue(json, assertion.path)) === assertion.expectedType; break;
      case 'jsonArrayLength': {
        const actual = jsonPathValue(json, assertion.path);
        passed = Array.isArray(actual) && actual.length === Number(assertion.expected); break;
      }
      case 'textContains': passed = text.includes(context.interpolate(assertion.expected)); break;
      case 'textEquals': passed = text === context.interpolate(assertion.expected); break;
    }
    return {
      type: assertion.type,
      passed,
      message: passed ? 'Assertion passed.' : context.redact(assertionFailureMessage(assertion, status, durationMs, headers, json, text, context))
    };
  });
}

function captureValue(capture: HttpCapture, status: number, durationMs: number, headers: Record<string, string | string[] | undefined>, json: unknown, text: string) {
  switch (capture.source) {
    case 'status': return status;
    case 'responseTime': return durationMs;
    case 'textBody': return text;
    case 'responseHeader': {
      const key = Object.keys(headers).find((name) => name.toLowerCase() === capture.headerName?.toLowerCase());
      if (!key) throw new HttpRequestError(`Response header "${capture.headerName}" was not present.`, 'HTTP_CONFIGURATION');
      return String(headers[key]);
    }
    case 'jsonPath': {
      const value = jsonPathValue(json, capture.path ?? '');
      if (value === undefined) throw new HttpRequestError(`Response JSON did not contain capture path ${capture.path}.`, 'HTTP_CONFIGURATION');
      return value;
    }
  }
}

export async function executeHttpRequest(step: Step, context: VariableContext, stepIndex: number) {
  const config = step.http;
  if (!config) throw new HttpRequestError('HTTP request configuration is required.', 'HTTP_CONFIGURATION');
  let url = parseUrl(context.interpolate(config.url, { stepIndex }));
  for (const param of config.queryParams ?? []) if (param.enabled) url.searchParams.append(context.interpolate(param.key, { stepIndex }), context.interpolate(param.value, { stepIndex }));
  const { headers, names } = sanitizeHeaderEntries(config.headers ?? []);
  for (const name of names) headers[name] = context.interpolate(headers[name], { stepIndex });
  const auth = config.auth ?? { type: 'none' as const };
  if (auth.type === 'bearer') headers.Authorization = `Bearer ${context.interpolate(auth.token ?? '', { stepIndex })}`;
  if (auth.type === 'basic') headers.Authorization = `Basic ${Buffer.from(`${context.interpolate(auth.username ?? '', { stepIndex })}:${context.interpolate(auth.password ?? '', { stepIndex })}`).toString('base64')}`;
  if (auth.type === 'apiKey') {
    const name = auth.apiKeyName ?? '';
    if (!name || BLOCKED_HEADERS.has(name.toLowerCase()) || /[\r\n]/.test(name)) throw new HttpRequestError('API key header name is not permitted.', 'HTTP_CONFIGURATION');
    headers[name] = context.interpolate(auth.apiKeyValue ?? '', { stepIndex });
    names.push(name);
  }
  const body = buildBody(config, context, stepIndex);
  if (body && Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new HttpRequestError('Request body exceeded the 512 KB limit.', 'HTTP_CONFIGURATION');
  if (body && !Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = config.body?.type === 'json' ? 'application/json' : config.body?.type === 'form-urlencoded' ? 'application/x-www-form-urlencoded' : 'text/plain; charset=utf-8';
  }
  const headerBytes = Object.entries(headers).reduce((total, [name, value]) => total + Buffer.byteLength(name) + Buffer.byteLength(value) + 4, 0);
  if (headerBytes > 32 * 1024) throw new HttpRequestError('Request headers exceeded the 32 KB limit.', 'HTTP_CONFIGURATION');
  if (Buffer.byteLength(url.toString()) > 8_192) throw new HttpRequestError('Request URL exceeds the 8 KB limit.', 'HTTP_CONFIGURATION');
  const started = Date.now();
  const { response, finalUrl } = await sendWithRedirects(url, config.method, headers, body, config.timeoutMs ?? 15_000, config.followRedirects !== false);
  const durationMs = Date.now() - started;
  const text = response.body.toString('utf8');
  const contentType = String(response.headers['content-type'] ?? '');
  let json: unknown;
  if (/json/i.test(contentType) && text) {
    try { json = JSON.parse(text); } catch { throw new HttpRequestError('The server returned an invalid JSON response.', 'HTTP_NETWORK'); }
  }
  const assertions = buildAssertions(config.assertions ?? [], response.status, durationMs, response.headers, json, text, context);
  const captures: HttpExecutionSummary['captures'] = [];
  for (const capture of config.capture ?? []) {
    context.assertRuntimeWritable(capture.saveAs, capture.replace, stepIndex);
    const value = captureValue(capture, response.status, durationMs, response.headers, json, text);
    if (typeof value === 'string' && value.length > VariableContext.valueLimit) throw new HttpRequestError('Captured value exceeded the runtime variable size limit.', 'HTTP_CONFIGURATION');
    const sourceHeader = capture.source === 'responseHeader' && SENSITIVE_HEADER.test(capture.headerName ?? '');
    const secretPath = capture.source === 'jsonPath' && SENSITIVE_HEADER.test((capture.path ?? '').split(/[.\[\]]/).filter(Boolean).at(-1) ?? '');
    const unknownTextCapture = capture.source === 'textBody';
    const secret = Boolean(capture.secret || sourceHeader || secretPath || unknownTextCapture || step.secret || auth.type !== 'none' || SENSITIVE_HEADER.test(capture.saveAs));
    context.setRuntime(capture.saveAs, value, { source: 'captured', secret, createdByStep: stepIndex + 1, replace: capture.replace });
    const entry = context.resolve(capture.saveAs)!;
    captures.push({ variableName: capture.saveAs, type: entry.type, secret: entry.secret });
  }
  const summary: HttpExecutionSummary = {
    method: config.method,
    url: safeUrl(finalUrl, context),
    status: response.status,
    durationMs,
    responseBytes: response.bytes,
    requestHeaderNames: names,
    responseHeaderNames: Object.keys(response.headers),
    assertions,
    captures
  };
  const failed = assertions.some((assertion) => !assertion.passed);
  return { summary, failed, error: failed ? context.redact(assertions.find((assertion) => !assertion.passed)!.message) : undefined };
}
