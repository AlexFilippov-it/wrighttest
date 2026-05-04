import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const env = loadEnv(mode, rootDir, '');
  const frontendPort = Number(env.FRONTEND_PORT ?? 5173);
  const backendUrl = env.VITE_BACKEND_URL ?? `http://localhost:${env.BACKEND_PORT ?? 3000}`;

  return {
    envDir: rootDir,
    plugins: [react()],
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
