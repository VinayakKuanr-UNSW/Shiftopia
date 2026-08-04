/**
 * Conflict Resolver — Operation Scorer
 *
 * Assigns a composite_score to each operation and runs a standalone
 * (per-operation, no other ops) compliance evaluation to produce a
 * pre_compliance_status.
 *
 * Composite score formula:
 *
 *   base =
 *       (op.score ?? priority / 100) * priority_weight    ← caller's score or priority
 *     + compliance_component           * compliance_weight  ← PASS=1, WARNING=0.5, BLOCKING=0
 *     + (business_weight / 100)        * biz_weight         ← optional caller weight
 *
 *   composite_score = base * 100   (range: 0–100)
 *
 * Pre-compliance status:
 *   For each operation, we simulate ONLY its own schedule_changes against
 *   the employee's existing schedule (ignoring all other operations).
 *   This tells us the "standalone compliance quality" of the operation
 *   and contributes to the compliance component of the score.
 *
 *   BLOCKING standalone compliance → compliance_component = 0
 *   Operations that are BLOCKING standalone still participate — they may
 *   be the only option for a shift. Their low score naturally de-prioritises
 *   them in the greedy ordering.
 *
 * Performance:
 *   O(ops × employees_per_op × rules).
 *   For 1000 ops with 1-2 employees each: ~2000 compliance evaluations.
 *   The engine's LRU cache absorbs repeated (employee, shifts) pairs.
 */

import type {
    ConflictOperation,
    ScoredOperation,
    ConflictResolverConfig,
} from './types';
import type {
    V8EmpId, V8ShiftId, V8OrchestratorShift, V8EmployeeContext, V8OrchestratorInput, V8Status,
} from '../types';
import { runV8Orchestrator } from '../index';

/**
 * Denial-rate debt at which the F3 preference-equity bonus saturates.
 *
 * 0.25 = losing a quarter more of your bids than the org average, which is a
 * strong equity claim. Named because the metric is a rate in [0,1] and any
 * threshold expressed as a raw count would silently neutralise the term.
 */
const DENIAL_RATE_FULL_CLAIM = 0.25;

// =============================================================================
// STANDALONE COMPLIANCE CHECK
// =============================================================================

/**
 * Runs compliance for each employee affected by the operation
 * INDEPENDENTLY of all other operations. Returns the worst-case status.
 */
function standaloneComplianceStatus(
    op:                   ConflictOperation,
    shift_catalog:        Map<V8ShiftId, V8OrchestratorShift>,
    employee_catalog:     Map<V8EmpId, V8EmployeeContext>,
    existing_shifts_map:  Map<V8EmpId, V8OrchestratorShift[]>,
    config:               ConflictResolverConfig,
): V8Status {
    const rank = (s: V8Status) => s === 'BLOCKING' ? 2 : s === 'WARNING' ? 1 : 0;
    let worst: V8Status = 'PASS';

    for (const change of op.schedule_changes) {
        const employee_context = employee_catalog.get(change.employee_id);
        if (!employee_context) continue;

        const existing_shifts = existing_shifts_map.get(change.employee_id) ?? [];

        const add_shifts    = change.add_shift_ids
            .map(id => shift_catalog.get(id))
            .filter((s): s is V8OrchestratorShift => s !== undefined);
        const remove_shifts = change.remove_shift_ids;

        if (add_shifts.length === 0 && remove_shifts.length === 0) continue;

        const input: V8OrchestratorInput = {
            employee_id:       change.employee_id,
            employee_context,
            existing_shifts,
            candidate_changes: { add_shifts, remove_shifts },
            mode:              'SIMULATED',
            operation_type:    op.type === 'SWAP_APPROVE' ? 'SWAP'
                               : op.type === 'BID_ACCEPT'  ? 'BID'
                               : 'ASSIGN',
            stage:             config.compliance_stage,
            config:            config.compliance_config,
        };

        const result = runV8Orchestrator(input, { stage: config.compliance_stage });
        if (rank(result.overall_status) > rank(worst)) worst = result.overall_status;
    }

    return worst;
}

// =============================================================================
// SCORE COMPUTATION
// =============================================================================

function complianceComponent(status: V8Status): number {
    switch (status) {
        case 'PASS':     return 1.0;
        case 'WARNING':  return 0.5;
        case 'BLOCKING': return 0.0;
    }
}

// =============================================================================
// MAIN SCORER
// =============================================================================

