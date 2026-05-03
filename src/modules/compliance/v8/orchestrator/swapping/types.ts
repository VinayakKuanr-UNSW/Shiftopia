/**
 * Two-Way Swap Engine — Core Types
 *
 * Scope: A ↔ B only (two-way swaps).
 *   Employee A gives shift_X to B.
 *   Employee B gives shift_Y to A.
 *
 * Out of scope:
 *   - one-way transfers
 *   - multi-party chains
 *   - circular swaps
 *
 * Pipeline:
 *   SwapInput
 *     → StructuralValidator   (shift ownership, existence, duplicates)
 *     → InterSwapConflict     (same shift used in multiple swaps → keep highest priority)
 *     → SwapSimulator         (A_new = A−X+Y, B_new = B−Y+X)
 *     → ComplianceChecker     (evaluate(A_new) + evaluate(B_new))
 *     → DecisionLogic         (BLOCKING or WARNING-if-rejected → reject; else approve)
 *     → FinalValidator        (full final-state compliance per affected employee)
 *     → [BatchExecutor]       (optional auto-apply via SWAP_APPROVE operations)
 *     → SwapResult
 */

import type {
    V8OrchestratorShift,
    V8ShiftId,
    V8EmpId,
    V8EmployeeContext,
    V8Hit,
    V8Status,
    V8Stage,
    V8Config,
    V8OrchestratorResult,
} from '../types';
import type { BatchResult } from '../batch/types';

// =============================================================================
// INPUT
// =============================================================================

export type SwapStatus = 'REQUESTED' | 'APPROVED';

export interface SwapRequest {
    swap_id:        string;
    /** Employee giving shift_X, receiving shift_Y */
    employee_a_id:  V8EmpId;
    /** Employee giving shift_Y, receiving shift_X */
    employee_b_id:  V8EmpId;
    /** Belongs to A in base_state */
    shift_x_id:     V8ShiftId;
    /** Belongs to B in base_state */
    shift_y_id:     V8ShiftId;
    /** APPROVED requests are processed preferentially */
    status:         SwapStatus;
    /** 1–100: higher wins when the same shift appears in multiple swaps */
    priority:       number;
}

export interface SwapInput {
    swaps:                    SwapRequest[];
    employees:                V8EmployeeContext[];
    /** Each employee's shifts before any swap is applied */
    existing_assignments:     { employee_id: V8EmpId; shifts: V8OrchestratorShift[] }[];
    config?:                  Partial<SwapConfig>;
}

// =============================================================================
// CONFIG
// =============================================================================

export interface SwapConfig {
    /** Compliance stage forwarded to the engine. Default: 'DRAFT' */
    compliance_stage:    V8Stage;
    /**
     * When true (default), swaps producing WARNING compliance results are
     * approved (manager has discretion). When false, only PASS is acceptable.
     */
    accept_warnings:     boolean;
    /**
     * When true, convert approved swaps to SWAP_APPROVE BatchOperations
     * and call executeBatch(). Populates batch_result in the output.
     */
    auto_apply:          boolean;
    compliance_config?:  Partial<V8Config>;
}

export const DEFAULT_SWAP_CONFIG: SwapConfig = {
    compliance_stage: 'DRAFT',
    accept_warnings:  true,
    auto_apply:       false,
};

// =============================================================================
// INTERNAL: STRUCTURAL VALIDATION
// =============================================================================

export interface StructuralError {
    swap_id: string;
    reason:  string;
}

export interface StructuralValidationResult {
    valid:   SwapRequest[];
    invalid: StructuralError[];
}

// =============================================================================
// INTERNAL: INTER-SWAP CONFLICT
// Occurs when the same shift_id appears in more than one swap.
// Resolution: keep the highest-priority swap; reject the rest.
// =============================================================================

export interface InterSwapConflict {
    rejected_swap_id:  string;
    reason:            string;
    winner_swap_id:    string;
}

export interface ConflictResolutionResult {
    clean:      SwapRequest[];
    conflicted: InterSwapConflict[];
}

// =============================================================================
// INTERNAL: SIMULATION
// Represents the FINAL state for both parties after the swap.
// =============================================================================

export interface SwapSimulation {
    swap_id:      string;
    request:      SwapRequest;
    shift_x:      V8OrchestratorShift;    // the shift A gives away (B receives)
    shift_y:      V8OrchestratorShift;    // the shift B gives away (A receives)
    a_new_shifts: V8OrchestratorShift[];  // A's schedule after: remove shift_X, add shift_Y
    b_new_shifts: V8OrchestratorShift[];  // B's schedule after: remove shift_Y, add shift_X
}

// =============================================================================
// INTERNAL: PER-SWAP COMPLIANCE RESULT
// =============================================================================

export interface SwapComplianceResult {
    swap_id:         string;
    result_a:        V8OrchestratorResult;
    result_b:        V8OrchestratorResult;
    /** Worst of result_a.status and result_b.status */
    combined_status: V8Status;
}

// =============================================================================
// OUTPUT
// =============================================================================

export interface ApprovedSwap {
    swap_id:              string;
    employee_a_id:        V8EmpId;
    employee_b_id:        V8EmpId;
    shift_x_id:           V8ShiftId;
    shift_y_id:           V8ShiftId;
    compliance_status_a:  V8Status;
    compliance_status_b:  V8Status;
    /** Combined worst-case compliance status */
    compliance_status:    V8Status;
    /**
     * Original SwapRequest.priority (1–100, higher = more important).
     * Preserved so the final validator can demote lowest-priority swaps
     * first when combined-state violations require it.
     */
    original_priority:    number;
}

export interface RejectedSwap {
    swap_id:     string;
    reason:      string;
    rule_hits_a: V8Hit[];
    rule_hits_b: V8Hit[];
}

export interface SwapFinalStateSummary {
    total_swaps:        number;
    approved_count:     number;
    rejected_count:     number;
    affected_employees: V8EmpId[];
    affected_shifts:    V8ShiftId[];
    /** true when final-validation found no BLOCKING violations */
    compliance_clean:   boolean;
}

export interface SwapResult {
    approved_swaps:     ApprovedSwap[];
    rejected_swaps:     RejectedSwap[];
    final_state_summary: SwapFinalStateSummary;
    evaluation_time_ms: number;
    /** Populated when config.auto_apply = true */
    batch_result?:      BatchResult;
}
