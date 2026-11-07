import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { Client as PgClient, type QueryResult } from 'pg';
import mysql, { type Connection as MysqlConnection } from 'mysql2/promise';
import { Parser } from 'node-sql-parser';
import type { DatabaseConnection } from '@prisma/client';
import type { Step } from '../types/step';

const parser = new Parser();
const CONNECT_TIMEOUT_MS = 5_000;
const QUERY_TIMEOUT_MS = 5_000;
const MAX_RESULT_ROWS = 100;
const MAX_CAPTURE_ROWS = 10;
const MAX_CAPTURE_VALUE_LENGTH = 500;
const SECRET_COLUMN = /(pass(word)?|secret|token|api[_-]?key|authorization|cookie|credential|ssn|card|cvv)/i;

type DbConnection = Pick<DatabaseConnection,
  'id' | 'projectId' | 'name' | 'provider' | 'host' | 'port' | 'database' | 'username' | 'encryptedCredentials' | 'ssl' | 'accessMode'>;

type SqlRows = Record<string, unknown>[];
export type SqlExecutionSummary = {
  connectionName: string;
  rowCount: number;
  affectedRows: number;
  rowLimitReached: boolean;
  columns: string[];
  rows?: Record<string, string | number | boolean | null>[];
  assertion?: { type: NonNullable<Step['assertion']>['type']; passed: boolean };
};

function encryptionKey() {
  const value = process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY;
  if (!value || !/^[a-f\d]{64}$/i.test(value)) {
    throw new Error('Database credential encryption is not configured on this server.');
  }
  return Buffer.from(value, 'hex');
}

export function encryptDatabasePassword(password: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

function decryptDatabasePassword(value: string) {
  try {
    const [iv, authTag, encrypted] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Stored database credentials cannot be decrypted. Check the server encryption key.');
  }
}

function safeHostAddress(address: string) {
  if (!ipaddr.isValid(address)) return false;
  return ipaddr.parse(address).range() === 'unicast';
}

async function resolvePublicAddress(host: string) {
  const normalized = host.trim().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!normalized || normalized.toLowerCase() === 'localhost' || normalized.toLowerCase().endsWith('.localhost') || normalized.toLowerCase().endsWith('.local')) {
    throw new Error('This host is not allowed. Use a publicly reachable database hostname or IP address.');
  }

  let addresses: Array<{ address: string; family: number }>;
  if (ipaddr.isValid(normalized)) {
    addresses = [{ address: normalized, family: ipaddr.parse(normalized).kind() === 'ipv4' ? 4 : 6 }];
  } else {
    try {
      addresses = await lookup(normalized, { all: true, verbatim: true });
    } catch {
      throw new Error('DNS lookup failed for the database host.');
    }
  }

  const allowPrivateForIsolatedTest = process.env.NODE_ENV === 'test' && process.env.WRIGHTTEST_DATABASE_TEST_MODE === '1';
  if (!addresses.length || (!allowPrivateForIsolatedTest && addresses.some(({ address }) => !safeHostAddress(address)))) {
    throw new Error('The database host resolves to a private, local, or reserved network address and is blocked.');
  }
  return { address: addresses[0].address, family: addresses[0].family, servername: ipaddr.isValid(normalized) ? undefined : normalized };
}

function friendlyDatabaseError(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new Error('DNS lookup failed for the database host.');
  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ECONNRESET') return new Error('Connection timed out or the database is unavailable.');
  if (code.startsWith('28') || code === 'ER_ACCESS_DENIED_ERROR' || /password authentication failed|access denied/.test(message)) return new Error('Database authentication failed. Check the username and password.');
  if (/ssl|certificate|tls/.test(message) || code.startsWith('CERT_')) return new Error('TLS/SSL connection failed. Check the database TLS configuration.');
  if (/timeout|timed out/.test(message)) return new Error('The database operation timed out.');
  if (code === '25006' || code === 'ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION') return new Error('The database rejected a write because this connection is read-only.');
  if (code === '42501' || code === 'ER_TABLEACCESS_DENIED_ERROR') return new Error('The configured database user does not have permission for this operation.');
  if (code === '42601' || code === 'ER_PARSE_ERROR') return new Error('SQL syntax is invalid for this database.');
  if (code === '42P01' || code === 'ER_NO_SUCH_TABLE') return new Error('The query references a table that does not exist or is not accessible.');
  return new Error('Database operation failed. Check database availability and permissions.');
}