export function scoreOperations(
    operations:           ConflictOperation[],
    shift_catalog:        Map<V8ShiftId, V8OrchestratorShift>,
    employee_catalog:     Map<V8EmpId, V8EmployeeContext>,
    existing_shifts_map:  Map<V8EmpId, V8OrchestratorShift[]>,
    config:               ConflictResolverConfig,
    employee_hours_28d?:  Map<V8EmpId, number>,
    fairness_debts?:      Map<V8EmpId, Record<string, number>>,
): ScoredOperation[] {
    return operations.map(op => {
        const pre_compliance_status = standaloneComplianceStatus(
            op, shift_catalog, employee_catalog, existing_shifts_map, config,
        );

        // Normalise the caller's score or priority into [0, 1]
        const priority_component = op.score !== undefined
            ? Math.min(1, op.score / 100)
            : op.priority / 100;

        const comp_component = complianceComponent(pre_compliance_status);
        const biz_component  = (op.business_weight ?? 0) / 100;

        let composite_score = Math.round((
            priority_component * config.priority_weight  +
            comp_component     * config.compliance_weight +
            biz_component      * config.business_weight
        ) * 10_000) / 100;    // two decimal places, range [0, 100]

        // ── System-level fairness adjustment ─────────────────────────────────
        //
        // Every term below is aggregated across the operation's changes FIRST
        // and applied ONCE (audit F-17). They used to mutate `composite_score`
        // inside a `for (const change of ...)` loop, so an operation touching
        // three employees applied the penalty three times — which systematically
        // favoured smaller operations in the greedy ordering and made the score
        // depend on the order of `schedule_changes`. Exactly the operations this
        // resolver exists to arbitrate (multi-employee swaps and batch
        // assignments) were the ones scored on a different scale.
        if (config.fairness_weight > 0 && (employee_hours_28d || fairness_debts)) {
            let max_over_ceiling = 0;   // how far PAST contract, not total load
            let max_positive_debt = 0;  // worst over-share among affected employees
            let max_denied_prefs = 0;   // best owed-preference claim

            for (const change of op.schedule_changes) {
                // Only penalise when we're adding shifts (not removals-only ops)
                if (change.add_shift_ids.length === 0) continue;

                if (employee_hours_28d) {
                    const ctx = employee_catalog.get(change.employee_id);
                    // Contracted 28-day hours (casual has 0 — skip to avoid ÷0)
                    const ceiling_28d = (ctx?.contracted_weekly_hours ?? 0) * 4;
                    if (ceiling_28d > 0) {
                        const current_hours = employee_hours_28d.get(change.employee_id) ?? 0;
                        // EXCESS over the ceiling, not the raw load ratio
                        // (audit F-16). The old `Math.min(1, current/ceiling)`
                        // penalised an employee at 50% of contract by half the
                        // maximum, and — because it clamped at 1 — scored 100%
                        // and 300% of contract identically, going flat exactly
                        // where over-work starts to matter.
                        max_over_ceiling = Math.max(max_over_ceiling, current_hours / ceiling_28d - 1);
                    }
                }

                const debts = fairness_debts?.get(change.employee_id);
                if (debts) {
                    // `denial_rate` is excluded from the burden sum: it is a
                    // rate in [0,1] while every other metric is a count or a
                    // duration, so adding it in would be a category error.
                    const positive = Object.entries(debts)
                        .filter(([k]) => k !== 'denial_rate')
                        .reduce((a, [, v]) => a + Math.max(0, v as number), 0);
                    max_positive_debt = Math.max(max_positive_debt, positive);

                    if (op.type === 'BID_ACCEPT') {
                        max_denied_prefs = Math.max(max_denied_prefs, debts.denial_rate ?? 0);
                    }
                }
            }

            // Over-ceiling load. Unclamped at the top so 300% of contract really
            // is worse than 110%; the ×0.5 keeps a 2×-over operation at roughly
            // the old full-weight magnitude.
            const overCeilingPenalty = Math.max(0, max_over_ceiling) * 0.5 * config.fairness_weight * 100;

            // F1 longitudinal ledger. 5 units of positive debt = full penalty.
            const ledgerPenalty = Math.min(1, max_positive_debt / 5) * config.fairness_weight * 50;

            // F3 preference equity — an employee repeatedly denied gets a boost
            // when the operation would finally satisfy a preference.
            //
            // Saturates at DENIAL_RATE_FULL_CLAIM, not at 5: the metric is now
            // a RATE debt, not a denial count (stakeholder decision Q5). Left
            // at /5 it would have divided a typical ±0.3 debt down to ~0.06 and
            // quietly zeroed this bonus — the metric would still be read, and
            // still be meaningless.
            const prefBonus = Math.min(1, max_denied_prefs / DENIAL_RATE_FULL_CLAIM)
                * config.fairness_weight * 50;

            // Single clamped application, so the bonus can no longer resurrect a
            // score the penalties had already floored at 0 (the old ordering
            // clamped penalties to 0 and THEN added the bonus back on top).
            composite_score = Math.max(
                0,
                Math.min(100, composite_score - overCeilingPenalty - ledgerPenalty + prefBonus),
            );
        }

        return { op, composite_score, pre_compliance_status };
    });
}
