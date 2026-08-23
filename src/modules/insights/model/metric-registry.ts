/**
 * metric-registry.ts — ONE definition per KPI.
 *
 * Before this file the codebase carried five status functions over four
 * threshold tables:
 *
 *   getMetricStatus     METRIC_THRESHOLDS     (usePerformanceMetrics)
 *   getReportCellStatus REPORT_THRESHOLDS     (usePerformanceMetrics)
 *   getKpiStatus        KPI_THRESHOLDS        (marketplace-kpis.types)
 *   getBiddingStatus    BIDDING_THRESHOLDS    (bidding-kpis.types)
 *   getScorecardStatus  SCORECARD_THRESHOLDS  (manager-scorecard.types)
 *
 * Each re-implemented the same higher/lower-is-better comparison, and each
 * declared direction by membership of a local array — so the direction of a
 * metric lived somewhere different from its thresholds. Two of the tables
 * disagreed outright on the same metric.
 *
 * RESOLVING THE DISAGREEMENTS
 * ---------------------------
 * METRIC_THRESHOLDS and REPORT_THRESHOLDS gave different bands for two
 * metrics. The rule applied here, uniformly: keep the value already applied to
 * the org-wide manager-facing report, because that is the one people have been
 * reading and calibrating against. Loosening a threshold silently makes
 * problems disappear, and no threshold was loosened.
 *
 *   acceptance_rate    80/50 vs 70/40  ->  70/40  (REPORT)
 *   reliability_score  85/70 vs 90/75  ->  90/75  (REPORT, and the stricter)
 *
 * Everything else was identical in both tables.
 *
 * WHAT LIVES HERE
 * ---------------
 * A metric's id, human label, unit, direction and bands, in one entry. Metrics
 * with no universally-correct target (raw counts, avg bids per shift) carry no
 * band and always resolve to 'neutral' — deliberately NOT 'good', which is
 * what the old functions returned and which painted unjudgeable numbers green.
 */

export type MetricStatus = 'good' | 'warn' | 'critical' | 'neutral';

/** How a value is rendered and compared. */
export type MetricFormat = 'percent' | 'count' | 'hours' | 'currency' | 'ratio';

export interface MetricSpec {
    /** Canonical id. Matches the RPC column wherever one exists. */
    id: string;
    /** Short human label. Sentence case, no trailing unit. */
    label: string;
    format: MetricFormat;
    /**
     * Which direction is healthy. `null` means the metric is not judgeable —
     * status is always 'neutral' and no band is defined.
     */
    direction: 'higher' | 'lower' | null;
    /** Band edges. Absent when direction is null. */
    good?: number;
    warn?: number;
    /** One line explaining what the number counts. Shown in the tile tooltip. */
    description?: string;
}

const spec = (s: MetricSpec): MetricSpec => s;

/**
 * The registry. Grouped by the KPI tab that owns each metric — a metric has
 * exactly one owning tab, which is how duplication stays gone.
 */
