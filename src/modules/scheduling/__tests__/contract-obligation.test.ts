/**
 * HC-7 contract obligation — leave credit and contract-weighted fair share.
 *
 * These cover the two arithmetic defects that made the solver's Tier-1
 * min-contract penalty (100,000/minute) unsatisfiable or vacuous:
 *   1. approved leave was excluded as `unavailable_dates` but never credited
 *      against the obligation those same dates make impossible to discharge;
 *   2. the fair-share cap divided demand by RAW headcount, so a casual-heavy
 *      pool erased the permanent workforce's contract floor.
 */

import { describe, it, expect } from 'vitest';
import {
    FAIR_SHARE_BUFFER,
    baselineWeeklyContractMinutes,
    buildFairShareCaps,
    resolveContractObligationMinutes,
} from '../auto-scheduler.controller';

const FT_WEEK = 2280; // 38h
const PT_WEEK = 1200; // 20h

/** A cap large enough never to bind, so a test can isolate the leave credit. */
const UNCAPPED = Number.MAX_SAFE_INTEGER;

describe('baselineWeeklyContractMinutes', () => {
    it('resolves the canonical tokens', () => {
        expect(baselineWeeklyContractMinutes('FT')).toBe(FT_WEEK);
        expect(baselineWeeklyContractMinutes('PT')).toBe(PT_WEEK);
        expect(baselineWeeklyContractMinutes('CASUAL')).toBe(0);
    });

    it('resolves the long-form employment statuses the pool actually carries', () => {
        expect(baselineWeeklyContractMinutes('Full-Time')).toBe(FT_WEEK);
        expect(baselineWeeklyContractMinutes('Part-Time')).toBe(PT_WEEK);
        // 'Flexible Part-Time' is a PART-TIME contract and keeps its floor —
        // mirrors `toContractType` in availability/domain/contract-basis.ts.
        expect(baselineWeeklyContractMinutes('Flexible Part-Time')).toBe(PT_WEEK);
        expect(baselineWeeklyContractMinutes('Casual')).toBe(0);
    });

    it('treats an unknown or absent contract type as HC-7 exempt', () => {
        // Conservative in the direction that matters here: inventing a floor for
        // someone we cannot classify would charge the solver 100,000/min for
        // hours nobody is owed.
        expect(baselineWeeklyContractMinutes(null)).toBe(0);
        expect(baselineWeeklyContractMinutes(undefined)).toBe(0);
        expect(baselineWeeklyContractMinutes('')).toBe(0);
    });
});

describe('resolveContractObligationMinutes — leave credit', () => {
    it('charges the full scaled obligation when there is no leave', () => {
        expect(resolveContractObligationMinutes({
            weeklyContractMinutes: FT_WEEK,
            weekScale: 4,
            leaveDays: 0,
            fairShareCapMinutes: UNCAPPED,
        })).toBe(FT_WEEK * 4);
    });

    it('cancels exactly one week of obligation per 7 calendar days of leave', () => {
        // The case that matters: a fortnight of annual leave inside a 4-week
        // window leaves precisely a fortnight of obligation.
        expect(resolveContractObligationMinutes({
            weeklyContractMinutes: FT_WEEK,
            weekScale: 4,
            leaveDays: 14,
            fairShareCapMinutes: UNCAPPED,
        })).toBe(FT_WEEK * 2);
    });

    it('zeroes the obligation when leave spans the whole window', () => {
        // Previously the solver was told "you may not work any of these 28 days"
        // (unavailable_dates) AND "you still owe 152h" — an unavoidable ~9.1e8
        // Tier-1 penalty that flattens every trade-off ranked beneath it.
        expect(resolveContractObligationMinutes({
            weeklyContractMinutes: FT_WEEK,
            weekScale: 4,
            leaveDays: 28,
            fairShareCapMinutes: UNCAPPED,
        })).toBe(0);
    });

    it('never returns a negative obligation when leave overruns the window', () => {
        expect(resolveContractObligationMinutes({
            weeklyContractMinutes: FT_WEEK,
            weekScale: 1,
            leaveDays: 30,
            fairShareCapMinutes: UNCAPPED,
        })).toBe(0);
    });

    it('credits leave pro-rata on CALENDAR days, matching the weekScale basis', () => {
        // A Fri-Mon spell is 4 calendar dates (fetchApprovedLeave expands
        // weekends), so it credits 4/7 of a week rather than the 2 working days
        // it really costs. Documented over-credit: it errs toward UNDER-
        // obligating, which is the safe direction.
        expect(resolveContractObligationMinutes({
            weeklyContractMinutes: FT_WEEK,
            weekScale: 1,
            leaveDays: 4,
            fairShareCapMinutes: UNCAPPED,
        })).toBeCloseTo(FT_WEEK - (FT_WEEK / 7) * 4, 6);
    });

    it('leaves casuals exempt regardless of leave', () => {
        expect(resolveContractObligationMinutes({
            weeklyContractMinutes: 0,
            weekScale: 4,
            leaveDays: 0,
            fairShareCapMinutes: UNCAPPED,
        })).toBe(0);
    });
});

