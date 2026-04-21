/**
 * Bulk Compliance Types
 * 
 * Types for bulk compliance operations, following the user-specified API contracts.
 * 
 * Design principles:
 * - Compliance evaluated per employee, per shift
 * - Simulation-based (no persistence until confirmed)
 * - Batch-optimized for performance
 */

import { ComplianceResult, ComplianceStatus, ShiftTimeRange } from './types';

// =============================================================================
// MODES
// =============================================================================

/**
 * Bulk compliance execution mode.
 * - ALL_OR_NOTHING: Either all assignments pass or none are applied
 * - PARTIAL_APPLY: Valid assignments proceed, failed ones are skipped
 */
export type BulkComplianceMode = 'ALL_OR_NOTHING' | 'PARTIAL_APPLY';

/**
 * Bulk action types supported by the compliance engine.
 */
export type BulkActionType = 'BULK_ASSIGN' | 'BULK_BID' | 'BULK_SWAP';

// =============================================================================
// REQUEST TYPES
// =============================================================================

/**
 * A single assignment in a bulk operation.
 */
export interface BulkAssignment {
    shiftId: string;
    employeeId: string;
}

/**
 * Request payload for bulk compliance check API.
 */
export interface BulkComplianceCheckRequest {
    actionType: BulkActionType;
    organisationId?: string;
    requestedBy?: string;
    mode: BulkComplianceMode;
    assignments: BulkAssignment[];
    /** F2: Minimum rest-gap threshold in hours. Default 10h — matches single-shift rule. Pass 8 for relaxed mode. */
    restGapHours?: number;
}

// =============================================================================
// RESULT TYPES
// =============================================================================

/**
 * Status of a single shift's compliance evaluation.
 */
export type BulkComplianceResultStatus = 'PASS' | 'FAIL' | 'WARNING';

/**
 * Detail about a single rule's evaluation for a shift.
 */
export interface BulkRuleDetail {
    ruleId: string;
    status: BulkComplianceResultStatus;
    blocking: boolean;
    explanation: string;
    data?: Record<string, any>;
}

/**
 * Compliance result for a single (employeeId, shiftId) pair.
 */
export interface BulkShiftComplianceResult {
    employeeId: string;
    shiftId: string;
    status: BulkComplianceResultStatus;
    blocking: boolean;
    failedRules: string[];
    details: BulkRuleDetail[];
}

/**
 * Summary statistics for a bulk compliance check.
 */
export interface BulkComplianceSummary {
    totalAssignments: number;
    blockingFailures: number;
    warnings: number;
    passes: number;
    canProceed: boolean;  // true if mode allows proceeding
}

/**
 * Response from bulk compliance check API.
 */
export interface BulkComplianceCheckResponse {
    bulkCheckId: string;  // For history and apply reference
    summary: BulkComplianceSummary;
    results: BulkShiftComplianceResult[];
    // Grouped by employee for UI convenience
    resultsByEmployee: Map<string, BulkShiftComplianceResult[]>;
}

// =============================================================================
// APPLY TYPES
// =============================================================================

/**
 * Request to apply bulk assignments after compliance confirmation.
 */
export interface BulkApplyRequest {
    bulkCheckId: string;
    mode: BulkComplianceMode;
    confirm: boolean;
}

/**
 * Result of a failed assignment during apply.
 */
export interface BulkApplyFailure {
    employeeId: string;
    shiftId: string;
    reason: string;
}

/**
 * Response from bulk apply API.
 */
export interface BulkApplyResponse {
    status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
    reason?: string;
    appliedAssignments: BulkAssignment[];
    failedAssignments: BulkApplyFailure[];
}

// =============================================================================
// INTERNAL TYPES (used by engine)
// =============================================================================

/**
 * Shift data fetched from database for compliance evaluation.
 */
export interface ShiftForCompliance {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    assigned_employee_id: string | null;
    unpaid_break_minutes?: number;
    role_id?: string;
    is_candidate?: boolean;  // true if this is a candidate shift in simulation
}

/**
 * Employee timeline with existing and candidate shifts.
 */
export interface EmployeeTimeline {
    employeeId: string;
    existingShifts: ShiftForCompliance[];
    candidateShifts: ShiftForCompliance[];
    simulatedShifts: ShiftForCompliance[];  // existing + candidates
}

/**
 * Grouped assignments by employee for batch processing.
 */
export type AssignmentsByEmployee = Map<string, BulkAssignment[]>;
