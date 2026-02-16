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
    ComplianceCheckResult,
    ComplianceAuditEntry
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

// API
export {
    logComplianceCheck,
    getComplianceHistory,
    getRecentFailedChecks
} from './api/compliance.api';

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
