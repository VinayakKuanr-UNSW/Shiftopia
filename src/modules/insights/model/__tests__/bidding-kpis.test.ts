import { describe, it, expect } from 'vitest';
import {
    EMPTY_BIDDING_KPIS,
    type BiddingKpis,
} from '../bidding-kpis.types';

describe('EMPTY_BIDDING_KPIS', () => {
    it('has every field set to 0', () => {
        for (const value of Object.values(EMPTY_BIDDING_KPIS)) {
            expect(value).toBe(0);
        }
    });

    it('is structurally a complete BiddingKpis (compile-time check)', () => {
        // If a field were missing, this assignment would fail tsc.
        const kpis: BiddingKpis = EMPTY_BIDDING_KPIS;
        expect(Object.keys(kpis).length).toBeGreaterThan(0);
    });
});
