import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/supabase/client';
import type { ScopeSelection } from '@/platform/auth/types';
import { getNowInTimezone, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import { statusFor, type MetricStatus } from '@/modules/insights/model/metric-registry';

import {
    PerformanceMetrics,
    EmployeePerformanceRow,
    PerformanceFilters,
    PerformanceTrendPoint,
    PerformanceEventTimelineItem
} from '../model/performance.types';

export type {
    PerformanceMetrics,
    EmployeePerformanceRow,
    PerformanceFilters,
    PerformanceTrendPoint,
    PerformanceEventTimelineItem
};

// Backward-compat alias — PerformancePage and WorkforceTab import this type
export type QuarterlyReportRow = EmployeePerformanceRow;

// ---------------------------------------------------------------------------
// EmployeeMetricsSnapshot — typed to match employee_performance_metrics columns
// ---------------------------------------------------------------------------
export interface EmployeeMetricsSnapshot {
    id: string;
    employee_id: string;
    period_start: string;
    period_end: string;
    quarter_year: string;
    is_locked: boolean;

    // Raw counts
    total_offers: number;
    shifts_accepted: number;
    shifts_rejected: number;
    shifts_assigned: number;
    emergency_assignments: number;
    shifts_worked: number;
    shifts_swapped: number;
    shifts_dropped: number;
    standard_cancellations: number;
    late_cancellations: number;
    no_shows: number;
    offer_expirations: number;
    early_clock_outs: number;
    late_clock_ins: number;
    auto_clock_outs: number;

    // Calculated rates (%)
    acceptance_rate: number;
    drop_rate: number;
    rejection_rate: number;
    offer_expiration_rate: number;
    cancellation_rate_standard: number;
    cancellation_rate_late: number;
    swap_ratio: number;
    reliability_score: number;
    late_clock_in_rate: number;
    early_clock_out_rate: number;
    auto_clock_out_rate: number;
    no_show_rate: number;
    punctuality_rate: number;

    calculated_at: string;
}

// ---------------------------------------------------------------------------
// EMPTY_METRICS — safe default; all counts 0, reliability_score 100
// ---------------------------------------------------------------------------
export const EMPTY_METRICS: EmployeeMetricsSnapshot = {
    id: '',
    employee_id: '',
    period_start: '',
    period_end: '',
    quarter_year: '',
    is_locked: false,
    total_offers: 0,
    shifts_accepted: 0,
    shifts_rejected: 0,
    shifts_assigned: 0,
    emergency_assignments: 0,
    shifts_worked: 0,
    shifts_swapped: 0,
    shifts_dropped: 0,
    standard_cancellations: 0,
    late_cancellations: 0,
    no_shows: 0,
    offer_expirations: 0,
    early_clock_outs: 0,
    late_clock_ins: 0,
    auto_clock_outs: 0,
    acceptance_rate: 0,
    drop_rate: 0,
    rejection_rate: 0,
    offer_expiration_rate: 0,
    cancellation_rate_standard: 0,
    cancellation_rate_late: 0,
    swap_ratio: 0,
    reliability_score: 100,
    late_clock_in_rate: 0,
    early_clock_out_rate: 0,
    auto_clock_out_rate: 0,
    no_show_rate: 0,
    punctuality_rate: 100,
    calculated_at: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// METRIC_THRESHOLDS
// ---------------------------------------------------------------------------
export const METRIC_THRESHOLDS = {
    acceptance_rate:          { good: 80, warn: 50 },
    reliability_score:        { good: 85, warn: 70 },
    rejection_rate:           { good: 10, warn: 20 },
    cancellation_rate_standard: { good: 5,  warn: 15 },
    cancellation_rate_late:   { good: 3,  warn: 10 },
    swap_ratio:               { good: 10, warn: 20 },
    offer_expiration_rate:    { good: 10, warn: 25 },
    late_clock_in_rate:       { good: 5,  warn: 15 },
    early_clock_out_rate:     { good: 5,  warn: 15 },
    early_clock_in_rate:      { good: 5,  warn: 15 },
    late_clock_out_rate:      { good: 5,  warn: 15 },
    auto_clock_out_rate:      { good: 5,  warn: 15 },
    no_show_rate:             { good: 2,  warn: 5  },
    on_time_in_rate:          { good: 85, warn: 70 },
    on_time_out_rate:         { good: 85, warn: 70 },
} as const;

// ---------------------------------------------------------------------------
// getMetricStatus / getReportCellStatus
//
// Both now DELEGATE to statusFor() in the KPI metric registry, which is the
// single threshold catalogue. They survive only as adapters so the components
// still calling them keep their signatures.
//
// They used to be two of five rival implementations over four threshold
// tables, and the two tables disagreed: reliability_score was 85/70 here and
// 90/75 in REPORT_THRESHOLDS, so a per-employee dialog could paint a score
// green while the table row that opened it painted the same score amber.
//
// METRIC_THRESHOLDS and REPORT_THRESHOLDS are kept as data — the parity test
// asserts the registry still agrees with them — but nothing reads them to make
// a decision any more.
// ---------------------------------------------------------------------------

/**
 * The registry reports 'neutral' for a metric with no defensible target. These
 * legacy call sites index into three-key colour maps with no neutral slot, so
 * it is folded into 'good' here — matching what they did before. New code
 * should call statusFor() and handle 'neutral' properly.
 */
const toLegacyStatus = (s: MetricStatus): 'good' | 'warn' | 'critical' =>
    s === 'neutral' ? 'good' : s;

export const getMetricStatus = (metricType: string, value: number): 'good' | 'warn' | 'critical' =>
    toLegacyStatus(statusFor(metricType, value));

// ---------------------------------------------------------------------------
// Quarter helpers
// ---------------------------------------------------------------------------
export const getCurrentQuarter = () => {
    // Sydney-zoned, not the viewer's device clock — a manager overseas
    // shouldn't default to a different quarter than the roster itself uses.
    const now = getNowInTimezone(SYDNEY_TZ);
    return {
        year: now.getFullYear(),
        quarter: Math.floor(now.getMonth() / 3) + 1,
    };
};

export const getQuarterDateRange = (quarterYear: string): { start: Date; end: Date } | null => {
    if (quarterYear === 'ALL_TIME') return null;

    const [q, year] = quarterYear.split('_');
    const quarterNum = parseInt(q.substring(1));
    const yearNum = parseInt(year);
    const startMonth = (quarterNum - 1) * 3;

    return {
        start: new Date(yearNum, startMonth, 1),
        end: new Date(yearNum, startMonth + 3, 0, 23, 59, 59),
    };
};

export const getQuarterOptions = () => {
    const quarters: string[] = [];
    const { year: currentYear, quarter: currentQuarter } = getCurrentQuarter();

    quarters.push(`Q${currentQuarter}_${currentYear}`);

    for (let i = 1; i <= 4; i++) {
        let quarter = currentQuarter - i;
        let year = currentYear;

        if (quarter <= 0) {
            quarter += 4;
            year -= 1;
        }

        quarters.push(`Q${quarter}_${year}`);
    }

    return quarters;
};

export const formatQuarter = (quarterYear: string): string => {
    if (quarterYear === 'ALL_TIME') return 'All Time';
    const [q, year] = quarterYear.split('_');
    return `${q} ${year}`;
};

const parseQuarterYear = (quarterYear: string): { year: number; quarter: number } | null => {
    // Live per-employee computation needs a concrete quarter — 'ALL_TIME'
    // (a special case the old snapshot writer supported) isn't offered by
    // any current quarter picker in the app, so it isn't supported here.
    const [qPart, yearPart] = quarterYear.split('_');
    const quarter = parseInt((qPart ?? '').replace('Q', ''), 10);
    const year = parseInt(yearPart ?? '', 10);
    if (!quarter || quarter < 1 || quarter > 4 || !year) return null;
    return { year, quarter };
};

interface EmployeeQuarterlyPerformanceRow {
    employee_id: string;
    total_offers: number;
    accepted: number;
    rejected: number;
    expired: number;
    assigned: number;
    emergency_assigned: number;
    completed: number;
    no_show: number;
    swap_out: number;
    acceptance_rate: number;
    rejection_rate: number;
    ignorance_rate: number;
    cancel_rate: number;
    late_cancel_rate: number;
    no_show_rate: number;
    swap_rate: number;
    reliability_score: number;
    late_clock_in_rate: number;
    early_clock_out_rate: number;
    attendance_compliance_rate: number;
    total_bids: number;
    bids_accepted: number;
    bid_success_rate: number;
    trade_requests: number;
    performance_score: number;
    engagement_score: number;
    calculated_at: string;
}

// ---------------------------------------------------------------------------
// usePerformanceMetrics — live per-employee read via get_employee_quarterly_performance
// Signature: (employeeId: string, quarterYear: string) — 2 args, unchanged
//
// Previously read the employee_performance_metrics snapshot table, which was
// only ever updated when this component's own "Refresh" button ran
// compute_employee_quarter_metrics(). The Insights "Team Performance" report
// computes the same metrics live on every load, so the two could show
// different numbers for the same employee/quarter. Both now go through the
// same always-live computation.
// ---------------------------------------------------------------------------
export const usePerformanceMetrics = (employeeId: string, quarterYear: string) => {
    const parsed = parseQuarterYear(quarterYear);
    return useQuery({
        queryKey: ['performance_metrics', employeeId, quarterYear],
        queryFn: async () => {
            if (!parsed) return null;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase as any).rpc('get_employee_quarterly_performance', {
                p_employee_id: employeeId,
                p_year: parsed.year,
                p_quarter: parsed.quarter,
            });
            if (error) throw error;

            const row: EmployeeQuarterlyPerformanceRow | undefined = Array.isArray(data) ? data[0] : data;
            if (!row) return null;

            const range = getQuarterDateRange(quarterYear);
            const snapshot = {
                id: row.employee_id,
                employee_id: row.employee_id,
                period_start: range ? range.start.toISOString() : '',
                period_end: range ? range.end.toISOString() : '',
                quarter_year: quarterYear,
                is_locked: false,
                total_offers: row.total_offers,
                shifts_offered: row.total_offers, // real DB column name PerformanceSection.tsx reads via `(m as any)`
                shifts_accepted: row.accepted,
                shifts_rejected: row.rejected,
                shifts_assigned: row.assigned,
                emergency_assignments: row.emergency_assigned,
                shifts_worked: row.completed,
                shifts_swapped: row.swap_out,
                shifts_dropped: row.no_show,
                standard_cancellations: 0,
                late_cancellations: 0,
                no_shows: row.no_show,
                offer_expirations: row.expired,
                early_clock_outs: 0,
                late_clock_ins: 0,
                auto_clock_outs: 0,
                acceptance_rate: row.acceptance_rate,
                drop_rate: row.cancel_rate,
                rejection_rate: row.rejection_rate,
                offer_expiration_rate: row.ignorance_rate,
                cancellation_rate_standard: row.cancel_rate,
                cancellation_rate_late: row.late_cancel_rate,
                swap_ratio: row.swap_rate,
                reliability_score: row.reliability_score,
                late_clock_in_rate: row.late_clock_in_rate,
                early_clock_out_rate: row.early_clock_out_rate,
                auto_clock_out_rate: 0,
                no_show_rate: row.no_show_rate,
                // attendance_compliance_rate (worked AND not late-in AND not early-out) is
                // what "punctuality" actually means here — the snapshot table had a
                // punctuality_rate column that compute_employee_quarter_metrics() never
                // wrote to, so it silently stayed at its DEFAULT 100 for every employee.
                punctuality_rate: row.attendance_compliance_rate,
                calculated_at: row.calculated_at,
            };
            return snapshot as EmployeeMetricsSnapshot;
        },
        enabled: !!employeeId && !!quarterYear && !!parsed,
    });
};

// ---------------------------------------------------------------------------
// useQuarterlyReport — calls get_quarterly_performance_report RPC
// Signature: (year: number, quarter: number, scope: ScopeSelection)
// ---------------------------------------------------------------------------
export const useQuarterlyReport = (year: number, quarter: number, scope: ScopeSelection) => {
    return useQuery({
        queryKey: ['quarterly_performance_report', year, quarter, scope],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('get_quarterly_performance_report', {
                p_year: year,
                p_quarter: quarter,
                p_org_ids: scope.org_ids.length ? scope.org_ids : undefined,
                p_dept_ids: scope.dept_ids.length ? scope.dept_ids : undefined,
                p_subdept_ids: scope.subdept_ids.length ? scope.subdept_ids : undefined,
            });
            if (error) throw error;
            return (data ?? []) as EmployeePerformanceRow[];
        },
        enabled: !!year && !!quarter && !!scope,
    });
};