export async function openDatabaseConnection(connection: DbConnection) {
  const resolved = await resolvePublicAddress(connection.host);
  const password = decryptDatabasePassword(connection.encryptedCredentials);
  const provider = connection.provider === 'MYSQL' ? 'MYSQL' : 'POSTGRESQL';

  if (provider === 'POSTGRESQL') {
    const client = new PgClient({
      host: resolved.address,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      statement_timeout: QUERY_TIMEOUT_MS,
      query_timeout: QUERY_TIMEOUT_MS,
      ssl: connection.ssl ? { rejectUnauthorized: true, ...(resolved.servername ? { servername: resolved.servername } : {}) } : undefined,
      application_name: 'wrighttest-check-runner'
    });
    client.on('error', () => undefined);
    try {
      await client.connect();
      return {
        provider,
        client,
        async close() { await client.end().catch(() => undefined); }
      };
    } catch (error) {
      await client.end().catch(() => undefined);
      throw friendlyDatabaseError(error);
    }
  }

  try {
    const client = await mysql.createConnection({
      host: resolved.address,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password,
      connectTimeout: CONNECT_TIMEOUT_MS,
      ssl: connection.ssl ? { rejectUnauthorized: true, ...(resolved.servername ? { servername: resolved.servername } : {}) } : undefined,
      multipleStatements: false,
      enableKeepAlive: true
    });
    return {
      provider,
      client,
      async close() { await client.end().catch(() => undefined); }
    };
  } catch (error) {
    throw friendlyDatabaseError(error);
  }
}

export async function testDatabaseConnection(connection: DbConnection) {
  const session = await openDatabaseConnection(connection);
  try {
    if (session.provider === 'POSTGRESQL') {
      await (session.client as PgClient).query('SELECT 1');
    } else {
      await executeMysqlWithTimeout(session.client as MysqlConnection, 'SELECT 1', []);
    }
  } catch (error) {
    throw friendlyDatabaseError(error);
  } finally {
    await session.close();
  }
}

type SqlParameterValue = string | number | boolean | null;

async function executeMysqlWithTimeout(client: MysqlConnection, sql: string, values: SqlParameterValue[]) {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    return await Promise.race([
      client.execute(sql, values),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          client.destroy();
          reject(new Error('The database operation timed out.'));
        }, QUERY_TIMEOUT_MS);
      })
    ]);
  } catch (error) {
    if (timedOut || Date.now() - startedAt >= QUERY_TIMEOUT_MS - 100) {
      throw new Error('The database operation timed out.');
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type NamedParameters = { sql: string; values: SqlParameterValue[] };

export function bindNamedParameters(sql: string, parameters: Record<string, SqlParameterValue>, provider: 'POSTGRESQL' | 'MYSQL'): NamedParameters {
  const values: SqlParameterValue[] = [];
  let output = '';
  let i = 0;
  let state: 'normal' | 'single' | 'double' | 'backtick' | 'line' | 'block' | 'dollar' = 'normal';
  let dollarTag = '';

  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];
    if (state === 'normal') {
      if (char === "'") state = 'single';
      else if (char === '"') state = 'double';
      else if (char === '`') state = 'backtick';
      else if (provider === 'MYSQL' && char === '#') state = 'line';
      else if (char === '-' && next === '-') state = 'line';
      else if (char === '/' && next === '*') state = 'block';
      else if (provider === 'POSTGRESQL' && char === '$') {
        const match = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z\d_]*\$|^\$\$/);
        if (match) { dollarTag = match[0]; state = 'dollar'; output += dollarTag; i += dollarTag.length; continue; }
      } else if (char === ':' && next !== ':' && sql[i - 1] !== ':' && /[A-Za-z_]/.test(next ?? '')) {
        let end = i + 2;
        while (/[A-Za-z\d_]/.test(sql[end] ?? '')) end += 1;
        const name = sql.slice(i + 1, end);
        if (!(name in parameters)) throw new Error(`SQL parameter ":${name}" has no value.`);
        values.push(parameters[name]);
        output += provider === 'POSTGRESQL' ? `$${values.length}` : '?';
        i = end;
        continue;
      }
    } else if (state === 'single' && char === "'" && next === "'") { output += "''"; i += 2; continue; }
    else if (state === 'double' && char === '"' && next === '"') { output += '""'; i += 2; continue; }
    else if (state === 'backtick' && char === '`' && next === '`') { output += '``'; i += 2; continue; }
    else if (state === 'line' && char === '\n') state = 'normal';
    else if (state === 'block' && char === '*' && next === '/') { output += '*/'; i += 2; state = 'normal'; continue; }
    else if (state === 'dollar' && sql.startsWith(dollarTag, i)) { output += dollarTag; i += dollarTag.length; state = 'normal'; continue; }
    else if ((state === 'single' || state === 'double' || state === 'backtick') && char === '\\' && next !== undefined) { output += char + next; i += 2; continue; }
    else if (state === 'single' && char === "'") state = 'normal';
    else if (state === 'double' && char === '"') state = 'normal';
    else if (state === 'backtick' && char === '`') state = 'normal';
    output += char;
    i += 1;
  }
  return { sql: output, values };
}

