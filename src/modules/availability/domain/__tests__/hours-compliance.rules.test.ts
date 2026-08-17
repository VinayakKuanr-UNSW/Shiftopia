import { describe, expect, it } from 'vitest';
import { computeEmpComp, type ShiftHours } from '../hours-compliance';

/**
 * Regression tests for client-side hours compliance.
 *
 * The first five are carried over from the Annual Shift Grid
 * (`insights/model/__tests__/grid-compliance.test.ts`) and lock the bug that
 * fix was written for: the Grid applied the ordinary-hours rolling caps
 * (2/3/4-week, 38h × weeks) to EVERY employee — casuals included — painting a
 * wall of false "VIOLATION 78h in 2w window" badges. The canonical v8 rule
 * (`compliance/v8/rules/ordinary-hours-avg.ts`) exempts casuals and uses the
 * employee's contracted weekly hours as the basis.
 *
 * They are re-keyed from bare ISO week numbers onto `yyyy-Www`; the assertions
 * are unchanged.
 */

let idc = 0;
const pill = (netHours: number, isDraft = false): ShiftHours => ({
    id: `p-${++idc}`,
    netHours,
    isDraft,
});

// Two consecutive ISO weeks totalling 78h (40 + 38) — over the FT 2-week cap (76h).
const byWeek = { '2026-W10': 40, '2026-W11': 38 };
const weekKeys = ['2026-W10', '2026-W11'];

describe('computeEmpComp — casual exemption + contracted-hours basis', () => {
    it('exempts CASUAL from the rolling-window caps (no violation for a 78h fortnight)', () => {
        const r = computeEmpComp(byWeek, {}, weekKeys, 'CASUAL');
        expect(r.overallV8Severity).toBe('ok');
        expect(r.weeks['2026-W11'].windows).toHaveLength(0);
    });

    it('flags FT for the same 78h fortnight (over the 76h 2-week cap)', () => {
        const r = computeEmpComp(byWeek, {}, weekKeys, 'FT');
        expect(r.overallV8Severity).toBe('violation');
        expect(r.weeks['2026-W11'].windows.some(w => w.weeks === 2 && w.severity === 'violation')).toBe(true);
    });

    it('raises the cap when contracted_weekly_hours is higher (FT@40h → 80h/2wk, 78h is not a violation)', () => {
        const r = computeEmpComp(byWeek, {}, weekKeys, 'FT', 40);
        expect(r.overallV8Severity).not.toBe('violation');
    });

    it('lowers the cap for a part-timer (PT@20h → 40h/2wk, 78h is a violation)', () => {
        const r = computeEmpComp(byWeek, {}, weekKeys, 'PT', 20);
        expect(r.overallV8Severity).toBe('violation');
    });

    it('keeps rolling checks for unknown/null contract type (conservative — do not hide issues)', () => {
        const r = computeEmpComp(byWeek, {}, weekKeys, null);
        expect(r.overallV8Severity).toBe('violation');
    });

    it('still enforces the daily hard cap (>12h/day) for CASUAL', () => {
        const byDate = { '2026-03-10': [pill(13)] };
        const r = computeEmpComp({}, byDate, [], 'CASUAL');
        expect(r.overallV8Severity).toBe('violation');
        expect(r.dailyViolations.has('2026-03-10')).toBe(true);
    });

    it('warns rather than violates between the soft and hard daily caps', () => {
        const r = computeEmpComp({}, { '2026-03-10': [pill(11)] }, [], 'CASUAL');
        expect(r.overallV8Severity).toBe('warning');
        expect(r.dailyWarnings.has('2026-03-10')).toBe(true);
    });

    it('sums a split day before applying the daily cap', () => {
        const r = computeEmpComp({}, { '2026-03-10': [pill(7), pill(6)] }, [], 'CASUAL');
        expect(r.dailyViolations.has('2026-03-10')).toBe(true);
    });
});

/**
 * The reason `useTeamHours` reads a wider range than the page displays.
 *
 * @see docs/architecture/availability-manager-grid-merge-plan.md §2.1
 */
describe('computeEmpComp — the rolling window needs its lookback', () => {
    // Four consecutive 40h weeks. Any adjacent pair is 80h, over the 76h
    // two-week cap for a 38h full-timer.
    const fourWeeks = {
        '2026-W30': 40,
        '2026-W31': 40,
        '2026-W32': 40,
        '2026-W33': 40,
    };
    const widened = ['2026-W30', '2026-W31', '2026-W32', '2026-W33'];
    const visibleOnly = ['2026-W33'];

    it('reports a violation when the three prior weeks are in scope', () => {
        const r = computeEmpComp(fourWeeks, {}, widened, 'FT');
        expect(r.overallV8Severity).toBe('violation');
    });

    // THE FAILURE THIS DESIGN EXISTS TO PREVENT. Same employee, same hours,
    // same breach — but computed from the single visible week, no window has
    // enough entries to evaluate and the page reports a confident all-clear.
    it('reports a false all-clear from the visible week alone', () => {
        const r = computeEmpComp(fourWeeks, {}, visibleOnly, 'FT');
        expect(r.overallV8Severity).toBe('ok');
        expect(r.weeks['2026-W33'].windows).toHaveLength(0);
    });

    it('attributes the window to the week it ENDS in, so the badge lands on screen', () => {
        const r = computeEmpComp(fourWeeks, {}, widened, 'FT');
        expect(r.weeks['2026-W33'].windows.length).toBeGreaterThan(0);
        // W30 opens the range — nothing precedes it, so no window closes there.
        expect(r.weeks['2026-W30'].windows).toHaveLength(0);
    });

    it('still exempts a casual over the same four weeks', () => {
        expect(computeEmpComp(fourWeeks, {}, widened, 'CASUAL').overallV8Severity).toBe('ok');
    });
});

describe('computeEmpComp — week keys crossing a year boundary', () => {
    // Bare ISO week numbers would sort [1, 2, 51, 52], putting January before
    // the December that precedes it and averaging non-adjacent weeks.
    const acrossNewYear = {
        '2025-W51': 40,
        '2025-W52': 40,
        '2026-W01': 40,
        '2026-W02': 40,
    };
    const keys = ['2025-W51', '2025-W52', '2026-W01', '2026-W02'];

    it('treats December and January as adjacent weeks', () => {
        const r = computeEmpComp(acrossNewYear, {}, keys, 'FT');
        expect(r.overallV8Severity).toBe('violation');
        // The window closing in the first January week draws on December.
        expect(r.weeks['2026-W01'].windows.some(w => w.weeks === 2)).toBe(true);
    });

    it('sorts its keys the same way the sweep walks them', () => {
        expect([...keys].sort()).toEqual(keys);
    });
});
