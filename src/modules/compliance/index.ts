/**
 * Compliance Module - Public API
 * 
 * Re-exports all public types and functions from the compliance module.
 */

// Types
export type {
    ActionType,
    ComplianceStatus,
    ShiftTimeRange,
    ComplianceCheckInput,
    ComplianceCalculation,
    ComplianceResult,
    ComplianceRule,
    ComplianceCheckResult
} from './types';

// Engine functions
export * from './hard-validation';
export {
    runComplianceChecks,
    checkCompliance,
    getRegisteredRules,
    runRule,
    isActionAllowed,
    getComplianceSummary
} from './engine';

// Utilities
export {
    getShiftHoursForDate,
    getTotalHoursForDate,
    getShiftDurationMinutes,
    parseTimeToMinutes,
    minutesToHours,
    doShiftsOverlap,
    formatDateForDisplay,
    // New exports
    calculateNetHoursForDate,
    splitShiftByDay,
    mergeOverlappingRanges,
    normalizeToOrgTimezone,
    // ISO week utilities
    getISOWeekInfo,
    getISOWeekInfoFromString,
    getISOWeekDateRange,
    getISOWeeksInRange,
    sortISOWeekKeys,
    areWeeksConsecutive
} from './utils';

// Hook
export {
    useCompliance,
    buildComplianceInput,
    checkComplianceNow  // Immediate check without debounce
} from './hooks/useCompliance';

// UI Components
export { ComplianceBadge } from './ui/ComplianceBadge';
export { ComplianceModal } from './ui/ComplianceModal';


// Pre-Validation (Hard Validation - Layer 1)
export type {
    HardValidationError,
    HardValidationResult,
    HardValidationInput
} from './prevalidation';

export {
    runHardValidation,
    getFieldError,
    hasRuleError
} from './prevalidation';

// Constraint Solver (swap evaluation)
export type {
    RosterShift,
    SwapParty,
    SwapScenario,
    SolverConfig,
    SolverConstraint,
    ConstraintViolation,
    SolverResult,
    SwapPartyInput,
    SwapEvaluationInput,
} from './solver';
export { SwapEvaluator, swapEvaluator, solverResultToComplianceResults, evaluateScenario } from './solver';
export type { GuardViolation, GuardViolationCode, GuardResult, SwapGuardInput, ChainSwapScenario } from './solver';
export { runSwapGuards, SwapGuardError } from './solver';

// Scenario utilities
export { getScenarioWindow, SCENARIO_WINDOW_DAYS } from './solver';
export type { ScenarioWindow } from './solver';
export { aggregateSchedule, aggregateSchedules } from './solver';
export type { UnifiedShift, ShiftState } from './solver';

// Concurrency revalidation
export { validateBeforeCommit, ConcurrencyValidationError } from './solver';
export type { ConcurrencyCheckInput, ConcurrencyCheckResult } from './solver';

// Single-party constraint solver: assignment / add / bid
export {
    AssignmentEvaluator,
    assignmentEvaluator,
    assignmentResultToComplianceResults,
} from './solver';
export type { AssignmentEvaluationInput } from './solver';

// Bulk Compliance
export type {
    BulkComplianceMode,
    BulkActionType,
    BulkAssignment,
    BulkComplianceCheckRequest,
    BulkComplianceResultStatus,
    BulkRuleDetail,
    BulkShiftComplianceResult,
    BulkComplianceSummary,
    BulkComplianceCheckResponse,
    BulkApplyRequest,
    BulkApplyResponse
} from './bulk-types';

export { checkBulkCompliance } from './bulk-engine';

// Audit logging
export { logComplianceEvent, buildResultSnapshot } from './audit/compliance-audit';
export type { ComplianceAuditEntry, ComplianceContext, ComplianceAction } from './audit/compliance-audit';
