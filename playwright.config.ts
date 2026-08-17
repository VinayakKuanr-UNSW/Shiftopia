// Load .env into process.env (E2E credentials, dev-server vars). dotenv does not
// override vars already set, so CI secrets take precedence and a missing .env
// (e.g. in CI) is a no-op.
import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8080';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    reducedMotion: 'reduce',
  },
  projects: [
    // 1) Sign in once and persist the authenticated session to disk.
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    // 2) Run the specs with that stored session (no per-test re-login).
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
  // Auto-start the Vite dev server; reuse a running one locally.
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
