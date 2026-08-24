/**
 * Shapes returned by the insights RPCs.
 *
 * The 11-entry MetricId union and METRIC_DEFINITIONS that used to head this
 * file are gone: metric-registry.ts superseded them, and keeping a second
 * catalogue of metric names alongside it was how "one metric, two
 * definitions" kept happening. The registry is the only catalogue.
 */

// ── Real analytics types ──────────────────────────────────────────────────────

export interface InsightsFilters {
    startDate: string;   // 'YYYY-MM-DD'
    endDate: string;     // 'YYYY-MM-DD'
    orgIds?: string[];
    deptIds?: string[];
    subdeptIds?: string[];
}

/**
 * Returned by get_insights_summary RPC.
 *
 * Four fields were removed in migration 20260823090000 because none of them
 * described anything real:
 *   compliance_failures    — the RPC returned the literal 0
 *   last_minute_changes    — was the SAME value as shifts_emergency
 *   avg_reliability_score  — averaged employee_performance_metrics, a snapshot
 *   avg_swap_rate            table last written 2026-07-30 by a Refresh button
 *                            that no longer exists
 * The live reliability/swap figures come from get_quarterly_performance_report.
 */
export interface InsightsSummary {
    shifts_total: number;
    shifts_published: number;
    shifts_assigned: number;
    shifts_unassigned: number;
    shifts_cancelled: number;
    shifts_completed: number;
    shifts_no_show: number;
    shifts_emergency: number;
    scheduled_hours: number;
    estimated_cost: number;
    /** assigned / shifts_total. Label the denominator as TOTAL, not published. */
    shift_fill_rate: number;
    compliance_overrides: number;
    no_show_rate: number;
}

/** One row from get_insights_trend RPC — one dept per day */
export interface TrendRow {
    period_date: string;
    dept_id: string;
    dept_name: string;
    shifts_total: number;
    shifts_assigned: number;
    fill_rate: number;
    estimated_cost: number;
}

/** Chart-friendly shape after client-side pivot of TrendRow[] */
export interface TrendChartPoint {
    date: string;
    [deptName: string]: number | string;
}

/** One row from get_dept_insights_breakdown RPC */
export interface DeptBreakdownRow {
    dept_id: string;
    dept_name: string;
    shifts_total: number;
    shifts_assigned: number;
    fill_rate: number;
    estimated_cost: number;
    no_show_count: number;
    emergency_count: number;
}

/**
 * Date-range presets. Retired with useDateRange when the KPI surface went
 * quarter-only: the presets derived "today" from the device clock, so a
 * manager overseas got a different week than the roster used. Quarter
 * boundaries now come from the Sydney-anchored getCurrentQuarter().
 */
