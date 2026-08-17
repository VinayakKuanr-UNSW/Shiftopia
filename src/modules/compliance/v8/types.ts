/**
 * V8 Compliance Engine — Unified Type Contract
 * 
 * The single source of truth for all compliance data structures in Shiftopia.
 * Replaces all V1/V2/Solver types.
 */

import type { TargetEmploymentType } from '@/modules/core/model/employment.types';

export type ComplianceCheckInput = any; // Legacy alias
export type ComplianceResult = any;     // Legacy alias

export type V8ShiftId = string;
export type V8EmpId   = string;
export type V8RoleId  = string;

export type V8ContractType = 'FULL_TIME' | 'PART_TIME' | 'CASUAL' | 'STUDENT_VISA' | 'FLEXI_PART_TIME';
export type V8Severity     = 'WARNING' | 'BLOCKING';
export type V8Status       = 'PASS' | 'WARNING' | 'BLOCKING';

/** Unified shift representation for the V8 engine */
export interface V8Shift {
    id:                    V8ShiftId;
    date:                  string;    // YYYY-MM-DD
    shift_date?:           string;    // Alias for compatibility
    start_time:            string;    // HH:mm
    end_time:              string;    // HH:mm
    is_ordinary_hours:     boolean;
    unpaid_break_minutes?: number;
    paid_break_minutes?:   number;
    role_id?:              V8RoleId;
    is_training?:          boolean;
    is_sunday?:            boolean;
    is_public_holiday?:    boolean;
    shift_type?:           'NORMAL' | 'MULTI_HIRE';
    /**
     * Which employment type this shift is for. MANDATORY on the shifts table;
     * `undefined` here only means the caller did not hydrate it, in which case
     * V8_EMPLOYMENT_TARGET stays silent (the DB trigger remains the guarantee).
     */
    target_employment_type?: TargetEmploymentType | null;
    /** Narrows a 'PT' target to Flexible Part-Time staff only. */
    target_requires_flexible?: boolean;
    /**
     * True when this shift is being added/changed by the current operation,
     * false when it is a pre-existing (committed) shift pulled in only for
     * cumulative context (rest-gap, daily/weekly hours, overlap, etc.).
     * `undefined` = caller did not distinguish (legacy paths → treated as
     * evaluable). Pure per-shift structural rules (min-engagement, meal-break)
     * must skip `is_candidate === false` so they never re-validate history.
     */
    is_candidate?:         boolean;
}

/** Unified employee context */
export interface V8Employee {
    id:                      V8EmpId;
    name:                    string;
    contract_type:           V8ContractType;
    contracted_weekly_hours: number;
    skill_ids?:              string[];
    license_ids?:            string[];
    /** Rich qualification records with expiry dates. When present, the
     *  qualification rule uses these instead of skill_ids / license_ids so
     *  that expired credentials are never silently treated as valid. */
    qualifications?:         QualificationV2[];
    /**
     * YYYY-MM-DD dates with APPROVED leave (audit F1). Consumed by
     * V8_LEAVE_CONFLICT — a BLOCKING rule for any candidate shift on one of
     * these dates. Absent/empty ⇒ the rule is silent (tolerant of callers
     * that don't hydrate leave; the solver-side `unavailable_dates`
     * exclusion still applies to auto-scheduling).
     */
    leave_days?:             string[];
    /**
     * RAW `employment_status` from every Active contract this employee holds.
     *
     * Deliberately separate from `contract_type`, which cannot answer the
     * employment-target question for two reasons: it is derived from the GLOBAL
     * `profiles.employment_type` rather than the per-sub-department contract, and
     * a student-visa holder has it overwritten with 'STUDENT_VISA'
     * (employee-context.ts), erasing whether they are FT, PT or Casual.
     *
     * Absent/empty ⇒ V8_EMPLOYMENT_TARGET is silent, matching how `leave_days`
     * tolerates callers that don't hydrate it.
     */
    employment_statuses?:    string[];
    /**
     * True when the employee's role is Security (EBA Schedule 3). Combined
     * with `contract_type === 'FULL_TIME'`, this switches
     * V8_ORD_HOURS_AVG from the general cl 35 structure (38h/week, 4-week
     * cycle) to Schedule 3 §3's own structure (42h/week — 38 ordinary + 4
     * "reasonable additional" — over an 8-week rotating cycle). Audit H-5:
     * Security previously had no discriminator anywhere in this engine and
     * was evaluated against the general cap, which a lawful 42h-average
     * roster can legitimately exceed. Part-time/casual event security
     * (Sch 3 §5) follow the general PT/casual structure unchanged, so this
     * flag alone (without FULL_TIME) has no effect.
     */
    is_security_role?:      boolean;
}

export interface QualificationV2 {
    qualification_id: string;
    issued_at:        string;
    expires_at:       string | null;
}

export interface ContractRecordV2 {
    organization_id:   string;
    department_id:     string;
    sub_department_id: string | null;
    role_id:           string;
}

export type ContractType = V8ContractType;

/** Global EBA/Policy configuration for the V8 engine */
export interface V8Config {
    /** Ordinary Hours Averaging */
    ord_avg_cycle_weeks:    number;   // default 4
    ord_avg_weekly_limit:   number;   // default 38
    /** Schedule 3 §3 — Full-Time Security's own averaging structure. */
    security_ord_avg_cycle_weeks:  number; // default 8
    security_ord_avg_weekly_limit: number; // default 42 (38 ordinary + 4 reasonable additional)

    /** Daily Limits */
    max_daily_hours:        number;   // default 12
    
    /** Rest & Recovery */
    min_rest_gap_minutes:   number;   // default 600 (10h)
    max_consecutive_days:   number;   // default 6
    
    /** Legal / Visa */
    student_visa_fortnightly_limit: number; // default 48

    /** cl 35.1(e) — paired days off. WARNING-only, opt-in. */
    enforce_ft_days_off: boolean;           // default false
}

export const DEFAULT_V8_CONFIG: V8Config = {
    ord_avg_cycle_weeks:    4,
    ord_avg_weekly_limit:   38,
    security_ord_avg_cycle_weeks:  8,
    security_ord_avg_weekly_limit: 42,
    max_daily_hours:        12,
    min_rest_gap_minutes:   600,
    max_consecutive_days:   6,
    student_visa_fortnightly_limit: 48,
    enforce_ft_days_off:      false,
};

/** A violation detected by a V8 rule */
export interface V8Hit {
    rule_id:         string;
    rule_name:       string;
    status:          V8Status;
    summary:         string;
    details:         string;
    affected_shifts: V8ShiftId[];
    blocking:        boolean;
    calculation?:    Record<string, any>;
}

/** Final output from the V8 engine */
export interface V8Result {
    passed:             boolean;
    overall_status:     V8Status;
    hits:               V8Hit[];
    solve_time_ms:      number;
    evaluated_shifts:   number;
}

/** Context provided to every V8 rule evaluator */
export interface V8RuleContext {
    employee:          V8Employee;
    shifts:            V8Shift[];         // Combined existing + proposed
    candidate_shift?:  V8Shift;           // The shift being added/assigned (if any)
    config:            V8Config;
    reference_date:    string;            // YYYY-MM-DD
}

export type V8RuleEvaluator = (ctx: V8RuleContext) => V8Hit[];
