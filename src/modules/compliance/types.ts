/**
 * Compliance Engine - Core Types
 * 
 * These types form the contract between the compliance engine,
 * UI components, and telemetry.
 */

// =============================================================================
// ACTION TYPES
// =============================================================================

export type ActionType = 'add' | 'assign' | 'swap' | 'bid';

export type ComplianceStatus = 'pass' | 'fail' | 'warning';

// =============================================================================
// INPUT CONTRACT
// =============================================================================

export interface ShiftTimeRange {
    start_time: string;  // HH:mm format
    end_time: string;    // HH:mm format
    shift_date: string;  // YYYY-MM-DD format
    unpaid_break_minutes?: number;  // Optional break time to subtract for net hours
    shift_id?: string;   // Unique identifier for database lookups
}

export interface ComplianceCheckInput {
    employee_id: string;
    action_type: ActionType;
    candidate_shift: ShiftTimeRange;
    existing_shifts: ShiftTimeRange[];
    // Optional: link compliance check to an existing shift record
    shift_id?: string;
    // Optional: exclude this shift ID from overlap checks (when editing)
    exclude_shift_id?: string;
    // Optional: overrides for Qualification Compliance
    overrideV8RoleId?: string;
    overrideSkillIds?: string[];
    overrideLicenseIds?: string[];
    // Optional context for swap operations
    swap_context?: {
        other_employee_id: string;
        other_employee_shifts: ShiftTimeRange[];
    };
    // Optional rules to skip (optimization)
    excludeRules?: string[];

    // Rule 5 – Minimum Shift Length context
    // When true the 2h training minimum applies instead of 3h weekday minimum
    candidate_is_training?: boolean;
    // Public holiday dates (YYYY-MM-DD) — shifts on these dates get the 4h minimum
    public_holiday_dates?: string[];

    // Rule 8 – Student Visa toggle
    // When true the 48h/fortnight limit becomes a hard blocking error (default: non-blocking warning)
    student_visa_enforcement?: boolean;

    // Rule 10 – Rest Gap configuration
    // Minimum rest hours between shifts (default 10; relaxed mode allows 8)
    rest_gap_hours?: number;

    // Rule 9 – Ordinary Hours Averaging cycle length (default 4 weeks)
    averaging_cycle_weeks?: 1 | 2 | 3 | 4;

    // F9 – Organisation timezone (IANA name, e.g. 'Australia/Sydney').
    // All time-based rules use this instead of a hardcoded constant.
    // Defaults to 'Australia/Sydney' when omitted.
    org_timezone?: string;

    // F11 – How many days of shift history the caller has provided.
    // Rules that require a longer lookback will surface a data-quality warning
    // rather than silently computing an incorrect result.
    // When omitted, rules assume the history is sufficient.
    shifts_window_days?: number;
}

// =============================================================================
// OUTPUT CONTRACT
// =============================================================================

export interface ComplianceCalculation {
    existing_hours: number;
    candidate_hours: number;
    total_hours: number;
    limit: number;
    [key: string]: any;  // Allow rule-specific fields
}

export interface ComplianceResult {
    rule_id: string;
    rule_name: string;
    status: ComplianceStatus;
    summary: string;
    details: string;
    calculation: ComplianceCalculation;
    blocking: boolean;  // If true, action cannot proceed when status is 'fail'
}

// =============================================================================
// RULE INTERFACE
// =============================================================================

export interface ComplianceRule {
    id: string;
    name: string;
    description: string;
    appliesTo: ActionType[];
    blocking: boolean;
    evaluate(input: ComplianceCheckInput): ComplianceResult;
}

// =============================================================================
// AGGREGATE RESULT
// =============================================================================

export interface ComplianceCheckResult {
    passed: boolean;                  // Overall pass (no blocking failures)
    hasWarnings: boolean;             // Has non-blocking warnings
    hasBlockingFailure: boolean;      // Has at least one blocking failure
    overallStatus: ComplianceStatus;  // Aggregated status for UI
    results: ComplianceResult[];      // All rule results (including passed)
    blockers: ComplianceResult[];     // Only blocking failures
}

// =============================================================================
// F10 – UNIFIED COMPLIANCE RESULT
// Bridges the client-side rule results and the server-side aggregate result
// into a single shape that callers can reason about consistently.
// =============================================================================

export type UnifiedComplianceStatus = 'passed' | 'violated' | 'warned' | 'unavailable';

export interface UnifiedComplianceResult {
    /** Canonical top-level status — never treat 'unavailable' as allowed */
    status: UnifiedComplianceStatus;
    /** Human-readable blocking violation messages (status === 'violated') */
    violations: string[];
    /** Human-readable non-blocking warning messages */
    warnings: string[];
    /** Per-rule detail — present when client-side engine ran */
    ruleResults?: ComplianceResult[];
    /** Projected hours in the current compliance window (from server-side checks) */
    weeklyHours?: number;
    /** Configured maximum for the above */
    maxWeeklyHours?: number;
    /** Which server-side checks completed successfully */
    checksPerformed?: string[];
    /** Which server-side checks could not reach the database */
    checksSkipped?: string[];
}

/**
 * Promote a ComplianceCheckResult (client-side aggregate) into a
 * UnifiedComplianceResult so callers only deal with one result shape.
 */
export function toUnifiedResult(result: ComplianceCheckResult): UnifiedComplianceResult {
    const violations = result.blockers.map(b => b.summary);
    const warnings = result.results
        .filter(r => r.status === 'warning' || (r.status === 'fail' && !r.blocking))
        .map(r => r.summary);

    let status: UnifiedComplianceStatus;
    if (result.hasBlockingFailure) {
        status = 'violated';
    } else if (result.hasWarnings || warnings.length > 0) {
        status = 'warned';
    } else {
        status = 'passed';
    }

    return { status, violations, warnings, ruleResults: result.results };
}
