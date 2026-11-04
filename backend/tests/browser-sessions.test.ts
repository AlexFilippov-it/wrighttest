import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { after, test } from 'node:test';
import type { Browser, BrowserContext, LaunchOptions } from 'playwright';
import { BrowserSessionError, BrowserSessionManager, validateBrowserUrl } from '../src/services/browser-sessions';
import { isPublicAddress, PublicEgressProxy, resolvePublicAddress } from '../src/services/public-egress-proxy';
import redis from '../src/redis';
import { testQueuePrefix } from '../src/queue/queue';
import { testQueue } from '../src/queue/queue';

after(async () => {
  await testQueue.close().catch(() => undefined);
  redis.disconnect();
});

function fakeBrowserHarness() {
  const contexts: Array<{ closed: boolean; page: FakePage }> = [];
  const browser = {
    async newContext() {
      const page = new FakePage();
      const state = { closed: false, page };
      contexts.push(state);
      return {
        setDefaultTimeout() {},
        setDefaultNavigationTimeout() {},
        async route() {},
        async newPage() { return page; },
        async close() { state.closed = true; }
      } as unknown as BrowserContext;
    },
    async close() {}
  } as unknown as Browser;
  return { contexts, launch: async (_options?: LaunchOptions) => browser };
}

class FakePage {
  private currentUrl = 'about:blank';
  async goto(url: string) {
    if (url.includes('broken')) throw new Error('navigation failed');
    this.currentUrl = url;
  }
  url() { return this.currentUrl; }
  async title() { return 'Test page'; }
  getByLabel(label: string) { return this.locator(label); }
  getByRole(_role: string, options: { name?: string }) { return this.locator(options.name ?? ''); }
  locator(selector: string) {
    return {
      ariaSnapshot: async () => selector.includes('Delete account') ? '- button "Delete account"' : '- heading "Test page"\n- textbox "Search": value: secret form value',
      count: async () => selector.includes('Missing') ? 0 : selector.includes('Ambiguous') ? 2 : 1,
      waitFor: async () => {},
      click: async () => {},
      fill: async () => {},
      selectOption: async () => {},
      evaluate: async () => selector.includes('Password')
        ? 'password Password current-password'
        : selector.includes('Card number')
          ? 'text cardNumber'
          : 'text search'
    };
  }
}

test('browser URL validation rejects localhost, credentials, and private address literals', () => {
  assert.throws(() => validateBrowserUrl('http://localhost/admin'), /Private network/);
  assert.throws(() => validateBrowserUrl('http://127.0.0.1'), /Private network/);
  assert.throws(() => validateBrowserUrl('http://user:pass@example.com'), /HTTP\(S\)/);
  assert.equal(validateBrowserUrl('https://example.com/'), 'https://example.com/');
});

test('Node test processes use a queue prefix separate from the application worker', () => {
  assert.match(testQueuePrefix, /^wrighttest-test-/);
  assert.notEqual(testQueuePrefix, 'bull');
});

test('egress proxy classifies special IP ranges as non-public and refuses metadata IPs', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.0.1', '::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicAddress(address), false, `${address} must not be routable by the browser`);
  }
  assert.equal(isPublicAddress('1.1.1.1'), true);
  await assert.rejects(resolvePublicAddress('localhost'), /Private network/);
  await assert.rejects(resolvePublicAddress('169.254.169.254'), /Private network/);
});

test('egress proxy rejects private HTTP destinations at the socket boundary', async () => {
  const proxy = new PublicEgressProxy();
  const proxyAddress = new URL(await proxy.start());
  try {
    const status = await new Promise<number>((resolve, reject) => {
      const request = http.request({
        hostname: proxyAddress.hostname,
        port: Number(proxyAddress.port),
        path: 'http://169.254.169.254/latest/meta-data/',
        headers: { host: '169.254.169.254' }
      }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.once('error', reject);
      request.end();
    });
    assert.equal(status, 403);
  } finally {
    await proxy.close();
  }
});

test('egress proxy closes active client sockets during shutdown', async () => {
  const proxy = new PublicEgressProxy();
  const proxyAddress = new URL(await proxy.start());
  const client = net.createConnection({ host: proxyAddress.hostname, port: Number(proxyAddress.port) });
  try {
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('error', reject);
    });
    await proxy.close();
    if (!client.destroyed) await new Promise<void>((resolve) => client.once('close', () => resolve()));
    assert.equal(client.destroyed, true);
  } finally {
    client.destroy();
    await proxy.close();
  }
});

