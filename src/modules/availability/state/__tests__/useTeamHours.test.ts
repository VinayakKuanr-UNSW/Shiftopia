import { describe, expect, it } from 'vitest';
import { format, getISOWeek } from 'date-fns';
import { COMPLIANCE_LOOKBACK_DAYS, toHoursRange } from '../useTeamHours';

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

/**
 * The widening is the load-bearing part of the hours read: a rolling window
 * ending inside the visible range reaches back up to three ISO weeks before it,
 * and a week-total column is only true if its whole week was fetched.
 *
 * @see docs/architecture/availability-manager-grid-merge-plan.md §2.1, §2.2
 */
describe('toHoursRange', () => {
    // Mon 2026-08-10 .. Sun 2026-08-16 is a whole ISO week already.
    it('starts three ISO weeks before the week containing the visible start', () => {
        const range = toHoursRange(new Date(2026, 7, 10), new Date(2026, 7, 16));
        expect(iso(range.start)).toBe('2026-07-20');
        expect(iso(range.end)).toBe('2026-08-16');
    });

    it('snaps a mid-week visible start back to its Monday before looking back', () => {
        // Thu 2026-08-13 belongs to the week beginning Mon 2026-08-10.
        const range = toHoursRange(new Date(2026, 7, 13), new Date(2026, 7, 13));
        expect(iso(range.start)).toBe('2026-07-20');
        expect(range.start.getDay()).toBe(1);
    });

    it('extends a mid-week visible end forward to its Sunday', () => {
        const range = toHoursRange(new Date(2026, 7, 10), new Date(2026, 7, 13));
        expect(iso(range.end)).toBe('2026-08-16');
        expect(range.end.getDay()).toBe(0);
    });

    // A Day view is the case that would break silently: 1 visible day must
    // still fetch 4 ISO weeks or the 4-week window is computed from one shift.
    it('fetches four whole ISO weeks even for a single visible day', () => {
        const range = toHoursRange(new Date(2026, 7, 13), new Date(2026, 7, 13));
        const weeks = new Set<number>();
        for (let d = new Date(range.start); d <= range.end; d.setDate(d.getDate() + 1)) {
            weeks.add(getISOWeek(d));
        }
        expect(weeks.size).toBe(4);
    });

    it('covers a whole month view plus the lookback', () => {
        const range = toHoursRange(new Date(2026, 7, 1), new Date(2026, 7, 31));
        // Aug 1 2026 is a Saturday, in the week beginning Mon Jul 27.
        expect(iso(range.start)).toBe('2026-07-06');
        // Aug 31 is a Monday, so its week runs to Sun Sep 6.
        expect(iso(range.end)).toBe('2026-09-06');
    });

    it('spans the lookback across a year boundary without clamping', () => {
        const range = toHoursRange(new Date(2026, 0, 5), new Date(2026, 0, 11));
        expect(iso(range.start)).toBe('2025-12-15');
        expect(iso(range.end)).toBe('2026-01-11');
    });

    it('always widens — the fetched range never sits inside the visible one', () => {
        const start = new Date(2026, 7, 10);
        const end = new Date(2026, 7, 16);
        const range = toHoursRange(start, end);
        expect(range.start.getTime()).toBeLessThan(start.getTime());
        expect(range.end.getTime()).toBeGreaterThanOrEqual(end.getTime());
    });

    it('looks back exactly the documented three weeks', () => {
        expect(COMPLIANCE_LOOKBACK_DAYS).toBe(21);
    });
});
