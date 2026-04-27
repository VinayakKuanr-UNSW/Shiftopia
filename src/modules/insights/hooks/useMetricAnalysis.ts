import { useQuery } from '@tanstack/react-query';
import { insightsApi } from '../api/insights.api';
import type { InsightsFilters } from '../model/metric.types';

export function useMetricAnalysis(metricId: string | undefined, filters: InsightsFilters) {
    return useQuery({
        queryKey: ['metric_analysis', metricId, filters],
        queryFn: async () => {
            if (!metricId) return null;
            return await insightsApi.getMetricAnalysis(metricId, filters);
        },
        enabled: !!metricId && !!filters.startDate && !!filters.endDate,
        staleTime: 5 * 60 * 1000,
    });
}
