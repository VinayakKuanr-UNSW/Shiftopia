/**
 * Batch Executor — Conflict Resolver
 *
 * Four resolution strategies:
 *
 *   GREEDY (default)
 *     Sort all operations by priority (desc) + timestamp (asc).
 *     Iterate; mark an op REJECTED if it conflicts with any already-accepted op.
 *     O(n²) in worst case but n is bounded by batch size.
 *
 *   REPLACEMENT (BID_ACCEPT only)
 *     Before rejecting a BID_ACCEPT op, try its fallback_employee_ids in order.
 *     The first fallback that passes compliance check is substituted.
 *     Falls back to GREEDY rejection if no fallback works.
 *
 *   ISOLATION (SWAP_APPROVE only)
 *     If a SWAP_APPROVE is in conflict, drop the entire swap atomically
 *     (never apply half a swap). For non-swap ops, delegate to GREEDY.
 *
 *   SOLVER (greedy max-weight independent set approximation)
 *     Model operations as a graph where conflict edges exist between ops.
 *     Assign weight = priority × (1 / timestamp_rank).
 *     Greedy: always pick the highest-weight unblocked op, mark its
 *     conflict-neighbours as rejected.
 *     Approximates optimal but remains O(n² log n).
 *
 * All strategies return a ConflictResolutionResult:
 *   - committed_ops  — operations that can proceed
 *   - rejected_ops   — operations that were dropped + why
 *   - modified_ops   — operations that were changed (REPLACEMENT only)
 */

import type {
    BatchOperation,
    BatchConflict,
    ConflictDetectionResult,
    ConflictResolutionResult,
    RejectedBatchOperation,
    ModifiedBatchOperation,
    BatchConfig,
    BidAcceptPayload,
} from './types';

// =============================================================================
// HELPERS
// =============================================================================

function compareByPriorityDesc(a: BatchOperation, b: BatchOperation): number {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0;
}

function buildRejectedOp(
    op:       BatchOperation,
    conflict: BatchConflict,
    reason:   string,
): RejectedBatchOperation {
    return {
        operation_id:              op.operation_id,
        reason,
        conflict_type:             conflict.type,
        rule_hits:                 conflict.rule_hits,
        conflicting_operation_ids: conflict.operation_ids.filter(id => id !== op.operation_id),
    };
}

/** Collect all conflicts that involve a given operation */
function conflictsFor(
    opId:         string,
    conflict_map: Map<string, BatchConflict[]>,
): BatchConflict[] {
    return conflict_map.get(opId) ?? [];
}

// =============================================================================
// STRATEGY A — GREEDY
// =============================================================================

function resolveGreedy(
    ops:        BatchOperation[],
    detection:  ConflictDetectionResult,
    log:        string[],
): ConflictResolutionResult {
    const sorted = [...ops].sort(compareByPriorityDesc);
    const accepted   = new Set<string>();
    const rejectedSet = new Set<string>();
    const rejected_ops: RejectedBatchOperation[] = [];

    for (const op of sorted) {
        if (rejectedSet.has(op.operation_id)) continue;

        const conflicts = conflictsFor(op.operation_id, detection.conflict_map);

        // Check if any accepted op conflicts with this one
        const blocker = conflicts.find(c =>
            c.operation_ids.some(id => id !== op.operation_id && accepted.has(id)),
        );

        if (blocker) {
            rejectedSet.add(op.operation_id);
            rejected_ops.push(buildRejectedOp(op, blocker, `Conflict with accepted operation: ${blocker.description}`));
            log.push(`[GREEDY] Rejected op ${op.operation_id}: ${blocker.type}`);
        } else {
            accepted.add(op.operation_id);
        }
    }

    return {
        committed_ops:  ops.filter(op => accepted.has(op.operation_id)),
        rejected_ops,
        modified_ops:   [],
        resolution_log: log,
    };
}

// =============================================================================
// STRATEGY B — REPLACEMENT (BID_ACCEPT fallbacks)
// =============================================================================

