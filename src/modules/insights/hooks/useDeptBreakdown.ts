import { useQuery } from '@tanstack/react-query';
import { insightsApi } from '../api/insights.api';
import type { InsightsFilters, DeptBreakdownRow } from '../model/metric.types';

export function useDeptBreakdown(filters: InsightsFilters) {
    return useQuery({
        queryKey: ['insights_dept_breakdown', filters],
        queryFn: () => insightsApi.getDeptBreakdown(filters),
        enabled: !!filters.startDate && !!filters.endDate,
        staleTime: 5 * 60 * 1000,
        gcTime:    15 * 60 * 1000,
        placeholderData: [] as DeptBreakdownRow[],
    });
}
