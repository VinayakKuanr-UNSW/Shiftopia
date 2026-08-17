/**
 * Scheduling Module — Shared Types
 *
 * Types shared between the OR-Tools client, solution parser,
 * auto-scheduler controller, and the UI layer.
 */

import type { TargetEmploymentType } from '@/modules/core/model/employment.types';

// =============================================================================
// OPTIMIZER REQUEST
// =============================================================================

export interface OptimizerShift {
    id: string;
    shift_date: string;           // YYYY-MM-DD
    start_time: string;           // HH:MM
    end_time: string;             // HH:MM
    duration_minutes: number;
    role_id?: string | null;
    required_skill_ids?: string[];
    required_license_ids?: string[];
    priority?: number;            // 1 (default) → higher = more important
    demand_source?: 'baseline' | 'ml_predicted' | 'derived' | null;
    target_employment_type?: TargetEmploymentType | null;
    /** Narrows a 'PT' target to Flexible Part-Time staff only. Pairs with
     *  `OptimizerEmployee.is_flexible` — the solver compares the (type,
     *  is_flexible) TUPLE, because `normalize_employment_type()` collapses
     *  'Flexible Part-Time' onto 'PT' and a token alone cannot express this. */
    target_requires_flexible?: boolean;
    level?: number;
    /** Day-type flags driving the EBA cl 41 loadings (`_penalty_day`) AND the
     *  SC-10/SC-11 fairness terms (`undesirable_shift_ids`). The controller
     *  populates `is_sunday`/`is_public_holiday` from `core/lib/holidays.ts`;
     *  `is_saturday` and `is_sunday` are ALSO derived server-side in
     *  `ShiftInput.__post_init__` so the solver is self-sufficient (audit F-01).
     *  `is_public_holiday` cannot be derived there — the optimizer service has
     *  no holiday calendar — so it must cross the wire. */
    is_sunday?: boolean;
    is_saturday?: boolean;
    is_public_holiday?: boolean;
    /** Lower min-engagement floor (training shifts can be 2h vs 3h). */
    is_training?: boolean;
    /** Required by `_calculate_effective_minutes` for fatigue scoring. */
    unpaid_break_minutes?: number;
    /** 'NORMAL' or 'MULTI_HIRE' — shorter rest gap (480m) for multi-hire. */
    shift_type?: 'NORMAL' | 'MULTI_HIRE';
}

export interface ExistingShiftRef {
    id: string;
    shift_date: string;     // YYYY-MM-DD
    start_time: string;     // HH:MM
    end_time: string;       // HH:MM
    duration_minutes: number;
    unpaid_break_minutes: number;
}

/**
 * A single declared availability window. Sent to the optimizer as the
 * authoritative "yes I am available here" signal. If an employee has
 * `has_availability_data: true` and a shift falls outside every slot, the
 * optimizer treats them as unavailable for that shift.
 */
export interface AvailabilitySlotRef {
    slot_date: string;     // YYYY-MM-DD
    start_time: string;    // HH:MM
    end_time: string;      // HH:MM
}

/**
 * A window that blocks or discourages assignment — the counterpart to
 * `AvailabilitySlotRef`, which says where someone CAN work.
 *
 * `date` scopes the window to one day; omitting it means every day in the
 * horizon. The field used to be a bare `[start, end, severity]` tuple with no
 * date at all, and every solver site resolved those times against the shift's
 * own date — so the channel could not express a dated one-off exception, or
 * leave that had been requested but not yet approved, which are the two things
 * it is most obviously for.
 *
 * Severity maps to the solver's tiers:
 *   HARD       pre-filter block, same tier as approved leave
 *   SOFT       5000c penalty — routed around unless coverage is worth more
 *   PREFERENCE 1000c — a nudge
 */
export interface AvailabilityOverrideRef {
    start_time: string;    // HH:MM
    end_time: string;      // HH:MM
    severity: 'HARD' | 'SOFT' | 'PREFERENCE';
    /** YYYY-MM-DD. Omitted = applies on every day. */
    date?: string;
}

