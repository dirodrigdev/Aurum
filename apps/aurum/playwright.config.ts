import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3000';
const artifactRoot = '../../.playwright/aurum';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: `${artifactRoot}/playwright-report`, open: 'never' }],
  ],
  outputDir: `${artifactRoot}/test-results`,
  use: {
    baseURL,
    ...devices['Desktop Chrome'],
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm -w apps/aurum run dev -- --host 127.0.0.1 --port 3000',
    cwd: '../..',
    url: baseURL,
    reuseExistingServer: true,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
  },
});
