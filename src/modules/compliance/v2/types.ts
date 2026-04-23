/**
 * Compliance Engine v2 — Core Types
 *
 * Extends and replaces the v1 type contract with:
 *   - Rule metadata (HARD/SOFT, category, blocking_stage)
 *   - Severity normalization (operation × stage matrix)
 *   - Delta explainability (before/after state, narrative)
 *   - Conflict pair index (for bidding graphs / solver reuse)
 *   - Consolidated hit groups (union-find deduplication)
 *   - Batch constraint descriptors (solver-agnostic)
 *   - Incremental evaluation cache support
 */

// =============================================================================
// PRIMITIVES
// =============================================================================

export type ShiftId       = string;
export type RoleId        = string;
export type QualId        = string;
export type EmpId         = string;

export type ContractType  = 'FULL_TIME' | 'PART_TIME' | 'CASUAL' | 'STUDENT_VISA';
export type Severity      = 'WARNING' | 'BLOCKING';
export type FinalStatus   = 'PASS' | 'WARNING' | 'BLOCKING';
export type OperationType = 'ASSIGN' | 'BID' | 'SWAP';
export type EvalMode      = 'CURRENT' | 'SIMULATED';
export type Stage         = 'DRAFT' | 'PUBLISH' | 'LIVE';

// =============================================================================
// AVAILABILITY DATA  (pre-fetched by caller; injected into the engine)
// =============================================================================

/** Pre-materialized declared availability slot (from availability_slots table) */
export interface AvailabilitySlotV2 {
    slot_date:   string;    // YYYY-MM-DD
    start_time:  string;    // HH:mm or HH:mm:ss
    end_time:    string;    // HH:mm or HH:mm:ss
}

/** An assigned shift that creates a locked interval (derived from shifts table) */
export interface AssignedShiftIntervalV2 {
    shift_id:   ShiftId;
    shift_date: string;     // YYYY-MM-DD
    start_time: string;     // HH:mm or HH:mm:ss
    end_time:   string;     // HH:mm or HH:mm:ss
}

/**
 * Pre-fetched availability data injected by the caller.
 * When present, R_AVAILABILITY_MATCH evaluates; otherwise the rule is skipped.
 *
 * Callers must fetch the correct date range BEFORE calling evaluateCompliance().
 * The engine is fully synchronous — no DB calls inside.
 */
export interface AvailabilityDataV2 {
    /** Declared availability slots for the relevant period */
    declared_slots:  AvailabilitySlotV2[];
    /**
     * Already-assigned shifts (locked intervals).
     * Must NOT include the candidate shift itself.
     */
    assigned_shifts: AssignedShiftIntervalV2[];
}

// =============================================================================
// AVAILABILITY MATCH SUMMARY  (attached to ComplianceResultV2)
// =============================================================================

/**
 * Structured advisory result for the R_AVAILABILITY_MATCH rule.
 *
 * FAIL → at least one candidate shift overlaps a locked (assigned) interval
 * WARN → shift time not covered by declared availability
 * PASS → declared available and no conflicts
 *
 * Used by isEligible() for context-aware enforcement and by UI for display.
 */
export type AvailabilityMatchStatus = 'PASS' | 'WARN' | 'FAIL';

export interface AvailabilityMatchSummary {
    status:              AvailabilityMatchStatus;
    declared_available:  boolean;
    has_conflict:        boolean;
    conflict_type?:      'LOCKED' | 'NOT_DECLARED';
    /** Candidate shift IDs that triggered the result (empty = all pass) */
    affected_shift_ids:  ShiftId[];
}

// =============================================================================
// DOMAIN ENTITIES  (caller-supplied; no DB assumptions)
// =============================================================================

/**
 * The minimal shift representation the v2 engine needs.
 * Uses the same date/time format as the existing ShiftTimeRange
 * (shift_date: YYYY-MM-DD, start_time/end_time: HH:mm).
 *
 * org/dept/sub_dept fields are optional — R10 only enforces the dimensions
 * that are actually populated (partial hierarchy matching).
 */
export interface ShiftV2 {
    shift_id:                ShiftId;
    shift_date:              string;    // YYYY-MM-DD
    start_time:              string;    // HH:mm
    end_time:                string;    // HH:mm
    role_id:                 RoleId;
    organization_id?:        string;   // from shifts.organization_id
    department_id?:          string;   // from shifts.department_id
    sub_department_id?:      string;   // from shifts.sub_department_id
    required_qualifications: QualId[];
    is_ordinary_hours:       boolean;
    is_training?:            boolean;        // training shift — reduced minimum (2h vs 3h/4h)
    break_minutes:           number;         // total break recorded (for R08 check)
    unpaid_break_minutes?:   number;         // unpaid portion (for net-hours calculation)
}

