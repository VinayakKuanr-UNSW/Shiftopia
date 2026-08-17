import { describe, it, expect } from 'vitest';
import { computeSss, penaltyScore, sssBand, SSS_WEIGHTS, type SssInputs } from '../sss';

const full = (over: Partial<SssInputs> = {}): SssInputs => ({
    reliability: 90, attendance: 90, acceptance: 90,
    noShowRate: 0, lateCancelRate: 0, skillMatch: 100, hasHistory: true, ...over,
});

describe('computeSss — composition', () => {
    it('weights sum to 1 and a perfect bidder scores 100', () => {
        expect(Object.values(SSS_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
        expect(computeSss(full({ reliability: 100, attendance: 100, acceptance: 100 })).score).toBe(100);
    });

    it('blends real factors with the documented weights', () => {
        // reliability 80, attendance 60, acceptance 40, skillMatch 100, penalty 100 (no rates)
        const r = computeSss(full({ reliability: 80, attendance: 60, acceptance: 40, skillMatch: 100 }));
        const expected = Math.round(0.30 * 80 + 0.25 * 60 + 0.20 * 40 + 0.15 * 100 + 0.10 * 100);
        expect(r.score).toBe(expected);
        expect(r.flag).toBe('OK');
    });

    it('is monotonic in reliability', () => {
        const lo = computeSss(full({ reliability: 50 })).score;
        const hi = computeSss(full({ reliability: 95 })).score;
        expect(hi).toBeGreaterThan(lo);
    });

    it('no-show and late-cancel drive the penalty down', () => {
        const clean = computeSss(full()).score;
        const messy = computeSss(full({ noShowRate: 20, lateCancelRate: 20 })).score;
        expect(messy).toBeLessThan(clean);
        expect(penaltyScore(20, 20)).toBeLessThan(penaltyScore(0, 0));
        expect(penaltyScore(0, 0)).toBe(100);
    });
});

describe('computeSss — missing data & flags', () => {
    it('renormalises weights when a performance factor is absent (still 0–100)', () => {
        const r = computeSss(full({ reliability: 100, attendance: null, acceptance: null, skillMatch: 100 }));
        // present: reliability(.30), penalty(.10)=100, skillMatch(.15) → all 100 ⇒ 100
        expect(r.score).toBe(100);
        expect(r.flag).toBe('LIMITED'); // <3 perf factors present
    });

    it('no history → INSUFFICIENT_DATA ranked on skill-match alone (never random/NaN)', () => {
        const r = computeSss({ skillMatch: 72, hasHistory: false });
        expect(r.flag).toBe('INSUFFICIENT_DATA');
        expect(r.score).toBe(72);
        expect(Number.isNaN(r.score)).toBe(false);
    });

    it('no history + no shift requirements → neutral 100 skill-match, not a fabricated score', () => {
        const r = computeSss({ skillMatch: 100, hasHistory: false });
        expect(r.score).toBe(100);
        expect(r.flag).toBe('INSUFFICIENT_DATA');
    });

    it('ignores NaN/undefined metric values safely', () => {
        const r = computeSss(full({ reliability: Number.NaN as unknown as number, attendance: undefined }));
        expect(Number.isFinite(r.score)).toBe(true);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
    });

    it('clamps out-of-range inputs into 0–100', () => {
        const r = computeSss(full({ reliability: 150, acceptance: -50 }));
        expect(r.score).toBeLessThanOrEqual(100);
        expect(r.breakdown.reliability).toBe(100);
        expect(r.breakdown.acceptance).toBe(0);
    });
});

describe('sssBand', () => {
    it('bands by tuned thresholds', () => {
        expect(sssBand(90)).toBe('good');
        expect(sssBand(75)).toBe('warn');
        expect(sssBand(50)).toBe('poor');
    });
});