export interface OptimizerEmployee {
    id: string;
    name: string;
    role_id?: string | null;
    contracted_role_ids?: string[];
    contract_type?: 'FT' | 'PT' | 'CASUAL' | null;
    employment_type?: string;
    hourly_rate?: number;
    min_contract_minutes?: number;   // FT/PT contract minimum (0 for Casuals)
    contract_weekly_minutes?: number; // Raw weekly contract base
    max_weekly_minutes?: number;  // Default 2400 (40h)
    skill_ids?: string[];
    license_ids?: string[];
    preferred_shift_ids?: string[];
    unavailable_dates?: string[];
    level?: number;
    is_flexible?: boolean;
    is_student?: boolean;
    visa_limit?: number;
    /**
     * True when this employee's substantive classification is Security
     * (Schedule 3), not a general Schedule 1/2 classification. Drives the
     * AutoScheduler's rate resolution: full-time Security Level 3-6 is paid
     * the Schedule 2 §2 ANNUALISED hourly rate, not the generic Schedule 2 §1
     * wage table (compliance audit finding — 2026-08-02). When not supplied
     * via `employeeDetails`, the controller derives a best-effort value from
     * whether this employee holds a role that appears on a Security-named
     * shift in the current optimization batch — see
     * `auto-scheduler.controller.ts`.
     */
    is_security_role?: boolean;
    /**
     * Schedule 4/5/6 wage classification, resolved from the employee's own
     * Active `user_contracts` row (compliance audit finding — 2026-08-02:
     * previously unreachable from the AutoScheduler, which only ever priced
     * the generic Schedule 1/2 classification). None of these affect the
     * CP-SAT solver's own cost objective (it has no apprentice/trainee/SWS
     * wage model, only a flat `hourly_rate`) — they are consulted ONLY by
     * the greedy-fallback's cost re-estimate (`estimateDetailedShiftCostObj`
     * in `auto-scheduler.controller.ts`), which already implements Schedule
     * 4/5/6 in full via `CostCalculatorOptions`. Fixing the solver's own
     * ranking to price these correctly is a separate, larger item — see the
     * audit's remediation notes.
     */
    is_apprentice?: boolean;
    apprentice_type?: 'standard' | 'adult' | 'school_based';
    apprentice_year?: number;
    has_completed_year_12?: boolean;
    is_trainee?: boolean;
    trainee_category?: 'junior' | 'adult' | 'school_based';
    trainee_level?: 'A' | 'B';
    trainee_exit_year?: number;
    trainee_years_out?: number;
    trainee_aqf_level?: number;
    trainee_year?: number;
    is_training_on_job?: boolean;
    prefers_sba_loading?: boolean;
    is_sws?: boolean;
    sws_capacity_percentage?: number;
    existing_shifts?: ExistingShiftRef[];
    contracts?: any[];
    qualifications?: any[];
    /**
     * Declared availability windows in the optimization range. Empty array
     * means "no data on file" (treated as universally available);
     * non-empty means "available only when a shift fits within one of
     * these windows" (treated as unavailable otherwise).
     */
    availability_slots?: AvailabilitySlotRef[];
    /**
     * True if the employee has *any* availability record on file —
     * including outside the current window. Distinguishes "not yet
     * onboarded" (no records ever → universally available) from "has
     * declared availability but none in this window" (records elsewhere →
     * universally unavailable for this window).
     */
    has_availability_data?: boolean;
    /**
     * What an ABSENT availability slot means for this employee — the two
     * populations are opposites, and applying the wrong one silently removes
     * people from every roster:
     *
     *   'OPT_IN'  — casuals. Availability is an OFFER, so no slot means "not
     *               offered", i.e. UNAVAILABLE. The optimizer's default, and
     *               what every employee got before this field existed.
     *
     *   'OPT_OUT' — FT/PT. Availability is an EXCEPTION LEDGER. These staff
     *               carry a contract floor the solver is charged 100,000/minute
     *               for missing (HC-7), so "no data" must not mean "cannot
     *               work"; unavailability is stated positively instead, via
     *               `unavailable_dates` (approved leave) or a HARD entry in
     *               `availability_overrides`. Evaluated per DATE by the solver:
     *               a declaration on a date still constrains that date.
     *
     * Omitted is read as 'OPT_IN' at both ends.
     */
    availability_mode?: 'OPT_IN' | 'OPT_OUT';
    /**
     * Contract ordinary-hours envelope (solver HC-5e) — when this contract may be
     * rostered at all, as opposed to what the employee declared. Both ends must
     * be present for it to bind; omitted or null means UNRESTRICTED, which is
     * every contract in production until one is explicitly opted in.
     *
     * Separate from `availability_slots` because an FT holds none: their
     * availability is implicit, so this is the only thing that bounds them, and
     * without it "available by contract" means available 24/7 on all seven days.
     */
    ordinary_span_start?: string | null;
    ordinary_span_end?: string | null;
    /** ISO weekdays (1=Mon .. 7=Sun) the span applies on. Empty = all seven. */
    ordinary_days?: number[];
    /**
     * Severity-based availability windows: tuples of
     * `[start_time, end_time, severity]` where severity is 'HARD',
     * 'SOFT', or 'PREFERENCE'. HARD entries are pre-filter blockers;
     * SOFT/PREFERENCE add penalties to the objective. The TS controller
     * doesn't currently populate these (they come from a future bulk
     * leave-management feature) but the field exists on the wire to
     * forward-compat the Python service.
     */
    availability_overrides?: AvailabilityOverrideRef[];
    /** F1: Ledger debts. Positive = penalty for assigning more, Negative = bonus. */
    fairness_debts?: Record<string, number>;
    /** Prior circadian load in EFFECTIVE MINUTES spilling into the horizon's
     *  first ISO week — SC-7's own unit. Supersedes the `initial_fatigue_score
     *  × 60` conversion, which overstated prior load ~2.2× (audit F-07). */
    initial_effective_minutes?: number;
}

