import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { executeHttpRequest, HttpRequestError } from '../src/services/http-request';
import { VariableContext } from '../src/utils/variable-context';
import type { Step } from '../src/types/step';
import { StepSchema } from '../src/schemas/test.schema';
import { bindNamedParameters } from '../src/services/database-connections';

async function withServer(handler: Parameters<typeof createServer>[0], run: (url: string) => Promise<void>) {
  const server: Server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test('HTTP request resolves typed JSON variables, captures values and evaluates assertions', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  process.env.WRIGHTTEST_HTTP_TEST_ALLOW_LOOPBACK = '1';
  try {
    await withServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
        assert.equal(body.enabled, true);
        assert.equal(body.id, 42);
        response.writeHead(201, { 'content-type': 'application/json', 'x-resource-id': '42' });
        response.end(JSON.stringify({ id: 42, enabled: true, user: { name: 'Ada' } }));
      });
    }, async (baseUrl) => {
      const step: Step = {
        action: 'httpRequest',
        http: {
          method: 'POST', url: `${baseUrl}/users?token={{API_TOKEN}}`,
          auth: { type: 'bearer', token: '{{API_TOKEN}}' },
          body: { type: 'json', value: '{"id":"{{USER_ID}}","enabled":"{{IS_ACTIVE}}"}' },
          assertions: [
            { type: 'statusEquals', expected: 201 },
            { type: 'jsonPathEquals', path: '$.enabled', expected: true },
            { type: 'headerExists', name: 'x-resource-id' }
          ],
          capture: [{ source: 'jsonPath', path: '$.id', saveAs: 'USER_ID_OUT' }]
        }
      };
      const context = new VariableContext({ runInputs: { USER_ID: 42, IS_ACTIVE: true, API_TOKEN: 'do-not-leak' }, secretNames: ['API_TOKEN'] });
      const result = await executeHttpRequest(step, context, 0);
      assert.equal(result.failed, false);
      assert.equal(result.summary.status, 201);
      assert.equal(result.summary.assertions.length, 3);
      assert.equal(context.resolve('USER_ID_OUT')?.value, 42);
      assert.equal(context.resolve('USER_ID_OUT')?.secret, true);
      assert.deepEqual(bindNamedParameters('SELECT id FROM users WHERE id = :userId', {
        userId: context.resolveSqlParameter('{{USER_ID_OUT}}')
      }, 'POSTGRESQL'), {
        sql: 'SELECT id FROM users WHERE id = $1', values: [42]
      });
      assert.ok(!JSON.stringify(result.summary).includes('do-not-leak'));
      assert.ok(!result.summary.url.includes('API_TOKEN'));
      assert.equal(new URL(result.summary.url).searchParams.get('token'), '[redacted]');
    });
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
    delete process.env.WRIGHTTEST_HTTP_TEST_ALLOW_LOOPBACK;
  }
});

test('failed HTTP assertions include safe expected and actual diagnostics without response secrets', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  process.env.WRIGHTTEST_HTTP_TEST_ALLOW_LOOPBACK = '1';
  try {
    await withServer((_request, response) => {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ token: 'response-secret' }));
    }, async (url) => {
      const result = await executeHttpRequest({
        action: 'httpRequest',
        http: { method: 'GET', url, assertions: [{ type: 'statusEquals', expected: 200 }, { type: 'jsonPathEquals', path: '$.token', expected: '{{API_TOKEN}}' }] }
      }, new VariableContext({ runInputs: { API_TOKEN: 'request-secret' }, secretNames: ['API_TOKEN'] }), 0);
      assert.equal(result.failed, true);
      assert.match(result.summary.assertions[0].message, /Expected HTTP status 200; received 404/);
      assert.match(result.summary.assertions[1].message, /actual value was string/);
      assert.ok(!JSON.stringify(result.summary).includes('response-secret'));
      assert.ok(!JSON.stringify(result.summary).includes('request-secret'));
    });
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
    delete process.env.WRIGHTTEST_HTTP_TEST_ALLOW_LOOPBACK;
  }
});

test('HTTP redirects are revalidated and private targets are blocked by default', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  delete process.env.WRIGHTTEST_HTTP_TEST_ALLOW_LOOPBACK;
  try {
    const step: Step = { action: 'httpRequest', http: { method: 'GET', url: 'http://127.0.0.1:12345/' } };
    await assert.rejects(() => executeHttpRequest(step, new VariableContext(), 0), (error: unknown) => error instanceof HttpRequestError && error.code === 'HTTP_SECURITY');
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('HTTP request fails before network activity when a variable is missing', async () => {
  const step: Step = { action: 'httpRequest', http: { method: 'GET', url: 'https://example.com/{{MISSING}}' } };
  await assert.rejects(() => executeHttpRequest(step, new VariableContext(), 0), /Variable "MISSING" is not available/);
});

test('HTTP step schema refuses literal credentials and accepts variable references', () => {
  const base = { action: 'httpRequest', http: { method: 'POST', url: 'https://api.example.test/users', auth: { type: 'bearer', token: '{{API_TOKEN}}' }, body: { type: 'json', value: '{"password":"{{PASSWORD}}"}' } } };
  assert.equal(StepSchema.safeParse(base).success, true);
  const rawCredential = structuredClone(base);
  rawCredential.http.auth.token = 'literal-secret-token';
  assert.equal(StepSchema.safeParse(rawCredential).success, false);
  const rawBodySecret = structuredClone(base);
  rawBodySecret.http.body.value = '{"password":"literal-password"}';
  assert.equal(StepSchema.safeParse(rawBodySecret).success, false);
  const incompleteHeaderAssertion = structuredClone(base);
  incompleteHeaderAssertion.http.assertions = [{ type: 'headerEquals', name: 'content-type' }];
  assert.equal(StepSchema.safeParse(incompleteHeaderAssertion).success, false);
  const incompleteTypeAssertion = structuredClone(base);
  incompleteTypeAssertion.http.assertions = [{ type: 'jsonPathType', path: '$.id' }];
  assert.equal(StepSchema.safeParse(incompleteTypeAssertion).success, false);
  const invalidArrayLengthAssertion = structuredClone(base);
  invalidArrayLengthAssertion.http.assertions = [{ type: 'jsonArrayLength', path: '$.items', expected: -1 }];
  assert.equal(StepSchema.safeParse(invalidArrayLengthAssertion).success, false);
});

test('redirects to private destinations are rejected before connecting', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  process.env.WRIGHTTEST_HTTP_TEST_ALLOW_LOOPBACK = '1';
  try {
    await withServer((_request, response) => {
      response.writeHead(302, { location: 'http://192.168.1.10/admin' });
      response.end();
    }, async (baseUrl) => {
      const step: Step = { action: 'httpRequest', http: { method: 'GET', url: baseUrl } };
      await assert.rejects(() => executeHttpRequest(step, new VariableContext(), 0), (error: unknown) => error instanceof HttpRequestError && error.code === 'HTTP_SECURITY');
    });
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
    delete process.env.WRIGHTTEST_HTTP_TEST_ALLOW_LOOPBACK;
  }
});
