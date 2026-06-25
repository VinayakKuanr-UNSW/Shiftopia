// ---------------------------------------------------------------------------
// Marketplace KPIs — model types, defaults, thresholds, status helper
//
// Mirrors the single-row result of the `get_marketplace_kpis` Postgres RPC.
// Rates are 0–100 percentages; counts are integers; TTF is in hours.
// ---------------------------------------------------------------------------

export interface MarketplaceKpis {
    // ── Coverage ────────────────────────────────────────────────────────────
    published_shifts: number;          // count — shifts published in the window
    filled_shifts: number;             // count — published shifts that ended up assigned
    fill_rate: number;                 // % (0–100) — filled / published

    open_shifts: number;               // count — shifts routed to the open marketplace
    covered_open_shifts: number;       // count — open shifts that got covered
    open_coverage_rate: number;        // % (0–100) — covered_open / open

    // ── Stability / Churn ───────────────────────────────────────────────────
    published_snapshots: number;       // count — total published-assignment snapshots
    distinct_filled_shifts: number;    // count — distinct shifts ever filled
    churn_rate: number;                // % (0–100) — re-assignment churn (lower is better)

    avg_time_to_fill_hours: number;    // hours — mean time from open → filled

    // ── Marketplace utilization ─────────────────────────────────────────────
    marketplace_eligible_shifts: number;   // count — shifts eligible for the marketplace
    marketplace_used_shifts: number;       // count — eligible shifts that used it
    marketplace_utilization_rate: number;  // % (0–100) — used / eligible

    // ── Offers ──────────────────────────────────────────────────────────────
    offers_resolved: number;           // count — offers that reached a terminal state
    offer_accept_rate: number;         // % (0–100) — accepted / resolved (higher is better)
    offer_reject_rate: number;         // % (0–100) — rejected / resolved (lower is better)
    offer_ignore_rate: number;         // % (0–100) — ignored / resolved (lower is better)

    // ── Trades ──────────────────────────────────────────────────────────────
    trades_initiated: number;          // count — trades/swaps initiated
    trade_completion_rate: number;     // % (0–100) — completed / initiated (higher is better)
    trade_cancellation_rate: number;   // % (0–100) — cancelled / initiated (lower is better)
    trade_expiry_rate: number;         // % (0–100) — expired / initiated (lower is better)
}

// ---------------------------------------------------------------------------
// EMPTY_KPIS — safe default: every field 0. Used to coalesce a null RPC row.
// ---------------------------------------------------------------------------
export const EMPTY_KPIS: MarketplaceKpis = {
    published_shifts: 0,
    filled_shifts: 0,
    fill_rate: 0,
    open_shifts: 0,
    covered_open_shifts: 0,
    open_coverage_rate: 0,
    published_snapshots: 0,
    distinct_filled_shifts: 0,
    churn_rate: 0,
    avg_time_to_fill_hours: 0,
    marketplace_eligible_shifts: 0,
    marketplace_used_shifts: 0,
    marketplace_utilization_rate: 0,
    offers_resolved: 0,
    offer_accept_rate: 0,
    offer_reject_rate: 0,
    offer_ignore_rate: 0,
    trades_initiated: 0,
    trade_completion_rate: 0,
    trade_cancellation_rate: 0,
    trade_expiry_rate: 0,
};

// ---------------------------------------------------------------------------
// MarketplaceKpiKey — every field of MarketplaceKpis
// ---------------------------------------------------------------------------
export type MarketplaceKpiKey = keyof MarketplaceKpis;

// ---------------------------------------------------------------------------
// KPI_THRESHOLDS — only the *rate* metrics carry good/warn thresholds.
//
// Direction is encoded by HIGHER_IS_BETTER below:
//   • higher-is-better → value >= good ? good : value >= warn ? warn : critical
//   • lower-is-better  → value <= good ? good : value <= warn ? warn : critical
//
// Counts and avg_time_to_fill_hours are intentionally NOT thresholded
// (no universally-correct target), so getKpiStatus returns 'good' for them.
// ---------------------------------------------------------------------------
export const KPI_THRESHOLDS: Partial<Record<MarketplaceKpiKey, { good: number; warn: number }>> = {
    // ── higher-is-better ──────────────────────────────────────────────────
    fill_rate:                    { good: 90, warn: 75 },  // most shifts should fill
    open_coverage_rate:           { good: 85, warn: 65 },  // open shifts should get covered
    marketplace_utilization_rate: { good: 60, warn: 35 },  // healthy adoption of the marketplace
    offer_accept_rate:            { good: 70, warn: 45 },  // offers should mostly be accepted
    trade_completion_rate:        { good: 75, warn: 50 },  // initiated trades should complete

    // ── lower-is-better ───────────────────────────────────────────────────
    churn_rate:                   { good: 10, warn: 25 },  // little re-assignment churn
    offer_reject_rate:            { good: 20, warn: 40 },  // few outright rejections
    offer_ignore_rate:            { good: 15, warn: 30 },  // few ignored offers
    trade_cancellation_rate:      { good: 15, warn: 30 },  // few cancelled trades
    trade_expiry_rate:            { good: 15, warn: 30 },  // few expired trades
} as const;

// Keys whose status improves as the number grows.
const HIGHER_IS_BETTER: ReadonlySet<MarketplaceKpiKey> = new Set<MarketplaceKpiKey>([
    'fill_rate',
    'open_coverage_rate',
    'marketplace_utilization_rate',
    'offer_accept_rate',
    'trade_completion_rate',
]);

// ---------------------------------------------------------------------------
// getKpiStatus — pure, deterministic good/warn/critical classification.
// Keys without thresholds (counts, TTF) return 'good'.
// ---------------------------------------------------------------------------
export const getKpiStatus = (
    key: MarketplaceKpiKey,
    value: number,
): 'good' | 'warn' | 'critical' => {
    const thresholds = KPI_THRESHOLDS[key];
    if (!thresholds) return 'good';

    if (HIGHER_IS_BETTER.has(key)) {
        if (value >= thresholds.good) return 'good';
        if (value >= thresholds.warn) return 'warn';
        return 'critical';
    }

    // lower-is-better
    if (value <= thresholds.good) return 'good';
    if (value <= thresholds.warn) return 'warn';
    return 'critical';
};
