/**
 * Bidding Engine — Composite Scorer
 *
 * Assigns a composite_score [0, 100] to each evaluated bid.
 *
 * Score formula (weighted sum):
 *
 *   score = (
 *       compliance_score * compliance_weight    ← PASS=1.0, WARNING=0.5, BLOCKING=0.0
 *     + priority_score   * priority_weight      ← bid.priority_score / 100 (default 0.5)
 *     + fairness_score   * fairness_weight      ← penalise bulk-bidders
 *     + recency_score    * recency_weight       ← earlier bid_time = higher score
 *   ) * 100
 *
 * Fairness score:
 *   Employees who submitted fewer bids (relative to total bids in the round)
 *   receive a fairness bonus. Normalised to [0, 1]:
 *
 *     fairness_score = 1 - (emp_bid_count - min_count) / max(1, max_count - min_count)
 *
 *   Where emp_bid_count = number of bids this employee submitted.
 *   min_count and max_count are the min/max across all employees.
 *   An employee who bid on only 1 shift gets score 1.0;
 *   the most prolific bidder gets 0.0.
 *
 * Recency score:
 *   First-come-first-served tiebreaker.
 *   Earliest bid_time → recency_score = 1.0; latest → 0.0.
 *   bid_time is parsed via Date.parse() so both ISO8601 and
 *   'YYYY-MM-DD HH:mm' formats work.
 *
 * Design:
 *   Scoring is purely deterministic given the same input set.
 *   The scorer does NOT have side effects.
 */

import type { EvaluatedBid, BiddingConfig } from './types';
import type { EmpId } from '../types';

// =============================================================================
// SCORE COMPONENTS
// =============================================================================

function complianceScore(status: EvaluatedBid['compliance_status']): number {
    switch (status) {
        case 'PASS':     return 1.0;
        case 'WARNING':  return 0.5;
        case 'BLOCKING': return 0.0;
    }
}

// =============================================================================
// PRE-COMPUTE NORMALIZATION CONSTANTS
// =============================================================================

interface ScoringContext {
    /** employee_id → number of bids they submitted */
    bid_count_by_emp:  Map<EmpId, number>;
    min_bid_count:     number;
    max_bid_count:     number;
    /** earliest bid_time as ms */
    min_bid_time_ms:   number;
    /** latest bid_time as ms */
    max_bid_time_ms:   number;
}

function buildScoringContext(bids: EvaluatedBid[]): ScoringContext {
    const bid_count_by_emp = new Map<EmpId, number>();
    let min_bid_time_ms = Infinity;
    let max_bid_time_ms = -Infinity;

    for (const eb of bids) {
        const eid = eb.bid.employee_id;
        bid_count_by_emp.set(eid, (bid_count_by_emp.get(eid) ?? 0) + 1);

        const t = Date.parse(eb.bid.bid_time);
        if (isFinite(t)) {
            if (t < min_bid_time_ms) min_bid_time_ms = t;
            if (t > max_bid_time_ms) max_bid_time_ms = t;
        }
    }

    const counts      = [...bid_count_by_emp.values()];
    const min_count   = counts.length > 0 ? Math.min(...counts) : 1;
    const max_count   = counts.length > 0 ? Math.max(...counts) : 1;

    return {
        bid_count_by_emp,
        min_bid_count: min_count,
        max_bid_count: max_count,
        min_bid_time_ms: isFinite(min_bid_time_ms) ? min_bid_time_ms : 0,
        max_bid_time_ms: isFinite(max_bid_time_ms) ? max_bid_time_ms : 0,
    };
}

// =============================================================================
// PER-BID SCORE
// =============================================================================

function scoreBid(
    eb:      EvaluatedBid,
    ctx:     ScoringContext,
    config:  BiddingConfig,
): number {
    // 1. Compliance
    const cs = complianceScore(eb.compliance_status);

    // 2. Priority (0–100 → 0–1)
    const ps = (eb.bid.priority_score ?? 50) / 100;

    // 3. Fairness: fewer bids submitted = higher fairness score
    const emp_count = ctx.bid_count_by_emp.get(eb.bid.employee_id) ?? 1;
    const count_range = Math.max(1, ctx.max_bid_count - ctx.min_bid_count);
    const fs = 1 - (emp_count - ctx.min_bid_count) / count_range;

    // 4. Recency: earlier bid_time = higher score
    const bid_time_ms = Date.parse(eb.bid.bid_time);
    const time_range  = Math.max(1, ctx.max_bid_time_ms - ctx.min_bid_time_ms);
    const rs = isFinite(bid_time_ms)
        ? 1 - (bid_time_ms - ctx.min_bid_time_ms) / time_range
        : 0.5;    // fallback for unparseable dates

    return (
        cs * config.compliance_weight +
        ps * config.priority_weight   +
        fs * config.fairness_weight   +
        rs * config.recency_weight
    ) * 100;
}

// =============================================================================
// MAIN SCORER
// =============================================================================

/**
 * Assigns composite_score to every EvaluatedBid in-place.
 * Returns the same array (mutated) for chaining convenience.
 */
export function scoreAllBids(
    evaluated: EvaluatedBid[],
    config:    BiddingConfig,
): EvaluatedBid[] {
    const ctx = buildScoringContext(evaluated);

    for (const eb of evaluated) {
        eb.composite_score = Math.round(scoreBid(eb, ctx, config) * 100) / 100;
    }

    return evaluated;
}
