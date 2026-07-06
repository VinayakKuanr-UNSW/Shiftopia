import { describe, it, expect } from 'vitest';
import {
    EMPTY_BIDDING_KPIS,
    BIDDING_THRESHOLDS,
    getBiddingStatus,
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

describe('getBiddingStatus — higher-is-better (open_shift_fill_rate)', () => {
    // thresholds: good 80, warn 60
    it('returns good at/above the good threshold', () => {
        expect(getBiddingStatus('open_shift_fill_rate', 80)).toBe('good');
        expect(getBiddingStatus('open_shift_fill_rate', 99.9)).toBe('good');
    });

    it('returns warn between warn and good', () => {
        expect(getBiddingStatus('open_shift_fill_rate', 60)).toBe('warn');
        expect(getBiddingStatus('open_shift_fill_rate', 79.9)).toBe('warn');
    });

    it('returns critical below the warn threshold', () => {
        expect(getBiddingStatus('open_shift_fill_rate', 59.9)).toBe('critical');
        expect(getBiddingStatus('open_shift_fill_rate', 0)).toBe('critical');
    });
});

describe('getBiddingStatus — lower-is-better (unfilled_open_shift_rate)', () => {
    // thresholds: good 15, warn 30
    it('returns good at/below the good threshold', () => {
        expect(getBiddingStatus('unfilled_open_shift_rate', 0)).toBe('good');
        expect(getBiddingStatus('unfilled_open_shift_rate', 15)).toBe('good');
    });

    it('returns warn between good and warn', () => {
        expect(getBiddingStatus('unfilled_open_shift_rate', 15.1)).toBe('warn');
        expect(getBiddingStatus('unfilled_open_shift_rate', 30)).toBe('warn');
    });

    it('returns critical above the warn threshold', () => {
        expect(getBiddingStatus('unfilled_open_shift_rate', 30.1)).toBe('critical');
        expect(getBiddingStatus('unfilled_open_shift_rate', 100)).toBe('critical');
    });
});

describe('getBiddingStatus — unthresholded keys default to good', () => {
    it('counts and avg_bids_per_open_shift have no threshold and return good', () => {
        expect(BIDDING_THRESHOLDS.avg_bids_per_open_shift).toBeUndefined();
        expect(BIDDING_THRESHOLDS.open_bidding_shifts).toBeUndefined();
        expect(getBiddingStatus('avg_bids_per_open_shift', 999)).toBe('good');
        expect(getBiddingStatus('open_bidding_shifts', 12345)).toBe('good');
    });
});
