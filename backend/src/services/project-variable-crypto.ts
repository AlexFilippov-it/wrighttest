import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function isProjectVariableEncryptionConfigured() {
  return /^[a-f\d]{64}$/i.test(process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY ?? '');
}

function key() {
  const value = process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY;
  if (!value || !/^[a-f\d]{64}$/i.test(value)) {
    throw new Error('Project variable encryption is not configured on this server.');
  }
  return Buffer.from(value, 'hex');
}

function encrypt(value: unknown, aad: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `v1.${[iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.')}`;
}

function decrypt(value: string, aad: string) {
  try {
    const [version, ivValue, tagValue, ciphertextValue] = value.split('.');
    if (version !== 'v1' || !ivValue || !tagValue || ciphertextValue === undefined) throw new Error('Invalid payload');
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivValue, 'base64url'));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final()
    ]).toString('utf8');
    return JSON.parse(plaintext) as unknown;
  } catch {
    throw new Error('Stored project variable cannot be decrypted. Check the server encryption key.');
  }
}

export function encryptProjectVariableValue(value: unknown) {
  return encrypt(value, 'wrighttest:project-variable:v1');
}

export function decryptProjectVariableValue(value: string): unknown {
  return decrypt(value, 'wrighttest:project-variable:v1');
}

export function encryptRunVariablesSnapshot(value: unknown) {
  const record = value && typeof value === 'object' ? value as { secretNames?: unknown } : {};
  const hasSecrets = Array.isArray(record.secretNames) && record.secretNames.length > 0;
  const configuredKey = process.env.DATABASE_CREDENTIALS_ENCRYPTION_KEY;
  if (!configuredKey || !isProjectVariableEncryptionConfigured()) {
    if (hasSecrets) throw new Error('Configure DATABASE_CREDENTIALS_ENCRYPTION_KEY before running checks with secret variables.');
    return `p1.${Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')}`;
  }
  return encrypt(value, 'wrighttest:run-variable-snapshot:v1');
}

export function decryptRunVariablesSnapshot(value: string): unknown {
  if (value.startsWith('p1.')) {
    try {
      return JSON.parse(Buffer.from(value.slice(3), 'base64url').toString('utf8')) as unknown;
    } catch {
      throw new Error('Stored run variable snapshot is invalid.');
    }
  }
  return decrypt(value, 'wrighttest:run-variable-snapshot:v1');
}
