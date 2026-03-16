import { MetricValue } from "../model/metric.types";
import type { InsightsQueryFilters } from "./useMetric";

/**
 * @deprecated Use useInsightsSummary from hooks/useInsightsSummary instead.
 * Kept as a stub so legacy view components still compile.
 */
export function useInsights(_filters: InsightsQueryFilters) {
    return {
        data: {
            workforce: [] as MetricValue[],
            events:    [] as MetricValue[],
            financial: [] as MetricValue[],
        },
        loading: false,
        error: null,
    };
}