export interface OptimizerStrategy {
    fatigue_weight?: number;      // 0-100, default 50
    fairness_weight?: number;     // 0-100, default 50
    cost_weight?: number;         // 0-100, default 50
    coverage_weight?: number;     // 0-100, default 100 (critical)
}

export interface OptimizerConstraints {
    min_rest_minutes?: number;       // Default 600 (10h)
    enforce_role_match?: boolean;    // Default true
    enforce_skill_match?: boolean;   // Default true
    allow_partial?: boolean;         // Default true — allow uncovered shifts
    relax_constraints?: boolean;     // If true, softens overlap/rest-gap to soft constraints
    /**
     * When true, declared availability is a HARD constraint AND "unset = unavailable":
     * the solver may only place a shift fully inside a declared availability slot, and
     * an employee with no slots is unavailable for every shift. The auto-scheduler
     * always sends true; manual workflows do NOT use this (availability is warn-only there).
     */
    enforce_availability?: boolean;
}

export interface OptimizeRequest {
    shifts: OptimizerShift[];
    employees: OptimizerEmployee[];
    constraints: OptimizerConstraints;
    strategy?: OptimizerStrategy;
    solver_params?: {
        max_time_seconds?: number;
        num_workers?: number;
        enable_greedy_hint?: boolean;
        /** B4 — also compute Pareto "what-if" alternatives for the explorer. */
        compute_alternatives?: boolean;
        /**
         * Month-long rosters: solve each ISO week in sequence so the
         * fairness/cost tiers aren't time-starved on one large monolithic solve.
         * Auto-skipped (monolithic) by the solver when the horizon is <2 ISO weeks.
         */
        decompose_by_week?: boolean;
    };
    /**
     * Forbidden (employee, shift) pairs — dropped from the solver's eligibility
     * map so it will not propose them. Drives the compliance-repair re-solve: a
     * pair the compliance engine rejected is excluded so the shift is re-homed to
     * a different compliant employee (or left uncovered). Empty on the first solve.
     */
    excluded_pairs?: { employee_id: string; shift_id: string }[];
}

// =============================================================================
// SERVER-SIDE AUDIT (replaces per-pair simulate() fan-out)
// =============================================================================

export interface AuditRequest {
    shifts: OptimizerShift[];
    employees: OptimizerEmployee[];
    constraints: OptimizerConstraints;
    /** Subset of shift IDs to audit. Omit to audit every shift in `shifts`. */
    target_shift_ids?: string[];
}

export interface AuditEmployeeRow {
    employee_id: string;
    status: 'PASS' | 'FAIL';
    /** Reason codes (e.g. 'ROLE_MISMATCH', 'OUTSIDE_DECLARED_AVAILABILITY'). */
    rejection_reasons: string[];
}

