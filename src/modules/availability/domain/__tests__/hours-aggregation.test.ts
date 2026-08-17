import { describe, expect, it } from 'vitest';
import {
    buildHoursByEmployee,
    buildWeekColumns,
    isoWeekKeyFromISO,
    shortWeekLabel,
    weekKeysInRange,
} from '../hours-compliance';
import type { RawTeamShift } from '../../model/team-availability.types';

// ── fixtures ────────────────────────────────────────────────────────────────

let seq = 0;
const shift = (over: Partial<RawTeamShift> & { shiftDate: string }): RawTeamShift => ({
    id: `s-${++seq}`,
    startTime: '09:00',
    endTime: '17:00',
    assignedEmployeeId: 'p1',
    roleName: null,
    netMinutes: 480,
    isDraft: false,
    deptName: null,
    subDeptName: null,
    unpaidBreakMinutes: 30,
    ...over,
});

const range = (start: string, end: string) => ({
    start: new Date(`${start}T00:00:00`),
    end: new Date(`${end}T00:00:00`),
});

const members = (...ids: string[]) => ids.map((profileId) => ({ profileId }));

// ── ISO week keys ───────────────────────────────────────────────────────────

describe('isoWeekKey', () => {
    it('keys a week by its ISO YEAR as well as its number', () => {
        expect(isoWeekKeyFromISO('2026-08-12')).toBe('2026-W33');
    });

    /**
     * The reason the key is not a bare number. Late December belongs to ISO
     * week 1 of the FOLLOWING year, so a range spanning the new year produces
     * numbers that sort backwards.
     */
    it('sorts chronologically across a year boundary, where bare numbers do not', () => {
        const keys = ['2025-12-15', '2025-12-22', '2025-12-29', '2026-01-05'].map(isoWeekKeyFromISO);
        expect(keys).toEqual(['2025-W51', '2025-W52', '2026-W01', '2026-W02']);
        expect([...keys].sort()).toEqual(keys);
    });

    it('parses the date as local midnight, so the day never slips a timezone', () => {
        expect(isoWeekKeyFromISO('2026-01-01')).toBe('2026-W01');
        expect(isoWeekKeyFromISO('2026-12-31')).toBe('2026-W53');
    });

    it('shortens to a header label', () => {
        expect(shortWeekLabel('2026-W33')).toBe('W33');
    });
});

// ── weekKeysInRange ─────────────────────────────────────────────────────────

describe('weekKeysInRange', () => {
    it('returns every week of a four-week span, contiguous and ascending', () => {
        const { start, end } = range('2026-07-20', '2026-08-16');
        expect(weekKeysInRange(start, end)).toEqual([
            '2026-W30', '2026-W31', '2026-W32', '2026-W33',
        ]);
    });

    // The sweep steps through adjacent entries assuming they are adjacent
    // weeks; a missing quiet week would make a 4-week window span five.
    it('includes weeks nobody worked', () => {
        const keys = weekKeysInRange(new Date('2026-07-20T00:00:00'), new Date('2026-08-16T00:00:00'));
        expect(keys).toHaveLength(4);
        expect(new Set(keys).size).toBe(4);
    });

    it('does not drop the final week when the range ends on a different weekday', () => {
        // Mon 20 Jul .. Wed 19 Aug — the last week is caught by the tail check.
        const keys = weekKeysInRange(new Date('2026-07-20T00:00:00'), new Date('2026-08-19T00:00:00'));
        expect(keys[keys.length - 1]).toBe('2026-W34');
    });

    it('crosses a year boundary in chronological order', () => {
        const keys = weekKeysInRange(new Date('2025-12-15T00:00:00'), new Date('2026-01-11T00:00:00'));
        expect(keys).toEqual(['2025-W51', '2025-W52', '2026-W01', '2026-W02']);
    });

    it('returns a single key for a range inside one week', () => {
        expect(weekKeysInRange(new Date('2026-08-11T00:00:00'), new Date('2026-08-13T00:00:00')))
            .toEqual(['2026-W33']);
    });
});

// ── buildHoursByEmployee ────────────────────────────────────────────────────

