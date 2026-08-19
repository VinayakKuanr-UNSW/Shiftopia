/**
 * Assignment Validation — Core Types
 *
 * Types for the incremental feasibility assignment engine, which is
 * responsible for:
 *   1. Loading a SimulatedRoster for a given employee
 *   2. Incrementally validating candidate shifts against it
 *   3. Atomically committing passing shifts via Supabase RPC
 */

import type { ContractRecordV2 } from '@/modules/compliance/v8/types';
import type { TargetEmploymentType } from '@/modules/core/model/employment.types';
export type { ContractRecordV2 };

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
    organization_id?: string | null;
    department_id?: string | null;
    sub_department_id?: string | null;
    unpaid_break_minutes?: number;
    /** Qualification IDs required to work this shift (skill IDs). */
    required_skills?: string[] | null;
    /** Qualification IDs required to work this shift (license IDs). */
    required_licenses?: string[] | null;
    /** Canonical time columns for past-shift validation. */
    start_at?: string | null;
    end_at?: string | null;
    /**
     * The employment type this shift is for (`shifts.target_employment_type`,
     * NOT NULL in the DB). Feeds V8_EMPLOYMENT_TARGET, the app-layer half of
     * the match that `trg_shift_employment_target_2_enforce` enforces on write.
     * Optional here only because callers may not have hydrated it — in which
     * case the rule stays silent and the trigger remains the guarantee.
     */
    target_employment_type?: TargetEmploymentType | null;
    /** Narrows a 'PT' target to Flexible Part-Time staff only. */
    target_requires_flexible?: boolean;
}

// =============================================================================
// SIMULATED ROSTER
// =============================================================================

/**
 * The in-memory roster the engine builds up as it processes each shift.
 *
 * - existingShifts:       DB shifts already assigned to the employee (±28 days).
 * - proposedAssignments:  Shifts that have already passed validation in this
 *                         validation run. Each newly validated shift is appended here
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
 * Codes minted by `IncrementalValidator` — entity-level problems that are not
 * EBA rules, and so have no rule id to carry. Evaluated in this order:
 *
 *   1. PAST_SHIFT            — shift has already started
 *   2. DRAFT_STATE           — shift must be in Draft (not Published/Cancelled)
 *   3. ALREADY_ASSIGNED      — shift must be unassigned
 *   4. OVERLAP               — no time overlap with existing/proposed shifts
 *   5. ROLE_MISMATCH         — employee not contracted for this role/position
 *   6. QUALIFICATION_MISSING — employee lacks required skills/licenses
 *   7. QUALIFICATION_EXPIRED — employee holds expired qualifications
 *
 * SHIFT_NOT_FOUND is not part of that sequence — it is raised by the controller
 * when a requested shift id has no row. It was previously reported as
 * DRAFT_STATE, which put a lookup failure into the `failByRule` telemetry the
 * AutoScheduler prints as a compliance reason.
 */
export type PreflightViolationCode =
    | 'PAST_SHIFT'
    | 'SHIFT_NOT_FOUND'
    | 'DRAFT_STATE'
    | 'ALREADY_ASSIGNED'
    | 'OVERLAP'
    | 'ROLE_MISMATCH'
    | 'QUALIFICATION_MISSING'
    | 'QUALIFICATION_EXPIRED';

/**
 * What a violation is identified by: a pre-flight code above, or — for anything
 * the compliance engine raised — the V8 rule id VERBATIM (`V8_20_IN_28`,
 * `V8_MAX_DAILY_ENGAGEMENTS`, …).
 *
 * Deliberately open rather than a closed union. There used to be a closed
 * `ViolationType` enum here and a lookup table in ComplianceEvaluator
 * translating V8 rule ids onto it. Two of that table's keys named no rule V8
 * emits — `V8_WORKING_DAYS_CAP` against the real `V8_20_IN_28`, and
 * `V8_STUDENT_VISA` against `V8_STUDENT_VISA_LIMIT` — and a third rule was never
 * listed at all: `V8_MAX_DAILY_ENGAGEMENTS`, the casual two-shifts-a-day cap of
 * cl 35.4(f). Unmapped ids were dropped by a bare `continue`, so all three
 * BLOCKING rules were computed and then discarded, indistinguishable downstream
 * from a rule that passed.
 *
 * A closed enum cannot track a rule set owned by another module: every rule
 * added to V8 had to be re-declared here or silently vanish. Carrying the id
 * verbatim deletes the translation step, and with it the failure mode.
 */
export type ViolationCode = PreflightViolationCode | (string & {});

