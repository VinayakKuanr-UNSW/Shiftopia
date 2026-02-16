/**
 * Compliance Engine - Core Types
 * 
 * These types form the contract between the compliance engine,
 * UI components, and audit logging.
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
}

export interface ComplianceCheckInput {
    employee_id: string;
    action_type: ActionType;
    candidate_shift: ShiftTimeRange;
    existing_shifts: ShiftTimeRange[];
    // Optional context for swap operations
    swap_context?: {
        other_employee_id: string;
        other_employee_shifts: ShiftTimeRange[];
    };
    // Optional rules to skip (optimization)
    excludeRules?: string[];
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
// AUDIT LOG ENTRY
// =============================================================================

export interface ComplianceAuditEntry {
    id?: string;
    employee_id: string;
    action_type: ActionType;
    shift_id: string | null;
    candidate_shift: ShiftTimeRange;
    results: ComplianceResult[];
    passed: boolean;
    performed_at?: string;
    performed_by?: string;
}