// ---------------------------------------------------------------------------
// REPORT_THRESHOLDS — thresholds tuned for the global report table
// ---------------------------------------------------------------------------
export const REPORT_THRESHOLDS = {
    acceptance_rate:  { good: 70, warn: 40 },
    drop_rate:        { good: 5,  warn: 15 },
    cancel_rate:      { good: 10, warn: 25 },
    late_cancel_rate: { good: 5,  warn: 15 },
    no_show_rate:     { good: 2,  warn: 5  },
    reliability_score: { good: 90, warn: 75 },
    bid_success_rate:  { good: 70, warn: 40 },
    performance_score: { good: 85, warn: 70 },
    engagement_score:  { good: 60, warn: 30 },
    attendance_compliance_rate: { good: 95, warn: 85 },
    standard_drop_rate: { good: 5,  warn: 15 },
    urgent_drop_rate:   { good: 3,  warn: 10 },
    early_clock_in_rate: { good: 5,  warn: 15 },
    late_clock_out_rate: { good: 5,  warn: 15 },
    auto_clock_out_rate: { good: 5,  warn: 15 },
    on_time_in_rate:  { good: 85, warn: 70 },
    on_time_out_rate: { good: 85, warn: 70 },
} as const;

export const getReportCellStatus = (metricType: string, value: number): 'good' | 'warn' | 'critical' =>
    toLegacyStatus(statusFor(metricType, value));
