import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { parseAuthStorageState } from '../src/services/auth-state-storage';
import { runValidationInSubprocess } from '../src/services/validation-runner';

test('authenticated validation keeps the backend event loop available', { timeout: 15_000 }, async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/session') {
      response.writeHead(request.headers.authorization === 'test-session' ? 204 : 401).end();
      return;
    }

    response.writeHead(200, { 'content-type': 'text/html' }).end(`
      <!doctype html>
      <script>
        fetch('/session', {
          headers: { authorization: localStorage.getItem('session') || '' }
        }).then((response) => {
          if (!response.ok) return;
          const link = document.createElement('a');
          link.href = '/projects';
          link.textContent = 'Projects';
          document.body.append(link);
        });
      </script>
    `);
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;
    const storageState = parseAuthStorageState({
      cookies: [],
      origins: [
        {
          origin,
          localStorage: [{ name: 'session', value: 'test-session' }]
        }
      ]
    });

    const report = await runValidationInSubprocess(
      origin,
      [
        {
          action: 'assertVisible',
          selector: "page.getByRole('link', { name: 'Projects' })"
        }
      ],
      undefined,
      storageState
    );

    assert.equal(report.valid, true);
    assert.deepEqual(report.results.map((result) => result.status), ['ok']);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