export const METRIC_REGISTRY: Record<string, MetricSpec> = {
    // ── Attendance ──────────────────────────────────────────────────────────
    attendance_compliance_rate: spec({
        id: 'attendance_compliance_rate', label: 'Attendance compliance', format: 'percent',
        direction: 'higher', good: 95, warn: 85,
        description: 'Worked, clocked in on time, and clocked out on time.',
    }),
    no_show_rate: spec({
        id: 'no_show_rate', label: 'No-show rate', format: 'percent',
        direction: 'lower', good: 2, warn: 5,
        description: 'No-shows as a share of shifts held.',
    }),
    on_time_in_rate: spec({
        id: 'on_time_in_rate', label: 'On-time in', format: 'percent',
        direction: 'higher', good: 85, warn: 70,
        description: 'Clock-in within 7.5 minutes of the scheduled start.',
    }),
    on_time_out_rate: spec({
        id: 'on_time_out_rate', label: 'On-time out', format: 'percent',
        direction: 'higher', good: 85, warn: 70,
        description: 'Clock-out within 7.5 minutes of the scheduled end.',
    }),
    early_clock_in_rate: spec({
        id: 'early_clock_in_rate', label: 'Early in', format: 'percent',
        direction: 'lower', good: 5, warn: 15,
    }),
    late_clock_in_rate: spec({
        id: 'late_clock_in_rate', label: 'Late in', format: 'percent',
        direction: 'lower', good: 5, warn: 15,
    }),
    early_clock_out_rate: spec({
        id: 'early_clock_out_rate', label: 'Early out', format: 'percent',
        direction: 'lower', good: 5, warn: 15,
    }),
    late_clock_out_rate: spec({
        id: 'late_clock_out_rate', label: 'Late out', format: 'percent',
        direction: 'lower', good: 5, warn: 15,
    }),
    auto_clock_out_rate: spec({
        id: 'auto_clock_out_rate', label: 'Missing clock-out', format: 'percent',
        direction: 'lower', good: 5, warn: 15,
        description: 'Shifts closed automatically because no clock-out was recorded.',
    }),
    shifts_worked: spec({
        id: 'shifts_worked', label: 'Shifts worked', format: 'count', direction: null,
    }),

    // ── Bids ────────────────────────────────────────────────────────────────
    // NOTE the rename: the RPC column is open_shift_fill_rate, but "fill rate"
    // already means filled/published at org level. Awarding an open shift is a
    // different question, so the label says so.
    open_shift_fill_rate: spec({
        id: 'open_shift_fill_rate', label: 'Open-shift award rate', format: 'percent',
        direction: 'higher', good: 80, warn: 60,
        description: 'Open bidding shifts that ended with a winner selected.',
    }),
    // TWO metrics shared the name `bid_success_rate`, at different aggregation
    // levels and with different correct bands — a genuine collision, not a
    // duplicate. They are separated here:
    //
    //   bid_win_rate      org-level, get_bidding_kpis: winners / ALL bids
    //                     placed. Bounded by 1 / avg bids per shift, so with
    //                     five bidders per shift it cannot exceed 20%.
    //   bid_success_rate  per-employee, get_quarterly_performance_report:
    //                     this person's winning bids / their bids. A healthy
    //                     individual bidder clears 70%.
    //
    // Grading the org number against the employee bands painted a perfectly
    // healthy marketplace critical.
    bid_win_rate: spec({
        id: 'bid_win_rate', label: 'Bid win rate', format: 'percent',
        direction: 'higher', good: 40, warn: 20,
        description: 'Share of all bids placed that won. Falls as competition per shift rises.',
    }),
    bid_success_rate: spec({
        id: 'bid_success_rate', label: 'Bid success rate', format: 'percent',
        direction: 'higher', good: 70, warn: 40,
        description: "An employee's winning bids as a share of the bids they placed.",
    }),
    unfilled_open_shift_rate: spec({
        id: 'unfilled_open_shift_rate', label: 'Unfilled open shifts', format: 'percent',
        direction: 'lower', good: 15, warn: 30,
    }),
    avg_bids_per_open_shift: spec({
        id: 'avg_bids_per_open_shift', label: 'Bids per open shift', format: 'ratio',
        direction: null,
        description: 'No universally correct target — depends on the shift.',
    }),
    open_bidding_shifts: spec({ id: 'open_bidding_shifts', label: 'Open bidding shifts', format: 'count', direction: null }),
    total_bids:          spec({ id: 'total_bids',          label: 'Bids placed',          format: 'count', direction: null }),
    winners_selected:    spec({ id: 'winners_selected',    label: 'Winners selected',     format: 'count', direction: null }),
    unfilled_open_shifts:spec({ id: 'unfilled_open_shifts',label: 'Unfilled open shifts', format: 'count', direction: null }),

    // ── Swaps ───────────────────────────────────────────────────────────────
    trade_completion_rate: spec({
        id: 'trade_completion_rate', label: 'Swap completion rate', format: 'percent',
        direction: 'higher', good: 75, warn: 50,
        description: 'Swaps initiated that reached an approved completion.',
    }),
    trade_rejection_rate: spec({
        id: 'trade_rejection_rate', label: 'Swap rejection rate', format: 'percent',
        direction: 'lower', good: 15, warn: 30,
        description: 'Swaps a manager declined.',
    }),
    trade_expiry_rate: spec({
        id: 'trade_expiry_rate', label: 'Swap expiry rate', format: 'percent',
        direction: 'lower', good: 15, warn: 30,
        description: 'Swaps that lapsed with nobody responding.',
    }),
    trades_initiated: spec({ id: 'trades_initiated', label: 'Swaps initiated', format: 'count', direction: null }),
    // Owned by Swaps; mirrored as one linked card on Cancellations. A withdrawn
    // swap is not a shift cancellation — nobody loses a rostered shift — so it
    // is named apart from the two cancellation kinds.
    trade_cancellation_rate: spec({
        id: 'trade_cancellation_rate', label: 'Withdrawn swaps', format: 'percent',
        direction: 'lower', good: 15, warn: 30,
        description: 'Swaps the requester withdrew before they completed.',
    }),
    offer_accept_rate: spec({
        id: 'offer_accept_rate', label: 'Offer accept rate', format: 'percent',
        direction: 'higher', good: 70, warn: 45,
    }),
    offer_reject_rate: spec({
        id: 'offer_reject_rate', label: 'Offer reject rate', format: 'percent',
        direction: 'lower', good: 20, warn: 40,
    }),
    offer_ignore_rate: spec({
        id: 'offer_ignore_rate', label: 'Offer ignore rate', format: 'percent',
        direction: 'lower', good: 15, warn: 30,
        description: 'Offers that lapsed without a response.',
    }),
    offers_resolved: spec({ id: 'offers_resolved', label: 'Offers resolved', format: 'count', direction: null }),
    avg_time_to_fill_hours: spec({
        id: 'avg_time_to_fill_hours', label: 'Average time to fill', format: 'hours',
        direction: 'lower', good: 24, warn: 72,
        description: 'Mean hours from a shift opening to being filled.',
    }),
    swap_rate: spec({
        id: 'swap_rate', label: 'Swap rate', format: 'percent',
        direction: 'lower', good: 10, warn: 20,
        description: 'Held shifts an employee traded away.',
    }),
    acceptance_rate: spec({
        id: 'acceptance_rate', label: 'Acceptance rate', format: 'percent',
        // 70/40 (REPORT), not 80/50 (METRIC) — see the header note.
        direction: 'higher', good: 70, warn: 40,
    }),
    rejection_rate: spec({
        id: 'rejection_rate', label: 'Rejection rate', format: 'percent',
        direction: 'lower', good: 10, warn: 20,
    }),
    ignorance_rate: spec({
        id: 'ignorance_rate', label: 'Ignored offers', format: 'percent',
        direction: 'lower', good: 10, warn: 25,
    }),
    offer_expiration_rate: spec({
        id: 'offer_expiration_rate', label: 'Ignored offers', format: 'percent',
        direction: 'lower', good: 10, warn: 25,
    }),

    // ── Cancellations ───────────────────────────────────────────────────────
    // Exactly two kinds, and the discriminator is notice, not intent:
    // >= 4h standard, < 4h urgent. The RPC still returns the older
    // cancel_rate / late_cancel_rate names for the same two numbers.
    standard_cancel_rate: spec({
        id: 'standard_cancel_rate', label: 'Standard cancellation rate', format: 'percent',
        direction: 'lower', good: 5, warn: 15,
        description: 'Shifts dropped with 4 hours notice or more.',
    }),
    urgent_cancel_rate: spec({
        id: 'urgent_cancel_rate', label: 'Urgent cancellation rate', format: 'percent',
        direction: 'lower', good: 3, warn: 10,
        description: 'Shifts dropped with less than 4 hours notice — too late to backfill normally.',
    }),
    cancel_rate: spec({
        id: 'cancel_rate', label: 'Cancellation rate', format: 'percent',
        direction: 'lower', good: 10, warn: 25,
    }),
    // Legacy aliases kept so existing report columns resolve to the same bands.
    standard_drop_rate: spec({
        id: 'standard_drop_rate', label: 'Standard cancellation rate', format: 'percent',
        direction: 'lower', good: 5, warn: 15,
    }),
    urgent_drop_rate: spec({
        id: 'urgent_drop_rate', label: 'Urgent cancellation rate', format: 'percent',
        direction: 'lower', good: 3, warn: 10,
    }),
    late_cancel_rate: spec({
        id: 'late_cancel_rate', label: 'Urgent cancellation rate', format: 'percent',
        direction: 'lower', good: 5, warn: 15,
    }),
    drop_rate: spec({
        id: 'drop_rate', label: 'Cancellation rate', format: 'percent',
        direction: 'lower', good: 5, warn: 15,
    }),
    cancellation_rate_standard: spec({
        id: 'cancellation_rate_standard', label: 'Standard cancellation rate', format: 'percent',
        direction: 'lower', good: 5, warn: 15,
    }),
    cancellation_rate_late: spec({
        id: 'cancellation_rate_late', label: 'Urgent cancellation rate', format: 'percent',
        direction: 'lower', good: 3, warn: 10,
    }),

    // ── Overview: coverage, cost, and the composite scores ──────────────────
    fill_rate: spec({
        id: 'fill_rate', label: 'Fill rate', format: 'percent',
        direction: 'higher', good: 90, warn: 75,
        description: 'Published shifts that ended up assigned.',
    }),
    shift_fill_rate: spec({
        id: 'shift_fill_rate', label: 'Fill rate', format: 'percent',
        direction: 'higher', good: 90, warn: 75,
    }),
    open_coverage_rate: spec({
        id: 'open_coverage_rate', label: 'Open coverage', format: 'percent',
        direction: 'higher', good: 85, warn: 65,
    }),
    marketplace_utilization_rate: spec({
        id: 'marketplace_utilization_rate', label: 'Marketplace use', format: 'percent',
        direction: 'higher', good: 60, warn: 35,
    }),
    churn_rate: spec({
        id: 'churn_rate', label: 'Re-assignment churn', format: 'percent',
        direction: 'lower', good: 10, warn: 25,
    }),
    emergency_fill_rate: spec({
        id: 'emergency_fill_rate', label: 'Emergency fill rate', format: 'percent',
        direction: 'lower', good: 10, warn: 25,
    }),
    avg_publish_lead_time_hours: spec({
        id: 'avg_publish_lead_time_hours', label: 'Publish lead time', format: 'hours',
        direction: 'higher', good: 168, warn: 72,
        description: 'Mean hours between publishing a shift and it starting.',
    }),
    reliability_score: spec({
        id: 'reliability_score', label: 'Reliability score', format: 'percent',
        // 90/75 (REPORT), not 85/70 (METRIC) — see the header note.
        direction: 'higher', good: 90, warn: 75,
    }),
    performance_score: spec({
        id: 'performance_score', label: 'Performance score', format: 'percent',
        direction: 'higher', good: 85, warn: 70,
    }),
    engagement_score: spec({
        id: 'engagement_score', label: 'Engagement score', format: 'percent',
        direction: 'higher', good: 60, warn: 30,
    }),
    punctuality_rate: spec({
        id: 'punctuality_rate', label: 'Punctuality', format: 'percent',
        direction: 'higher', good: 95, warn: 85,
    }),
    estimated_cost: spec({ id: 'estimated_cost', label: 'Labour cost', format: 'currency', direction: null }),
    scheduled_hours: spec({ id: 'scheduled_hours', label: 'Scheduled hours', format: 'hours', direction: null }),
    compliance_overrides: spec({
        id: 'compliance_overrides', label: 'Compliance overrides', format: 'count',
        direction: 'lower', good: 0, warn: 3,
        description: 'Shifts a manager approved despite a rule breach.',
    }),
    shifts_emergency: spec({
        id: 'shifts_emergency', label: 'Emergency assignments', format: 'count', direction: null,
    }),
};

