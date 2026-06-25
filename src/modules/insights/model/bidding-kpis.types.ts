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

// ---------------------------------------------------------------------------
// BiddingKpiKey — every field of BiddingKpis
// ---------------------------------------------------------------------------
export type BiddingKpiKey = keyof BiddingKpis;

// ---------------------------------------------------------------------------
// BIDDING_THRESHOLDS — only the *rate* metrics carry good/warn thresholds.
//
// Direction is encoded by HIGHER_IS_BETTER below:
//   • higher-is-better → value >= good ? good : value >= warn ? warn : critical
//   • lower-is-better  → value <= good ? good : value <= warn ? warn : critical
//
// Counts and avg_bids_per_open_shift are intentionally NOT thresholded
// (no universally-correct target), so getBiddingStatus returns 'good' for them.
// ---------------------------------------------------------------------------
export const BIDDING_THRESHOLDS: Partial<Record<BiddingKpiKey, { good: number; warn: number }>> = {
    // ── higher-is-better ──────────────────────────────────────────────────
    open_shift_fill_rate: { good: 80, warn: 60 },  // open shifts should mostly fill
    bid_success_rate:     { good: 40, warn: 20 },  // a healthy share of bids should win

    // ── lower-is-better ───────────────────────────────────────────────────
    unfilled_open_shift_rate: { good: 15, warn: 30 },  // few open shifts left unfilled
} as const;

// Keys whose status improves as the number grows.
const HIGHER_IS_BETTER: ReadonlySet<BiddingKpiKey> = new Set<BiddingKpiKey>([
    'open_shift_fill_rate',
    'bid_success_rate',
]);

// ---------------------------------------------------------------------------
// getBiddingStatus — pure, deterministic good/warn/critical classification.
// Keys without thresholds (counts, avg_bids_per_open_shift) return 'good'.
// ---------------------------------------------------------------------------
export const getBiddingStatus = (
    key: BiddingKpiKey,
    value: number,
): 'good' | 'warn' | 'critical' => {
    const thresholds = BIDDING_THRESHOLDS[key];
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
