// ---------------------------------------------------------------------------
// Bidding KPIs — model types, defaults, thresholds, status helper
//
// Mirrors the single-row result of the `get_bidding_kpis` Postgres RPC.
// Rates are 0–100 percentages; counts are integers; averages are unitless.
// ---------------------------------------------------------------------------

export interface BiddingKpis {
    // ── Counts ──────────────────────────────────────────────────────────────
    open_bidding_shifts: number;       // count — shifts routed to open bidding in the window
    total_bids: number;                // count — bids placed across those shifts
    winners_selected: number;          // count — open shifts that got a winning bid selected
    unfilled_open_shifts: number;      // count — open shifts left without a winner

    // ── Derived metrics ─────────────────────────────────────────────────────
    avg_bids_per_open_shift: number;   // avg — total_bids / open_bidding_shifts (unthresholded)
    open_shift_fill_rate: number;      // % (0–100) — winners / open shifts (higher is better)
    bid_success_rate: number;          // % (0–100) — winners / total bids (higher is better)
    unfilled_open_shift_rate: number;  // % (0–100) — unfilled / open shifts (lower is better)
}

// ---------------------------------------------------------------------------
// EMPTY_BIDDING_KPIS — safe default: every field 0. Coalesces a null RPC row.
// ---------------------------------------------------------------------------
export const EMPTY_BIDDING_KPIS: BiddingKpis = {
    open_bidding_shifts: 0,
    total_bids: 0,
    winners_selected: 0,
    unfilled_open_shifts: 0,
    avg_bids_per_open_shift: 0,
    open_shift_fill_rate: 0,
    bid_success_rate: 0,
    unfilled_open_shift_rate: 0,
};


// Keys whose status improves as the number grows.
