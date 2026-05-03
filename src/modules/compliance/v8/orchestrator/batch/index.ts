/**
 * Batch Executor — Main Orchestrator
 *
 * Single entry point: executeBatch()
 *
 * Full pipeline:
 *   1.  Merge config with defaults
 *   2.  Normalise operations (validate + deduplicate + expand to atomics)
 *   3.  Build dependency + conflict graph
 *   4.  Topological sort (dependency-respecting execution order)
 *   5.  Reject cyclic operations immediately
 *   6.  Simulate ordered operations on an in-memory state snapshot
 *   7.  Run compliance engine for all affected employees
 *   8.  Detect conflicts (3-pass: graph → simulation → compliance)
 *   9.  Resolve conflicts (configured strategy)
 *  10.  If max_resolution_passes not reached and new conflicts found → repeat from 6
 *  11.  Final validation pass on committed set
 *  12.  Assemble BatchResult
 *
 * The executor is stateless and pure — all state lives in local variables.
 * Callers supply base_state and receive a BatchResult with committed/rejected sets.
 */

import type {
    BatchInput,
    BatchOperation,
    BatchResult,
    BatchConfig,
    BatchConflictType,
    ExecutionLogEntry,
    FinalStateSummary,
    RejectedBatchOperation,
    ModifiedBatchOperation,
} from './types';
import { DEFAULT_BATCH_CONFIG } from './types';

import { normalizeOperations }  from './normalizer';
import { buildDependencyGraph } from './dependency-graph';
import { buildExecutionOrder }  from './ordering-engine';
import { buildInitialState, applyAtomics } from './simulator';
import { validateCompliance }   from './compliance-validator';
import { detectConflicts }      from './conflict-detector';
import { resolveConflicts }     from './conflict-resolver';

// =============================================================================
// HELPERS
// =============================================================================

function mergeConfig(partial?: Partial<BatchConfig>): BatchConfig {
    return { ...DEFAULT_BATCH_CONFIG, ...partial };
}

