import { useState, useEffect } from "react";
import { MetricId } from "../model/metric.types";
import { insightsApi, InsightsQueryFilters } from "../api/insights.api";

/**
 * Hook to fetch trend data for a metric.
 */
export function useMetricTrend(metricId: MetricId, filters: InsightsQueryFilters) {
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        let isMounted = true;

        async function fetchTrend() {
            setLoading(true);
            try {
                const trend = await insightsApi.getMetricTrend(metricId, filters);
                if (isMounted) {
                    setData(trend);
                    setError(null);
                }
            } catch (err) {
                if (isMounted) {
                    setError(err instanceof Error ? err : new Error("Failed to fetch metric trend"));
                }
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        }

        fetchTrend();
        return () => { isMounted = false; };
    }, [metricId, filters.startDate, filters.endDate, filters.departmentId]);

    return { data, loading, error };
}
