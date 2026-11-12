import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3001',
    trace: process.env.CI ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: path.resolve(__dirname, '../api'),
      url: 'http://localhost:3000/public/elections',
      reuseExistingServer: false,
      env: {
        ADMIN_EMAIL: 'admin@uni.test',
        ADMIN_PASSWORD: 'administrator123',
        OTP_ECHO: 'true',
        SESSION_SECRET: 'sessionsecret12345678901234567890123456789012',
        PORT: '3000',
        NO_RATE_LIMIT: 'true',
        ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
        ...(process.env.STORE ? { STORE: process.env.STORE } : {}),
      },
      timeout: 120_000,
    },
    {
      command: 'npx next start -p 3001',
      cwd: path.resolve(__dirname),
      url: 'http://localhost:3001',
      reuseExistingServer: false,
      env: {
        API_URL: 'http://localhost:3000',
        PORT: '3001',
      },
      timeout: 120_000,
    },
  ],
});