export interface QualificationV2 {
    qualification_id: QualId;
    issued_at:        string;           // YYYY-MM-DD
    expires_at:       string | null;    // YYYY-MM-DD | null = non-expiring
}

/**
 * One row from user_contracts — used by R10 for exact hierarchy matching.
 * (organization_id, department_id, sub_department_id, role_id)
 */
export interface ContractRecordV2 {
    organization_id:   string;
    department_id:     string;
    sub_department_id: string | null;
    role_id:           string;
}

export interface EmployeeContextV2 {
    employee_id:              EmpId;
    contract_type:            ContractType;
    contracted_weekly_hours:  number;        // 38 FT, 20 PT, 0 casual
    /** @deprecated Derive from contracts if needed; kept for backward compat */
    assigned_role_ids:        RoleId[];
    /** Full contract records from user_contracts — primary source for R10 */
    contracts:                ContractRecordV2[];
    qualifications:           QualificationV2[];
}

// =============================================================================
// COMPLIANCE CONFIG  (injected; not hardcoded)
// =============================================================================

export interface ComplianceConfigV2 {
    min_shift_hours:             number;   // default 3
    max_daily_hours:             number;   // default 12
    max_working_days_per_28:     number;   // default 20
    student_visa_fortnightly_h:  number;   // default 48
    ord_avg_tolerance_pct:       number;   // default 1.10 (10% over contracted)
    rest_gap_hours:              number;   // default 10
    meal_break_threshold_hours:  number;   // default 5
    meal_break_minimum_minutes:  number;   // default 30
    max_consecutive_days:        number;   // default 6
}

export const DEFAULT_CONFIG_V2: ComplianceConfigV2 = {
    min_shift_hours:            3,
    max_daily_hours:            12,
    max_working_days_per_28:    20,
    student_visa_fortnightly_h: 48,
    ord_avg_tolerance_pct:      1.10,
    rest_gap_hours:             10,
    meal_break_threshold_hours: 5,
    meal_break_minimum_minutes: 30,
    max_consecutive_days:       6,
};

// =============================================================================
// ENGINE I/O
// =============================================================================

export interface CandidateChangesV2 {
    add_shifts:    ShiftV2[];
    remove_shifts: ShiftId[];    // IDs only; removal is by ID match
}

export interface ComplianceInputV2 {
    employee_id:                 EmpId;
    employee_context:            EmployeeContextV2;
    existing_shifts:             ShiftV2[];       // published + assigned drafts
    candidate_changes:           CandidateChangesV2;
    mode:                        EvalMode;
    operation_type:              OperationType;
    stage?:                      Stage;           // default 'DRAFT'
    evaluation_reference_date?:  string;          // YYYY-MM-DD, defaults to today
    config?:                     Partial<ComplianceConfigV2>;
    /**
     * Pre-fetched declared slots + locked intervals for availability checking.
     * When provided, R_AVAILABILITY_MATCH is evaluated as an advisory rule.
     * When absent, R_AVAILABILITY_MATCH is skipped entirely.
     */
    availability_data?:          AvailabilityDataV2;
}

export interface RuleHitV2 {
    rule_id:          string;
    severity:         Severity;
    message:          string;
    resolution_hint:  string;
    affected_shifts:  ShiftId[];
}

// =============================================================================
// RULE METADATA
// =============================================================================

export type RuleType      = 'HARD' | 'SOFT';
export type RuleCategory  = 'TIME' | 'LEGAL' | 'CONTRACT' | 'SKILL' | 'AVAILABILITY';
export type BlockingStage = 'ALWAYS' | 'PUBLISH' | 'NEVER';

export interface RuleMeta {
    rule_id:         string;
    rule_type:       RuleType;
    category:        RuleCategory;
    blocking_stage:  BlockingStage;
    description:     string;
    overlaps_with?:  string[];    // rule IDs with potentially correlated violations
}

// =============================================================================
// SEVERITY NORMALIZATION
// =============================================================================

/** null = skip this rule silently for this operation × stage combination */
export type SeverityOverride = Severity | null;

/** rule_id → OperationType → Stage → resolved severity (or null = skip) */
export type SeverityMatrix = Partial<Record<
    string,
    Partial<Record<OperationType, Partial<Record<Stage, SeverityOverride>>>>
>>;

// =============================================================================
// IMPACT WINDOW
// =============================================================================

export interface ImpactWindow {
    from_date: string;    // YYYY-MM-DD
    to_date:   string;    // YYYY-MM-DD
}

// =============================================================================
// CROSS-MIDNIGHT: DAY SEGMENT
// =============================================================================

export interface DaySegmentV2 {
    date:            string;    // YYYY-MM-DD
    hours:           number;    // net hours for this segment
    source_shift_id: ShiftId;
}

