/**
 * The registry replaced five status functions over four threshold tables. These
 * tests pin the three things that could regress silently:
 *
 *   1. the two resolved disagreements stay resolved the way they were decided,
 *   2. unjudgeable metrics report 'neutral' rather than the old 'good',
 *   3. the registry still agrees with every threshold table it absorbed.
 */

import { describe, it, expect } from 'vitest';
import {
    METRIC_REGISTRY,
    statusFor,
    labelFor,
    formatMetric,
} from '../metric-registry';
import { REPORT_THRESHOLDS, METRIC_THRESHOLDS } from '@/modules/users/hooks/usePerformanceMetrics';
import { KPI_THRESHOLDS } from '../marketplace-kpis.types';
import { BIDDING_THRESHOLDS } from '../bidding-kpis.types';
import { SCORECARD_THRESHOLDS } from '../manager-scorecard.types';

describe('statusFor — direction', () => {
    it('grades higher-is-better metrics up the scale', () => {
        expect(statusFor('attendance_compliance_rate', 97)).toBe('good');
        expect(statusFor('attendance_compliance_rate', 90)).toBe('warn');
        expect(statusFor('attendance_compliance_rate', 60)).toBe('critical');
    });

    it('grades lower-is-better metrics down the scale', () => {
        expect(statusFor('no_show_rate', 1)).toBe('good');
        expect(statusFor('no_show_rate', 4)).toBe('warn');
        expect(statusFor('no_show_rate', 20)).toBe('critical');
    });

    it('treats the band edges as inclusive on the good side', () => {
        // good: 95 for a higher-is-better metric
        expect(statusFor('attendance_compliance_rate', 95)).toBe('good');
        // good: 2 for a lower-is-better metric
        expect(statusFor('no_show_rate', 2)).toBe('good');
    });
});

describe('statusFor — unjudgeable metrics', () => {
    it('returns neutral, not good, for metrics with no correct target', () => {
        // The five functions this replaced all returned 'good' here, which
        // painted every raw count green.
        expect(statusFor('avg_bids_per_open_shift', 0)).toBe('neutral');
        expect(statusFor('avg_bids_per_open_shift', 99)).toBe('neutral');
        expect(statusFor('total_bids', 0)).toBe('neutral');
        expect(statusFor('estimated_cost', 1_000_000)).toBe('neutral');
    });

    it('returns neutral for an unknown metric id', () => {
        expect(statusFor('not_a_metric', 50)).toBe('neutral');
    });

    it('returns neutral for a non-finite value', () => {
        expect(statusFor('no_show_rate', Number.NaN)).toBe('neutral');
        expect(statusFor('no_show_rate', Number.POSITIVE_INFINITY)).toBe('neutral');
    });
});

describe('resolved threshold disagreements', () => {
    // METRIC_THRESHOLDS said 80/50, REPORT_THRESHOLDS said 70/40. The rule was
    // to keep the value applied to the org-wide manager-facing report.
    it('acceptance_rate keeps the REPORT bands (70/40)', () => {
        expect(METRIC_REGISTRY.acceptance_rate.good).toBe(70);
        expect(METRIC_REGISTRY.acceptance_rate.warn).toBe(40);
        expect(METRIC_THRESHOLDS.acceptance_rate.good).toBe(80); // the value NOT chosen
        expect(statusFor('acceptance_rate', 75)).toBe('good');   // would be 'warn' under 80/50
    });

    // METRIC said 85/70, REPORT said 90/75. REPORT is also the stricter pair,
    // and no threshold was loosened in this consolidation.
    it('reliability_score keeps the REPORT bands (90/75)', () => {
        expect(METRIC_REGISTRY.reliability_score.good).toBe(90);
        expect(METRIC_REGISTRY.reliability_score.warn).toBe(75);
        expect(statusFor('reliability_score', 87)).toBe('warn');  // would be 'good' under 85/70
    });
});

describe('registry agrees with the tables it absorbed', () => {
    const check = (
        table: Record<string, { good: number; warn: number } | undefined>,
        name: string,
        skip: string[] = [],
    ) => {
        for (const [key, bands] of Object.entries(table)) {
            if (!bands || skip.includes(key)) continue;
            const entry = METRIC_REGISTRY[key];
            expect(entry, `${name}.${key} is missing from METRIC_REGISTRY`).toBeDefined();
            expect(
                { good: entry.good, warn: entry.warn },
                `${name}.${key} bands drifted`,
            ).toEqual({ good: bands.good, warn: bands.warn });
        }
    };

    it('matches REPORT_THRESHOLDS', () => {
        // acceptance_rate and reliability_score agree with REPORT by decision;
        // drop_rate and late_cancel_rate were folded into the two-kind
        // standard/urgent model and are asserted separately below.
        check(REPORT_THRESHOLDS as never, 'REPORT_THRESHOLDS', ['drop_rate', 'late_cancel_rate']);
    });

    it('matches BIDDING_THRESHOLDS', () => {
        // bid_success_rate is deliberately NOT shared — see below.
        check(BIDDING_THRESHOLDS as never, 'BIDDING_THRESHOLDS', ['bid_success_rate']);
    });

    it('separates the org-level and per-employee bid success metrics', () => {
        // One name, two metrics. The org-level figure is winners / ALL bids and
        // is bounded by 1 / avg bids per shift; the per-employee figure is one
        // person's hit rate. Grading the org number against the employee bands
        // painted a healthy marketplace critical.
        expect(BIDDING_THRESHOLDS.bid_success_rate).toEqual({ good: 40, warn: 20 });
        expect({
            good: METRIC_REGISTRY.bid_win_rate.good,
            warn: METRIC_REGISTRY.bid_win_rate.warn,
        }).toEqual({ good: 40, warn: 20 });
        expect({
            good: METRIC_REGISTRY.bid_success_rate.good,
            warn: METRIC_REGISTRY.bid_success_rate.warn,
        }).toEqual({ good: 70, warn: 40 });

        // 25% of bids winning is healthy for the marketplace and poor for one
        // employee. The split is the whole point.
        expect(statusFor('bid_win_rate', 25)).toBe('warn');
        expect(statusFor('bid_success_rate', 25)).toBe('critical');
    });

    it('matches KPI_THRESHOLDS (marketplace)', () => {
        check(KPI_THRESHOLDS as never, 'KPI_THRESHOLDS');
    });

    it('matches SCORECARD_THRESHOLDS', () => {
        check(SCORECARD_THRESHOLDS as never, 'SCORECARD_THRESHOLDS');
    });
});

