/**
 * V8 Compliance Engine — Swap Engine Types
 */

import { V8Status, V8Shift } from '../types';

export type RosterShift = V8Shift;

export interface SwapParty {
    employee_id:           string;
    name:                  string;
    hypothetical_schedule: RosterShift[];
    received_shift:        RosterShift;
    given_shift:           RosterShift;
    is_student_visa?:      boolean;
    /**
     * Employment status of this party. Drives contract-scoped rules (e.g.
     * V8_ORD_HOURS_AVG, which exempts CASUAL). When absent/null the engine
     * defaults to CASUAL so behaviour is unchanged for legacy callers.
     */
    contract_type?:            'FT' | 'PT' | 'CASUAL' | null;
    contracted_weekly_hours?:  number;
    /** YYYY-MM-DD dates with APPROVED leave (audit F1 — V8_LEAVE_CONFLICT). */
    leave_days?:               string[];
    /** EBA Schedule 3 §3 — see V8Employee.is_security_role (audit H-5). */
    is_security_role?:         boolean;
    /** Raw per-contract employment statuses — see V8Employee.employment_statuses.
     *  Feeds V8_EMPLOYMENT_TARGET, which returns no hits without them.
     *  NOT derivable from `contract_type` (global source; collapses the
     *  Flexible Part-Time variant onto 'PT'). */
    employment_statuses?:      string[];
}

export interface SwapScenario {
    partyA: SwapParty;
    partyB: SwapParty;
}

export interface SwapPartyInput {
    employee_id:     string;
    name:            string;
    current_shifts:  RosterShift[];
    shift_to_give:   RosterShift;
    is_student_visa?: boolean;
    /**
     * Employment status of this party. Must be supplied by the caller —
     * absent/null is treated as CASUAL by the engine (audit C-4: this was
     * previously never populated by any caller, so every party was
     * silently evaluated as CASUAL regardless of their real contract).
     */
    contract_type?:            'FT' | 'PT' | 'CASUAL' | null;
    contracted_weekly_hours?:  number;
    /** YYYY-MM-DD dates with APPROVED leave (audit F1 — V8_LEAVE_CONFLICT). */
    leave_days?:               string[];
    /** EBA Schedule 3 §3 — see V8Employee.is_security_role (audit H-5). */
    is_security_role?:         boolean;
}

export interface SwapEvaluationInput {
    partyA:  SwapPartyInput;
    partyB:  SwapPartyInput;
    config?: SolverConfig;
}

export interface SolverConfig {
    max_daily_hours?:          number;
    rest_gap_hours?:           number;
    averaging_cycle_weeks?:    number;
    student_visa_enforcement?: boolean;
    public_holiday_dates?:     string[];
    candidate_is_training?:    boolean;
    action_type?:              'add' | 'assign' | 'bid' | 'swap';
}

export interface ConstraintViolation {
    id:            string;
    constraint_id: string; // Alias for id
    name:          string;
    constraint_name: string; // Alias for name
    employee_id:   string;
    employee_name?: string;
    status:        'pass' | 'fail' | 'warning';
    summary:       string;
    details:       string;
    blocking:      boolean;
    calculation?:  Record<string, any>;
}

export interface SolverResult {
    feasible:       boolean;
    violations:     ConstraintViolation[];
    warnings:       ConstraintViolation[];
    all_results:    ConstraintViolation[];
    solve_time_ms:  number;
    scenario:       SwapScenario;
}
