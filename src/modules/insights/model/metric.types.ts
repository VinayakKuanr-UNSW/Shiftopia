export type MetricId =
    | "SHIFT_FILL_RATE"
    | "EMPLOYEE_UTILIZATION"
    | "NO_SHOW_RATE"
    | "PUNCTUALITY_RATE"
    | "UNDERUTILIZED_STAFF_COUNT"
    | "SHIFT_DEMAND"
    | "SHIFT_SUPPLY"
    | "ROLE_COVERAGE"
    | "EVENT_CONFLICTS"
    | "LABOUR_COST"
    | "BUDGET_ADHERENCE";

export interface MetricDefinition {
    id: MetricId;
    label: string;
    description: string;
    unit: "%" | "hours" | "count" | "currency" | "string";
}

export const METRIC_DEFINITIONS: Record<MetricId, MetricDefinition> = {
    SHIFT_FILL_RATE: {
        id: "SHIFT_FILL_RATE",
        label: "Shift Fill Rate",
        description: "Percentage of planned shifts filled",
        unit: "%",
    },
    EMPLOYEE_UTILIZATION: {
        id: "EMPLOYEE_UTILIZATION",
        label: "Employee Utilization",
        description: "Rostered vs. available hours",
        unit: "%",
    },
    NO_SHOW_RATE: {
        id: "NO_SHOW_RATE",
        label: "No-show Rate",
        description: "Missed shifts/assignments",
        unit: "%",
    },
    PUNCTUALITY_RATE: {
        id: "PUNCTUALITY_RATE",
        label: "Punctuality",
        description: "Late start and early finish irregularities",
        unit: "count",
    },
    UNDERUTILIZED_STAFF_COUNT: {
        id: "UNDERUTILIZED_STAFF_COUNT",
        label: "Underutilized Staff",
        description: "Number of staff consistently not rostered",
        unit: "count",
    },
    SHIFT_DEMAND: {
        id: "SHIFT_DEMAND",
        label: "Shift Demand",
        description: "Required number of shifts",
        unit: "count",
    },
    SHIFT_SUPPLY: {
        id: "SHIFT_SUPPLY",
        label: "Shift Supply",
        description: "Available staff count",
        unit: "count",
    },
    ROLE_COVERAGE: {
        id: "ROLE_COVERAGE",
        label: "Role Coverage",
        description: "Percentage of critical roles filled",
        unit: "%",
    },
    EVENT_CONFLICTS: {
        id: "EVENT_CONFLICTS",
        label: "Event Conflicts",
        description: "Number of overlapping event conflicts",
        unit: "count",
    },
    LABOUR_COST: {
        id: "LABOUR_COST",
        label: "Labour Cost",
        description: "Total estimated labour cost",
        unit: "currency",
    },
    BUDGET_ADHERENCE: {
        id: "BUDGET_ADHERENCE",
        label: "Budget Adherence",
        description: "Actual vs. budgeted cost",
        unit: "%",
    },
};

export interface MetricValue {
    metricId: MetricId;
    value: string | number;
    timestamp: string;
    trend?: "up" | "down" | "stable";
}