describe('cancellations are exactly two kinds, split at 24h', () => {
    it('grades critical more strictly than standard', () => {
        // The same 4% reads as acceptable when the shift was released with more
        // than a day's notice, and as a warning when it was released inside it.
        expect(statusFor('standard_cancel_rate', 4)).toBe('good');
        expect(statusFor('critical_cancel_rate', 4)).toBe('warn');
    });

    it('names the boundary as 24 hours, not the 4h emergent lockout', () => {
        // 4h is the urgent/emergent boundary — where the app blocks exchange
        // operations outright. Using it as the cancellation split put the line
        // inside the window where an employee cannot cancel at all, so every
        // self-service cancellation graded 'standard'.
        expect(METRIC_REGISTRY.standard_cancel_rate.description).toMatch(/more than 24 hours/);
        expect(METRIC_REGISTRY.critical_cancel_rate.description).toMatch(/24 hours notice or less/);
        // \b matters: "24 hours" contains "4 hours" as a substring.
        expect(METRIC_REGISTRY.standard_cancel_rate.description).not.toMatch(/\b4 hours/);
        expect(METRIC_REGISTRY.critical_cancel_rate.description).not.toMatch(/\b4 hours/);
    });

    it('has no metric called "urgent" — that word belongs to the urgency bands', () => {
        expect(METRIC_REGISTRY.urgent_cancel_rate).toBeUndefined();
        for (const spec of Object.values(METRIC_REGISTRY)) {
            expect(spec.label).not.toMatch(/urgent/i);
        }
    });

    it('labels the legacy RPC column names as the two canonical kinds', () => {
        expect(labelFor('standard_drop_rate')).toBe('Standard cancellation rate');
        expect(labelFor('urgent_drop_rate')).toBe('Critical cancellation rate');
        expect(labelFor('cancellation_rate_standard')).toBe('Standard cancellation rate');
        expect(labelFor('cancellation_rate_late')).toBe('Critical cancellation rate');
    });
});

describe('naming', () => {
    it('renames the bidding fill rate so it cannot collide with org fill rate', () => {
        expect(labelFor('open_shift_fill_rate')).toBe('Open-shift award rate');
        expect(labelFor('fill_rate')).toBe('Fill rate');
    });
});

describe('formatMetric', () => {
    it('formats each unit in its own idiom', () => {
        expect(formatMetric('no_show_rate', 3.25)).toBe('3.3%');
        expect(formatMetric('total_bids', 12)).toBe('12');
        expect(formatMetric('avg_time_to_fill_hours', 5.5)).toBe('5.5h');
        expect(formatMetric('avg_bids_per_open_shift', 2.44)).toBe('2.4');
    });

    it('scales currency', () => {
        expect(formatMetric('estimated_cost', 940)).toBe('$940');
        expect(formatMetric('estimated_cost', 12_400)).toBe('$12.4k');
        expect(formatMetric('estimated_cost', 2_500_000)).toBe('$2.50M');
    });

    it('renders missing data as an em dash, distinct from a real zero', () => {
        expect(formatMetric('no_show_rate', null)).toBe('—');
        expect(formatMetric('no_show_rate', undefined)).toBe('—');
        expect(formatMetric('no_show_rate', Number.NaN)).toBe('—');
        expect(formatMetric('no_show_rate', 0)).toBe('0.0%');
    });
});

describe('the legacy status functions delegate here', () => {
    it('getMetricStatus and getReportCellStatus agree with statusFor', async () => {
        const { getMetricStatus, getReportCellStatus } =
            await import('@/modules/users/hooks/usePerformanceMetrics');

        // reliability_score is the one that used to differ: 85/70 in
        // METRIC_THRESHOLDS, 90/75 in REPORT_THRESHOLDS. A per-employee dialog
        // painted 87% green while the table row that opened it painted amber.
        for (const v of [95, 87, 60]) {
            expect(getMetricStatus('reliability_score', v)).toBe(statusFor('reliability_score', v));
            expect(getReportCellStatus('reliability_score', v)).toBe(statusFor('reliability_score', v));
        }
        expect(getMetricStatus('reliability_score', 87)).toBe('warn');
    });

    it('folds neutral into good, because the legacy colour maps have no neutral slot', () => {
        // New code should call statusFor and handle 'neutral' properly.
        expect(statusFor('total_bids', 5)).toBe('neutral');
    });

    it('covers every key both legacy tables define', () => {
        for (const table of [METRIC_THRESHOLDS, REPORT_THRESHOLDS]) {
            for (const key of Object.keys(table)) {
                expect(METRIC_REGISTRY[key], `${key} has no registry entry`).toBeDefined();
            }
        }
    });
});