test('sessions use separate contexts, redact form values, and enforce owner isolation', async () => {
  const harness = fakeBrowserHarness();
  const manager = new BrowserSessionManager(harness.launch);
  const first = await manager.start('user-a', 'project-a', 'https://example.com');
  const second = await manager.start('user-b', 'project-b', 'https://example.com');
  assert.notEqual(first.id, second.id);
  assert.equal(harness.contexts.length, 2);
  assert.notEqual(harness.contexts[0].page, harness.contexts[1].page);

  const snapshot = await manager.snapshot(first.id, 'user-a', 'project-a');
  assert.match(snapshot.snapshot, /value: \[redacted\]/);
  assert.doesNotMatch(snapshot.snapshot, /secret form value/);
  assert.equal(snapshot.untrustedPageContent, true);
  await assert.rejects(manager.snapshot(first.id, 'user-b', 'project-b'), (error: unknown) => error instanceof BrowserSessionError && error.statusCode === 403);

  await manager.close(first.id, 'user-a', 'project-a');
  assert.equal(harness.contexts[0].closed, true);
  assert.equal(manager.activeSessionCount, 1);
  await manager.closeAll();
  assert.equal(harness.contexts[1].closed, true);
  assert.equal(manager.activeSessionCount, 0);
});

test('idle session TTL closes its context and releases browser resources', async () => {
  const harness = fakeBrowserHarness();
  let now = Date.now();
  const manager = new BrowserSessionManager(harness.launch, () => now);
  const session = await manager.start('user-a', 'project-a', 'https://example.com');

  now += 5 * 60 * 1000;
  await manager.start('user-a', 'project-a', 'https://example.com');
  assert.equal(harness.contexts[0].closed, true);
  await assert.rejects(
    manager.snapshot(session.id, 'user-a', 'project-a'),
    /not found or expired/
  );
  await manager.closeAll();
});

test('sessions enforce per-user limits and block credential fields and unconfirmed destructive actions', async () => {
  const harness = fakeBrowserHarness();
  const manager = new BrowserSessionManager(harness.launch);
  const first = await manager.start('same-user', 'project-a', 'https://example.com');
  const second = await manager.start('same-user', 'project-a', 'https://example.com');
  await assert.rejects(manager.start('same-user', 'project-a', 'https://example.com'), (error: unknown) => error instanceof BrowserSessionError && error.statusCode === 429);
  await assert.rejects(manager.fill(first.id, 'same-user', 'project-a', "page.getByLabel('Password')", 'secret'), /credential fields is disabled/);
  await assert.rejects(manager.fill(first.id, 'same-user', 'project-a', "page.getByRole('textbox', { name: 'Card number' })", '4111111111111111'), /credential fields is disabled/);
  await assert.rejects(manager.select(first.id, 'same-user', 'project-a', "page.getByRole('textbox', { name: 'Card number' })", 'secret-choice'), /credential fields is disabled/);
  await assert.rejects(manager.click(first.id, 'same-user', 'project-a', "page.getByRole('button', { name: 'Delete account' })"), /explicit user confirmation/);
  await manager.click(first.id, 'same-user', 'project-a', "page.getByRole('button', { name: 'Delete account' })", true);
  assert.equal((await manager.snapshot(second.id, 'same-user', 'project-a')).actions.length, 1);
  await manager.closeAll();
});

test('missing and ambiguous locators fail clearly without recording a step or retrying', async () => {
  const harness = fakeBrowserHarness();
  const manager = new BrowserSessionManager(harness.launch);
  const session = await manager.start('user-a', 'project-a', 'https://example.com');

  await assert.rejects(
    manager.click(session.id, 'user-a', 'project-a', "page.getByRole('button', { name: 'Missing action' })"),
    /found 0/
  );
  await assert.rejects(
    manager.click(session.id, 'user-a', 'project-a', "page.getByRole('button', { name: 'Ambiguous action' })"),
    /found 2/
  );
  assert.deepEqual((await manager.snapshot(session.id, 'user-a', 'project-a')).actions, [{ action: 'goto', value: 'https://example.com/' }]);
  await manager.closeAll();
});

test('failed startup closes its context and does not leave a live session', async () => {
  const harness = fakeBrowserHarness();
  const manager = new BrowserSessionManager(harness.launch);
  await assert.rejects(manager.start('user-a', 'project-a', 'https://broken.example'));
  assert.equal(manager.activeSessionCount, 0);
  assert.equal(harness.contexts[0].closed, true);
  await manager.closeAll();
});
