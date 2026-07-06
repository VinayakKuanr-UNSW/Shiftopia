/**
 * Performance Metrics Contract - Phase 2
 * Includes Explainability, Behavioral Indicators, and Performance Flags.
 */

export type PerformanceFlag = 'OK' | 'WARN' | 'CRITICAL' | 'INSUFFICIENT_DATA';

export type PerformanceMetrics = {
    // Raw Counts
    total_offers: number;
    accepted: number;
    rejected: number;
    expired: number;

    assigned: number;
    emergency_assigned: number;

    cancel_standard: number;
    cancel_late: number;
    swap_out: number;

    late_clock_in: number;
    early_clock_out: number;
    no_show: number;
    completed: number;

    // Calculated Rates (%)
    acceptance_rate: number;
    rejection_rate: number;
    ignorance_rate: number;
    drop_rate: number;
    cancel_rate: number;
    late_cancel_rate: number;
    swap_rate: number;

    late_clock_in_rate: number;
    early_clock_out_rate: number;
    no_show_rate: number;

    // Aggregate Score (0-100)
    reliability_score: number;

    // Bids
    total_bids: number;
    bids_accepted: number;
    bid_success_rate: number;

    // Snapshot Restructuring additions
    assignment_changes?: number;
    trade_requests?: number;
    trade_completion_rate?: number;
    trade_cancellation_rate?: number;
    attendance_compliance_rate?: number;
    performance_score?: number;
    engagement_score?: number;
    standard_drop_rate?: number;
    urgent_drop_rate?: number;
    early_clock_in?: number;
    late_clock_out?: number;
    early_clock_in_rate?: number;
    late_clock_out_rate?: number;
    on_time_in?: number;
    on_time_out?: number;
    on_time_in_rate?: number;
    on_time_out_rate?: number;
    auto_clock_out?: number;
    auto_clock_out_rate?: number;

    // Phase 2: Performance Insights (not yet returned by any DB function)
    performance_flag?: PerformanceFlag;

    // Behavioral Indicators
    responsiveness_minutes?: number; // Avg time to resolve offers
    stability_score?: number;        // Assigned vs Completed ratio (%)
};

export type EmployeePerformanceRow = {
    employee_id: string;
    employee_name: string;
} & PerformanceMetrics;

export interface PerformanceFilters {
    startDate: string; // ISO Date
    endDate: string;   // ISO Date
    orgIds?: string[];
    deptIds?: string[];
    subdeptIds?: string[];
}

/**
 * Trend Data for Charting
 */
export interface PerformanceTrendPoint {
    period_start: string;
    reliability_score: number;
    cancel_rate: number;
    worked_count: number;
}

/**
 * Event Timeline Item (Audit/Debug)
 */
export interface PerformanceEventTimelineItem {
    event_id: string;
    event_type: string;
    event_time: string;
    shift_id: string;
    shift_date: string;
    shift_label: string;
    metadata: any;
}
