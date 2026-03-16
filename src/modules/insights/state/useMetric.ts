import { MetricId, MetricValue } from "../model/metric.types";

export interface InsightsQueryFilters {
    startDate: string;
    endDate: string;
    organizationId?: string;
    departmentId?: string;
    subDepartmentId?: string;
}

/**
 * @deprecated Use useInsightsSummary from hooks/useInsightsSummary instead.
 * Kept as a stub so legacy view components still compile.
 */
export function useMetric(_metricId: MetricId, _filters: InsightsQueryFilters) {
    return { data: null as MetricValue | null, loading: false, error: null };
}
