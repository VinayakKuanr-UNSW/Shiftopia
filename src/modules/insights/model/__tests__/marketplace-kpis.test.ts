import { describe, it, expect } from 'vitest';
import {
    EMPTY_KPIS,
    type MarketplaceKpis,
} from '../marketplace-kpis.types';

describe('EMPTY_KPIS', () => {
    it('has every field set to 0', () => {
        for (const value of Object.values(EMPTY_KPIS)) {
            expect(value).toBe(0);
        }
    });

    it('is structurally a complete MarketplaceKpis (compile-time check)', () => {
        // If a field were missing, this assignment would fail tsc.
        const kpis: MarketplaceKpis = EMPTY_KPIS;
        expect(Object.keys(kpis).length).toBeGreaterThan(0);
    });
});

describe('EMPTY_KPIS includes trade_rejection_rate', () => {
    it('has trade_rejection_rate defaulted to 0', () => {
        expect(EMPTY_KPIS.trade_rejection_rate).toBe(0);
    });
});
