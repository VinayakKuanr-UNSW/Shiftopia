import { useState, useEffect } from "react";
import { MetricId, MetricValue } from "../model/metric.types";
import { insightsApi, InsightsQueryFilters } from "../api/insights.api";

/**
 * Hook to fetch a specific metric value.
 */
export function useMetric(metricId: MetricId, filters: InsightsQueryFilters) {
    const [data, setData] = useState<MetricValue | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        let isMounted = true;

        async function fetchMetric() {
            setLoading(true);
            try {
                // This is a bit simplified, usually you'd have a specific endpoint for one metric
                // or filter from a larger response. For now, we'll fetch from the relevant category.
                let values: MetricValue[] = [];

                if (["SHIFT_FILL_RATE", "EMPLOYEE_UTILIZATION", "NO_SHOW_RATE", "PUNCTUALITY_RATE", "UNDERUTILIZED_STAFF_COUNT"].includes(metricId)) {
                    values = await insightsApi.getWorkforceMetrics(filters);
                } else if (["SHIFT_DEMAND", "SHIFT_SUPPLY", "ROLE_COVERAGE", "EVENT_CONFLICTS"].includes(metricId)) {
                    values = await insightsApi.getEventMetrics(filters);
                } else if (["LABOUR_COST", "BUDGET_ADHERENCE"].includes(metricId)) {
                    values = await insightsApi.getFinancialMetrics(filters);
                }

                if (isMounted) {
                    const match = values.find(v => v.metricId === metricId);
                    setData(match || null);
                    setError(null);
                }
            } catch (err) {
                if (isMounted) {
                    setError(err instanceof Error ? err : new Error("Failed to fetch metric"));
                }
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        }

        fetchMetric();
        return () => { isMounted = false; };
    }, [metricId, filters.startDate, filters.endDate, filters.departmentId]);

    return { data, loading, error };
}