describe('buildHoursByEmployee', () => {
    const week = range('2026-08-10', '2026-08-16');

    it('totals paid hours by day and by ISO week', () => {
        const fold = buildHoursByEmployee(
            [
                shift({ shiftDate: '2026-08-10', netMinutes: 480 }),
                shift({ shiftDate: '2026-08-11', netMinutes: 420 }),
            ],
            members('p1'),
            week,
        );

        const p1 = fold.byProfile.get('p1')!;
        expect(p1.byDate['2026-08-10']).toHaveLength(1);
        expect(p1.byWeek['2026-W33']).toBe(15);
        expect(p1.totalHours).toBe(15);
    });

    it('sums several shifts on the same day into one date entry', () => {
        const fold = buildHoursByEmployee(
            [
                shift({ shiftDate: '2026-08-10', netMinutes: 240 }),
                shift({ shiftDate: '2026-08-10', netMinutes: 180 }),
            ],
            members('p1'),
            week,
        );
        expect(fold.byProfile.get('p1')!.byDate['2026-08-10']).toHaveLength(2);
        expect(fold.byProfile.get('p1')!.byWeek['2026-W33']).toBe(7);
    });

    it('gives a member with no shifts an empty entry rather than no entry', () => {
        const fold = buildHoursByEmployee([], members('p1', 'p2'), week);
        expect(fold.byProfile.get('p2')).toBeDefined();
        expect(fold.byProfile.get('p2')!.totalHours).toBe(0);
    });

    // Every assigned shift in production is a draft, so this figure is the
    // caveat on every total the page prints.
    it('tracks draft hours and draft dates separately from the total', () => {
        const fold = buildHoursByEmployee(
            [
                shift({ shiftDate: '2026-08-10', netMinutes: 480, isDraft: true }),
                shift({ shiftDate: '2026-08-11', netMinutes: 480, isDraft: false }),
            ],
            members('p1'),
            week,
        );
        const p1 = fold.byProfile.get('p1')!;
        expect(p1.totalHours).toBe(16);
        expect(p1.draftHours).toBe(8);
        expect([...p1.draftDates]).toEqual(['2026-08-10']);
    });

    it('ignores unassigned shifts — those are demand, not anybody hours', () => {
        const fold = buildHoursByEmployee(
            [shift({ shiftDate: '2026-08-10', assignedEmployeeId: null })],
            members('p1'),
            week,
        );
        expect(fold.byProfile.get('p1')!.totalHours).toBe(0);
        expect(fold.orphanShiftCount).toBe(0);
    });

    // The Grid invented a row for these people; this page counts them instead
    // of dropping them silently.
    it('reports shifts assigned to someone outside the member set', () => {
        const fold = buildHoursByEmployee(
            [
                shift({ shiftDate: '2026-08-10', assignedEmployeeId: 'ghost' }),
                shift({ shiftDate: '2026-08-11', assignedEmployeeId: 'ghost' }),
                shift({ shiftDate: '2026-08-11', assignedEmployeeId: 'p1' }),
            ],
            members('p1'),
            week,
        );
        expect(fold.orphanShiftCount).toBe(2);
        expect([...fold.orphanProfileIds]).toEqual(['ghost']);
        expect(fold.byProfile.has('ghost')).toBe(false);
    });

    it('spans week keys from the RANGE, not from the shifts it happened to see', () => {
        const fold = buildHoursByEmployee(
            [shift({ shiftDate: '2026-08-10' })],
            members('p1'),
            range('2026-07-20', '2026-08-16'),
        );
        expect(fold.sortedWeekKeys).toEqual(['2026-W30', '2026-W31', '2026-W32', '2026-W33']);
    });
});

// ── buildWeekColumns ────────────────────────────────────────────────────────

describe('buildWeekColumns', () => {
    it('produces one column per ISO week, in order', () => {
        const dates = [
            '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
            '2026-08-14', '2026-08-15', '2026-08-16',
            '2026-08-17', '2026-08-18',
        ];
        const cols = buildWeekColumns(dates);
        expect(cols.map((c) => c.key)).toEqual(['2026-W33', '2026-W34']);
        expect(cols[0].label).toBe('W33');
    });

    it('marks a whole visible week as complete', () => {
        const dates = [
            '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
            '2026-08-14', '2026-08-15', '2026-08-16',
        ];
        const [col] = buildWeekColumns(dates);
        expect(col.visibleDates).toHaveLength(7);
        expect(col.isPartial).toBe(false);
    });

    // A month view starts and ends mid-week; those columns still print the TRUE
    // full-week total, so the flag is what stops it reading as a sum of the
    // cells beside it.
    it('marks a week the range only partly covers', () => {
        const [col] = buildWeekColumns(['2026-08-14', '2026-08-15', '2026-08-16']);
        expect(col.isPartial).toBe(true);
        expect(col.visibleDates).toHaveLength(3);
    });

    it('keeps chronological order across a year boundary', () => {
        const cols = buildWeekColumns(['2025-12-29', '2026-01-01', '2026-01-05']);
        expect(cols.map((c) => c.key)).toEqual(['2026-W01', '2026-W02']);
    });

    it('returns nothing for an empty axis', () => {
        expect(buildWeekColumns([])).toEqual([]);
    });
});
