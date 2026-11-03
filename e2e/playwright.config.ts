import { defineConfig, devices } from '@playwright/test';

const frontendUrl = process.env.E2E_BASE_URL
  ?? process.env.FRONTEND_DEV_URL
  ?? `http://localhost:${process.env.FRONTEND_PORT ?? '5173'}`;
const runIntegrationTests = process.env.E2E_INTEGRATION === '1';

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
  outputDir: '../test-results/e2e',
  reporter: [
    ['line'],
    ['html', { outputFolder: '../playwright-report/e2e', open: 'never' }]
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
      command: 'npm run dev -w frontend -- --host 127.0.0.1',
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
