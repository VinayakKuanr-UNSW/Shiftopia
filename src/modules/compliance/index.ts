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

export type {
    RosterShift,
    ConstraintViolation
} from './v8';

// Engine functions
// export * from './hard-validation'; // Removed to avoid conflict with prevalidation
export {
    runV8LegacyBridge,
    runV8ComplexBridge,
    runV8Orchestrator,
    isV8Eligible,
    validateV8State,
    getScenarioWindow,
    getRegisteredRules,
    runRule,
    assignmentEvaluator,
    assignmentResultToComplianceResults,
    solverResultToComplianceResults,
    swapEvaluator,
    runSwapGuards,
    SwapGuardError
} from './v8';

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
    runV8LegacyBridgeNow  // Immediate check without debounce
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

// Swap Engine (Replaces legacy solver)
export { V8SwapEngine as SwapEvaluator } from './v8';

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