function resolveReplacement(
    ops:       BatchOperation[],
    detection: ConflictDetectionResult,
    log:       string[],
): ConflictResolutionResult {
    const sorted = [...ops].sort(compareByPriorityDesc);
    const accepted    = new Set<string>();
    const rejectedSet = new Set<string>();
    const rejected_ops:  RejectedBatchOperation[]  = [];
    const modified_ops:  ModifiedBatchOperation[]  = [];

    for (const op of sorted) {
        if (rejectedSet.has(op.operation_id)) continue;

        const conflicts = conflictsFor(op.operation_id, detection.conflict_map);
        const blocker   = conflicts.find(c =>
            c.operation_ids.some(id => id !== op.operation_id && accepted.has(id)),
        );

        if (!blocker) {
            accepted.add(op.operation_id);
            continue;
        }

        // Attempt replacement only for BID_ACCEPT
        if (op.type === 'BID_ACCEPT') {
            const p = op.payload as BidAcceptPayload;
            const fallbacks = p.fallback_employee_ids ?? [];

            let replaced = false;
            for (const fallbackV8EmpId of fallbacks) {
                // Build a modified op with the fallback employee
                const modifiedPayload: BidAcceptPayload = {
                    ...p,
                    winning_employee_id: fallbackV8EmpId,
                    fallback_employee_ids: fallbacks.filter(f => f !== fallbackV8EmpId),
                };
                // Check if this fallback is conflict-free (simplified: no RESOURCE_CONTENTION
                // for the same shift — TIME_OVERLAP still needs a compliance check which
                // happens in the next execution pass)
                const shiftConflicts = conflicts.filter(c =>
                    c.type === 'RESOURCE_CONTENTION' &&
                    c.operation_ids.some(id => id !== op.operation_id && accepted.has(id)),
                );

                if (shiftConflicts.length === 0) {
                    // No remaining contention — accept with modification
                    const originalPayload = op.payload;
                    Object.assign(op, { payload: modifiedPayload });

                    modified_ops.push({
                        operation_id:        op.operation_id,
                        modification_type:   'BIDDER_REPLACED',
                        original_payload:    originalPayload,
                        modified_payload:    modifiedPayload,
                        modification_reason: `Original winner conflicted; replaced with fallback ${fallbackV8EmpId}`,
                    });
                    accepted.add(op.operation_id);
                    log.push(`[REPLACEMENT] Modified op ${op.operation_id}: winner → ${fallbackV8EmpId}`);
                    replaced = true;
                    break;
                }
            }

            if (!replaced) {
                rejectedSet.add(op.operation_id);
                rejected_ops.push(buildRejectedOp(op, blocker, `BID_ACCEPT conflict — no viable fallback: ${blocker.description}`));
                log.push(`[REPLACEMENT] Rejected op ${op.operation_id}: no fallback available`);
            }
        } else {
            rejectedSet.add(op.operation_id);
            rejected_ops.push(buildRejectedOp(op, blocker, `Conflict with accepted operation: ${blocker.description}`));
            log.push(`[REPLACEMENT] Rejected op ${op.operation_id}: ${blocker.type}`);
        }
    }

    return {
        committed_ops:  ops.filter(op => accepted.has(op.operation_id)),
        rejected_ops,
        modified_ops,
        resolution_log: log,
    };
}

// =============================================================================
// STRATEGY C — ISOLATION (SWAP_APPROVE isolation)
// =============================================================================

function resolveIsolation(
    ops:       BatchOperation[],
    detection: ConflictDetectionResult,
    log:       string[],
): ConflictResolutionResult {
    const sorted = [...ops].sort(compareByPriorityDesc);
    const accepted    = new Set<string>();
    const rejectedSet = new Set<string>();
    const rejected_ops: RejectedBatchOperation[] = [];

    for (const op of sorted) {
        if (rejectedSet.has(op.operation_id)) continue;

        const conflicts = conflictsFor(op.operation_id, detection.conflict_map);
        const blocker   = conflicts.find(c =>
            c.operation_ids.some(id => id !== op.operation_id && accepted.has(id)),
        );

        if (!blocker) {
            accepted.add(op.operation_id);
            continue;
        }

        if (op.type === 'SWAP_APPROVE') {
            // Isolation: drop the entire swap atomically (never partial swap)
            rejectedSet.add(op.operation_id);
            rejected_ops.push(buildRejectedOp(op, blocker, `Swap isolated — dropping entire swap to avoid partial state: ${blocker.description}`));
            log.push(`[ISOLATION] Isolated SWAP op ${op.operation_id}`);
        } else {
            rejectedSet.add(op.operation_id);
            rejected_ops.push(buildRejectedOp(op, blocker, `Conflict with accepted operation: ${blocker.description}`));
            log.push(`[ISOLATION] Rejected op ${op.operation_id}: ${blocker.type}`);
        }
    }

    return {
        committed_ops:  ops.filter(op => accepted.has(op.operation_id)),
        rejected_ops,
        modified_ops:   [],
        resolution_log: log,
    };
}

