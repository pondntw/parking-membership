import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: false,
  use: {
    baseURL: process.env.E2E_BASE_URL,
    channel: 'chrome',
    locale: 'th-TH',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
