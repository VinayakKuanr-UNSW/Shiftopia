import { test, expect } from '@playwright/test';

/**
 * T17BALMOND-17 — E2E for the peer-to-peer shift swap journey.
 *
 * This v1 covers the read-only journey against the deployed Supabase with a real
 * authenticated session: the employee opens the Swaps workspace and the swap
 * marketplace renders (the three lifecycle tabs: Available / My Offers / My Swaps).
 * It exercises real auth + the protected route + the swap data layer end-to-end
 * WITHOUT mutating shared data.
 *
 * Follow-up (needs ≥2 seeded employee accounts with swappable shifts): the full
 * mutation journey — requester posts a swap → peer offers → requester accepts →
 * manager approves — driven across multiple browser contexts.
 */
test.describe('Peer-to-peer swap journey (T17BALMOND-17)', () => {
  test('opens the Swaps workspace and shows the swap marketplace', async ({ page }) => {
    await page.goto('/my-swaps');

    // Stayed authenticated — not bounced back to /login.
    await expect(page).toHaveURL(/\/my-swaps/);

    // The swap marketplace tabs render (names include a live count badge).
    await expect(page.getByRole('button', { name: /Available/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /My Offers/ })).toBeVisible();
  });

  test('can switch to the Available marketplace tab', async ({ page }) => {
    await page.goto('/my-swaps');

    const availableTab = page.getByRole('button', { name: /Available/ });
    await expect(availableTab).toBeVisible({ timeout: 20_000 });
    await availableTab.click();

    // Page stays stable on the swaps route after switching tabs.
    await expect(page).toHaveURL(/\/my-swaps/);
    await expect(availableTab).toBeVisible();
  });
});
