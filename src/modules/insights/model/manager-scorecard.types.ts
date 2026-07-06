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

// ---------------------------------------------------------------------------
// ManagerScorecardKey — every field of ManagerScorecard
// ---------------------------------------------------------------------------
export type ManagerScorecardKey = keyof ManagerScorecard;

// ---------------------------------------------------------------------------
// SCORECARD_THRESHOLDS — only the metrics with a meaningful target carry
// good/warn thresholds. Direction is encoded by HIGHER_IS_BETTER below:
//   • higher-is-better → value >= good ? good : value >= warn ? warn : critical
//   • lower-is-better  → value <= good ? good : value <= warn ? warn : critical
//
// Plain counts (no universally-correct target) are intentionally NOT
// thresholded, so getScorecardStatus returns 'good' for them.
// ---------------------------------------------------------------------------
export const SCORECARD_THRESHOLDS: Partial<
    Record<ManagerScorecardKey, { good: number; warn: number }>
> = {
    // ── higher-is-better ──────────────────────────────────────────────────
    fill_rate:                   { good: 90,  warn: 75 },  // % — most managed shifts should fill
    open_coverage_rate:          { good: 85,  warn: 65 },  // % — open shifts should get covered
    // More lead time is healthier — gives employees notice and reduces scramble.
    avg_publish_lead_time_hours: { good: 168, warn: 72 },  // hours — good ≥ 1 week, warn ≥ 3 days

    // ── lower-is-better (manager-negative) ────────────────────────────────
    churn_rate:                  { good: 10,  warn: 25 },  // % — little re-assignment churn
    emergency_fill_rate:         { good: 10,  warn: 25 },  // % — few last-minute emergency fills
} as const;

// Keys whose status improves as the number grows.
const HIGHER_IS_BETTER: ReadonlySet<ManagerScorecardKey> = new Set<ManagerScorecardKey>([
    'fill_rate',
    'open_coverage_rate',
    'avg_publish_lead_time_hours',
]);

// ---------------------------------------------------------------------------
// getScorecardStatus — pure, deterministic good/warn/critical classification.
// Keys without thresholds (plain counts) return 'good'.
// ---------------------------------------------------------------------------
export const getScorecardStatus = (
    key: ManagerScorecardKey,
    value: number,
): 'good' | 'warn' | 'critical' => {
    const thresholds = SCORECARD_THRESHOLDS[key];
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
