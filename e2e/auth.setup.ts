// Load .env in this worker process so credentials resolve in every run mode
// (headless `playwright test` AND `--ui`, which doesn't inherit config-level env).
import 'dotenv/config';
import { test as setup, expect } from '@playwright/test';

const authFile = 'e2e/.auth/user.json';

// Credentials come from the environment only — never committed. Set them in
// .env locally (see .env.example) or as CI secrets. See e2e/README.md.
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

/**
 * Authenticate through the real login UI against the deployed Supabase, then
 * persist the session (localStorage auth token) so the specs start signed in.
 */
setup('authenticate', async ({ page }) => {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      'Missing E2E_EMAIL / E2E_PASSWORD — set them in .env (local) or as CI secrets. See e2e/README.md.',
    );
  }

  await page.goto('/login');

  await page.getByPlaceholder('name@company.com').fill(EMAIL);
  await page.getByPlaceholder('Enter your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();

  // Successful auth redirects out of /login into the workspace (default /my-roster).
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page).not.toHaveURL(/\/login/);

  await page.context().storageState({ path: authFile });
});
