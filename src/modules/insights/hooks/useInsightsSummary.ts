import { useQuery } from '@tanstack/react-query';
import { insightsApi } from '../api/insights.api';
import type { InsightsFilters, InsightsSummary } from '../model/metric.types';

const EMPTY_SUMMARY: InsightsSummary = {
    shifts_total: 0,
    shifts_published: 0,
    shifts_assigned: 0,
    shifts_unassigned: 0,
    shifts_cancelled: 0,
    shifts_completed: 0,
    shifts_no_show: 0,
    shifts_emergency: 0,
    scheduled_hours: 0,
    estimated_cost: 0,
    shift_fill_rate: 0,
    compliance_overrides: 0,
    no_show_rate: 0,
};

export function useInsightsSummary(filters: InsightsFilters) {
    return useQuery({
        queryKey: ['insights_summary', filters],
        queryFn: async () => {
            const data = await insightsApi.getSummary(filters);
            // RPC returns a single jsonb object — coerce nulls to defaults
            return { ...EMPTY_SUMMARY, ...data } as InsightsSummary;
        },
        enabled: !!filters.startDate && !!filters.endDate,
        staleTime: 5 * 60 * 1000,   // 5 min — analytics don't need real-time
        gcTime:    15 * 60 * 1000,
        // No placeholderData. An all-zero placeholder renders a confident "0%"
        // on first paint, which is indistinguishable from a real zero and from
        // a failed query. Callers show a skeleton while isLoading instead.
    });
}