export function validateSqlStatement(sql: string, provider: 'POSTGRESQL' | 'MYSQL', accessMode: 'READ_ONLY' | 'READ_WRITE') {
  if (provider === 'MYSQL' && /\/\*\s*[!+]|\/\*\s*M!/i.test(sql)) {
    throw new Error('MySQL executable comments and optimizer hints are not supported in database steps.');
  }
  let parsed: unknown;
  try {
    parsed = parser.astify(sql, { database: provider === 'MYSQL' ? 'MySQL' : 'Postgresql' });
  } catch {
    throw new Error('SQL syntax is invalid or not supported.');
  }
  const statements = Array.isArray(parsed) ? parsed : [parsed];
  if (statements.length !== 1 || !statements[0] || typeof statements[0] !== 'object') {
    throw new Error('Only one SQL statement is allowed per step.');
  }

  const ast = statements[0] as Record<string, unknown>;
  const type = String(ast.type ?? '').toLowerCase();
  const hasIntoClause = Boolean(ast.into && typeof ast.into === 'object' && (ast.into as Record<string, unknown>).position);
  if (ast.with || hasIntoClause || ast.returning || ast.locking_read) {
    throw new Error('CTEs, SELECT INTO, RETURNING, and locking reads are not supported by database steps.');
  }
  if (accessMode === 'READ_ONLY') {
    if (type !== 'select') throw new Error('This connection is read-only. Only SELECT statements are allowed.');
  } else if (!['select', 'insert', 'update', 'delete'].includes(type)) {
    throw new Error('Only SELECT, INSERT, UPDATE, and DELETE statements are allowed.');
  }
  return type;
}

function maskCapturedRows(rows: SqlRows) {
  return rows.slice(0, MAX_CAPTURE_ROWS).map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (SECRET_COLUMN.test(key)) return [key, '[REDACTED]'];
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
        const safeValue = typeof value === 'string' && value.length > MAX_CAPTURE_VALUE_LENGTH ? `${value.slice(0, MAX_CAPTURE_VALUE_LENGTH)}…` : value;
        return [key, safeValue as string | number | boolean | null];
      }
      return [key, String(value).slice(0, MAX_CAPTURE_VALUE_LENGTH)];
    })
  ));
}

export function evaluateDatabaseAssertion(step: Step, rows: SqlRows, affectedRows: number, rowLimitReached: boolean) {
  const assertion = step.assertion;
  if (!assertion) return true;
  const rowCount = rows.length;
  const expectedNumber = Number(assertion.expected);
  switch (assertion.type) {
    case 'rowCountEquals': return !rowLimitReached && rowCount === expectedNumber;
    case 'rowCountGreaterThan': return rowLimitReached ? expectedNumber < MAX_RESULT_ROWS : rowCount > expectedNumber;
    case 'empty': return rowCount === 0;
    case 'notEmpty': return rowCount > 0;
    case 'affectedRowsEquals': return affectedRows === expectedNumber;
    case 'columnNotNull': return rows[assertion.rowIndex ?? 0]?.[assertion.column ?? ''] != null;
    case 'columnEquals': return String(rows[assertion.rowIndex ?? 0]?.[assertion.column ?? ''] ?? '') === (assertion.expected ?? '');
    case 'columnContains': return String(rows[assertion.rowIndex ?? 0]?.[assertion.column ?? ''] ?? '').includes(assertion.expected ?? '');
  }
}

export type SqlSession = Awaited<ReturnType<typeof openDatabaseConnection>>;

