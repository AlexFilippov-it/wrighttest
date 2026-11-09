import crypto from 'node:crypto';

export function isWebhookSecretConfigured(secret: string | undefined) {
  return Boolean(secret && secret.length >= 32 && !['your-secret-here', 'changeme'].includes(secret));
}

export function verifyWebhookSignature(secret: string, body: string, signature: string) {
  if (!signature.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const supplied = signature.slice('sha256='.length);
  if (!/^[a-f\d]{64}$/i.test(supplied)) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'));
}