// =============================================================================
// STRATEGY D — SOLVER (greedy max-weight independent set)
// =============================================================================

function resolveSolver(
    ops:       BatchOperation[],
    detection: ConflictDetectionResult,
    log:       string[],
): ConflictResolutionResult {
    // Assign weight = priority (1–100). Timestamp rank as tie-breaker.
    // Build adjacency (conflict_map is already available)
    const n = ops.length;
    const opById = new Map(ops.map(op => [op.operation_id, op]));

    // Sort for timestamp rank (earlier = lower rank = higher weight tiebreaker)
    const ranked = [...ops].sort(compareByPriorityDesc);
    const weight  = new Map<string, number>();
    ranked.forEach((op, i) => {
        weight.set(op.operation_id, op.priority * 1000 - i);
    });

    const active    = new Set(ops.map(op => op.operation_id));
    const accepted  = new Set<string>();
    const rejected_ops: RejectedBatchOperation[] = [];

    while (active.size > 0) {
        // Pick highest-weight active node
        let best: BatchOperation | null = null;
        let bestW = -Infinity;
        for (const opId of active) {
            const w = weight.get(opId) ?? 0;
            if (w > bestW) { bestW = w; best = opById.get(opId)!; }
        }
        if (!best) break;

        accepted.add(best.operation_id);
        active.delete(best.operation_id);

        // Remove all conflict-neighbours from active set
        const conflicts = conflictsFor(best.operation_id, detection.conflict_map);
        for (const c of conflicts) {
            for (const neighbourId of c.operation_ids) {
                if (neighbourId === best.operation_id) continue;
                if (!active.has(neighbourId)) continue;
                active.delete(neighbourId);
                const neighbour = opById.get(neighbourId)!;
                rejected_ops.push(buildRejectedOp(
                    neighbour, c,
                    `[SOLVER] Excluded by max-weight independent set: ${c.description}`,
                ));
                log.push(`[SOLVER] Excluded op ${neighbourId} (weight ${weight.get(neighbourId)}) in favour of ${best.operation_id} (weight ${bestW})`);
            }
        }
    }

    return {
        committed_ops:  ops.filter(op => accepted.has(op.operation_id)),
        rejected_ops,
        modified_ops:   [],
        resolution_log: log,
    };
}

// =============================================================================
// DISPATCHER
// =============================================================================

export function resolveConflicts(
    ops:       BatchOperation[],
    detection: ConflictDetectionResult,
    config:    BatchConfig,
): ConflictResolutionResult {
    const log: string[] = [];

    // Ops that are blocked (cycles, simulation failures) are always rejected
    const hardBlocked = [...detection.blocked_operations].filter(id =>
        detection.conflicts.some(c =>
            c.operation_ids.includes(id) &&
            (c.type === 'DEPENDENCY_CYCLE' || c.type === 'LOGICAL_INCONSISTENCY'),
        ),
    );

    const hardBlockedSet = new Set(hardBlocked);
    const hardRejected: RejectedBatchOperation[] = [];

    for (const opId of hardBlockedSet) {
        const op = ops.find(o => o.operation_id === opId);
        if (!op) continue;
        const c = detection.conflict_map.get(opId)?.[0];
        if (!c) continue;
        hardRejected.push(buildRejectedOp(op, c, `Hard-blocked: ${c.type} — ${c.description}`));
        log.push(`[HARD] Blocked op ${opId}: ${c.type}`);
    }

    // Only attempt to resolve ops that are not hard-blocked
    const resolvable = ops.filter(op => !hardBlockedSet.has(op.operation_id));

    let strategyResult: ConflictResolutionResult;

    switch (config.resolution_strategy) {
        case 'REPLACEMENT': strategyResult = resolveReplacement(resolvable, detection, log); break;
        case 'ISOLATION':   strategyResult = resolveIsolation(resolvable, detection, log);   break;
        case 'SOLVER':      strategyResult = resolveSolver(resolvable, detection, log);      break;
        case 'GREEDY':
        default:            strategyResult = resolveGreedy(resolvable, detection, log);      break;
    }

    return {
        committed_ops:  strategyResult.committed_ops,
        rejected_ops:   [...hardRejected, ...strategyResult.rejected_ops],
        modified_ops:   strategyResult.modified_ops,
        resolution_log: log,
    };
}