/**
 * statusFor — the single threshold comparison in the app.
 *
 * Unknown metrics and metrics with no defined direction return 'neutral'. The
 * five functions this replaces all returned 'good' in that case, which painted
 * every unjudgeable count green.
 */
export function statusFor(metricId: string, value: number): MetricStatus {
    const m = METRIC_REGISTRY[metricId];
    if (!m || m.direction === null || m.good === undefined || m.warn === undefined) {
        return 'neutral';
    }
    if (!Number.isFinite(value)) return 'neutral';

    if (m.direction === 'higher') {
        if (value >= m.good) return 'good';
        if (value >= m.warn) return 'warn';
        return 'critical';
    }
    if (value <= m.good) return 'good';
    if (value <= m.warn) return 'warn';
    return 'critical';
}

/** Human label for a metric id, falling back to the id itself. */
export function labelFor(metricId: string): string {
    return METRIC_REGISTRY[metricId]?.label ?? metricId;
}

/** Format a raw value the way its metric should read. */
export function formatMetric(metricId: string, value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const format = METRIC_REGISTRY[metricId]?.format ?? 'count';
    switch (format) {
        case 'percent':  return `${value.toFixed(1)}%`;
        case 'hours':    return `${value.toFixed(1)}h`;
        case 'ratio':    return value.toFixed(1);
        case 'currency':
            if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
            if (Math.abs(value) >= 1_000)     return `$${(value / 1_000).toFixed(1)}k`;
            return `$${value.toFixed(0)}`;
        case 'count':
        default:         return String(Math.round(value));
    }
}
