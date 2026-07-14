import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4174';
const artifactRoot = '../../.playwright/midas-e2e';

export default defineConfig({
  testDir: './e2e-auth',
  timeout: 45_000,
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
    command: 'npm -w apps/midas run dev -- --mode e2e --host 127.0.0.1 --port 4174',
    cwd: '../..',
    url: baseURL,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
  },
});
