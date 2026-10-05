/**
 * The copy planner decides how many shifts get written, so every branch here is
 * a number of real rows in `shifts`.
 *
 * Two of these are the reason the feature was specified ambiguously in the first
 * place: what "exclude" means, and whether a bulk copy can overrun the cycle
 * ceiling by fitting each date individually.
 */
import { describe, expect, it } from 'vitest';
import { copyOutcomeToast, datesBetween, isoWeekdayOf, planCopy, type CopyPlanInput } from '../copyPlan';
import type { CycleRequirement, IsoWeekday, RawLeaveDay } from '../types';
import type { OfficeDay } from '../plannedWeek';
import type { Shift } from '@/modules/rosters/domain/shift.entity';

// Mon 28 Sep 2026 → Sun 11 Oct 2026, a clean fortnight.
const ALL = datesBetween('2026-09-28', '2026-10-11');

function cycle(over: Partial<CycleRequirement> = {}): CycleRequirement {
    return {
        cycleIndex: 0,
        start: '2026-09-28',
        endInclusive: '2026-10-25',
        ceilingHours: 152,
        activeDays: 28,
        cycleDays: 28,
        requiredHours: 152,
        existingHours: 0,
        paidLeaveHours: 0,
        publicHolidayCreditHours: 0,
        blockedDates: [],
        deficitHours: 152,
        deficitHoursIfElectionUnpaid: 152,
        ...over,
    };
}

function input(over: Partial<CopyPlanInput> = {}): CopyPlanInput {
    return {
        sourceDate: '2026-09-28',
        netMinutes: 456, // 7.6h — a compliant full-time day
        startDate: '2026-09-28',
        endDate: '2026-10-11',
        excludeWeekdays: new Set<IsoWeekday>(),
        existing: new Map<string, OfficeDay>(),
        approvedLeave: new Map<string, RawLeaveDay>(),
        // Everything writable unless a test says otherwise.
        writableDates: new Set(ALL),
        lockedOutDates: new Set<string>(),
        cycles: [cycle()],
        // The day before the fixture fortnight, so no date in it is past.
        today: '2026-09-27',
        ...over,
    };
}

function officeDay(dateKey: string): OfficeDay {
    return { dateKey, shift: { id: `s-${dateKey}` } as unknown as Shift, alsoOnThisDay: [] };
}

describe('isoWeekdayOf', () => {
    it('reports Monday as 1 and Sunday as 7', () => {
        expect(isoWeekdayOf('2026-09-28')).toBe(1);
        expect(isoWeekdayOf('2026-10-04')).toBe(7);
    });

    it('does not shift a date by the viewer’s timezone', () => {
        // Built in UTC on purpose: `new Date('2026-04-05').getDay()` reads the
        // LOCAL weekday of a UTC-midnight instant, which is a day out for any
        // viewer behind UTC. These are calendar dates and must not move.
        expect(isoWeekdayOf('2026-04-05')).toBe(7); // a Sunday
        expect(isoWeekdayOf('2026-01-01')).toBe(4); // a Thursday
    });
});

describe('datesBetween', () => {
    it('is inclusive of both ends', () => {
        expect(datesBetween('2026-09-28', '2026-09-30'))
            .toEqual(['2026-09-28', '2026-09-29', '2026-09-30']);
    });

    it('crosses a month boundary', () => {
        expect(datesBetween('2026-09-29', '2026-10-02'))
            .toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    });

    it('returns nothing for a reversed range', () => {
        expect(datesBetween('2026-10-02', '2026-09-29')).toEqual([]);
    });
});

