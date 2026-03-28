/**
 * Conflict Resolver — Core Types
 *
 * A unified, strategy-aware resolver that finds the best VALID SUBSET of
 * competing operations using a mix of structural conflict detection,
 * per-step compliance validation, and optional local-search improvement.
 *
 * Sits ABOVE the Batch Executor, Bidding Engine, and Swap Engine —
 * those engines produce operations; this resolver adjudicates between them
 * when they compete for the same resources.
 *
 * Pipeline:
 *   ConflictResolverInput
 *     → Scorer            (composite: priority + compliance + business)
 *     → ConflictGraph     (structural edges only — O(n²) cheap)
 *     → GreedyResolver    (sort by score → add if no structural/compliance conflict)
 *     → [SolverImprovement] (1-opt local search, time-bounded)
 *     → FinalValidator    (full-schedule compliance for all affected employees)
 *     → ConflictResolverResult
 *
 * Strategy selection:
 *   GREEDY  — fast, deterministic, O(n log n + n·k·rules)
 *   SOLVER  — greedy + 1-opt local search, better quality, O(n²·k·rules) worst case
 *   HYBRID  — chooses GREEDY or SOLVER based on n and conflict density
 */

import type {
    ShiftV2,
    ShiftId,
    EmpId,
    EmployeeContextV2,
    RuleHitV2,
    FinalStatus,
    Stage,
    ComplianceConfigV2,
} from '../types';

// =============================================================================
// OPERATION DEFINITION
// =============================================================================

export type ConflictOperationType = 'ASSIGN' | 'BID_ACCEPT' | 'SWAP_APPROVE';

/**
 * Describes how one operation mutates an employee's schedule.
 * Required for per-step compliance checking.
 */
export interface ScheduleChange {
    employee_id:    EmpId;
    /** Shift IDs to add to this employee's schedule */
    add_shift_ids:  ShiftId[];
    /** Shift IDs to remove from this employee's schedule */
    remove_shift_ids: ShiftId[];
}

export interface ConflictOperation {
    operation_id:      string;
    type:              ConflictOperationType;
    /** 1–100: higher = more important. Input from caller. */
    priority:          number;
    /**
     * Optional pre-computed score (e.g. from bidding engine's composite_score).
     * If provided, used INSTEAD of deriving from priority alone.
     * The scorer still applies the compliance_weight boost on top.
     */
    score?:            number;
    /** Optional per-domain weight (e.g. business priority from external system). */
    business_weight?:  number;
    /** All employee IDs affected (used for structural TIME_OVERLAP detection). */
    employee_ids:      EmpId[];
    /** All shift IDs involved (used for RESOURCE_CONTENTION detection). */
    shift_ids:         ShiftId[];
    /**
     * Explicit schedule mutations per employee.
     * MUST be provided for compliance validation to work.
     * For ASSIGN: [{emp, add:[shift], remove:[]}]
     * For SWAP  : [{emp_a, add:[Y], remove:[X]}, {emp_b, add:[X], remove:[Y]}]
     */
    schedule_changes:  ScheduleChange[];
}

// =============================================================================
// INPUT
// =============================================================================

export interface ConflictResolverBaseState {
    shifts:                   ShiftV2[];
    employees:                EmployeeContextV2[];
    /** Each employee's current schedule before any operation is applied. */
    employee_existing_shifts: { employee_id: EmpId; shifts: ShiftV2[] }[];
    /**
     * Optional: net hours each employee has accumulated in the last 28 days
     * before any operation in this batch.  Drives the system-level fairness
     * penalty in the scorer — operations that over-load employees who are
     * already near their contracted ceiling receive a lower composite_score.
     *
     * If omitted, fairness scoring is skipped even when fairness_weight > 0.
     */
    employee_hours_28d?:      Map<EmpId, number>;
}

export interface ConflictResolverInput {
    operations: ConflictOperation[];
    base_state: ConflictResolverBaseState;
    config?:    Partial<ConflictResolverConfig>;
}

// =============================================================================
// CONFIG
// =============================================================================

export type ResolverStrategy = 'GREEDY' | 'SOLVER' | 'HYBRID';

