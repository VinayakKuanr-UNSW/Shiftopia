import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/platform/realtime/client';

// Types
export interface PerformanceMetrics {
    id: string;
    employee_id: string;
    period_start: string;
    period_end: string;
    quarter_year: string;  // 'Q1_2026' or 'ALL_TIME'
    is_locked: boolean;

    // Numerators
    shifts_offered: number;
    shifts_accepted: number;
    shifts_rejected: number;
    shifts_assigned: number;
    shifts_worked: number;
    shifts_swapped: number;
    standard_cancellations: number;
    late_cancellations: number;
    no_shows: number;

    // Calculated rates
    acceptance_rate: number;
    rejection_rate: number;
    punctuality_rate: number;
    swap_ratio: number;
    cancellation_rate_standard: number;
    cancellation_rate_late: number;
    no_show_rate: number;

    metric_version: number;
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

/**
 * Hook to fetch performance metrics for an employee and specific quarter
 * CRITICAL: This hook ONLY reads from employee_performance_metrics table
 * It NEVER calls RPC functions - those are used only by background jobs
 */
export const usePerformanceMetrics = (
    employeeId: string,
    quarterYear: string  // 'Q1_2026' or 'ALL_TIME'
) => {
    return useQuery({
        queryKey: ['performance_metrics', employeeId, quarterYear],
        queryFn: async () => {
            // ALWAYS read from employee_performance_metrics table
            // Background jobs populate this table - frontend NEVER calls RPC
            const { data, error } = await supabase
                .from('employee_performance_metrics')
                .select('*')
                .eq('employee_id', employeeId)
                .eq('quarter_year', quarterYear)
                .maybeSingle();

            if (error) throw error;

            if (!data) {
                // If quarter doesn't exist yet, return empty metrics
                return {
                    id: '',
                    employee_id: employeeId,
                    period_start: '',
                    period_end: '',
                    quarter_year: quarterYear,
                    is_locked: false,
                    shifts_offered: 0,
                    shifts_accepted: 0,
                    shifts_rejected: 0,
                    shifts_assigned: 0,
                    shifts_worked: 0,
                    shifts_swapped: 0,
                    acceptance_rate: 0,
                    rejection_rate: 0,
                    punctuality_rate: 100,
                    swap_ratio: 0,
                    standard_cancellations: 0,
                    late_cancellations: 0,
                    no_shows: 0,
                    cancellation_rate_standard: 0,
                    cancellation_rate_late: 0,
                    no_show_rate: 0,
                    metric_version: 1,
                    calculated_at: new Date().toISOString(),
                } as PerformanceMetrics;
            }

            return data as PerformanceMetrics;
        },
        enabled: !!employeeId && !!quarterYear,
    });
};

// Hook to check if metrics are above/below average
export const useMetricComparison = (value: number, metricType: string) => {
    // These would ideally come from aggregated data
    // For now, using reasonable thresholds
    const benchmarks: Record<string, number> = {
        acceptance_rate: 85,
        punctuality_rate: 95,
        rejection_rate: 15,
        swap_ratio: 10,
        cancellation_rate_standard: 5,
        cancellation_rate_late: 3,
        no_show_rate: 2,
    };

    const benchmark = benchmarks[metricType] || 50;

    // For metrics where higher is better
    const higherIsBetter = ['acceptance_rate', 'punctuality_rate', 'swap_ratio'];

    if (higherIsBetter.includes(metricType)) {
        return value >= benchmark ? 'above' : 'below';
    } else {
        // For metrics where lower is better
        return value <= benchmark ? 'above' : 'below';  // "above average" means better (lower bad rate)
    }
};
