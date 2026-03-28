/**
 * Compliance Engine v2 — Aggregator
 *
 * Three responsibilities:
 *   1. deduplicateHits  — remove exact-duplicate (rule × shift-set) violations
 *   2. consolidateHits  — union-find grouping of hits sharing affected shifts
 *   3. deriveStatus     — PASS | WARNING | BLOCKING from hit set
 *   4. combineSwapResults — merge two per-employee results for swap operations
 */

import {
    RuleHitV2,
    ConsolidatedGroupV2,
    FinalStatus,
    Severity,
    ComplianceResultV2,
    ShiftId,
} from './types';
import { RULE_METADATA } from './rules/registry';

// =============================================================================
// DEDUPLICATION
// =============================================================================

/**
 * Removes exact-duplicate hits: same rule_id + same (sorted) affected_shifts set.
 * Prevents double-reporting when two code paths detect the same violation.
 */
export function deduplicateHits(hits: RuleHitV2[]): RuleHitV2[] {
    const seen = new Set<string>();
    return hits.filter(hit => {
        const key = `${hit.rule_id}:${[...hit.affected_shifts].sort().join(',')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// =============================================================================
// CONSOLIDATION  (union-find grouping by shared affected shifts)
// =============================================================================

/**
 * Groups rule hits into ConsolidatedGroups by shared affected shifts.
 * Uses union-find so hits that share ANY single shift end up in the same group.
 *
 * Result: instead of "3 separate violations for the same shift cluster",
 * the UI receives one group with a merged summary.
 */
export function consolidateHits(hits: RuleHitV2[]): ConsolidatedGroupV2[] {
    if (hits.length === 0) return [];

    // Union-find on hit indices
    const parent = hits.map((_, i) => i);

    function find(i: number): number {
        if (parent[i] !== i) parent[i] = find(parent[i]);
        return parent[i];
    }
    function union(i: number, j: number): void {
        parent[find(i)] = find(j);
    }

    // Map shift_id → list of hit indices that mention it
    const shiftToIndices = new Map<ShiftId, number[]>();
    hits.forEach((hit, i) => {
        for (const s of hit.affected_shifts) {
            if (!shiftToIndices.has(s)) shiftToIndices.set(s, []);
            shiftToIndices.get(s)!.push(i);
        }
    });

    // Union hits that share any affected shift
    for (const indices of shiftToIndices.values()) {
        for (let k = 1; k < indices.length; k++) {
            union(indices[0], indices[k]);
        }
    }

    // Collect groups by root
    const groupMap = new Map<number, RuleHitV2[]>();
    hits.forEach((hit, i) => {
        const root = find(i);
        if (!groupMap.has(root)) groupMap.set(root, []);
        groupMap.get(root)!.push(hit);
    });

    return Array.from(groupMap.values()).map((groupHits, idx) => {
        const allShifts  = [...new Set(groupHits.flatMap(h => h.affected_shifts))];
        const worst: Severity = groupHits.some(h => h.severity === 'BLOCKING') ? 'BLOCKING' : 'WARNING';
        const categories = [...new Set(
            groupHits.map(h => RULE_METADATA[h.rule_id]?.category ?? h.rule_id)
        )];

        const summary = groupHits.length === 1
            ? groupHits[0].message
            : `${groupHits.length} violations on ${allShifts.length} shift(s) — ${categories.join(' + ')} constraints exceeded`;

        return {
            group_id:        `GROUP-${String(idx + 1).padStart(2, '0')}`,
            summary,
            severity:        worst,
            hits:            groupHits,
            affected_shifts: allShifts,
        } satisfies ConsolidatedGroupV2;
    });
}

// =============================================================================
// STATUS DERIVATION
// =============================================================================

/**
 * Derives the final PASS | WARNING | BLOCKING status from a set of hits.
 * Any BLOCKING hit → BLOCKING; any WARNING → WARNING; else PASS.
 */
export function deriveStatus(hits: RuleHitV2[]): FinalStatus {
    if (hits.some(h => h.severity === 'BLOCKING')) return 'BLOCKING';
    if (hits.some(h => h.severity === 'WARNING'))  return 'WARNING';
    return 'PASS';
}

// =============================================================================
// SWAP SUPPORT
// =============================================================================

/**
 * Combines two per-employee ComplianceResultV2s for a swap operation.
 * The overall status is the worst of the two.
 */
export function combineSwapResults(
    result_a: ComplianceResultV2,
    result_b: ComplianceResultV2,
): { status: FinalStatus; per_employee: [ComplianceResultV2, ComplianceResultV2] } {
    const rank = (s: FinalStatus) => s === 'BLOCKING' ? 2 : s === 'WARNING' ? 1 : 0;

    const status: FinalStatus =
        rank(result_a.status) >= rank(result_b.status)
            ? result_a.status
            : result_b.status;

    return { status, per_employee: [result_a, result_b] };
}
