/**
 * Compliance Module - Public API
 * 
 * Re-exports all public types and functions from the compliance module.
 */

// Types
export type {
    ShiftTimeRange,
    ComplianceCheckInput,
    ComplianceResult,
    ComplianceRule,
} from './types';

export type {
    RosterShift,
    ConstraintViolation
} from './v8';

// Engine functions
export {
    getScenarioWindow,
    getRegisteredRules,
    runRule,
    assignmentEvaluator,
    assignmentResultToComplianceResults,
    swapEvaluator,
    runSwapGuards,
    SwapGuardError,
} from './v8';

// Utilities

// Hook

// UI Components


// Pre-Validation (Hard Validation - Layer 1)
export type {
    HardValidationResult,
} from './prevalidation';

export {
    runHardValidation,
} from './prevalidation';

// Swap Engine (Replaces legacy solver)

// Shift Shape (employee-free, runs at shift creation — see ./shape/types.ts)


// Rule Registry — the single description of every rule, both layers, all three
// engines. `v8/metadata.ts` is a derived view of it; see ./registry/types.ts for
// why the checkable fields are checked rather than merely written down.