export interface ConflictResolverConfig {
    strategy:           ResolverStrategy;
    compliance_stage:   Stage;
    /** When true, operations producing WARNING compliance results are accepted. */
    accept_warnings:    boolean;
    /** Maximum ms the solver improvement step may run. Default: 2000ms */
    time_limit_ms:      number;

    // ── HYBRID thresholds ──────────────────────────────────────────────────
    /** Use GREEDY if #operations ≤ this. Default: 100 */
    greedy_threshold_ops:      number;
    /** Use GREEDY if conflict_density ≤ this. Default: 0.30 */
    greedy_threshold_density:  number;

    // ── Scoring weights ───────────────────────────────────────────────────
    /** Weight of priority component (0–1). Default: 0.50 */
    priority_weight:      number;
    /** Weight of compliance component (0–1). Default: 0.35 */
    compliance_weight:    number;
    /** Weight of business_weight component (0–1). Default: 0.15 */
    business_weight:      number;
    /**
     * System-level fairness penalty weight (0–1). Default: 0.
     *
     * When > 0 AND base_state.employee_hours_28d is provided, operations that
     * assign work to employees who are already at or above their 28-day
     * contracted ceiling receive a proportional penalty.
     *
     * The penalty is subtracted from composite_score AFTER the base weights are
     * applied, so it doesn't require rebalancing priority/compliance/business
     * weights.  Recommended range: 0.05–0.15 (subtle nudge, not hard block).
     *
     * Formula:
     *   load_ratio = employee_hours_28d / (contracted_weekly_hours × 4)
     *   penalty    = clamp(load_ratio, 0, 1) × fairness_weight × 100
     *   final      = max(0, composite_score − max_penalty_across_affected_employees)
     */
    fairness_weight:      number;

    compliance_config?:   Partial<ComplianceConfigV2>;
}

export const DEFAULT_RESOLVER_CONFIG: ConflictResolverConfig = {
    strategy:                  'HYBRID',
    compliance_stage:          'DRAFT',
    accept_warnings:           true,
    time_limit_ms:             2000,
    greedy_threshold_ops:      100,
    greedy_threshold_density:  0.30,
    priority_weight:           0.50,
    compliance_weight:         0.35,
    business_weight:           0.15,
    fairness_weight:           0,      // off by default — opt-in
};

// =============================================================================
// INTERNAL: CONFLICT GRAPH NODE
// =============================================================================

export type ConflictEdgeKind = 'RESOURCE_CONTENTION' | 'TIME_OVERLAP';

export interface ConflictEdge {
    op_id_a:  string;
    op_id_b:  string;
    kind:     ConflictEdgeKind;
    reason:   string;
}

export interface ConflictGraph {
    /** op_id → operation */
    nodes:      Map<string, ConflictOperation>;
    /** undirected edges */
    edges:      ConflictEdge[];
    /** op_id → set of op_ids that conflict with it */
    adjacency:  Map<string, Set<string>>;
    /** |edges| / max_possible_edges — used by HYBRID strategy selector */
    density:    number;
}

// =============================================================================
// INTERNAL: SCORED OPERATION
// =============================================================================

export interface ScoredOperation {
    op:                   ConflictOperation;
    composite_score:      number;
    pre_compliance_status: FinalStatus;    // standalone compliance status
}

// =============================================================================
// OUTPUT
// =============================================================================

export interface RejectedConflictOperation {
    operation_id:              string;
    reason:                    string;
    rule_hits:                 RuleHitV2[];
    /** Operations this one conflicted with */
    conflicting_operation_ids: string[];
}

export interface ConflictResolverStateSummary {
    total_operations:   number;
    selected_count:     number;
    rejected_count:     number;
    affected_employees: EmpId[];
    affected_shifts:    ShiftId[];
    strategy_used:      ResolverStrategy;
    conflict_density:   number;
    evaluation_time_ms: number;
    solver_improvement: number;    // score gained by local search (0 if greedy only)
}

export interface ConflictResolverResult {
    selected_operations: ConflictOperation[];
    rejected_operations: RejectedConflictOperation[];
    summary:             ConflictResolverStateSummary;
}
