import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const env = loadEnv(mode, rootDir, '');
  const frontendPort = Number(env.FRONTEND_PORT ?? 5173);
  const backendUrl = env.VITE_BACKEND_URL ?? `http://localhost:${env.BACKEND_PORT ?? 3000}`;
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { version?: string };

  const readGitValue = (command: string) => {
    try {
      return execSync(command, { cwd: rootDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return '';
    }
  };

  const appVersion = env.VITE_APP_VERSION || packageJson.version || '';
  const gitCommit = env.VITE_GIT_COMMIT || readGitValue('git rev-parse --short HEAD');
  const buildDate = env.VITE_BUILD_DATE || new Date().toISOString();
  const appEnvironment = env.VITE_APP_ENV || (mode === 'development' ? 'local' : mode);

  return {
    envDir: rootDir,
    plugins: [react()],
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
      'import.meta.env.VITE_GIT_COMMIT': JSON.stringify(gitCommit),
      'import.meta.env.VITE_BUILD_DATE': JSON.stringify(buildDate),
      'import.meta.env.VITE_APP_ENV': JSON.stringify(appEnvironment)
    },
    server: {
      port: frontendPort,
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true
        },
        '/health': {
          target: backendUrl,
          changeOrigin: true
        }
      }
    }
  };
});
