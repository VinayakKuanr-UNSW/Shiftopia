/**
 * Scheduling Module — Shared Types
 *
 * Types shared between the OR-Tools client, solution parser,
 * auto-scheduler controller, and the UI layer.
 */

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
}

export interface ExistingShiftRef {
    id: string;
    shift_date: string;     // YYYY-MM-DD
    start_time: string;     // HH:MM
    end_time: string;       // HH:MM
    duration_minutes: number;
}

export interface OptimizerEmployee {
    id: string;
    name: string;
    role_id?: string | null;
    max_weekly_minutes?: number;  // Default 2400 (40h)
    skill_ids?: string[];
    license_ids?: string[];
    preferred_shift_ids?: string[];
    unavailable_dates?: string[];
    /**
     * Already-committed shifts for this employee. Treated as fixed by the
     * optimizer: it will not propose any shift that overlaps or violates
     * the rest gap against these, and counts their minutes against
     * max_weekly_minutes. Without this field, re-running the optimizer
     * after a partial commit collapses to almost no passing proposals
     * because the solver is blind to the live roster.
     */
    existing_shifts?: ExistingShiftRef[];
}

export interface OptimizerConstraints {
    min_rest_minutes?: number;       // Default 600 (10h)
    enforce_role_match?: boolean;    // Default true
    enforce_skill_match?: boolean;   // Default true
    allow_partial?: boolean;         // Default true — allow uncovered shifts
}

export interface OptimizeRequest {
    shifts: OptimizerShift[];
    employees: OptimizerEmployee[];
    constraints?: OptimizerConstraints;
    time_limit_seconds?: number;     // Default 30s
}

// =============================================================================
// OPTIMIZER RESPONSE
// =============================================================================

export type OptimizerStatus = 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'UNKNOWN' | 'MODEL_INVALID';

export interface AssignmentProposal {
    shift_id: string;
    employee_id: string;
    score: number;   // Confidence / preference score (higher = better)
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
    optimizerScore: number;
    complianceStatus: ProposalValidationStatus;
    violations: Array<{
        type: string;
        description: string;
        blocking: boolean;
    }>;
    passing: boolean;
}

export interface UncoveredAudit {
    shiftId: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    rejectionSummary: Record<string, number>; // violationType -> count
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
    uncoveredShiftIds: string[];
    uncoveredAudit?: UncoveredAudit[];
    /** Number of uncovered shifts actually audited (audit may be capped for performance). */
    auditedUncoveredCount?: number;
    capacityCheck?: CapacityCheck;
    proposals: ValidatedProposal[];
    canCommit: boolean;
    usedFallback: boolean;
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
