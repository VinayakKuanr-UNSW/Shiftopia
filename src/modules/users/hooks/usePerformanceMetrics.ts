import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/realtime/client';
import type { ScopeSelection } from '@/platform/auth/types';

// Types
export interface PerformanceMetrics {
    id: string;
    employee_id: string;
    period_start: string;
    period_end: string;
    quarter_year: string;  // 'Q1_2026' or 'ALL_TIME'
    is_locked: boolean;

    // Raw counts
    shifts_offered: number;
    shifts_accepted: number;
    shifts_rejected: number;
    shifts_assigned: number;
    emergency_assignments: number;
    shifts_worked: number;
    shifts_swapped: number;
    standard_cancellations: number;
    late_cancellations: number;
    no_shows: number;
    offer_expirations: number;
    early_clock_outs: number;
    late_clock_ins: number;

    // Offer Behavior rates
    acceptance_rate: number;
    rejection_rate: number;
    offer_expiration_rate: number;

    // Reliability rates
    cancellation_rate_standard: number;
    cancellation_rate_late: number;
    swap_ratio: number;
    reliability_score: number;

    // Attendance rates
    late_clock_in_rate: number;
    early_clock_out_rate: number;
    no_show_rate: number;

    calculated_at: string;
}

// Helper function to generate quarter options for the last year
export const getQuarterOptions = () => {
    const quarters = [];
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth();
    const currentQuarter = Math.floor(currentMonth / 3) + 1;

    // Add current quarter
    quarters.push(`Q${currentQuarter}_${currentYear}`);

    // Add previous 4 quarters
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

// Helper function to format quarter for display
export const formatQuarter = (quarterYear: string): string => {
    if (quarterYear === 'ALL_TIME') return 'All Time';
    return quarterYear.replace('_', ' ');
};

// Helper function to get date range for a quarter
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

export const EMPTY_METRICS: PerformanceMetrics = {
    id: '',
    employee_id: '',
    period_start: '',
    period_end: '',
    quarter_year: '',
    is_locked: false,
    shifts_offered: 0,
    shifts_accepted: 0,
    shifts_rejected: 0,
    shifts_assigned: 0,
    emergency_assignments: 0,
    shifts_worked: 0,
    shifts_swapped: 0,
    standard_cancellations: 0,
    late_cancellations: 0,
    no_shows: 0,
    offer_expirations: 0,
    early_clock_outs: 0,
    late_clock_ins: 0,
    acceptance_rate: 0,
    rejection_rate: 0,
    offer_expiration_rate: 0,
    cancellation_rate_standard: 0,
    cancellation_rate_late: 0,
    swap_ratio: 0,
    reliability_score: 100,
    late_clock_in_rate: 0,
    early_clock_out_rate: 0,
    no_show_rate: 0,
    calculated_at: new Date().toISOString(),
};

/**
 * Hook to fetch performance metrics for an employee and specific quarter.
 * CRITICAL: This hook ONLY reads from employee_performance_metrics table.
 * It NEVER calls RPC functions — those are used only by background jobs.
 */
export const usePerformanceMetrics = (
    employeeId: string,
    quarterYear: string  // 'Q1_2026' or 'ALL_TIME'
) => {
    return useQuery({
        queryKey: ['performance_metrics', employeeId, quarterYear],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('employee_performance_metrics')
                .select('*')
                .eq('employee_id', employeeId)
                .eq('quarter_year', quarterYear)
                .maybeSingle();

            if (error) throw error;

            if (!data) {
                return {
                    ...EMPTY_METRICS,
                    employee_id: employeeId,
                    quarter_year: quarterYear,
                } as PerformanceMetrics;
            }

            return data as PerformanceMetrics;
        },
        enabled: !!employeeId && !!quarterYear,
    });
};

