/**
 * V8 Compliance Engine — Unified Type Contract
 * 
 * The single source of truth for all compliance data structures in Shiftopia.
 * Replaces all V1/V2/Solver types.
 */

import type { OrdinaryCycleWeeks } from '../ordinary-hours-cycle';
import type { TargetEmploymentType } from '@/modules/core/model/employment.types';

export type ComplianceCheckInput = any; // Legacy alias
export type ComplianceResult = any;     // Legacy alias

export type V8ShiftId = string;
export type V8EmpId   = string;
export type V8RoleId  = string;

/**
 * The EMPLOYMENT axis, and only that.
 *
 * 'STUDENT_VISA' used to be a fifth member. It is not an employment type — it
 * is a visa condition that an employee holds *in addition to* being FT, PT,
 * flexi or casual — and modelling it here made the two facts mutually
 * exclusive. Setting it erased the real employment type, so every rule that
 * branches on FT/PT/CASUAL silently exempted the holder (cl 35.4(f) daily
 * engagements, cl 39.2 spread, cl 35 ordinary-hours averaging); and the two
 * converters that mapped it back to 'CASUAL' to recover an employment type
 * then erased the visa fact, leaving V8_STUDENT_VISA_LIMIT unreachable.
 * Whichever direction the value was converted, one of the two facts was lost.
 *
 * The visa condition now lives on its own axis as `V8Employee.is_student_visa`
 * — the same separation `target_requires_flexible` uses for FPT.
 */
export type V8ContractType = 'FULL_TIME' | 'PART_TIME' | 'CASUAL' | 'FLEXI_PART_TIME';
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
    /**
     * Which job this shift is for. Needed by V8_EMPLOYMENT_TARGET to pick the
     * contract that governs: a person can hold different employment types in
     * different sub-departments, and (since EBA cl 13 multi-hiring became
     * expressible) in different roles within one. Undefined falls back to the
     * person-wide match, which is what this rule did for every caller before.
     */
    sub_department_id?:    string | null;
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
    /**
     * Declared ordinary-hours work cycle (ICC EBA cl 35.x(a) / 12.2(b)).
     *
     * Optional on the RULE input, unlike on the context: plenty of callers build
     * a V8Employee by hand for a single-shift check that no cycle rule reads,
     * and `ordinaryHoursAvgRule` falls back to the config default. A required
     * field here would force every one of them to invent a value.
     */
    ordinary_hours_cycle_weeks?:  OrdinaryCycleWeeks;
    ordinary_hours_cycle_anchor?: string;
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
     * it collapses 'Flexible Part-Time' onto a single part-time member.
     *
     * Absent/empty ⇒ V8_EMPLOYMENT_TARGET is silent, matching how `leave_days`
     * tolerates callers that don't hydrate it.
     */
    employment_statuses?:    string[];
    /**
     * The Active contracts themselves — scope AND status together.
     *
     * `employment_statuses` above is a de-duplicated flat list, which can say
     * "this person is Full-Time somewhere" but never "they are Casual HERE".
     * V8_EMPLOYMENT_TARGET needs the second question to match the way
     * `fn_enforce_shift_employment_target` does, so it reads these.
     *
     * Absent ⇒ the rule falls back to the person-wide `employment_statuses`
     * match, which is exactly what it did before this field existed.
     */
    contracts?:              ContractRecordV2[];
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
    /**
     * Holds a student visa with a restricted work limit (Migration Act 1958
     * (Cth), visa condition 8105 — 48 hours per fortnight).
     *
     * A SEPARATE axis from `contract_type`, deliberately: the holder is still
     * FT, PT, flexi or casual, and every rule scoped to those must keep seeing
     * the real value. Sourced from `employee_licenses.has_restricted_work_limit`
     * ('WorkRights'). Absent/false ⇒ V8_STUDENT_VISA_LIMIT is silent.
     */
    is_student_visa?:       boolean;
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
    /**
     * The raw `user_contracts.employment_status` for THIS contract.
     *
     * It used to live only in the flat, de-duplicated
     * `V8Employee.employment_statuses`, which threw away which contract each
     * status came from — so V8_EMPLOYMENT_TARGET could tell that a person was
     * "Full-Time somewhere" but never that they were Casual HERE. Carrying it
     * on the record keeps the status and the scope together, which is the only
     * way to answer the question the DB trigger actually asks.
     *
     * Optional so a caller that has not hydrated it degrades to the previous
     * person-wide behaviour rather than blocking.
     */
    employment_status?: string | null;
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
    /**
     * REMOVED — there is no general consecutive-day cap.
     *
     * `max_consecutive_days: 6` sat here from the beginning and no rule ever
     * read it. The 2026-07-05 policy lock scoped the streak cap to FLEXIBLE
     * part-time (cl 35.3(g), max 10) on the grounds that the EBA gives no basis
     * for an arbitrary standard cap — consecutive-day density is governed by the
     * 20-in-28 limit alone — but the config key and the "Standard: Max 6 days"
     * docstring on `maxWorkdayLimitsRule` both survived the rule they described.
     * A tunable that changes nothing is worse than no tunable: it reads as the
     * knob for a cap that does not exist. The live numbers are exported from
     * `rules/consecutive-days.ts` as MAX_WORKDAYS_PER_28 and
     * MAX_CONSECUTIVE_DAYS_FLEXI_PT, where the solver-parity test can see them.
     */
    
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
