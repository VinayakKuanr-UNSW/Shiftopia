import { describe, it, expect } from 'vitest';
import { computeEmpComp, type ShiftPillData } from '../grid-compliance';

/**
 * Regression tests for the Annual Shift Grid's client-side compliance.
 *
 * The bug these lock: the Grid used to apply the ordinary-hours rolling caps
 * (2/3/4-week, 38h×weeks) to EVERY employee — including casuals — painting a
 * wall of false "VIOLATION 78h in 2w window" badges for a ~102/103-casual org.
 * The canonical v8 rule (compliance/v8/rules/ordinary-hours-avg.ts) exempts
 * casuals and uses the employee's contracted weekly hours as the basis.
 */

let idc = 0;
const pill = (netHours: number, isDraft = false): ShiftPillData => ({
    id: `p-${++idc}`,
    netHours,
    isDraft,
});

// Two consecutive ISO weeks totalling 78h (40 + 38) — over the FT 2-week cap (76h).
const byWeek = { 10: 40, 11: 38 };
const sortedWeekNums = [10, 11];

describe('computeEmpComp — casual exemption + contracted-hours basis', () => {
    it('exempts CASUAL from the rolling-window caps (no violation for a 78h fortnight)', () => {
        const r = computeEmpComp(byWeek, {}, sortedWeekNums, 'CASUAL');
        expect(r.overallV8Severity).toBe('ok');
        expect(r.weeks[11].windows).toHaveLength(0);
    });

    it('flags FT for the same 78h fortnight (over the 76h 2-week cap)', () => {
        const r = computeEmpComp(byWeek, {}, sortedWeekNums, 'FT');
        expect(r.overallV8Severity).toBe('violation');
        expect(r.weeks[11].windows.some(w => w.weeks === 2 && w.severity === 'violation')).toBe(true);
    });

    it('raises the cap when contracted_weekly_hours is higher (FT@40h → 80h/2wk, 78h is not a violation)', () => {
        const r = computeEmpComp(byWeek, {}, sortedWeekNums, 'FT', 40);
        expect(r.overallV8Severity).not.toBe('violation');
    });

    it('keeps rolling checks for unknown/null contract type (conservative — do not hide issues)', () => {
        const r = computeEmpComp(byWeek, {}, sortedWeekNums, null);
        expect(r.overallV8Severity).toBe('violation');
    });

    it('still enforces the daily hard cap (>12h/day) for CASUAL', () => {
        const byDate = { '2026-03-10': [pill(13)] };
        const r = computeEmpComp({}, byDate, [], 'CASUAL');
        expect(r.overallV8Severity).toBe('violation');
        expect(r.dailyViolations.has('2026-03-10')).toBe(true);
    });
});
