import { test, expect } from '@playwright/test';

/**
 * T17BALMOND-19 — E2E for the bid approval flow.
 *
 * Read-only v1 against the deployed Supabase with a real authenticated session:
 * a manager opens the Open Bids Manager (/management/bids), where bids are
 * reviewed and awarded, and it renders. Exercises real auth + the feature-gated
 * management route + the bidding data layer end-to-end, without mutating shared
 * data. The full award/approve mutation is a follow-up needing seeded bids.
 */
test.describe('Bid approval flow (T17BALMOND-19)', () => {
  test('opens the Open Bids Manager as a manager', async ({ page }) => {
    await page.goto('/management/bids');

    // Stayed authenticated — not bounced back to /login.
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Sign In' })).toHaveCount(0);

    // The manager bids workspace renders.
    await expect(page.getByText('Open Bids Manager').first()).toBeVisible({ timeout: 20_000 });
  });
});
