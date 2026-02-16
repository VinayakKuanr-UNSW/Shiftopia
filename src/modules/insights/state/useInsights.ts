import { useState, useEffect } from "react";
import { MetricValue } from "../model/metric.types";
import { insightsApi, InsightsQueryFilters } from "../api/insights.api";

/**
 * Hook to fetch all insights for the dashboard.
 */
export function useInsights(filters: InsightsQueryFilters) {
    const [data, setData] = useState<{
        workforce: MetricValue[];
        events: MetricValue[];
        financial: MetricValue[];
    }>({
        workforce: [],
        events: [],
        financial: [],
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        let isMounted = true;

        async function fetchAllInsights() {
            setLoading(true);
            try {
                const [workforce, events, financial] = await Promise.all([
                    insightsApi.getWorkforceMetrics(filters),
                    insightsApi.getEventMetrics(filters),
                    insightsApi.getFinancialMetrics(filters),
                ]);

                if (isMounted) {
                    setData({ workforce, events, financial });
                    setError(null);
                }
            } catch (err) {
                if (isMounted) {
                    setError(err instanceof Error ? err : new Error("Failed to fetch insights"));
                }
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        }

        fetchAllInsights();
        return () => { isMounted = false; };
    }, [filters.startDate, filters.endDate, filters.departmentId]);

    return { data, loading, error };
}