describe('resolveContractObligationMinutes — cap interaction', () => {
    it('caps an obligation the window has no work for', () => {
        expect(resolveContractObligationMinutes({
            weeklyContractMinutes: FT_WEEK,
            weekScale: 4,
            leaveDays: 0,
            fairShareCapMinutes: 3000,
        })).toBe(3000);
    });

    it('applies the leave credit BEFORE the cap, so the lower of the two wins', () => {
        // Order matters: capping first would hand back 3000 for someone whose
        // leave has already reduced the real obligation to 2280.
        expect(resolveContractObligationMinutes({
            weeklyContractMinutes: FT_WEEK,
            weekScale: 4,
            leaveDays: 21,
            fairShareCapMinutes: 3000,
        })).toBe(FT_WEEK);
    });

    it('clamps a negative cap to zero rather than producing a negative floor', () => {
        expect(resolveContractObligationMinutes({
            weeklyContractMinutes: FT_WEEK,
            weekScale: 1,
            leaveDays: 0,
            fairShareCapMinutes: -100,
        })).toBe(0);
    });
});

describe('buildFairShareCaps', () => {
    it('weights each slice by contracted minutes, not headcount', () => {
        const caps = buildFairShareCaps(10_000, new Map([
            ['ft', FT_WEEK],
            ['pt', PT_WEEK],
        ]));
        const totalWeight = FT_WEEK + PT_WEEK;
        expect(caps.get('ft')).toBeCloseTo(10_000 * (FT_WEEK / totalWeight) * FAIR_SHARE_BUFFER, 6);
        expect(caps.get('pt')).toBeCloseTo(10_000 * (PT_WEEK / totalWeight) * FAIR_SHARE_BUFFER, 6);
        // The FT slice is larger in exactly the ratio of the two contracts.
        expect(caps.get('ft')! / caps.get('pt')!).toBeCloseTo(FT_WEEK / PT_WEEK, 6);
    });

    it('does not dilute the permanent floor as casuals join the pool', () => {
        // The production shape: 17 FT + 4 PT against 83 casuals. Under the old
        // `demand / headcount` split an FT's cap was ~1/104 of demand; weighting
        // by obligation makes the casual bench irrelevant to it.
        const withoutCasuals = new Map<string, number>();
        for (let i = 0; i < 17; i++) withoutCasuals.set(`ft${i}`, FT_WEEK);
        for (let i = 0; i < 4; i++) withoutCasuals.set(`pt${i}`, PT_WEEK);

        const withCasuals = new Map(withoutCasuals);
        for (let i = 0; i < 83; i++) withCasuals.set(`c${i}`, 0);

        const a = buildFairShareCaps(500_000, withoutCasuals);
        const b = buildFairShareCaps(500_000, withCasuals);

        expect(b.get('ft0')).toBeCloseTo(a.get('ft0')!, 6);

        // And it is materially larger than the unweighted split it replaces.
        const oldUniform = (500_000 / withCasuals.size) * FAIR_SHARE_BUFFER;
        expect(b.get('ft0')!).toBeGreaterThan(oldUniform * 4);
    });

    it('gives casuals a zero cap, which is a no-op against their zero floor', () => {
        const caps = buildFairShareCaps(10_000, new Map([['ft', FT_WEEK], ['c', 0]]));
        expect(caps.get('c')).toBe(0);
        expect(resolveContractObligationMinutes({
            weeklyContractMinutes: 0,
            weekScale: 4,
            leaveDays: 0,
            fairShareCapMinutes: caps.get('c')!,
        })).toBe(0);
    });

    it('distributes the whole buffered demand across the obligated pool', () => {
        const caps = buildFairShareCaps(10_000, new Map([
            ['a', FT_WEEK], ['b', FT_WEEK], ['c', 0],
        ]));
        const total = [...caps.values()].reduce((a, b) => a + b, 0);
        expect(total).toBeCloseTo(10_000 * FAIR_SHARE_BUFFER, 6);
    });

    it('falls back to a uniform split for an all-casual pool', () => {
        // Total weight 0 — the weighted formula would divide by zero, so the
        // old behaviour stands in. Nobody in such a pool carries a floor for it
        // to bind against, but the map must still be total.
        const caps = buildFairShareCaps(10_000, new Map([['a', 0], ['b', 0]]));
        expect(caps.get('a')).toBeCloseTo((10_000 / 2) * FAIR_SHARE_BUFFER, 6);
        expect(caps.get('b')).toBeCloseTo((10_000 / 2) * FAIR_SHARE_BUFFER, 6);
    });

    it('returns an empty map for an empty pool rather than dividing by zero', () => {
        expect(buildFairShareCaps(10_000, new Map()).size).toBe(0);
    });

    it('caps at zero when the window holds no assignable demand', () => {
        const caps = buildFairShareCaps(0, new Map([['ft', FT_WEEK]]));
        expect(caps.get('ft')).toBe(0);
        // A window with nothing to assign must not charge anyone a floor.
        expect(resolveContractObligationMinutes({
            weeklyContractMinutes: FT_WEEK,
            weekScale: 4,
            leaveDays: 0,
            fairShareCapMinutes: caps.get('ft')!,
        })).toBe(0);
    });
});
