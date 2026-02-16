import { MetricId, MetricValue } from "../model/metric.types";

/**
 * Insights API - Read-only queries for analytics and metrics.
 * Following Atlassian principles: Query-only, no side effects.
 */

export interface InsightsQueryFilters {
    startDate: string;
    endDate: string;
    departmentId?: string;
    locationId?: string;
}

export const insightsApi = {
    /**
     * Fetches workforce utilization metrics for a given date range.
     */
    async getWorkforceMetrics(filters: InsightsQueryFilters): Promise<MetricValue[]> {
        console.log("Fetching workforce metrics for:", filters);
        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 500));

        return [
            { metricId: "SHIFT_FILL_RATE", value: 92, timestamp: new Date().toISOString(), trend: "up" },
            { metricId: "EMPLOYEE_UTILIZATION", value: 78, timestamp: new Date().toISOString(), trend: "stable" },
            { metricId: "NO_SHOW_RATE", value: 2.8, timestamp: new Date().toISOString(), trend: "down" },
            { metricId: "PUNCTUALITY_RATE", value: 7, timestamp: new Date().toISOString() }, // 5 late + 2 early
            { metricId: "UNDERUTILIZED_STAFF_COUNT", value: 2, timestamp: new Date().toISOString() },
        ];
    },

    /**
     * Fetches event-level coverage and demand metrics.
     */
    async getEventMetrics(filters: InsightsQueryFilters): Promise<MetricValue[]> {
        console.log("Fetching event metrics for:", filters);
        await new Promise(resolve => setTimeout(resolve, 400));

        return [
            { metricId: "SHIFT_DEMAND", value: 48, timestamp: new Date().toISOString() },
            { metricId: "SHIFT_SUPPLY", value: 51, timestamp: new Date().toISOString() },
            { metricId: "ROLE_COVERAGE", value: 100, timestamp: new Date().toISOString(), trend: "stable" },
            { metricId: "EVENT_CONFLICTS", value: 1, timestamp: new Date().toISOString(), trend: "down" },
        ];
    },

    /**
     * Fetches financial and budget related insights.
     */
    async getFinancialMetrics(filters: InsightsQueryFilters): Promise<MetricValue[]> {
        console.log("Fetching financial metrics for:", filters);
        await new Promise(resolve => setTimeout(resolve, 600));

        return [
            { metricId: "LABOUR_COST", value: 42500, timestamp: new Date().toISOString(), trend: "up" },
            { metricId: "BUDGET_ADHERENCE", value: 95, timestamp: new Date().toISOString(), trend: "stable" },
        ];
    },

    /**
     * Fetches trend data for specific metrics (used by charts).
     */
    async getMetricTrend(metricId: MetricId, filters: InsightsQueryFilters): Promise<any[]> {
        console.log(`Fetching trend for ${metricId}:`, filters);
        await new Promise(resolve => setTimeout(resolve, 300));

        if (metricId === "SHIFT_FILL_RATE") {
            return [
                { name: 'Mon', convention: 85, exhibition: 78, theatre: 90 },
                { name: 'Tue', convention: 88, exhibition: 82, theatre: 93 },
                { name: 'Wed', convention: 90, exhibition: 85, theatre: 88 },
                { name: 'Thu', convention: 92, exhibition: 80, theatre: 85 },
                { name: 'Fri', convention: 86, exhibition: 75, theatre: 92 },
                { name: 'Sat', convention: 78, exhibition: 72, theatre: 80 },
                { name: 'Sun', convention: 75, exhibition: 68, theatre: 75 },
            ];
        }

        return [];
    }
};