describe('planCopy', () => {
    it('never copies onto the source date', () => {
        const plan = planCopy(input());
        expect(plan.targets).not.toContain('2026-09-28');
        // …and does not report it as a skip either: it is where the shift already is.
        expect(plan.skipped.map(s => s.date)).not.toContain('2026-09-28');
    });

    it('EXCLUDES the ticked weekdays — it does not copy only to them', () => {
        // The ambiguity that had to be settled before this could be built.
        // Ticking Sat+Sun over a fortnight writes the ten weekdays.
        const plan = planCopy(input({ excludeWeekdays: new Set<IsoWeekday>([6, 7]) }));

        expect(plan.targets).toHaveLength(9); // 10 weekdays minus the source
        expect(plan.targets).toContain('2026-09-29');
        expect(plan.targets).not.toContain('2026-10-03'); // Sat
        expect(plan.targets).not.toContain('2026-10-04'); // Sun
    });

    it('does not report an excluded weekday as skipped', () => {
        // The manager already decided. Listing four weekend dates as "skipped"
        // would bury the one date that genuinely could not be written.
        const plan = planCopy(input({ excludeWeekdays: new Set<IsoWeekday>([6, 7]) }));
        expect(plan.skipped).toEqual([]);
    });

    it('skips a day with approved leave, and says so', () => {
        const plan = planCopy(input({
            approvedLeave: new Map([['2026-09-30', {
                date: '2026-09-30', leaveType: 'annual', credit: 'CREDITS', status: 'approved',
            }]]),
        }));

        expect(plan.targets).not.toContain('2026-09-30');
        expect(plan.skipped).toContainEqual({ date: '2026-09-30', reason: 'On approved leave' });
    });

    it('skips a day that already has a shift, citing cl 39.1 in spirit', () => {
        const plan = planCopy(input({
            existing: new Map([['2026-09-29', officeDay('2026-09-29')]]),
        }));

        expect(plan.targets).not.toContain('2026-09-29');
        expect(plan.skipped).toContainEqual(
            { date: '2026-09-29', reason: 'Already rostered that day' });
    });

    it('distinguishes a locked roster from no roster at all', () => {
        // Two different answers for the manager: one is "wait for the roster to be
        // created", the other is "this roster is published, cl 38.2".
        const plan = planCopy(input({
            writableDates: new Set(ALL.filter(d => d !== '2026-10-01' && d !== '2026-10-02')),
            lockedOutDates: new Set(['2026-10-01']),
        }));

        expect(plan.skipped).toContainEqual({
            date: '2026-10-01', reason: 'Roster is published or locked (cl 38.2)',
        });
        expect(plan.skipped).toContainEqual({
            date: '2026-10-02', reason: 'No draft roster covers this date',
        });
    });

    it('stops at the cycle ceiling, counting the RUNNING total', () => {
        // The failure a bulk action introduces: each 7.6h day fits on its own, but
        // together they overrun cl 35.1(a). 144h booked against a 152h ceiling
        // leaves 8h — room for exactly one 7.6h day, and none after it.
        const plan = planCopy(input({
            cycles: [cycle({ existingHours: 144 })],
        }));

        expect(plan.targets).toHaveLength(1);
        expect(plan.skipped.length).toBeGreaterThan(0);
        expect(plan.skipped[0].reason).toContain('152.0h cycle ceiling');
    });

    it('refuses every date when there is no headroom at all', () => {
        // 148 + 7.6 overruns 152, so nothing fits — not even the first date.
        const plan = planCopy(input({ cycles: [cycle({ existingHours: 148 })] }));

        expect(plan.targets).toEqual([]);
        expect(plan.skipped).toHaveLength(13);
    });

    it('fills right up to the ceiling without stopping early', () => {
        // 152 / 7.6 = 20 days exactly, so a fortnight of them must all fit.
        const plan = planCopy(input({ cycles: [cycle({ existingHours: 0 })] }));
        expect(plan.targets).toHaveLength(13); // 14 days minus the source
        expect(plan.skipped).toEqual([]);
    });

    it('does not invent a ceiling for a date outside every cycle', () => {
        // No cycle covers October here. The ceiling cannot be checked, so the date
        // is passed through to the write gate rather than refused on a guess.
        const plan = planCopy(input({
            cycles: [cycle({ start: '2026-09-28', endInclusive: '2026-09-30' })],
        }));

        expect(plan.targets).toContain('2026-10-05');
    });

    it('reports nothing and targets nothing for a reversed range', () => {
        const plan = planCopy(input({ startDate: '2026-10-11', endDate: '2026-09-28' }));
        expect(plan.targets).toEqual([]);
        expect(plan.skipped).toEqual([]);
    });

    it('refuses every date before today, and says why', () => {
        // The grid behaves like the roster grid: no shift is created in the past.
        const plan = planCopy(input({ today: '2026-10-01' }));

        expect(plan.targets.every(d => d >= '2026-10-01')).toBe(true);
        expect(plan.targets).toContain('2026-10-01'); // today itself is not past
        expect(plan.skipped).toEqual([
            { date: '2026-09-29', reason: 'In the past' },
            { date: '2026-09-30', reason: 'In the past' },
        ]);
    });

    it('checks the past before anything else, so a past date is never "already rostered"', () => {
        const plan = planCopy(input({
            today: '2026-10-01',
            existing: new Map([['2026-09-29', officeDay('2026-09-29')]]),
        }));
        expect(plan.skipped.find(s => s.date === '2026-09-29')?.reason).toBe('In the past');
    });
});

describe('copyOutcomeToast', () => {
    it('always states both halves, even when nothing was skipped', () => {
        expect(copyOutcomeToast(['2026-10-07', '2026-10-05', '2026-10-29', '2026-10-06'], []))
            .toEqual({ title: 'Copied to 4 dates (5 Oct – 29 Oct), 0 dates skipped' });
    });

    it('singularises, and gives the first reasons', () => {
        const t = copyOutcomeToast(['2026-10-05'], [{ date: '2026-10-03', reason: 'On approved leave' }]);
        expect(t.title).toBe('Copied to 1 date (5 Oct), 1 date skipped');
        expect(t.description).toBe('2026-10-03: On approved leave');
    });

    it('caps the reasons at three with a tail count', () => {
        const skips = ['01', '02', '03', '04', '05'].map(d => ({ date: `2026-10-${d}`, reason: 'In the past' }));
        const t = copyOutcomeToast([], skips);
        expect(t.title).toBe('Copied to 0 dates, 5 dates skipped');
        expect(t.description).toMatch(/…and 2 more$/);
    });
});

describe('planCopy — leave and public holidays count toward the ceiling (cl 35.1(a))', () => {
    it('stops a copy that fits on rostered hours alone but not once leave is counted', () => {
        // 114h rostered + 38h annual leave = 152h already. One more 7.6h day is
        // 159.6h of ordinary hours — the excess would be overtime (cl 42.1).
        const plan = planCopy(input({
            endDate: '2026-09-29',
            cycles: [cycle({ existingHours: 114, paidLeaveHours: 38 })],
        }));
        expect(plan.targets).toEqual([]);
        expect(plan.skipped[0].reason).toMatch(/once 38\.0h of leave and public holidays is counted/);
    });

    it('counts public-holiday credit the same way (cl 56.4)', () => {
        const plan = planCopy(input({
            endDate: '2026-09-29',
            cycles: [cycle({ existingHours: 144.4, publicHolidayCreditHours: 7.6 })],
        }));
        expect(plan.targets).toEqual([]);
    });

    it('still copies when rostered + credited + the copy fits exactly', () => {
        const plan = planCopy(input({
            endDate: '2026-09-29',
            cycles: [cycle({ existingHours: 106.4, paidLeaveHours: 38 })],
        }));
        expect(plan.targets).toEqual(['2026-09-29']);
    });
});

