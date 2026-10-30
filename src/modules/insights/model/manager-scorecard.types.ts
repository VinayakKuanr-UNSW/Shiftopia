// ---------------------------------------------------------------------------
// Manager Scorecard — model types, defaults, thresholds, status helper
//
// Mirrors the single-row result of the `get_manager_scorecard` Postgres RPC.
// Rates are 0–100 percentages; counts are integers; times are in hours.
//
// Style mirrors marketplace-kpis.types.ts (same panel/hook family).
// ---------------------------------------------------------------------------

export interface ManagerScorecard {
    // ── Coverage ────────────────────────────────────────────────────────────
    managed_published_shifts: number;     // count — shifts the manager published in the window
    filled_shifts: number;                // count — published shifts that ended up assigned
    fill_rate: number;                     // % (0–100) — filled / published (higher is better)

    open_shifts: number;                   // count — shifts routed to the open marketplace
    covered_open_shifts: number;           // count — open shifts that got covered
    open_coverage_rate: number;            // % (0–100) — covered_open / open (higher is better)

    // ── Stability / Churn ───────────────────────────────────────────────────
    published_snapshots: number;           // count — total published-assignment snapshots
    distinct_shifts: number;               // count — distinct shifts across snapshots
    churn_rate: number;                    // % (0–100) — re-assignment churn (lower is better)

    emergency_fill_count: number;          // count — shifts filled under emergency (short-lead) conditions
    emergency_fill_rate: number;           // % (0–100) — emergency fills / fills (lower is better)
    reassignment_count: number;            // count — assignment changes after publish

    avg_publish_lead_time_hours: number;   // hours — mean lead time publish → shift start (higher is better)

    // ── Activity ────────────────────────────────────────────────────────────
    manager_actions: number;               // count — actions attributed to managers
    employee_actions: number;              // count — actions attributed to employees
    system_actions: number;                // count — actions attributed to the system
}

// ---------------------------------------------------------------------------
// EMPTY_SCORECARD — safe default: every field 0. Used to coalesce a null RPC row.
// ---------------------------------------------------------------------------
export const EMPTY_SCORECARD: ManagerScorecard = {
    managed_published_shifts: 0,
    filled_shifts: 0,
    fill_rate: 0,
    open_shifts: 0,
    covered_open_shifts: 0,
    open_coverage_rate: 0,
    published_snapshots: 0,
    distinct_shifts: 0,
    churn_rate: 0,
    emergency_fill_count: 0,
    emergency_fill_rate: 0,
    reassignment_count: 0,
    avg_publish_lead_time_hours: 0,
    manager_actions: 0,
    employee_actions: 0,
    system_actions: 0,
};


// Keys whose status improves as the number grows.
