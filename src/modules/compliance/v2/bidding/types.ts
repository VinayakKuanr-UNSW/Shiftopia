/**
 * Bidding Engine — Core Types
 *
 * Sits on top of the Compliance Engine (v2) and Batch Executor.
 *
 * Pipeline:
 *   BiddingInput
 *     → Evaluator        (per-bid compliance simulation, no rejection)
 *     → Scorer           (composite score: compliance + priority + fairness + recency)
 *     → ConflictGraph    (per-employee structural conflict groups)
 *     → SelectionEngine  (greedy global selection with replacement)
 *     → Validator        (final safety pass on committed set)
 *     → [BatchExecutor]  (optional auto-assign via executeBatch)
 *     → BiddingResult
 */

import type {
    ShiftV2,
    ShiftId,
    EmpId,
    EmployeeContextV2,
    RuleHitV2,
    FinalStatus,
    Stage,
    ComplianceConfigV2,
} from '../types';
import type { BatchResult } from '../batch/types';

// =============================================================================
// INPUT
// =============================================================================

export interface Bid {
    bid_id:          string;
    shift_id:        ShiftId;
    employee_id:     EmpId;
    /** ISO8601 or YYYY-MM-DD HH:mm — used for recency scoring */
    bid_time:        string;
    /** 0–100 caller-supplied priority. If absent, treated as 50. */
    priority_score?: number;
}

export interface BiddingInput {
    shifts:                   ShiftV2[];
    bids:                     Bid[];
    employee_contexts:        EmployeeContextV2[];
    /** Each employee's already-assigned shifts (before this bid round) */
    employee_existing_shifts: { employee_id: EmpId; shifts: ShiftV2[] }[];
    config?:                  Partial<BiddingConfig>;
}

// =============================================================================
// CONFIG
// =============================================================================

export interface BiddingConfig {
    /**
     * Selection strategy.
     * GREEDY — sort by score, accept in order, skip conflicts.
     */
    strategy:           'GREEDY';

    /** Compliance stage forwarded to the compliance engine. Default: 'DRAFT' */
    compliance_stage:   Stage;

    /**
     * When true (default), bids with final compliance status WARNING are
     * accepted. When false, only PASS bids are selected.
     */
    accept_warnings:    boolean;

    // ── Scoring weights (should sum to 1.0) ─────────────────────────────────
    /** Weight of the compliance score component (0–1). Default: 0.40 */
    compliance_weight:  number;
    /** Weight of the priority_score component (0–1). Default: 0.30 */
    priority_weight:    number;
    /**
     * Weight of the fairness score component (0–1). Default: 0.20
     * Fairness penalises employees who submitted many bids relative to others,
     * and dynamically penalises employees who have already won shifts.
     */
    fairness_weight:    number;
    /** Weight of the recency (first-come-first-served) component. Default: 0.10 */
    recency_weight:     number;

    /**
     * When true, after selection, convert selected bids to BatchOperation[]
     * and call executeBatch() to produce a BatchResult in the output.
     */
    auto_assign:        boolean;

    compliance_config?: Partial<ComplianceConfigV2>;
}

export const DEFAULT_BIDDING_CONFIG: BiddingConfig = {
    strategy:           'GREEDY',
    compliance_stage:   'DRAFT',
    accept_warnings:    true,
    compliance_weight:  0.40,
    priority_weight:    0.30,
    fairness_weight:    0.20,
    recency_weight:     0.10,
    auto_assign:        false,
};

// =============================================================================
// INTERNAL: EVALUATED BID
// After per-bid compliance simulation (no rejection at this stage).
// =============================================================================

export interface EvaluatedBid {
    bid:                Bid;
    shift:              ShiftV2;
    employee_context:   EmployeeContextV2;
    /** Result of compliance simulation against ONLY the employee's existing schedule. */
    compliance_status:  FinalStatus;
    rule_hits:          RuleHitV2[];
    /** Composite score — higher = preferred. Computed by scorer. */
    composite_score:    number;
}

// =============================================================================
// INTERNAL: CONFLICT GRAPH
// Lightweight structural conflicts (time overlap, rest gap) per employee.
// Does NOT replace the compliance check during selection — it's a fast
// structural index for reporting and optional pre-filtering.
// =============================================================================

export type BidConflictKind = 'TIME_OVERLAP' | 'REST_GAP';

export interface BidConflictEdge {
    bid_id_a:      string;
    bid_id_b:      string;
    kind:          BidConflictKind;
    reason:        string;
}

export interface EmployeeBidConflictGroup {
    employee_id:   EmpId;
    group_id:      string;
    /** Bids that are mutually exclusive — at most one can be selected */
    bid_ids:       string[];
    edges:         BidConflictEdge[];
}

// =============================================================================
// OUTPUT
// =============================================================================

export interface SelectedBid {
    shift_id:           ShiftId;
    bid_id:             string;
    employee_id:        EmpId;
    /** Compliance status AFTER selection (against tentative full schedule) */
    compliance_status:  FinalStatus;
}

export interface RejectedBid {
    bid_id:     string;
    reason:     string;
    rule_hits:  RuleHitV2[];
}

export interface BiddingEvaluationSummary {
    total_bids:                  number;
    evaluated_bids:              number;
    selected_count:              number;
    rejected_count:              number;
    unfilled_shift_count:        number;
    pre_eval_pass_count:         number;    // bids whose standalone compliance was PASS
    pre_eval_warning_count:      number;    // bids whose standalone compliance was WARNING
    pre_eval_blocking_count:     number;    // bids whose standalone compliance was BLOCKING
}

export interface BiddingResult {
    selected_bids:      SelectedBid[];
    rejected_bids:      RejectedBid[];
    unfilled_shifts:    ShiftId[];
    summary:            BiddingEvaluationSummary;
    evaluation_time_ms: number;
    /** Populated only when config.auto_assign = true */
    batch_result?:      BatchResult;
}
