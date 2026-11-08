const PLACEHOLDER_SECRETS = new Set([
  'changeme',
  'your-secret-here',
  'replace-this-with-a-long-random-string-min-32-chars',
  'replace-this-with-a-long-random-string'
]);

export function validateRuntimeConfiguration(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== 'production') return;

  const jwtSecret = env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32 || PLACEHOLDER_SECRETS.has(jwtSecret)) {
    throw new Error('JWT_SECRET must be a non-placeholder secret of at least 32 characters in production.');
  }

  const encryptionKey = env.DATABASE_CREDENTIALS_ENCRYPTION_KEY ?? '';
  if (!/^[a-f\d]{64}$/i.test(encryptionKey)) {
    throw new Error('DATABASE_CREDENTIALS_ENCRYPTION_KEY must be a 32-byte hex key in production.');
  }

  const adminPassword = env.ADMIN_PASSWORD ?? '';
  if (adminPassword.length < 12 || PLACEHOLDER_SECRETS.has(adminPassword)) {
    throw new Error('ADMIN_PASSWORD must be a non-placeholder password of at least 12 characters in production.');
  }
}
