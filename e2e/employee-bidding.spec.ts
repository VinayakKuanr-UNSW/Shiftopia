import { test, expect } from '@playwright/test';

/**
 * T17BALMOND-18 — E2E for the employee bidding journey.
 *
 * Read-only v1 against the deployed Supabase with a real authenticated session:
 * an employee opens their bids workspace (/my-bids) and it renders. Exercises
 * real auth + the protected route + the bidding data layer end-to-end, without
 * mutating shared data. The full submit/withdraw-bid journey is a follow-up
 * needing seeded open shifts to bid on.
 */
test.describe('Employee bidding journey (T17BALMOND-18)', () => {
  test('opens the employee bids workspace', async ({ page }) => {
    await page.goto('/my-bids');

    // Stayed authenticated — the protected route rendered, not /login.
    await expect(page).toHaveURL(/\/my-bids/);
    await expect(page.getByRole('button', { name: 'Sign In' })).toHaveCount(0);
  });
});