export interface AuditShiftRow {
    shift_id: string;
    /** Map of reason code → number of employees rejected for that reason. */
    rejection_summary: Record<string, number>;
    employees: AuditEmployeeRow[];
}

export interface AuditResponse {
    audited_shift_count: number;
    rows: AuditShiftRow[];
    elapsed_ms: number;
}

// =============================================================================
// OPTIMIZER RESPONSE
// =============================================================================

export type OptimizerStatus = 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'UNKNOWN' | 'MODEL_INVALID';

/** B5 — per-assignment "why this person" factors from the solver. */
export interface AssignmentRationale {
    /** 1 = cheapest of the eligible pool for this shift; null if unknown. */
    cost_rank: number | null;
    eligible_count: number;
    cheapest_eligible: boolean;
    /** Sum of the employee's positive fairness-ledger debts (excl. preferences). */
    fairness_debt: number;
    /** emp.level − shift.level (positive = over-qualified). */
    qual_gap: number;
}

export interface AssignmentProposal {
    shift_id: string;
    employee_id: string;
    employment_type: string;
    cost: number;
    rationale?: AssignmentRationale | null;
}

/** B3/B5 — four-pillar scorecard derived from the solution (single-mode UX). */
export interface PillarScores {
    coverage: { score: number; covered: number; total: number };
    cost: { total: number; currency: string; avg_per_shift: number };
    fairness: { score: number; employees_used: number; spread_minutes: number; peak_minutes: number };
    fatigue: {
        score: number;
        amber: number;
        critical: number;
        /**
         * HC-4 max-hours breach across the window, in minutes.
         *
         * The solver's hours cap is a SOFT tier-3 term that yields to coverage
         * by design, so a roster can score 100% compliant while individuals are
         * rostered far past their own ceiling — the breach previously showed up
         * only as an aggregate penalty in the objective breakdown.
         *
         * OPTIONAL on purpose: an older optimizer image does not send these, and
         * a stale container silently serving previous-generation fields is a
         * trap this codebase has already hit twice. Absent ⇒ render nothing
         * rather than "0h over", which would read as an all-clear.
         */
        over_cap_staff?: number;
        over_cap_worst_minutes?: number;
        over_cap_total_minutes?: number;
    };
}

/** B5 — why a shift was left uncovered (drives the U5 banner). */
export interface BindingConstraint {
    shift_id: string;
    eligible_count: number;
    reason: string;
}

/** B4 — a Pareto "what-if" alternative for the trade-off explorer. */
export interface ParetoAlternative {
    key: string;          // 'cheapest' | 'fairest' | ...
    label: string;        // human label
    pillars: PillarScores;
}

export interface OptimizeResponse {
    status: OptimizerStatus;
    assignments: AssignmentProposal[];
    unassigned_shift_ids: string[];
    objective_value: number;
    solve_time_ms: number;
    num_variables: number;
    num_constraints: number;
    total_time_ms: number;
    /** Per-category breakdown of the solver objective value (cents).
     *  Null when the solver returned INFEASIBLE / UNKNOWN / MODEL_INVALID.
     *  Categories: cost, fairness, fatigue, coverage, continuity,
     *  employment_mix, relaxed_violations, availability, other. */
    objective_breakdown?: Record<string, number> | null;
    /** B3 — per-tier objective optima (coverage / guardrail / cost). */
    tier_values?: Record<string, number> | null;
    /** B5 — four-pillar scorecard. */
    pillars?: PillarScores | null;
    /** B5 — reasons for uncovered shifts. */
    binding_constraints?: BindingConstraint[] | null;
    /** B4 — Pareto "what-if" alternatives. */
    alternatives?: ParetoAlternative[] | null;
}

// =============================================================================
// AUTO-SCHEDULER RESULT (after compliance validation)
// =============================================================================

export type ProposalValidationStatus = 'PASS' | 'WARN' | 'FAIL';

export interface ValidatedProposal {
    shiftId: string;
    employeeId: string;
    employeeName: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    optimizerCost: number;
    employmentType: string;
    complianceStatus: ProposalValidationStatus;
    violations: Array<{
        type: string;
        description: string;
        blocking: boolean;
    }>;
    fatigueScore?: number;
    utilization?: number;
    roleName?: string;
    roleId?: string | null;
    passing: boolean;
}

