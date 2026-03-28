/**
 * Compliance Engine v2 — Incremental Evaluation Cache
 *
 * Design goals:
 *   - Avoid re-running rules when nothing relevant changed (drag-drop UX)
 *   - Identify WHICH rules are affected by a given set of changes
 *   - TTL-based invalidation (60 seconds default)
 *   - LRU eviction at capacity limit
 *
 * In production: replace Map backing store with Redis for multi-instance.
 */

import { ComplianceInputV2, CandidateChangesV2, ComplianceResultV2, EvaluationCacheEntryV2 } from './types';

// =============================================================================
// CACHE KEY  (FNV-1a, no external dependencies)
// =============================================================================

function fnv1a(str: string): string {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = (hash * 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/**
 * Builds a stable, order-independent cache key from ComplianceInputV2.
 *
 * Granularity: one key per (employee × shift-set × operation × stage × reference-day).
 * Shift arrays are sorted before hashing to ensure order-independence.
 */
export function buildCacheKey(input: ComplianceInputV2): string {
    const stable = JSON.stringify({
        emp:      input.employee_id,
        contract: input.employee_context.contract_type,
        op:       input.operation_type,
        stage:    input.stage ?? 'DRAFT',
        day:      input.evaluation_reference_date ?? new Date().toISOString().slice(0, 10),
        existing: input.existing_shifts.map(s => s.shift_id).sort().join(','),
        adds:     input.candidate_changes.add_shifts.map(s => s.shift_id).sort().join(','),
        removes:  [...input.candidate_changes.remove_shifts].sort().join(','),
    });
    return fnv1a(stable);
}

// =============================================================================
// AFFECTED RULES  (conservative: include rather than miss)
// =============================================================================

/**
 * Returns the rule IDs that MUST re-run given a set of candidate changes.
 * Rules NOT in this set can safely serve a cached result.
 *
 * Conservative: removes can only improve eligibility/break rules, so they skip those.
 * Adds always require a full re-check.
 */
export function getAffectedRules(changes: CandidateChangesV2): string[] {
    const rules = new Set<string>();

    const hasAdds    = changes.add_shifts.length > 0;
    const hasRemoves = changes.remove_shifts.length > 0;

    if (hasAdds || hasRemoves) {
        // Structural / window rules: always re-run if shift set changed
        rules.add('R01_NO_OVERLAP');
        rules.add('R07_REST_GAP');
        rules.add('R09_MAX_CONSECUTIVE_DAYS');
        rules.add('R04_MAX_WORKING_DAYS');
        rules.add('R06_ORD_HOURS_AVG');
        rules.add('R05_STUDENT_VISA');
        rules.add('R03_MAX_DAILY_HOURS');
    }

    if (hasAdds) {
        // New shifts only: eligibility rules only apply to incoming shifts
        rules.add('R02_MIN_SHIFT_LENGTH');
        rules.add('R08_MEAL_BREAK');
        rules.add('R10_ROLE_CONTRACT_MATCH');
        rules.add('R11_QUALIFICATIONS');
        rules.add('R12_QUAL_EXPIRY');
    }

    // Removals cannot create new eligibility violations — skip R02, R08, R10, R11, R12

    return [...rules];
}

// =============================================================================
// EVALUATION CACHE  (in-memory LRU with TTL)
// =============================================================================

export class EvaluationCache {
    private readonly store   = new Map<string, EvaluationCacheEntryV2>();
    private readonly MAX     = 1000;
    private readonly TTL_MS  = 60_000;    // 60 seconds

    get(key: string): ComplianceResultV2 | null {
        const entry = this.store.get(key);
        if (!entry) return null;

        if (Date.now() - entry.created_at > this.TTL_MS) {
            this.store.delete(key);
            return null;
        }

        // LRU: move to end on access
        this.store.delete(key);
        this.store.set(key, entry);
        return entry.result;
    }

    set(
        key:            string,
        result:         ComplianceResultV2,
        affected_rules: string[],
    ): void {
        if (this.store.size >= this.MAX) {
            // Evict oldest (first) entry
            const oldest = this.store.keys().next().value;
            if (oldest !== undefined) this.store.delete(oldest);
        }
        this.store.set(key, { key, result, affected_rules, created_at: Date.now() });
    }

    /** Invalidate all cached entries for a specific employee */
    invalidateEmployee(employee_id: string): void {
        for (const [key, entry] of this.store) {
            if (entry.result.rule_hits.length > 0) {
                // Keys encode employee_id — just clear all to be safe
                void key;
                void entry;
            }
        }
        // Conservative: clear everything (cache is warm-only optimization)
        this.store.clear();
    }

    /** Clear the entire cache */
    clear(): void {
        this.store.clear();
    }

    get size(): number {
        return this.store.size;
    }
}

/** Module-level default cache instance */
export const defaultCache = new EvaluationCache();
