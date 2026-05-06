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
    demand_source?: 'baseline' | 'ml_predicted' | 'derived' | null;
    target_employment_type?: 'FT' | 'PT' | 'Casual' | null;
    level?: number;
}

export interface ExistingShiftRef {
    id: string;
    shift_date: string;     // YYYY-MM-DD
    start_time: string;     // HH:MM
    end_time: string;       // HH:MM
    duration_minutes: number;
    unpaid_break_minutes: number;
}

export interface OptimizerEmployee {
    id: string;
    name: string;
    role_id?: string | null;
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
    existing_shifts?: ExistingShiftRef[];
    contracts?: any[];
    qualifications?: any[];
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
    };
}

// =============================================================================
// OPTIMIZER RESPONSE
// =============================================================================

export type OptimizerStatus = 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'UNKNOWN' | 'MODEL_INVALID';

export interface AssignmentProposal {
    shift_id: string;
    employee_id: string;
    employment_type: string;
    cost: number;
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
