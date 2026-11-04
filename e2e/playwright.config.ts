import { defineConfig, devices } from '@playwright/test';

const frontendUrl = process.env.E2E_BASE_URL
  ?? process.env.FRONTEND_DEV_URL
  ?? `http://localhost:${process.env.FRONTEND_PORT ?? '5173'}`;
const runIntegrationTests = process.env.E2E_INTEGRATION === '1';
const outputDir = process.env.E2E_OUTPUT_DIR ?? '../test-results/e2e';
const reportDir = process.env.E2E_REPORT_DIR ?? '../playwright-report/e2e';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  testIgnore: runIntegrationTests ? [] : ['**/*.integration.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  outputDir,
  reporter: [
    ['line'],
    ['html', { outputFolder: reportDir, open: 'never' }]
  ],
  use: {
    baseURL: frontendUrl,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off'
  },
  // globalSetup verifies the API; /health is subject to the global rate limit and can trigger duplicate backend starts.
  webServer: [
    {
      command: `npm run dev -w frontend -- --host 127.0.0.1 --port ${process.env.E2E_FRONTEND_PORT ?? process.env.FRONTEND_PORT ?? '5173'} --strictPort`,
      url: frontendUrl,
      reuseExistingServer: true,
      timeout: 120_000
    }
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
