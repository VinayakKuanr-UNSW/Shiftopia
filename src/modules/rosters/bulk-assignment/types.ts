/**
 * Bulk Assignment Engine — Core Types
 *
 * Types for the incremental feasibility assignment engine.
 * These complement (and do not replace) the compliance bulk-types.ts,
 * which handle the read-only compliance check surface.
 *
 * The bulk assignment engine is responsible for:
 *   1. Loading a SimulatedRoster for a given employee
 *   2. Incrementally validating candidate shifts against it
 *   3. Atomically committing passing shifts via Supabase RPC
 */

// =============================================================================
// CANDIDATE SHIFT
// =============================================================================

/**
 * Minimal shift shape used across all engine components.
 * Fetched from the DB; lightweight to keep the engine fast.
 */
export interface CandidateShift {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    assigned_employee_id: string | null;
    lifecycle_status?: string | null;
    role_id?: string | null;
    unpaid_break_minutes?: number;
    /** Qualification IDs required to work this shift (skill IDs). */
    required_skills?: string[] | null;
    /** Qualification IDs required to work this shift (license IDs). */
    required_licenses?: string[] | null;
}

// =============================================================================
// SIMULATED ROSTER
// =============================================================================

/**
 * The in-memory roster the engine builds up as it processes each shift.
 *
 * - existingShifts:       DB shifts already assigned to the employee (±28 days).
 * - proposedAssignments:  Shifts that have already passed validation in this
 *                         bulk run. Each newly validated shift is appended here
 *                         so subsequent checks see the "committed" state.
 *
 * This is the "incremental" aspect of Incremental Feasibility Assignment.
 */
export interface SimulatedRoster {
    existingShifts: CandidateShift[];
    proposedAssignments: CandidateShift[];
}

// =============================================================================
// VIOLATION TYPES
// =============================================================================

/**
 * All 9 ordered validation rule codes, evaluated in this order:
 *   1. DRAFT_STATE          — shift must be in Draft (not Published/Cancelled)
 *   2. ALREADY_ASSIGNED     — shift must be unassigned
 *   3. OVERLAP              — no time overlap with existing/proposed shifts
 *   4. ROLE_MISMATCH        — employee role must match shift role
 *   5. QUALIFICATION_MISSING — employee has required skills/licenses
 *   6. QUALIFICATION_EXPIRED — no expired qualifications for this shift
 *   7. REST_GAP             — minimum rest between consecutive shifts (10h)
 *   8. WEEKLY_HOURS         — max ordinary hours per 4-week rolling cycle
 *   9. CONSECUTIVE_DAYS     — max consecutive working days
 *  10. STUDENT_VISA         — student visa 48h/fortnight limit (warning only)
 */
export type ViolationType =
    | 'DRAFT_STATE'
    | 'ALREADY_ASSIGNED'
    | 'OVERLAP'
    | 'ROLE_MISMATCH'
    | 'QUALIFICATION_MISSING'
    | 'QUALIFICATION_EXPIRED'
    | 'REST_GAP'
    | 'WEEKLY_HOURS'
    | 'SHIFT_LENGTH'
    | 'CONSECUTIVE_DAYS'
    | 'STUDENT_VISA';

/**
 * A single violation on a candidate shift.
 */
export interface ShiftViolation {
    violation_type: ViolationType;
    /** The existing shift that caused the conflict (for OVERLAP, REST_GAP). */
    conflicting_shift?: {
        id: string;
        shift_date: string;
        start_time: string;
        end_time: string;
    };
    description: string;
    /** True when this violation blocks assignment (all except STUDENT_VISA). */
    blocking: boolean;
}

// =============================================================================
// PER-SHIFT RESULT
// =============================================================================

export type ShiftAssignmentStatus = 'PASS' | 'WARN' | 'FAIL';

/**
 * Compliance evaluation result for a single (shift, employee) pair.
 */
export interface ShiftAssignmentResult {
    shiftId: string;
    employeeId: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    status: ShiftAssignmentStatus;
    violations: ShiftViolation[];
    /** Convenience flag — true iff no blocking violations. */
    passing: boolean;
}

// =============================================================================
// BULK ASSIGNMENT RESULT
// =============================================================================

/**
 * Output from BulkAssignmentController.simulate() or .run().
 */
export interface BulkAssignmentResult {
    /** 'PARTIAL_APPLY' → commit passing shifts; 'ALL_OR_NOTHING' → all or none. */
    mode: 'PARTIAL_APPLY' | 'ALL_OR_NOTHING';
    total: number;
    passing: number;
    failing: number;
    /** Per-shift results in the original input order. */
    results: ShiftAssignmentResult[];
    /** Shift IDs that passed all validation. */
    passedShiftIds: string[];
    /** Shift IDs that have blocking violations. */
    failedShiftIds: string[];
    /** True when it is safe to call commit(). */
    canCommit: boolean;
    /** Milliseconds taken to validate (excludes commit time). */
    validationMs: number;
}

// =============================================================================
// EMPLOYEE INFO (loaded by ScenarioLoader)
// =============================================================================

export interface EmployeeInfo {
    id: string;
    name: string;
    role_id?: string | null;
    /** ISO-8601 string or null when still active. */
    employment_end_date?: string | null;
    /** JSON of granted qualifications { qualification_id, expires_at? }[] */
    qualifications?: Array<{ qualification_id: string; expires_at?: string | null }>;
}

// =============================================================================
// CONTROLLER INPUT / OPTIONS
// =============================================================================

export interface BulkAssignmentOptions {
    mode: 'PARTIAL_APPLY' | 'ALL_OR_NOTHING';
    /** When true, skips role and qualification checks (faster). */
    skipQualificationChecks?: boolean;
}

// =============================================================================
// AUDIT LOG
// =============================================================================

export interface BulkAssignmentAuditLog {
    runId: string;
    employeeId: string;
    requestedBy: string;
    timestamp: string;
    mode: string;
    total: number;
    committed: number;
    violations: number;
    validationMs: number;
}