// Warning thresholds for color coding
export const METRIC_THRESHOLDS = {
    // Green zone (higher is better)
    acceptance_rate: { good: 80, warn: 50 },
    reliability_score: { good: 85, warn: 70 },

    // Orange/Red zone (bad when HIGH)
    rejection_rate: { good: 10, warn: 20 },
    cancellation_rate_standard: { good: 5, warn: 15 },
    cancellation_rate_late: { good: 3, warn: 10 },
    swap_ratio: { good: 10, warn: 20 },
    offer_expiration_rate: { good: 10, warn: 25 },
    late_clock_in_rate: { good: 5, warn: 15 },
    early_clock_out_rate: { good: 5, warn: 15 },
    no_show_rate: { good: 2, warn: 5 },
} as const;

type ThresholdKey = keyof typeof METRIC_THRESHOLDS;

export const getMetricStatus = (metricType: string, value: number): 'good' | 'warn' | 'critical' => {
    const thresholds = METRIC_THRESHOLDS[metricType as ThresholdKey];
    if (!thresholds) return 'good';

    const higherIsBetter = ['acceptance_rate', 'reliability_score'];
    if (higherIsBetter.includes(metricType)) {
        if (value >= thresholds.good) return 'good';
        if (value >= thresholds.warn) return 'warn';
        return 'critical';
    } else {
        if (value <= thresholds.good) return 'good';
        if (value <= thresholds.warn) return 'warn';
        return 'critical';
    }
};

/* ═══════════════════════════════════════════════════════════════════
   QUARTERLY REPORT — used by /performance page
   ═══════════════════════════════════════════════════════════════════ */

export interface QuarterlyReportRow {
    employee_id: string;
    employee_name: string;
    offers_sent: number;
    accepted: number;
    rejected: number;
    expired: number;
    assigned: number;
    emergency_assigned: number;
    cancel_standard: number;
    cancel_late: number;
    swap_out: number;
    late_clock_in: number;
    early_clock_out: number;
    no_show: number;
    completed: number;
    acceptance_rate: number;
    rejection_rate: number;
    ignorance_rate: number;
    cancel_rate: number;
    late_cancel_rate: number;
    swap_rate: number;
    reliability_score: number;
    late_clock_in_rate: number;
    early_clock_out_rate: number;
    no_show_rate: number;
}

export const getCurrentQuarter = () => {
    const now = new Date();
    return {
        year: now.getFullYear(),
        quarter: Math.floor(now.getMonth() / 3) + 1,
    };
};

export const useQuarterlyReport = (year: number, quarter: number, scope: ScopeSelection) => {
    return useQuery({
        queryKey: ['quarterly_performance_report', year, quarter, scope],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('get_quarterly_performance_report', {
                p_year: year,
                p_quarter: quarter,
                p_org_ids: scope.org_ids.length ? scope.org_ids : null,
                p_dept_ids: scope.dept_ids.length ? scope.dept_ids : null,
                p_subdept_ids: scope.subdept_ids.length ? scope.subdept_ids : null,
            });
            if (error) throw error;
            return (data ?? []) as QuarterlyReportRow[];
        },
        enabled: !!year && !!quarter && !!scope,
    });
};

/** Thresholds tuned for the global report table (per user spec). */
export const REPORT_THRESHOLDS = {
    acceptance_rate: { good: 70, warn: 40 },
    cancel_rate: { good: 10, warn: 25 },
    late_cancel_rate: { good: 5, warn: 15 },
    no_show_rate: { good: 2, warn: 5 },
    reliability_score: { good: 90, warn: 75 },
} as const;

type ReportThresholdKey = keyof typeof REPORT_THRESHOLDS;

export const getReportCellStatus = (metricType: string, value: number): 'good' | 'warn' | 'critical' => {
    const thresholds = REPORT_THRESHOLDS[metricType as ReportThresholdKey];
    if (!thresholds) return 'good';

    const higherIsBetter = ['acceptance_rate', 'reliability_score'];
    if (higherIsBetter.includes(metricType)) {
        if (value >= thresholds.good) return 'good';
        if (value >= thresholds.warn) return 'warn';
        return 'critical';
    } else {
        if (value <= thresholds.good) return 'good';
        if (value <= thresholds.warn) return 'warn';
        return 'critical';
    }
};