export async function executeDatabaseStep(session: SqlSession, connectionName: string, connectionAccessMode: 'READ_ONLY' | 'READ_WRITE', step: Step, variables: Record<string, string>): Promise<{ summary: SqlExecutionSummary; savedValue?: string }> {
  const provider = session.provider as 'POSTGRESQL' | 'MYSQL';
  const statementType = validateSqlStatement(step.sql ?? '', provider, connectionAccessMode);
  if (step.waitForResult && statementType !== 'select') throw new Error('Wait for Result can only be used with SELECT statements.');

  const params = Object.fromEntries(Object.entries(step.parameters ?? {}).map(([key, value]) => [key,
    typeof value === 'string'
      ? value.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (match, name: string) => variables[name] ?? match)
      : value
  ]));
  const resolvedStep: Step = {
    ...step,
    assertion: step.assertion ? {
      ...step.assertion,
      ...(step.assertion.expected ? {
        expected: step.assertion.expected.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (match, name: string) => variables[name] ?? match)
      } : {})
    } : undefined
  };
  if (resolvedStep.assertion?.expected && /\{\{[A-Z][A-Z0-9_]*\}\}/.test(resolvedStep.assertion.expected)) {
    throw new Error('The database assertion contains an unresolved WrightTest variable.');
  }
  for (const value of Object.values(params)) {
    if (typeof value === 'string' && /\{\{[A-Z][A-Z0-9_]*\}\}/.test(value)) throw new Error('An SQL parameter contains an unresolved WrightTest variable.');
  }
  const bound = bindNamedParameters(step.sql ?? '', params, provider);
  const waitOptions = step.waitForResult;
  const deadline = Date.now() + (waitOptions?.timeoutMs ?? 0);
  let rows: SqlRows = [];
  let affectedRows = 0;
  let rowLimitReached = false;
  let fields: string[] = [];
  const transactionReadOnly = connectionAccessMode === 'READ_ONLY' || statementType === 'select';

  do {
    try {
      if (provider === 'POSTGRESQL') {
        const client = session.client as PgClient;
        await client.query(transactionReadOnly ? 'BEGIN READ ONLY' : 'BEGIN');
        try {
          const querySql = statementType === 'select' ? `SELECT * FROM (${bound.sql}) AS "__wrighttest_result" LIMIT ${MAX_RESULT_ROWS + 1}` : bound.sql;
          const result = await client.query(querySql, bound.values) as QueryResult<Record<string, unknown>>;
          rows = result.rows as SqlRows;
          affectedRows = result.rowCount ?? 0;
          fields = result.fields.map((field) => field.name);
          rowLimitReached = statementType === 'select' && rows.length > MAX_RESULT_ROWS;
          rows = rows.slice(0, MAX_RESULT_ROWS);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        }
      } else {
        const client = session.client as MysqlConnection;
        await client.query(transactionReadOnly ? 'SET TRANSACTION READ ONLY' : 'SET TRANSACTION READ WRITE');
        await client.beginTransaction();
        try {
          const querySql = statementType === 'select' ? `SELECT * FROM (${bound.sql}) AS __wrighttest_result LIMIT ${MAX_RESULT_ROWS + 1}` : bound.sql;
          const [result] = await executeMysqlWithTimeout(client, querySql, bound.values);
          if (Array.isArray(result)) {
            rows = result as SqlRows;
            fields = Object.keys(rows[0] ?? {});
            affectedRows = rows.length;
            rowLimitReached = statementType === 'select' && rows.length > MAX_RESULT_ROWS;
            rows = rows.slice(0, MAX_RESULT_ROWS);
          } else {
            const header = result as { affectedRows?: number };
            affectedRows = header.affectedRows ?? 0;
            rows = [];
            fields = [];
          }
          await client.commit();
        } catch (error) {
          try {
            await client.rollback();
          } catch {
            // Preserve the original query error when timeout already destroyed the connection.
          }
          throw error;
        }
      }
    } catch (error) {
      throw friendlyDatabaseError(error);
    }

    if (!waitOptions || evaluateDatabaseAssertion(resolvedStep, rows, affectedRows, rowLimitReached) || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(waitOptions.pollIntervalMs, Math.max(0, deadline - Date.now()))));
  } while (Date.now() < deadline);

  const assertionPassed = evaluateDatabaseAssertion(resolvedStep, rows, affectedRows, rowLimitReached);
  const summary: SqlExecutionSummary = {
    connectionName,
    rowCount: rows.length,
    affectedRows,
    rowLimitReached,
    columns: fields.slice(0, 50),
    ...(step.captureRows ? { rows: maskCapturedRows(rows) } : {}),
    ...(resolvedStep.assertion ? { assertion: { type: resolvedStep.assertion.type, passed: assertionPassed } } : {})
  };

  if (!assertionPassed) throw Object.assign(new Error('Database result assertion failed.'), { databaseSummary: summary });
  let savedValue: string | undefined;
  if (step.saveResultAs) {
    const row = rows[step.saveRowIndex ?? 0];
    const column = step.saveColumn?.trim() || (row ? Object.keys(row)[0] : undefined);
    const value = column ? row?.[column] : undefined;
    if (value === undefined || value === null) throw new Error(`Cannot save SQL result: row ${step.saveRowIndex ?? 0} or result column is missing.`);
    savedValue = String(value);
  }
  return { summary, savedValue };
}

export function publicDatabaseConnection(connection: DatabaseConnection) {
  const { encryptedCredentials: _secret, ...publicFields } = connection;
  return publicFields;
}
