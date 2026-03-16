import { MetricId } from "../model/metric.types";
import type { InsightsQueryFilters } from "./useMetric";

/**
 * @deprecated Use useInsightsTrend from hooks/useInsightsTrend instead.
 * Kept as a stub so legacy view components still compile.
 */
export function useMetricTrend(_metricId: MetricId, _filters: InsightsQueryFilters) {
    return { data: [] as unknown[], loading: false, error: null };
}
