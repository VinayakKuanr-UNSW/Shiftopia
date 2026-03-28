/**
 * Compliance Engine v2 — Shared Combined-State Validator
 *
 * Single, authoritative function for checking whether applying ALL PENDING
 * changes for one employee simultaneously still passes compliance.
 *
 * Why this exists:
 *   Every sub-system final pass (batch, bidding, swap, conflict-resolver)
 *   needs to verify the COMBINED effect of multiple operations on one
 *   employee's schedule, not each operation in isolation.
 *
 *   Without a shared utility, each sub-system was re-implementing the same
 *   "aggregate all adds/removes → run evaluateCompliance" pattern.  That
 *   pattern diverged in subtle ways (different operation_type choices,
 *   missing employee_id, etc.), creating hard-to-spot bugs.
 *
 *   This utility is the single source of truth for combined-state checks.
 *   Future: add a call to this from wherever combined-schedule correctness
 *   matters and the caller cannot use the sub-system final validators directly.
 *
 * Usage:
 *   import { validateCombinedState } from '../validate-combined-state';
 *
 *   const result = validateCombinedState({
 *       employee_id,
 *       employee_context,
 *       original_shifts,
 *       add_shifts,
 *       remove_shift_ids,
 *       operation_type: 'SWAP',
 *       stage: 'DRAFT',
 *       config,
 *   });
 *
 *   if (result.status === 'BLOCKING') { ... }
 */

import type {
    EmpId,
    EmployeeContextV2,
    ShiftV2,
    ShiftId,
    OperationType,
    Stage,
    ComplianceConfigV2,
    ComplianceResultV2,
} from './types';
import { evaluateCompliance } from './index';

// =============================================================================
// INPUT
// =============================================================================

export interface CombinedStateInput {
    /** Employee whose combined final schedule is being validated */
    employee_id:       EmpId;
    employee_context:  EmployeeContextV2;
    /** The employee's current schedule BEFORE any pending operations */
    original_shifts:   ShiftV2[];
    /** All shifts being added across ALL pending operations for this employee */
    add_shifts:        ShiftV2[];
    /** All shift IDs being removed across ALL pending operations for this employee */
    remove_shift_ids:  ShiftId[];
    /**
     * The dominant operation type for this check.
     * Use 'ASSIGN' for the most conservative (strictest) severity normalization.
     * Pass the actual type when the check is for a specific domain.
     */
    operation_type:    OperationType;
    stage:             Stage;
    config?:           Partial<ComplianceConfigV2>;
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Validates the FINAL combined schedule for one employee after all pending
 * operations are applied simultaneously.
 *
 * Returns the full ComplianceResultV2 — callers can inspect .status,
 * .rule_hits, and .delta_explanation as needed.
 */
export function validateCombinedState(
    input: CombinedStateInput,
): ComplianceResultV2 {
    return evaluateCompliance(
        {
            employee_id:       input.employee_id,
            employee_context:  input.employee_context,
            existing_shifts:   input.original_shifts,
            candidate_changes: {
                add_shifts:    input.add_shifts,
                remove_shifts: input.remove_shift_ids,
            },
            mode:              'SIMULATED',
            operation_type:    input.operation_type,
            stage:             input.stage,
            config:            input.config,
        },
        { stage: input.stage },
    ) as ComplianceResultV2;
}
