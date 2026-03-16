import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { insightsApi } from '../api/insights.api';
import type { InsightsFilters, TrendRow, TrendChartPoint } from '../model/metric.types';

/**
 * Pivots flat TrendRow[] (one row per date+dept) into chart-friendly
 * array with one entry per date and one key per department name.
 */
function pivotTrend(rows: TrendRow[]): TrendChartPoint[] {
    const map = new Map<string, TrendChartPoint>();

    for (const row of rows) {
        const label = format(new Date(row.period_date), 'MMM d');
        if (!map.has(label)) {
            map.set(label, { date: label });
        }
        const point = map.get(label)!;
        point[row.dept_name] = row.fill_rate;
        point[`${row.dept_name}_cost`] = row.estimated_cost;
    }

    return Array.from(map.values());
}

/** Returns unique dept names present in the trend rows */
export function extractDeptNames(rows: TrendRow[]): string[] {
    return [...new Set(rows.map(r => r.dept_name))];
}

export function useInsightsTrend(filters: InsightsFilters) {
    return useQuery({
        queryKey: ['insights_trend', filters],
        queryFn: async () => {
            const rows = await insightsApi.getTrend(filters);
            return {
                raw: rows,
                chart: pivotTrend(rows),
                deptNames: extractDeptNames(rows),
            };
        },
        enabled: !!filters.startDate && !!filters.endDate,
        staleTime: 5 * 60 * 1000,
        gcTime:    15 * 60 * 1000,
        placeholderData: { raw: [], chart: [], deptNames: [] },
    });
}
