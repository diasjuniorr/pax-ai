import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { browserName: 'chromium', channel: process.env.PAX_TEST_BROWSER_CHANNEL || undefined },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:31847/health',
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'production', PORT: '31847', PAX_PUBLIC_ORIGIN: 'https://pax.test',
      PAX_BRIDGE_TOKEN: 'browser-test-agent-key-not-a-real-secret',
      PAX_DASHBOARD_TOKEN: 'browser-test-dashboard-key-not-a-real-secret',
      OPENAI_API_KEY: '', // Browser tests never call a live or billable model.
    },
  },
});
