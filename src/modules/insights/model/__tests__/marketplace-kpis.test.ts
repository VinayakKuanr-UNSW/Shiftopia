import { describe, it, expect } from 'vitest';
import {
    EMPTY_KPIS,
    KPI_THRESHOLDS,
    getKpiStatus,
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

describe('getKpiStatus — higher-is-better (fill_rate)', () => {
    // thresholds: good 90, warn 75
    it('returns good at/above the good threshold', () => {
        expect(getKpiStatus('fill_rate', 90)).toBe('good');
        expect(getKpiStatus('fill_rate', 99.9)).toBe('good');
    });

    it('returns warn between warn and good', () => {
        expect(getKpiStatus('fill_rate', 75)).toBe('warn');
        expect(getKpiStatus('fill_rate', 89.9)).toBe('warn');
    });

    it('returns critical below the warn threshold', () => {
        expect(getKpiStatus('fill_rate', 74.9)).toBe('critical');
        expect(getKpiStatus('fill_rate', 0)).toBe('critical');
    });
});

describe('getKpiStatus — lower-is-better (churn_rate)', () => {
    // thresholds: good 10, warn 25
    it('returns good at/below the good threshold', () => {
        expect(getKpiStatus('churn_rate', 0)).toBe('good');
        expect(getKpiStatus('churn_rate', 10)).toBe('good');
    });

    it('returns warn between good and warn', () => {
        expect(getKpiStatus('churn_rate', 10.1)).toBe('warn');
        expect(getKpiStatus('churn_rate', 25)).toBe('warn');
    });

    it('returns critical above the warn threshold', () => {
        expect(getKpiStatus('churn_rate', 25.1)).toBe('critical');
        expect(getKpiStatus('churn_rate', 100)).toBe('critical');
    });
});

describe('getKpiStatus — lower-is-better (trade_rejection_rate)', () => {
    // thresholds: good 15, warn 30
    it('returns good at/below the good threshold', () => {
        expect(getKpiStatus('trade_rejection_rate', 0)).toBe('good');
        expect(getKpiStatus('trade_rejection_rate', 15)).toBe('good');
    });

    it('returns warn between good and warn', () => {
        expect(getKpiStatus('trade_rejection_rate', 15.1)).toBe('warn');
        expect(getKpiStatus('trade_rejection_rate', 30)).toBe('warn');
    });

    it('returns critical above the warn threshold', () => {
        expect(getKpiStatus('trade_rejection_rate', 30.1)).toBe('critical');
        expect(getKpiStatus('trade_rejection_rate', 100)).toBe('critical');
    });
});

describe('EMPTY_KPIS includes trade_rejection_rate', () => {
    it('has trade_rejection_rate defaulted to 0', () => {
        expect(EMPTY_KPIS.trade_rejection_rate).toBe(0);
    });
});

describe('getKpiStatus — unthresholded keys default to good', () => {
    it('counts and avg_time_to_fill_hours have no threshold and return good', () => {
        expect(KPI_THRESHOLDS.avg_time_to_fill_hours).toBeUndefined();
        expect(KPI_THRESHOLDS.published_shifts).toBeUndefined();
        expect(getKpiStatus('avg_time_to_fill_hours', 999)).toBe('good');
        expect(getKpiStatus('published_shifts', 12345)).toBe('good');
    });
});
