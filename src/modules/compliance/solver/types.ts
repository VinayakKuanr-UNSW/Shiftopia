/**
 * Constraint Solver — Core Types
 *
 * The solver answers ONE question:
 *   "Does a compliant schedule exist if this action is executed?"
 *
 * Architecture (4 layers):
 *   1. ScenarioBuilder  — builds the hypothetical roster state (scenario)
 *   2. SolverConstraint — one constraint evaluated against the full scenario
 *   3. ConstraintEngine — evaluates ALL constraints simultaneously
 *   4. Evaluators       — public API (AssignmentEvaluator / SwapEvaluator)
 *
 * Key design: constraints are WORKFLOW-AGNOSTIC.
 *   They receive `config.action_type` and decide whether to apply themselves.
 *   No constraint is excluded externally — constraints self-select based on context.
 */

import type { ShiftTimeRange, ComplianceStatus, ActionType } from '../types';

// =============================================================================
// EXTENDED SHIFT TYPE (with optional id for roster filtering)
// =============================================================================

export type RosterShift = ShiftTimeRange & { id?: string };

// =============================================================================
// SCENARIO
// =============================================================================

/**
 * One party in the swap (either the requester or the offerer).
 * Contains the FULL hypothetical schedule AFTER the swap is applied.
 */
export interface SwapParty {
    employee_id: string;
    name: string;
    /** Complete schedule after the swap (given shift removed, received shift added). */
    hypothetical_schedule: ShiftTimeRange[];
    /** The shift this party RECEIVES (new shift entering their schedule). */
    received_shift: ShiftTimeRange;
    /** The shift this party GIVES AWAY (removed from their schedule). */
    given_shift: ShiftTimeRange;
}

/**
 * Hypothetical roster state for BOTH parties after the swap.
 * This is the model handed to the ConstraintEngine.
 */
export interface SwapScenario {
    partyA: SwapParty;  // Typically the requester
    partyB: SwapParty;  // Typically the offerer
}

// =============================================================================
// CONSTRAINT RESULT
// =============================================================================

/**
 * Result of a single constraint evaluated for a single employee.
 * One ConstraintViolation is produced per (constraint × party) pair.
 */
export interface ConstraintViolation {
    constraint_id: string;
    constraint_name: string;
    employee_id: string;
    employee_name: string;
    status: ComplianceStatus;
    summary: string;
    details: string;
    calculation: Record<string, unknown>;
    blocking: boolean;
}

// =============================================================================
// CONSTRAINT INTERFACE
// =============================================================================

export interface SolverConfig {
    /**
     * Workflow context — constraints use this to decide if they apply.
     *   'add'    → all constraints active
     *   'assign' → all constraints active
     *   'bid'    → WORKING_DAYS_CAP skipped (bids are not confirmed assignments)
     *   'swap'   → all constraints active (default when omitted)
     *
     * Constraints self-select based on this value.
     * Prefer this over `exclude_constraints` for workflow-specific exclusions.
     */
    action_type?: ActionType;
    /** Minimum rest hours between consecutive days (default 10, relaxed 8). */
    rest_gap_hours?: number;
    /** Ordinary hours averaging cycle in weeks (default 4). */
    averaging_cycle_weeks?: 1 | 2 | 3 | 4;
    /** When true, student visa 48h/fortnight is a hard blocker. */
    student_visa_enforcement?: boolean;
    /** Public holiday dates in YYYY-MM-DD format. */
    public_holiday_dates?: string[];
    /** When true, applies 2h training minimum instead of weekday 3h. */
    candidate_is_training?: boolean;
    /**
     * Explicit constraint IDs to skip.
     * Use `action_type` for workflow-driven exclusions.
     * Reserve this for one-off overrides only.
     */
    exclude_constraints?: string[];
}

/**
 * A constraint evaluated against the FULL swap scenario (both parties
 * simultaneously). Returns one ConstraintViolation per party.
 */
export interface SolverConstraint {
    id: string;
    name: string;
    blocking: boolean;
    evaluate(scenario: SwapScenario, config: SolverConfig): ConstraintViolation[];
}

// =============================================================================
// SOLVER RESULT
// =============================================================================

export interface SolverResult {
    /** True when no blocking constraint is violated by either party. */
    feasible: boolean;
    /** All failing (status === 'fail') violations. */
    violations: ConstraintViolation[];
    /** All warning-level violations. */
    warnings: ConstraintViolation[];
    /** Every per-party per-constraint result (including passes). */
    all_results: ConstraintViolation[];
    /** The scenario that was evaluated. */
    scenario: SwapScenario;
}

// =============================================================================
// EVALUATOR INPUT
// =============================================================================

export interface SwapPartyInput {
    employee_id: string;
    name: string;
    /** Full current roster for the date window (±30 days). */
    current_shifts: RosterShift[];
    /** The shift this party is giving away. */
    shift_to_give: RosterShift;
}

export interface SwapEvaluationInput {
    partyA: SwapPartyInput;  // Requester
    partyB: SwapPartyInput;  // Offerer
    config?: SolverConfig;
}
