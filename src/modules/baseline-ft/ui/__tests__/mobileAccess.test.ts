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

    it('the workspace has BOTH compositions — cards for phones, table from md up', () => {
        const table = read('src/modules/baseline-ft/ui/components/BaselinePatternTable.tsx');

        // This is the assertion that matters, and it is deliberately structural
        // rather than a string match on a label.
        //
        // The desktop table's ten columns have a combined minimum width of
        // 1250px, nearly 3x a 430px viewport, so shipping it alone means
        // scrolling in two dimensions at once — WCAG SC 1.4.10 (Reflow). Being
        // on ALLOWED_MOBILE_ROUTES is a CLAIM that this page reflows; these two
        // classes are the only thing backing it.
        //
        // A previous revision of this test asserted an aria-label and the word
        // "DayToggles" instead. Both were true of a table with no phone
        // composition at all, so the test passed while the card view was
        // deleted. Assert the mechanism, not the vocabulary.
        expect(table).toContain('md:hidden');
        expect(table).toContain('hidden md:block');
    });

    it('the columns really are too wide for a phone — the reason the cards exist', () => {
        const table = read('src/modules/baseline-ft/ui/components/BaselinePatternTable.tsx');
        const mins = [...table.matchAll(/min-w-\[(\d+)px\]/g)].map(m => Number(m[1]));

        // If someone slims the table enough that it genuinely fits a phone,
        // this fails and the cards can be reconsidered on purpose rather than
        // deleted by accident.
        expect(mins.length).toBeGreaterThan(0);
        expect(mins.reduce((a, b) => a + b, 0)).toBeGreaterThan(430);
    });

    it('controls are thumb-sized where a thumb is used', () => {
        const table = read('src/modules/baseline-ft/ui/components/BaselinePatternTable.tsx');

        // `touch.target` is min-h-11/min-w-11 (44px). The shared inputs and the
        // day toggles opt into it below md and release it from md up, where the
        // table renders for a pointer. Without this the day toggles were 28px.
        expect(table).toContain("import { text, touch } from '@/modules/core/ui/typography'");
        expect(table).toMatch(/touch\.target\b/);
        expect(table).toMatch(/touch\.targetY\b/);
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
