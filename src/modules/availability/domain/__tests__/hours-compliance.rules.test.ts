import { describe, expect, it } from 'vitest';
import { computeEmpComp, mondayOfWeekKey, type ShiftHours } from '../hours-compliance';

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
 * They are re-keyed from bare ISO week numbers onto `yyyy-Www`.
 *
 * ── 2026-08-26: rolling windows became anchored cycles ──────────────────────
 *
 * cl 35.x(a)'s ladder (38h/1wk, 76h/2wk, 114h/3wk OR 152h/4wk) is a DISJUNCTION
 * over the cycle the engagement declares — cl 12.2(b), "a work cycle of up to
 * four (4) weeks" — not four caps applied at once. So these fixtures now pass an
 * explicit `cycleWeeks`, and the week keys are chosen to sit inside ONE cycle of
 * that length rather than merely to be adjacent. Two adjacent weeks are not
 * automatically one fortnight: with the shared 2024-01-01 anchor, 2026-W10 and
 * 2026-W11 fall in different two-week cycles, while W11 and W12 share one.
 */

let idc = 0;
const pill = (netHours: number, isDraft = false): ShiftHours => ({
    id: `p-${++idc}`,
    netHours,
    isDraft,
});

// Two ISO weeks inside ONE two-week cycle, totalling 78h (40 + 38) — over the
// 76h ceiling cl 35.x(a)(ii) sets for a declared fortnightly cycle. W11 and W12
// share cycle 57 (2026-03-09 .. 2026-03-22); W10 and W11 would not.
const byWeek = { '2026-W11': 40, '2026-W12': 38 };
const weekKeys = ['2026-W11', '2026-W12'];
const FORTNIGHT = 2;

describe('computeEmpComp — casual exemption + contracted-hours basis', () => {
    it('exempts CASUAL from the rolling-window caps (no violation for a 78h fortnight)', () => {
        const r = computeEmpComp(byWeek, {}, weekKeys, 'CASUAL', undefined, FORTNIGHT);
        expect(r.overallV8Severity).toBe('ok');
        expect(r.weeks['2026-W12'].windows).toHaveLength(0);
    });

    it('flags FT for the same 78h fortnight (over the 76h 2-week cap)', () => {
        const r = computeEmpComp(byWeek, {}, weekKeys, 'FT', undefined, FORTNIGHT);
        expect(r.overallV8Severity).toBe('violation');
        expect(r.weeks['2026-W12'].windows.some(w => w.kind === 'cycle' && w.severity === 'violation')).toBe(true);
    });

    it('raises the cap when contracted_weekly_hours is higher (FT@40h → 80h/2wk, 78h is not a violation)', () => {
        const r = computeEmpComp(byWeek, {}, weekKeys, 'FT', 40, FORTNIGHT);
        expect(r.overallV8Severity).not.toBe('violation');
    });

    it('lowers the cap for a part-timer (PT@20h → 40h/2wk, 78h is a violation)', () => {
        const r = computeEmpComp(byWeek, {}, weekKeys, 'PT', 20, FORTNIGHT);
        expect(r.overallV8Severity).toBe('violation');
    });

    it('keeps rolling checks for unknown/null contract type (conservative — do not hide issues)', () => {
        const r = computeEmpComp(byWeek, {}, weekKeys, null, undefined, FORTNIGHT);
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
describe('computeEmpComp — the cycle needs its lookback', () => {
    // The reason `useTeamHours` fetches COMPLIANCE_LOOKBACK_DAYS (21 = three
    // weeks) before the visible range: a four-week cycle whose start precedes
    // what is on screen must still be summed whole.
    // W29..W32 are the four ISO weeks of cycle 33 (2026-07-13 .. 2026-08-09).
    // 160h against the 152h ceiling.
    const fourWeeks = {
        '2026-W29': 40,
        '2026-W30': 40,
        '2026-W31': 40,
        '2026-W32': 40,
    };
    const widened = ['2026-W29', '2026-W30', '2026-W31', '2026-W32'];
    const visibleOnly = ['2026-W32'];

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
        expect(r.weeks['2026-W32'].windows).toHaveLength(0);
    });

    it('attributes the window to the week it ENDS in, so the badge lands on screen', () => {
        const r = computeEmpComp(fourWeeks, {}, widened, 'FT');
        expect(r.weeks['2026-W32'].windows.length).toBeGreaterThan(0);
        // The badge lands on the LAST week of the cycle that is in scope, so it
        // is drawn on screen rather than in the invisible lookback.
        expect(r.weeks['2026-W29'].windows).toHaveLength(0);
    });

    it('still exempts a casual over the same four weeks', () => {
        expect(computeEmpComp(fourWeeks, {}, widened, 'CASUAL').overallV8Severity).toBe('ok');
    });
});

describe('computeEmpComp — week keys crossing a year boundary', () => {
    // Cycle 26 runs 2025-12-29 .. 2026-01-25. Its first week is keyed 2026-W01
    // even though that week's MONDAY is in December 2025 — which is exactly why
    // the cycle maths keys off the Monday and never off the label's year.
    const acrossNewYear = {
        '2026-W01': 40,
        '2026-W02': 40,
        '2026-W03': 40,
        '2026-W04': 40,
    };
    const keys = ['2026-W01', '2026-W02', '2026-W03', '2026-W04'];

    it('resolves a week key to its Monday, not to its label year', () => {
        expect(mondayOfWeekKey('2026-W01')).toBe('2025-12-29');
        expect(mondayOfWeekKey('2025-W52')).toBe('2025-12-22');
    });

    it('sums a cycle that begins in the previous calendar year', () => {
        const r = computeEmpComp(acrossNewYear, {}, keys, 'FT');
        expect(r.overallV8Severity).toBe('violation');
        expect(r.weeks['2026-W04'].windows.some(w => w.kind === 'cycle')).toBe(true);
    });

    it('sorts its keys the same way the sweep walks them', () => {
        expect([...keys].sort()).toEqual(keys);
    });
});
