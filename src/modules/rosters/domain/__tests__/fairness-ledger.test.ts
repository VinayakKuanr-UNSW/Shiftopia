import { describe, expect, it } from 'vitest';
import {
    ALL_FAIRNESS_METRICS,
    categoryMinutes,
    effectiveDebtsByEmployee,
    projectFairnessImpact,
    type FairnessStanding,
} from '../fairness-ledger';

const PH = new Set(['2026-12-25', '2026-12-26']);
const isPH = (d: string) => PH.has(d);

const standing = (over: Partial<FairnessStanding>): FairnessStanding => ({
    employeeId: 'A',
    metric: 'total_hours',
    actualHours: 0,
    expectedHours: 0,
    debtHours: 0,
    opportunityCount: 1,
    confidence: 0.1,
    windowStart: '2026-11-07',
    windowEnd: '2026-12-31',
    ...over,
});

describe('categoryMinutes — mirrors public.fairness_category_minutes', () => {
    // Same cases, same numbers as section 1 of supabase/tests/casual_fairness_engine.sql.
    it.each([
        ['Sunday day',                   '2026-12-06', '09:00', '17:00', 480, { total: 480, saturday: 0,   sunday: 480, public_holiday: 0,   night: 0 }],
        ['Sat→Sun overnight, 30m break', '2026-12-05', '20:00', '04:00', 450, { total: 450, saturday: 225, sunday: 225, public_holiday: 0,   night: 337.5 }],
        ['Christmas (Fri)',              '2026-12-25', '10:00', '14:00', 240, { total: 240, saturday: 0,   sunday: 0,   public_holiday: 240, night: 0 }],
        ['Boxing Day is a Saturday',     '2026-12-26', '10:00', '14:00', 240, { total: 240, saturday: 240, sunday: 0,   public_holiday: 240, night: 0 }],
        ['evening reaches 22:00',        '2026-12-07', '20:00', '23:00', 180, { total: 180, saturday: 0,   sunday: 0,   public_holiday: 0,   night: 60 }],
        ['early morning before 06:00',   '2026-12-07', '05:00', '07:00', 120, { total: 120, saturday: 0,   sunday: 0,   public_holiday: 0,   night: 60 }],
        ['Christmas Eve night into PH',  '2026-12-24', '22:00', '06:00', 480, { total: 480, saturday: 0,   sunday: 0,   public_holiday: 360, night: 480 }],
    ])('%s', (_label, date, start, end, net, expected) => {
        expect(categoryMinutes(date, start, end, net, isPH)).toEqual(expected);
    });

    it('a shift ending at midnight is not night work', () => {
        expect(categoryMinutes('2026-12-07', '18:00', '00:00', 360, isPH).night).toBe(120);
        expect(categoryMinutes('2026-12-07', '12:00', '22:00', 600, isPH).night).toBe(0);
    });
});

describe('effectiveDebtsByEmployee', () => {
    it('weights each debt by its confidence, keyed by employee and metric', () => {
        const map = effectiveDebtsByEmployee([
            standing({ employeeId: 'A', metric: 'sunday_hours', debtHours: -4, confidence: 0.4 }),
            standing({ employeeId: 'A', metric: 'total_hours', debtHours: -9, confidence: 1 }),
            standing({ employeeId: 'C', metric: 'sunday_hours', debtHours: 4, confidence: 0.1 }),
        ]);
        expect(map.get('A')).toEqual({ sunday_hours: -1.6, total_hours: -9 });
        expect(map.get('C')).toEqual({ sunday_hours: 0.4 });
        expect(map.has('B')).toBe(false);
    });
});

describe('projectFairnessImpact — if this bidder is awarded the shift', () => {
    const sunday = { shiftDate: '2026-12-06', startTime: '09:00', endTime: '17:30', unpaidBreakMinutes: 30 };

    it('adds the hours to actual and one fair share to expected', () => {
        // A from the design example: Sunday 20 expected, 16 actual, −4 debt.
        const impact = projectFairnessImpact(
            [standing({ metric: 'sunday_hours', expectedHours: 20, actualHours: 16, debtHours: -4, opportunityCount: 4, confidence: 0.4 })],
            sunday, 2, isPH,
        );
        expect(impact.changed).toEqual(['total_hours', 'sunday_hours']);
        expect(impact.before.sunday_hours).toEqual({ actual: 16, expected: 20, debt: -4, opportunities: 4, confidence: 0.4 });
        expect(impact.after.sunday_hours).toEqual({ actual: 24, expected: 24, debt: 0, opportunities: 5, confidence: 0.5 });
    });

    it('the only candidate takes exactly their fair share: debt unchanged', () => {
        const impact = projectFairnessImpact([], sunday, 1, isPH);
        expect(impact.before.sunday_hours).toEqual({ actual: 0, expected: 0, debt: 0, opportunities: 0, confidence: 0 });
        expect(impact.after.sunday_hours).toEqual({ actual: 8, expected: 8, debt: 0, opportunities: 1, confidence: 0.1 });
    });

    it('a weekday day shift moves total hours only', () => {
        const impact = projectFairnessImpact([], { shiftDate: '2026-12-07', startTime: '09:00', endTime: '13:00' }, 4, isPH);
        expect(impact.changed).toEqual(['total_hours']);
        expect(impact.after.total_hours).toEqual({ actual: 4, expected: 1, debt: 3, opportunities: 1, confidence: 0.1 });
    });

    it('never projects overtime: awarding a shift does not bill beyond its roster', () => {
        expect(ALL_FAIRNESS_METRICS).toContain('overtime_hours');
        const impact = projectFairnessImpact([], sunday, 2, isPH);
        expect(impact.changed).not.toContain('overtime_hours');
    });
});