export interface UncoveredAudit {
    shiftId: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    rejectionSummary: Record<string, number>; // violationType -> count
    roleName?: string;
    roleId?: string | null;
    employeeDetails: Array<{
        employeeId: string;
        employeeName: string;
        status: ProposalValidationStatus;
        violations: Array<{ type: string; description: string }>;
    }>;
}

/**
 * Per-day demand vs. supply snapshot computed BEFORE the optimizer runs.
 * `deficitMinutes > 0` means there is mathematically not enough labour
 * to cover the day, regardless of how the solver assigns people.
 */
export interface CapacityDayBreakdown {
    date: string;                 // YYYY-MM-DD
    shiftCount: number;
    demandMinutes: number;        // Sum of shift durations
    supplyMinutes: number;        // Sum of employee daily caps
    employeeCount: number;
    deficitMinutes: number;       // max(0, demand - supply)
    sufficient: boolean;
}

export interface CapacityCheck {
    sufficient: boolean;          // Overall: every day satisfies demand ≤ supply
    totalDemandMinutes: number;
    totalSupplyMinutes: number;
    deficitDays: CapacityDayBreakdown[]; // Days where demand > supply
    perDay: CapacityDayBreakdown[];      // All days
}

export interface AutoSchedulerResult {
    optimizerStatus: OptimizerStatus;
    solveTimeMs: number;
    validationTimeMs: number;
    totalProposals: number;
    passing: number;
    failing: number;
    uncoveredV8ShiftIds: string[];
    uncoveredAudit?: UncoveredAudit[];
    /** Number of uncovered shifts actually audited (audit may be capped for performance). */
    auditedUncoveredCount?: number;
    capacityCheck?: CapacityCheck;
    proposals: ValidatedProposal[];
    canCommit: boolean;
    usedFallback: boolean;
    /** Per-category solver objective breakdown forwarded from the Python service.
     *  Null/undefined when the optimizer was unreachable or returned no solution
     *  (greedy fallback path). Safe to access with optional-chaining. */
    objective_breakdown?: Record<string, number> | null;
    /** Org scope echoed from the run input, so commit() can write the F1
     *  fairness ledger back. Undefined when no org was supplied (ledger off). */
    organizationId?: string;
    /** F1 ledger health for THIS run (audit F-04). A silently-empty ledger used
     *  to be indistinguishable from "nobody owes anything", so longitudinal
     *  fairness could be off for weeks with no signal. Now every run reports
     *  whether debts were applied, and how stale they were. */
    fairnessLedger?: FairnessLedgerRunStatus;
    /** B3/B5 — single-mode transparency, forwarded from the solver for the UI
     *  scorecard, constraint banner, and trade-off explorer. */
    pillars?: PillarScores | null;
    bindingConstraints?: BindingConstraint[] | null;
    alternatives?: ParetoAlternative[] | null;
    /** B5 — per-assignment rationale keyed by shiftId ("why this person"). */
    rationaleByShift?: Record<string, AssignmentRationale>;
}

/**
 * Whether the F1 longitudinal fairness ledger actually influenced a run.
 *
 * `applied` is the headline: when false, the roster was built with NO
 * cross-roster fairness at all and the reason says why. `reason`:
 *   - `no_org_scope` — the run carried no organizationId; the ledger is off by
 *     design (not a fault).
 *   - `no_data`      — org scoped, but the ledger has never been computed (or
 *                      not since before the as-of date).
 *   - `fetch_failed` — the read threw; the run continued without debts.
 *   - `ok` / `stale` — debts WERE applied; `ageDays` says how old they were.
 */
export interface FairnessLedgerRunStatus {
    applied: boolean;
    reason: 'ok' | 'stale' | 'no_data' | 'no_org_scope' | 'fetch_failed';
    /** Employees that carried at least one debt row. */
    employeesWithDebts: number;
    /** `window_end` of the freshest row used, or null. */
    windowEnd: string | null;
    /** Calendar days between `windowEnd` and the run date, or null. */
    ageDays: number | null;
}

// =============================================================================
// CONNECTION STATUS
// =============================================================================

export interface OptimizerHealth {
    available: boolean;
    url: string;
    latencyMs?: number;
    error?: string;
}
