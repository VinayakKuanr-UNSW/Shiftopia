import { test, expect } from '@playwright/test';

/**
 * T17BALMOND-15 — E2E for the manager publish-shift flow.
 *
 * Read-only v1 against the deployed Supabase with a real authenticated session:
 * a manager opens the Roster Planner (where shifts are created and published)
 * and the workspace renders. Exercises real auth + the feature-gated /rosters
 * route + the roster data layer end-to-end, without mutating shared data. The
 * full publish mutation is a follow-up needing seeded draft shifts.
 */
test.describe('Manager publish-shift flow (T17BALMOND-15)', () => {
  test('opens the Roster Planner as an authenticated manager', async ({ page }) => {
    await page.goto('/rosters');

    // Stayed authenticated — not bounced back to /login.
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Sign In' })).toHaveCount(0);

    // The Roster Planner workspace renders.
    await expect(page.getByText('Roster Planner').first()).toBeVisible({ timeout: 20_000 });
  });
});
