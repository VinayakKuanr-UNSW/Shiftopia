/**
 * Greedy-fallback utilization scoring.
 *
 * Three independent defects met at this one term and compounded into a
 * ranking input that could not influence the ranking at all:
 *
 *   a. the denominator read `employeeDetails.min_contract_minutes`, which
 *      nothing populates — so it was 0 for everyone, `utl` was a constant 0,
 *      the over-cap penalty could never fire and the under-load bonus was a
 *      fixed offset that cancels out of the argmax;
 *   b. the denominator was WEEKLY while the numerator spanned the window plus
 *      `fetchExistingRoster`'s 28-day rolling-context lookback;
 *   c. `acc + s.duration_minutes || 0` parses as `(acc + duration) || 0`, so a
 *      shift carrying no duration reset the running total to zero instead of
 *      contributing nothing — and the newly-proposed shifts built inside the
 *      scorer carried no duration.
 *
 * The fallback fires when OR-Tools is unhealthy, i.e. when nobody is watching,
 * so a silently inert fairness term there is worth more than one test.
 */

import { describe, expect, it, vi } from 'vitest';

// These modules drag in Supabase/optimizer internals at import time and must
// be stubbed for the controller module to load. Mirrors the mocking strategy
// in greedy-fallback-weekly-ot.test.ts.
vi.mock('@/modules/scheduling/validation', async (importOriginal) => {
    const original = await importOriginal() as any;
    return { ...original, assignmentValidator: { simulate: vi.fn() } };
});
vi.mock('@/modules/scheduling/validation/engine/assignment-committer', async (importOriginal) => {
    const original = await importOriginal() as any;
    return { ...original, assignmentCommitter: { commitAtomic: vi.fn(), commit: vi.fn() } };
});
vi.mock('@/modules/scheduling/optimizer/optimizer.client', () => ({
    optimizerClient: { optimize: vi.fn(), healthCheck: vi.fn() },
    OptimizerError: class OptimizerError extends Error {},
}));
vi.mock('@/modules/scheduling/data/roster-fetcher', () => ({
    rosterFetcher: { fetchExistingRoster: vi.fn(), fetchAvailability: vi.fn() },
    durationMinutes: (start: string, end: string) => {
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        let mins = (eh * 60 + em) - (sh * 60 + sm);
        if (mins <= 0) mins += 1440;
        return mins;
    },
}));
vi.mock('@/modules/scheduling/audit/auditor', () => ({ auditor: { audit: vi.fn() } }));

import {
    greedyUtilizationTerms,
    inWindowScheduledMinutes,
    windowContractObligationMinutes,
} from '../auto-scheduler.controller';

const FT_WEEK = 2280; // 38h

/** `strategyMult(50)`, the default fairness weight, is 1. */
const NEUTRAL_MULT = 1;

describe('inWindowScheduledMinutes', () => {
    it('sums durations inside the window', () => {
        expect(inWindowScheduledMinutes([
            { shift_date: '2026-09-01', duration_minutes: 480 },
            { shift_date: '2026-09-02', duration_minutes: 300 },
        ], '2026-09-01')).toBe(780);
    });

    it('excludes the 28-day rolling-context lookback', () => {
        // `fetchExistingRoster` reaches back 28 days for the rest-gap and
        // rolling-average checks. Counting that history against a window-sized
        // obligation reported everyone as hugely over-utilized.
        expect(inWindowScheduledMinutes([
            { shift_date: '2026-08-10', duration_minutes: 480 },  // lookback
            { shift_date: '2026-08-25', duration_minutes: 480 },  // lookback
            { shift_date: '2026-09-01', duration_minutes: 480 },  // in window
        ], '2026-09-01')).toBe(480);
    });

    it('treats a shift with no duration as zero, NOT as a reset', () => {
        // The precedence bug: `acc + undefined` is NaN and `NaN || 0` is 0, so
        // the untyped shift wiped the 480 in front of it.
        expect(inWindowScheduledMinutes([
            { shift_date: '2026-09-01', duration_minutes: 480 },
            { shift_date: '2026-09-02' },
            { shift_date: '2026-09-03', duration_minutes: 300 },
        ], '2026-09-01')).toBe(780);
    });

    it('is not derailed by a non-finite duration', () => {
        expect(inWindowScheduledMinutes([
            { shift_date: '2026-09-01', duration_minutes: 480 },
            { shift_date: '2026-09-02', duration_minutes: NaN },
        ], '2026-09-01')).toBe(480);
    });

    it('counts everything when the window start is unknown', () => {
        expect(inWindowScheduledMinutes([
            { shift_date: '2026-08-10', duration_minutes: 480 },
            { shift_date: '2026-09-01', duration_minutes: 300 },
        ], null)).toBe(780);
    });

    it('returns zero for an empty roster', () => {
        expect(inWindowScheduledMinutes([], '2026-09-01')).toBe(0);
    });
});

