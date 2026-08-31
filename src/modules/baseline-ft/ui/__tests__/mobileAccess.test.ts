/**
 * Being on the mobile allowlist is a CLAIM: that the route renders usably at
 * 430px without two-dimensional scrolling (WCAG SC 1.4.10). The guard cannot
 * check that, so the claim is pinned here alongside the route itself — if
 * someone adds the path without the composition, or removes the composition
 * without the path, one of these fails.
 *
 * The bottom-nav Leave button is the precedent: it pointed at a page inside the
 * guard that was never allowlisted, so it landed on "Desktop Only" on every
 * phone, and nothing caught it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALLOWED_MOBILE_ROUTES } from '@/modules/core/ui/components/MobileAccessGuard';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

describe('Baseline FT on mobile', () => {
    it('is on the allowlist, and at the path the router registers', () => {
        expect(ALLOWED_MOBILE_ROUTES.has('/baseline-ft')).toBe(true);

        // The guard matches `pathname` EXACTLY for these, so an allowlist entry
        // that disagrees with the route is silently useless.
        const router = read('src/router/AppRouter.tsx');
        expect(router).toContain('path="/baseline-ft"');
    });

    it('the sidebar links to the same path', () => {
        const sidebar = read('src/modules/core/ui/layout/sidebar/AppSidebar.tsx');
        expect(sidebar).toContain('to="/baseline-ft"');
    });

    it('the ledger carries a phone composition, not just a scrolling table', () => {
        const ledger = read('src/modules/baseline-ft/ui/components/BaselineLedger.tsx');

        // Cards below md, table from md up. Both halves must exist: a table
        // hidden on mobile with nothing in its place is a blank screen, and
        // cards with no `md:hidden` would double up on desktop.
        expect(ledger).toContain('md:hidden');
        expect(ledger).toContain('hidden md:block');
    });

    it('the designer dialog fits a short viewport', () => {
        const dialog = read('src/modules/baseline-ft/ui/components/PatternDesignerDialog.tsx');

        // Without a max height the footer buttons land below the fold on a
        // phone in landscape, with nothing indicating they exist.
        expect(dialog).toMatch(/max-h-\[90dvh\]/);
        expect(dialog).toContain('overflow-y-auto');
    });
});
