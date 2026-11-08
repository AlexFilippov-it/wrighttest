import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { isWebhookSecretConfigured, verifyWebhookSignature } from '../src/services/webhook-security';

test('webhook trigger fails closed when secret is absent or a placeholder', () => {
  assert.equal(isWebhookSecretConfigured(undefined), false);
  assert.equal(isWebhookSecretConfigured(''), false);
  assert.equal(isWebhookSecretConfigured('your-secret-here'), false);
  assert.equal(isWebhookSecretConfigured('short'), false);
});

test('webhook secrets require a non-placeholder secret with sufficient entropy length', () => {
  const secret = 's'.repeat(32);
  assert.equal(isWebhookSecretConfigured(secret), true);
  const payload = '{"testId":"example"}';
  const signature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  assert.match(signature, /^sha256=[a-f\d]{64}$/);
  assert.equal(verifyWebhookSignature(secret, payload, signature), true);
  assert.equal(verifyWebhookSignature(secret, payload, signature.slice(7)), false);
  assert.equal(verifyWebhookSignature(secret, payload, `sha256=${'0'.repeat(64)}`), false);
});
