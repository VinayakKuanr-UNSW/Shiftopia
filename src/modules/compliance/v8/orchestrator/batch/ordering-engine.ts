/**
 * Batch Executor — Ordering Engine
 *
 * Produces a topologically-sorted execution order for the valid operations.
 *
 * Algorithm: Kahn's (BFS-based) topological sort on the DEPENDENCY sub-graph.
 *   - Nodes with in-degree 0 are immediately ready.
 *   - Priority tiebreaker: higher priority number executed first.
 *     Within same priority, earlier timestamp wins.
 *   - CONFLICT edges are NOT used here — they are handled by the conflict resolver.
 *
 * Cycle detection:
 *   If a cycle exists in the dependency graph (should be rare / impossible
 *   for well-formed operations, but theoretically possible if the caller
 *   constructs contradictory deps), the cycle participants are returned in
 *   `cyclic_operations` and excluded from the sorted order.
 */

import type { BatchOperation, OperationGraph } from './types';

// =============================================================================
// OUTPUT
// =============================================================================

export interface OrderingResult {
    /** Operations in safe execution order (dependencies respected) */
    sorted_operations: BatchOperation[];
    /** Operation IDs that form or are blocked by a dependency cycle */
    cyclic_operations: string[];
}

// =============================================================================
// COMPARATOR
// =============================================================================

/** Priority-then-timestamp comparator (higher priority = earlier, earlier timestamp = earlier) */
function compareByPriority(a: BatchOperation, b: BatchOperation): number {
    if (b.priority !== a.priority) return b.priority - a.priority;    // higher priority first
    return a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0;
}

// =============================================================================
// KAHN'S ALGORITHM
// =============================================================================

export function buildExecutionOrder(graph: OperationGraph): OrderingResult {
    const { nodes, dependencies, dependents } = graph;

    // Copy in-degree counts (mutable during Kahn's)
    const inDegree = new Map<string, number>();
    for (const [opId] of nodes) {
        inDegree.set(opId, dependencies.get(opId)?.size ?? 0);
    }

    // Seed with zero-in-degree nodes
    let ready: BatchOperation[] = [];
    for (const [opId, deg] of inDegree) {
        if (deg === 0) {
            ready.push(nodes.get(opId)!);
        }
    }

    const sorted: BatchOperation[] = [];

    while (ready.length > 0) {
        // Pick highest-priority ready node
        ready.sort(compareByPriority);
        const current = ready.shift()!;
        sorted.push(current);

        // Decrement in-degree for all ops that depend on current
        const deps = dependents.get(current.operation_id) ?? new Set<string>();
        for (const nextId of deps) {
            const newDeg = (inDegree.get(nextId) ?? 1) - 1;
            inDegree.set(nextId, newDeg);
            if (newDeg === 0) {
                ready.push(nodes.get(nextId)!);
            }
        }
    }

    // Any node still with in-degree > 0 is in a cycle
    const cyclic: string[] = [];
    for (const [opId, deg] of inDegree) {
        if (deg > 0) cyclic.push(opId);
    }

    return {
        sorted_operations: sorted,
        cyclic_operations: cyclic,
    };
}