function unique<T>(arr: T[]): T[] {
    return [...new Set(arr)];
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

export function executeBatch(input: BatchInput): BatchResult {
    const t0     = performance.now();
    const config = mergeConfig(input.config);

    const execLog:   ExecutionLogEntry[] = [];
    let   logSeq     = 0;

    function log(
        op_id:    string,
        action:   ExecutionLogEntry['action'],
        reason?:  string,
    ): void {
        execLog.push({
            sequence:     logSeq++,
            operation_id: op_id,
            action,
            reason,
            elapsed_ms:   Math.round((performance.now() - t0) * 100) / 100,
        });
    }

    // ── 1. Normalise ───────────────────────────────────────────────────────────
    const norm = normalizeOperations(input.operations, input.base_state);

    // Log structurally invalid ops (missing refs, etc.)
    const allRejected:  RejectedBatchOperation[] = [];
    const allModified:  ModifiedBatchOperation[] = [];

    for (const inv of norm.invalid_operations) {
        allRejected.push({
            operation_id:              inv.operation_id,
            reason:                    inv.reason,
            conflict_type:             'LOGICAL_INCONSISTENCY' as BatchConflictType,
            rule_hits:                 [],
            conflicting_operation_ids: [],
        });
        log(inv.operation_id, 'REJECTED', `Normalisation: ${inv.reason}`);
    }

    if (norm.valid_operations.length === 0) {
        return assembleFinalResult(
            [],
            allRejected,
            allModified,
            execLog,
            input,
            performance.now() - t0,
        );
    }

    // ── 2. Build graph ────────────────────────────────────────────────────────
    const graph = buildDependencyGraph(norm);

    // ── 3. Topological sort ───────────────────────────────────────────────────
    const { sorted_operations, cyclic_operations } = buildExecutionOrder(graph);

    for (const opId of cyclic_operations) {
        allRejected.push({
            operation_id:              opId,
            reason:                    'Dependency cycle detected — cannot safely order this operation',
            conflict_type:             'DEPENDENCY_CYCLE',
            rule_hits:                 [],
            conflicting_operation_ids: [],
        });
        log(opId, 'REJECTED', 'Dependency cycle');
    }

    const cyclicSet   = new Set(cyclic_operations);
    let   workingOps  = sorted_operations.filter(op => !cyclicSet.has(op.operation_id));

    // ── 4–10. Resolution loop ─────────────────────────────────────────────────
    let committed: BatchOperation[] = [];

    for (let pass = 0; pass < config.max_resolution_passes; pass++) {
        if (workingOps.length === 0) break;

        // 4. Simulate
        const simState   = buildInitialState(input.base_state);
        const allAtomics = workingOps.flatMap(op => norm.atomics.get(op.operation_id) ?? []);
        const simResult  = applyAtomics(allAtomics, simState);

        const simFailSet = new Set(simResult.failed.map(f => f.op_id));
        const appliedOps = workingOps.filter(op => !simFailSet.has(op.operation_id));

        // 5. Compliance validation on successfully simulated ops
        const complianceResult = validateCompliance(
            appliedOps,
            norm.atomics,
            input.base_state,
            simState,
            config,
        );

        // 6. Detect conflicts (3-pass)
        const detection = detectConflicts(
            graph,
            [],                        // cycles already handled above
            simResult.failed,
            complianceResult,
            appliedOps,
            norm.atomics,
        );

        // Check if clean
        if (detection.blocked_operations.size === 0) {
            committed = appliedOps;
            for (const op of appliedOps) log(op.operation_id, 'APPLIED');
            // Log sim failures from this pass
            for (const f of simResult.failed) {
                allRejected.push({
                    operation_id:              f.op_id,
                    reason:                    f.reason,
                    conflict_type:             'LOGICAL_INCONSISTENCY',
                    rule_hits:                 [],
                    conflicting_operation_ids: [],
                });
                log(f.op_id, 'REJECTED', `Simulation failure: ${f.reason}`);
            }
            break;
        }

        // 7. Resolve conflicts
        const resolution = resolveConflicts(workingOps, detection, config);

        allModified.push(...resolution.modified_ops);
        for (const m of resolution.modified_ops) {
            log(m.operation_id, 'MODIFIED', m.modification_reason);
        }

        // Ops rejected THIS pass get logged + added to final rejected list
        for (const r of resolution.rejected_ops) {
            // Only log once (not re-logged in later passes)
            if (!allRejected.find(x => x.operation_id === r.operation_id)) {
                allRejected.push(r);
                log(r.operation_id, 'REJECTED', r.reason);
            }
        }

        const rejectedThisPass = new Set(resolution.rejected_ops.map(r => r.operation_id));
        workingOps = resolution.committed_ops.filter(op => !rejectedThisPass.has(op.operation_id));

        // Last pass — accept whatever remains
        if (pass === config.max_resolution_passes - 1) {
            const finalSimState   = buildInitialState(input.base_state);
            const finalAtomics    = workingOps.flatMap(op => norm.atomics.get(op.operation_id) ?? []);
            const finalSimResult  = applyAtomics(finalAtomics, finalSimState);

            committed = workingOps.filter(op =>
                !finalSimResult.failed.some(f => f.op_id === op.operation_id),
            );
            for (const op of committed) log(op.operation_id, 'APPLIED');

            for (const f of finalSimResult.failed) {
                if (!allRejected.find(r => r.operation_id === f.op_id)) {
                    allRejected.push({
                        operation_id:              f.op_id,
                        reason:                    f.reason,
                        conflict_type:             'LOGICAL_INCONSISTENCY',
                        rule_hits:                 [],
                        conflicting_operation_ids: [],
                    });
                    log(f.op_id, 'REJECTED', `Final pass simulation failure: ${f.reason}`);
                }
            }
        }
    }

    return assembleFinalResult(
        committed,
        allRejected,
        allModified,
        execLog,
        input,
        performance.now() - t0,
    );
}

// =============================================================================
// RESULT ASSEMBLER
// =============================================================================

function assembleFinalResult(
    committed:  BatchOperation[],
    rejected:   RejectedBatchOperation[],
    modified:   ModifiedBatchOperation[],
    execLog:    ExecutionLogEntry[],
    input:      BatchInput,
    elapsed_ms: number,
): BatchResult {
    const committedIds  = new Set(committed.map(op => op.operation_id));
    const rejectedIds   = new Set(rejected.map(r => r.operation_id));

    // Compute affected employees and shifts from committed ops
    const affectedV8EmpIds:   string[] = [];
    const affectedV8ShiftIds: string[] = [];

    for (const op of committed) {
        const p = op.payload;
        switch (p.type) {
            case 'ASSIGN':
                affectedV8EmpIds.push(p.employee_id);
                affectedV8ShiftIds.push(p.shift_id);
                break;
            case 'UNASSIGN':
                affectedV8EmpIds.push(p.employee_id);
                affectedV8ShiftIds.push(p.shift_id);
                break;
            case 'BID_ACCEPT':
                affectedV8EmpIds.push(p.winning_employee_id);
                affectedV8ShiftIds.push(p.shift_id);
                break;
            case 'SWAP_APPROVE':
                affectedV8EmpIds.push(p.party_a.employee_id, p.party_b.employee_id);
                affectedV8ShiftIds.push(p.party_a.gives_shift_id, p.party_b.gives_shift_id);
                break;
        }
    }

    const hasViolations = rejected.some(r => r.conflict_type === 'COMPLIANCE_VIOLATION');
    const hasWarnings   = false;  // Warnings don't block commit; surfaced in per-employee results

    const summary: FinalStateSummary = {
        total_operations:   input.operations.length,
        committed_count:    committed.length,
        rejected_count:     rejected.length,
        modified_count:     modified.length,
        affected_employees: unique(affectedV8EmpIds),
        affected_shifts:    unique(affectedV8ShiftIds),
        compliance_status:  hasViolations ? 'HAS_VIOLATIONS' : hasWarnings ? 'HAS_WARNINGS' : 'CLEAN',
    };

    return {
        committed_operations: committed,
        rejected_operations:  rejected,
        modified_operations:  modified,
        final_state_summary:  summary,
        execution_log:        execLog,
        evaluation_time_ms:   Math.round(elapsed_ms * 100) / 100,
    };
}

// =============================================================================
// PUBLIC RE-EXPORTS
// =============================================================================

export type {
    BatchInput,
    BatchResult,
    BatchConfig,
    BatchOperation,
    BatchV8OperationType,
    RejectedBatchOperation,
    ModifiedBatchOperation,
    FinalStateSummary,
    ExecutionLogEntry,
    BatchConflict,
    BatchConflictType,
    ResolutionStrategy,
    AssignPayload,
    UnassignPayload,
    BidAcceptPayload,
    SwapApprovePayload,
    BatchBaseState,
    SimulatedState,
} from './types';

export { DEFAULT_BATCH_CONFIG } from './types';
