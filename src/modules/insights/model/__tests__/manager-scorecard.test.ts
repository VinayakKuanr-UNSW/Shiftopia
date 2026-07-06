import { describe, it, expect } from 'vitest';
import {
    EMPTY_SCORECARD,
    SCORECARD_THRESHOLDS,
    getScorecardStatus,
    type ManagerScorecard,
} from '../manager-scorecard.types';

describe('EMPTY_SCORECARD', () => {
    it('has every field set to 0', () => {
        for (const value of Object.values(EMPTY_SCORECARD)) {
            expect(value).toBe(0);
        }
    });

    it('is structurally a complete ManagerScorecard (compile-time check)', () => {
        // If a field were missing, this assignment would fail tsc.
        const scorecard: ManagerScorecard = EMPTY_SCORECARD;
        expect(Object.keys(scorecard).length).toBe(16);
    });
});

describe('getScorecardStatus — higher-is-better (fill_rate)', () => {
    // thresholds: good 90, warn 75
    it('returns good at/above the good threshold', () => {
        expect(getScorecardStatus('fill_rate', 90)).toBe('good');
        expect(getScorecardStatus('fill_rate', 99.9)).toBe('good');
    });

    it('returns warn between warn and good', () => {
        expect(getScorecardStatus('fill_rate', 75)).toBe('warn');
        expect(getScorecardStatus('fill_rate', 89.9)).toBe('warn');
    });

    it('returns critical below the warn threshold', () => {
        expect(getScorecardStatus('fill_rate', 74.9)).toBe('critical');
        expect(getScorecardStatus('fill_rate', 0)).toBe('critical');
    });
});

describe('getScorecardStatus — lower-is-better (churn_rate / emergency_fill_rate)', () => {
    // thresholds: good 10, warn 25
    it('returns good at/below the good threshold', () => {
        expect(getScorecardStatus('churn_rate', 0)).toBe('good');
        expect(getScorecardStatus('churn_rate', 10)).toBe('good');
        expect(getScorecardStatus('emergency_fill_rate', 10)).toBe('good');
    });

    it('returns warn between good and warn', () => {
        expect(getScorecardStatus('churn_rate', 10.1)).toBe('warn');
        expect(getScorecardStatus('churn_rate', 25)).toBe('warn');
        expect(getScorecardStatus('emergency_fill_rate', 25)).toBe('warn');
    });

    it('returns critical above the warn threshold', () => {
        expect(getScorecardStatus('churn_rate', 25.1)).toBe('critical');
        expect(getScorecardStatus('churn_rate', 100)).toBe('critical');
        expect(getScorecardStatus('emergency_fill_rate', 80)).toBe('critical');
    });
});

describe('getScorecardStatus — lead time (avg_publish_lead_time_hours, higher-is-better)', () => {
    // thresholds: good 168 (1wk), warn 72 (3d)
    it('returns good at/above 1 week of lead time', () => {
        expect(getScorecardStatus('avg_publish_lead_time_hours', 168)).toBe('good');
        expect(getScorecardStatus('avg_publish_lead_time_hours', 336)).toBe('good');
    });

    it('returns warn between 3 days and 1 week', () => {
        expect(getScorecardStatus('avg_publish_lead_time_hours', 72)).toBe('warn');
        expect(getScorecardStatus('avg_publish_lead_time_hours', 167.9)).toBe('warn');
    });

    it('returns critical below 3 days of lead time', () => {
        expect(getScorecardStatus('avg_publish_lead_time_hours', 71.9)).toBe('critical');
        expect(getScorecardStatus('avg_publish_lead_time_hours', 0)).toBe('critical');
    });
});

describe('getScorecardStatus — unthresholded count keys default to good', () => {
    it('plain counts have no threshold and return good', () => {
        expect(SCORECARD_THRESHOLDS.reassignment_count).toBeUndefined();
        expect(SCORECARD_THRESHOLDS.manager_actions).toBeUndefined();
        expect(getScorecardStatus('reassignment_count', 9999)).toBe('good');
        expect(getScorecardStatus('manager_actions', 12345)).toBe('good');
        expect(getScorecardStatus('emergency_fill_count', 50)).toBe('good');
    });
});