// =============================================================================
// CONFLICT PAIR INDEX
// =============================================================================

export type ConflictType =
    | 'OVERLAP'
    | 'REST_GAP'
    | 'DAILY_HOURS_SHARED'
    | 'CONSECUTIVE_SHARED';

export interface ConflictPairV2 {
    shift_a:       ShiftId;
    shift_b:       ShiftId;
    rule_id:       string;
    conflict_type: ConflictType;
}

// =============================================================================
// DELTA EXPLAINABILITY
// =============================================================================

export interface DeltaChange {
    metric:            string;
    before_value:      number;
    after_value:       number;
    unit:              string;
    threshold?:        number;
    threshold_label?:  string;
    direction:         'INCREASE' | 'DECREASE' | 'UNCHANGED';
    exceeds_threshold: boolean;
}

export interface StateSummaryV2 {
    total_hours_28d:        number;
    total_hours_14d:        number;
    working_days_28d:       number;
    max_consecutive_days:   number;
    peak_daily_hours:       number;
    peak_daily_hours_date:  string;    // YYYY-MM-DD
}

export interface DeltaExplanationV2 {
    before:    StateSummaryV2;
    after:     StateSummaryV2;
    changes:   DeltaChange[];
    narrative: string;    // human-readable one-liner for managers/UI
}

// =============================================================================
// CONSOLIDATED HIT GROUPS
// =============================================================================

export interface ConsolidatedGroupV2 {
    group_id:        string;
    summary:         string;
    severity:        Severity;
    hits:            RuleHitV2[];
    affected_shifts: ShiftId[];
}

// =============================================================================
// BATCH CONSTRAINT DESCRIPTORS  (for solver / OR-Tools integration)
// =============================================================================

export type ConstraintType =
    | 'NO_OVERLAP'
    | 'MAX_SUM'
    | 'MIN_GAP'
    | 'MEMBERSHIP'
    | 'MAX_STREAK'
    | 'FORTNIGHTLY_CAP';

export interface ConstraintDescriptorV2 {
    rule_id:          string;
    constraint_type:  ConstraintType;
    variables:        ShiftId[];
    parameters:       Record<string, number | string | string[]>;
    is_hard:          boolean;
}

// =============================================================================
// EVALUATION CACHE
// =============================================================================

export interface EvaluationCacheEntryV2 {
    key:            string;
    result:         ComplianceResultV2;
    affected_rules: string[];
    created_at:     number;     // epoch ms
}

// =============================================================================
// RULE CONTEXT  (passed to every rule evaluator)
// =============================================================================

export interface RuleContextV2 {
    // Shift sets
    simulated_shifts:  ShiftV2[];               // full merged snapshot
    relevant_shifts:   ShiftV2[];               // scoped to impact_window ± buffer
    candidate_shifts:  ShiftV2[];               // add_shifts only

    // Pre-sliced time windows
    window_28d:        ShiftV2[];
    window_14d:        ShiftV2[];

    // Pre-computed indexes (built once, shared across all rules)
    shifts_by_day:     Map<string, DaySegmentV2[]>;  // cross-midnight safe
    sorted_shifts:     ShiftV2[];                     // by date then start_time

    impact_window:     ImpactWindow;

    // Context
    employee:          EmployeeContextV2;
    reference_date:    string;    // YYYY-MM-DD
    config:            ComplianceConfigV2;
    operation_type:    OperationType;
    stage:             Stage;

    // Mutable output: rules push conflict pairs directly into this array
    conflict_pairs:    ConflictPairV2[];

    // Optional: pre-fetched availability data (passed through from ComplianceInputV2)
    availability_data?: AvailabilityDataV2;
}

// =============================================================================
// RULE EVALUATOR  (function signature every rule must satisfy)
// =============================================================================

export type RuleEvaluatorV2 = (ctx: RuleContextV2) => RuleHitV2[];

// =============================================================================
// OUTPUT CONTRACT
// =============================================================================

export interface ComplianceResultV2 {
    status:                FinalStatus;
    rule_hits:             RuleHitV2[];
    consolidated_groups:   ConsolidatedGroupV2[];
    conflict_pairs:        ConflictPairV2[];
    delta_explanation:     DeltaExplanationV2 | null;   // null when mode=CURRENT
    evaluated_shift_count: number;
    evaluation_time_ms:    number;
    /**
     * Advisory availability summary, derived from R_AVAILABILITY_MATCH hits.
     * Present only when availability_data was provided in the input.
     * null = availability data was not provided; check was skipped.
     */
    availability_match?:   AvailabilityMatchSummary | null;
}

export interface ComplianceResultV2WithConstraints extends ComplianceResultV2 {
    constraints: ConstraintDescriptorV2[];
}
