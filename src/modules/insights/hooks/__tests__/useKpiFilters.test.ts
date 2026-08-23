import { describe, it, expect } from 'vitest';
import {
    quarterBounds,
    makeQuarter,
    previousQuarter,
    computeDelta,
} from '../useKpiFilters';

describe('quarterBounds', () => {
    it('covers each quarter end to end', () => {
        expect(quarterBounds(2026, 1)).toEqual({ startDate: '2026-01-01', endDate: '2026-03-31' });
        expect(quarterBounds(2026, 2)).toEqual({ startDate: '2026-04-01', endDate: '2026-06-30' });
        expect(quarterBounds(2026, 3)).toEqual({ startDate: '2026-07-01', endDate: '2026-09-30' });
        expect(quarterBounds(2026, 4)).toEqual({ startDate: '2026-10-01', endDate: '2026-12-31' });
    });

    it('leaves no gap between consecutive quarters', () => {
        for (let q = 1; q <= 3; q++) {
            const end = new Date(`${quarterBounds(2026, q).endDate}T00:00:00Z`);
            const nextStart = new Date(`${quarterBounds(2026, q + 1).startDate}T00:00:00Z`);
            expect(nextStart.getTime() - end.getTime()).toBe(24 * 60 * 60 * 1000);
        }
    });

    it('handles February in a leap year', () => {
        // Only reachable if Q1 ever ends in February; guard the leap logic anyway
        // since it is the kind of branch that rots unnoticed.
        expect(quarterBounds(2024, 1).endDate).toBe('2024-03-31');
        expect(quarterBounds(2023, 1).endDate).toBe('2023-03-31');
    });

    it('builds boundaries from calendar numbers, not Date arithmetic', () => {
        // A Date built in the viewer's zone can land on the wrong calendar day
        // either side of midnight; these must be stable strings regardless.
        expect(makeQuarter(2026, 3).startDate).toBe('2026-07-01');
        expect(makeQuarter(2026, 3).label).toBe('Q3 2026');
    });
});

describe('previousQuarter', () => {
    it('steps back within a year', () => {
        expect(previousQuarter({ year: 2026, quarter: 3 })).toMatchObject({ year: 2026, quarter: 2 });
    });

    it('wraps to Q4 of the prior year', () => {
        expect(previousQuarter({ year: 2026, quarter: 1 })).toMatchObject({ year: 2025, quarter: 4 });
    });
});

describe('computeDelta', () => {
    it('moves rate metrics in percentage points, not percent', () => {
        // A no-show rate going 2% -> 3% is +1pt. Reporting it as +50% would be
        // arithmetically true and completely misleading.
        const d = computeDelta(3, 2, { unit: 'points', label: 'vs Q2 2026' });
        expect(d).toMatchObject({ value: 1, unit: 'points' });
    });

    it('moves counts in percent', () => {
        const d = computeDelta(150, 100, { unit: 'percent', label: 'vs Q2 2026' });
        expect(d).toMatchObject({ value: 50, unit: 'percent' });
    });

    it('returns null when either reading is missing', () => {
        expect(computeDelta(null, 2, { unit: 'points', label: 'x' })).toBeNull();
        expect(computeDelta(2, undefined, { unit: 'points', label: 'x' })).toBeNull();
        expect(computeDelta(Number.NaN, 2, { unit: 'points', label: 'x' })).toBeNull();
    });

    it('suppresses the comparison when a period is too small to mean anything', () => {
        const d = computeDelta(50, 0, {
            unit: 'points', label: 'vs Q2 2026', currentBase: 2, previousBase: 40,
        });
        expect(d?.suppressedReason).toMatch(/at least 10/);
    });

    it('suppresses a percent change against a zero baseline', () => {
        const d = computeDelta(5, 0, { unit: 'percent', label: 'vs Q2 2026' });
        expect(d?.suppressedReason).toMatch(/Nothing recorded/);
    });

    it('compares normally once both periods clear the floor', () => {
        const d = computeDelta(4, 6, {
            unit: 'points', label: 'vs Q2 2026', currentBase: 120, previousBase: 95,
        });
        expect(d).toMatchObject({ value: -2, unit: 'points' });
        expect(d?.suppressedReason).toBeUndefined();
    });
});