describe('greedyUtilizationTerms', () => {
    it('is fully neutral for an employee with no contract obligation', () => {
        // Casuals. Previously they scored 0% utilized and collected the MAXIMUM
        // under-load bonus (80 * 5 * mult = 400), outranking every partially
        // loaded permanent.
        expect(greedyUtilizationTerms(0, 0, NEUTRAL_MULT))
            .toEqual({ utilization: 0, penalty: 0, bonus: 0 });
        expect(greedyUtilizationTerms(2400, 0, NEUTRAL_MULT))
            .toEqual({ utilization: 0, penalty: 0, bonus: 0 });
    });

    it('ranks a starved full-timer above a casual', () => {
        // The whole point of the term, and what it could not do before: an
        // unloaded FT must attract work that a no-obligation casual does not.
        const ft = greedyUtilizationTerms(0, FT_WEEK, NEUTRAL_MULT);
        const casual = greedyUtilizationTerms(0, 0, NEUTRAL_MULT);
        expect(ft.bonus).toBeGreaterThan(casual.bonus);
        expect(ft.bonus - ft.penalty).toBeGreaterThan(casual.bonus - casual.penalty);
    });

    it('ranks a starved full-timer above a half-loaded one', () => {
        const starved = greedyUtilizationTerms(0, FT_WEEK, NEUTRAL_MULT);
        const half = greedyUtilizationTerms(FT_WEEK / 2, FT_WEEK, NEUTRAL_MULT);
        expect(starved.bonus).toBeGreaterThan(half.bonus);
    });

    it('gives no bonus at or above the 80% under-load threshold', () => {
        expect(greedyUtilizationTerms(FT_WEEK * 0.8, FT_WEEK, NEUTRAL_MULT).bonus).toBe(0);
        expect(greedyUtilizationTerms(FT_WEEK * 0.9, FT_WEEK, NEUTRAL_MULT).bonus).toBe(0);
    });

    it('penalises past 100% and scales with the overshoot', () => {
        // Dead before: the denominator was 0, so `utl > 100` never held and an
        // over-loaded employee was indistinguishable from an idle one.
        const over = greedyUtilizationTerms(FT_WEEK * 1.5, FT_WEEK, NEUTRAL_MULT);
        expect(over.utilization).toBeCloseTo(150, 6);
        expect(over.penalty).toBeCloseTo(50 * 10, 6);
        expect(over.bonus).toBe(0);

        const worse = greedyUtilizationTerms(FT_WEEK * 2, FT_WEEK, NEUTRAL_MULT);
        expect(worse.penalty).toBeGreaterThan(over.penalty);
    });

    it('is neutral exactly at 100%', () => {
        const exact = greedyUtilizationTerms(FT_WEEK, FT_WEEK, NEUTRAL_MULT);
        expect(exact.utilization).toBeCloseTo(100, 6);
        expect(exact.penalty).toBe(0);
        expect(exact.bonus).toBe(0);
    });

    it('scales the bonus by the fairness multiplier but never the penalty', () => {
        // The over-cap penalty is a hard limit, not a strategy lever — the
        // fairness slider must not be able to buy its way past it.
        const soft = greedyUtilizationTerms(0, FT_WEEK, 0.5);
        const hard = greedyUtilizationTerms(0, FT_WEEK, 2);
        expect(hard.bonus).toBeCloseTo(soft.bonus * 4, 6);

        const overSoft = greedyUtilizationTerms(FT_WEEK * 2, FT_WEEK, 0.5);
        const overHard = greedyUtilizationTerms(FT_WEEK * 2, FT_WEEK, 2);
        expect(overSoft.penalty).toBe(overHard.penalty);
    });
});

describe('greedy utilization against the window obligation', () => {
    it('reads a full-timer working their contract as 100%, not as over-loaded', () => {
        // The scale mismatch: a WEEKLY denominator against 4 weeks of scheduled
        // minutes made a correctly-loaded FT look 400% utilized and take a
        // 3000-point penalty for meeting their contract.
        const weekScale = 4;
        const obligation = windowContractObligationMinutes(FT_WEEK, weekScale, 0);
        const scheduled = FT_WEEK * weekScale;

        const terms = greedyUtilizationTerms(scheduled, obligation, NEUTRAL_MULT);
        expect(terms.utilization).toBeCloseTo(100, 6);
        expect(terms.penalty).toBe(0);

        // What the old weekly denominator produced, for contrast.
        const mismatched = greedyUtilizationTerms(scheduled, FT_WEEK, NEUTRAL_MULT);
        expect(mismatched.utilization).toBeCloseTo(400, 6);
        expect(mismatched.penalty).toBeCloseTo(3000, 6);
    });

    it('does not chase a full-timer whose leave spans the window', () => {
        // Obligation nets to 0, so the term goes neutral rather than reporting
        // 0% utilized and flooding them with shifts they may not work.
        const obligation = windowContractObligationMinutes(FT_WEEK, 4, 28);
        expect(obligation).toBe(0);
        expect(greedyUtilizationTerms(0, obligation, NEUTRAL_MULT))
            .toEqual({ utilization: 0, penalty: 0, bonus: 0 });
    });

    it('still prefers a part-timer who is under their (smaller) contract', () => {
        // 12h scheduled is under a 20h PT week but well over nothing at all;
        // the ratio, not the raw hours, is what ranks them.
        const ptObligation = windowContractObligationMinutes(1200, 1, 0);
        const pt = greedyUtilizationTerms(720, ptObligation, NEUTRAL_MULT);
        expect(pt.utilization).toBeCloseTo(60, 6);
        expect(pt.bonus).toBeGreaterThan(0);

        // A full-timer at the same 12h is further from their contract and so
        // outranks the part-timer for the next shift.
        const ftObligation = windowContractObligationMinutes(FT_WEEK, 1, 0);
        const ft = greedyUtilizationTerms(720, ftObligation, NEUTRAL_MULT);
        expect(ft.bonus).toBeGreaterThan(pt.bonus);
    });
});