/**
 * A single violation on a candidate shift.
 */
export interface ShiftViolation {
    /** Pre-flight code, or the V8 rule id verbatim. */
    violation_type: ViolationCode;
    /**
     * Human-readable name for display — V8's own `rule_name` ("20 Days in 28
     * Limit"), or a written-out label for a pre-flight code. Renderers should
     * prefer this over `violation_type`, which is an identifier, not copy.
     */
    rule_name: string;
    /** The existing shift that caused the conflict (for OVERLAP, REST_GAP). */
    conflicting_shift?: {
        id: string;
        shift_date: string;
        start_time: string;
        end_time: string;
    };
    description: string;
    /** True when this violation blocks assignment. */
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
// VALIDATION RUN RESULT
// =============================================================================

/**
 * Output from AssignmentValidator.simulate() or .run().
 */
export interface ValidationRunResult {
    /** 'PARTIAL_APPLY' → commit passing shifts; 'ALL_OR_NOTHING' → all or none. */
    mode: 'PARTIAL_APPLY' | 'ALL_OR_NOTHING';
    total: number;
    passing: number;
    failing: number;
    /** Per-shift results in the original input order. */
    results: ShiftAssignmentResult[];
    /** Shift IDs that passed all validation. */
    passedV8ShiftIds: string[];
    /** Shift IDs that have blocking violations. */
    failedV8ShiftIds: string[];
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
    /** @deprecated Use contracts for role matching (R10). Kept for other callers. */
    role_id?: string | null;
    /** ISO-8601 string or null when still active. */
    employment_end_date?: string | null;
    /** Granted qualifications { qualification_id, expires_at? }[] */
    qualifications?: Array<{ qualification_id: string; expires_at?: string | null }>;
    /** Active user_contracts rows — source of truth for R10 role contract match. */
    contracts?: ContractRecordV2[];
    /**
     * Employment status — drives contract-scoped compliance rules
     * (e.g. V8_ORD_HOURS_AVG, exempt for CASUAL). Undefined/null when
     * unavailable, in which case the engine defaults to CASUAL.
     */
    contract_type?: 'FT' | 'PT' | 'CASUAL' | null;
    contracted_weekly_hours?: number;
    /**
     * YYYY-MM-DD dates with APPROVED leave inside the candidate window
     * (audit F1). Feeds V8_LEAVE_CONFLICT — a BLOCKING rule for any candidate
     * shift on one of these dates. Undefined when the loader could not fetch
     * leave (rule stays silent — fail-open at this layer; the solver-side
     * exclusion still guards auto-scheduling).
     */
    leave_days?: string[];
    /**
     * Raw per-contract `employment_status` values ('Full-Time', 'Casual',
     * 'Flexible Part-Time', …) — the source `trg_shift_employment_target_2_enforce`
     * matches against, and what V8_EMPLOYMENT_TARGET needs. Deliberately NOT
     * derived from `contract_type`, which comes from the global profile and
     * collapses 'Flexible Part-Time' onto 'PT'. Undefined ⇒ the rule stays
     * silent (fail-open) and the DB trigger remains the guarantee.
     */
    employment_statuses?: string[];
    /**
     * Holds a Security role on any Active contract (EBA Schedule 3). Switches
     * V8_ORD_HOURS_AVG onto Sch 3 §3.1(a)'s 42h/8-week cycle for full-timers,
     * and V8_CASUAL_SECURITY_SPREAD / _ENGAGEMENT on for casuals (Sch 3 §5.3(g)).
     * Undefined ⇒ both fall back to the general structure.
     */
    is_security_role?: boolean;
    /**
     * Holds a student visa with a restricted work limit (Migration Act 1958
     * (Cth), condition 8105). Its own axis — never a `contract_type` value —
     * so a student-visa casual is still evaluated as a casual. Undefined ⇒
     * V8_STUDENT_VISA_LIMIT stays silent.
     */
    is_student_visa?: boolean;
}

// =============================================================================
// CONTROLLER INPUT / OPTIONS
// =============================================================================

export interface InjectedSimulationData {
    candidateShifts: CandidateShift[];
    existingShifts: CandidateShift[];
    employee: EmployeeInfo;
}

export interface ValidationRunOptions {
    mode: 'PARTIAL_APPLY' | 'ALL_OR_NOTHING';
    /** When true, skips role and qualification checks (faster). */
    skipQualificationChecks?: boolean;
    /** (Optional) Pre-fetched data to skip network calls. */
    injectedData?: InjectedSimulationData;
}


