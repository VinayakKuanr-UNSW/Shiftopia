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
    trade_rejection_rate: number;      // % (0–100) — manager rejected / initiated (lower is better)
    trade_cancellation_rate: number;   // % (0–100) — requester withdrew / initiated (lower is better)
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
    trade_rejection_rate: 0,
    trade_cancellation_rate: 0,
    trade_expiry_rate: 0,
};


// Keys whose status improves as the number grows.
