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

    it('the pattern table carries a phone composition, not just a scrolling table', () => {
        const table = read('src/modules/baseline-ft/ui/components/BaselinePatternTable.tsx');

        // Cards below md, table from md up. Both halves must exist: a table
        // hidden on mobile with nothing in its place is a blank screen, and
        // cards with no `md:hidden` would double up on desktop.
        //
        // Eleven columns is well past what a 430px viewport can hold, so this
        // is the page's load-bearing responsive decision, not a nicety.
        expect(table).toContain('md:hidden');
        expect(table).toContain('hidden overflow-x-auto rounded-lg border bg-card md:block');
    });

    it('every editable control in the table is reachable and labelled', () => {
        const table = read('src/modules/baseline-ft/ui/components/BaselinePatternTable.tsx');

        // The day toggles are icon-sized buttons showing a single letter, so
        // "M" is ambiguous between Monday and a truncated month. Each carries
        // its full day name for assistive technology.
        expect(table).toContain('aria-label={DAY_LONG[d]}');
        expect(table).toContain('aria-pressed={on}');

        // Time inputs sit in table cells with no visible label on desktop —
        // a column header is not programmatically associated with the cells
        // beneath it, so each input names itself and its owner. Asserted as
        // the two halves that make it true: the wiring, and both call sites.
        expect(table).toContain('aria-label={label}');
        expect(table).toContain('label={`Start time for ${emp.name}`}');
        expect(table).toContain('label={`Finish time for ${emp.name}`}');
    });
});
