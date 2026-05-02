/**
 * Demand Engine L3 — Rule engine types.
 *
 * Mirrors public.demand_rules (migration 20260502000012).
 * The rule DSL is implemented in ruleEvaluator.ts; this file is types-only.
 */

import type { FunctionCode } from '../api/supervisorFeedback.dto';

/** Variables available to a rule's `formula` expression. */
export interface RuleEvalContext {
    pax: number;
    room_count: number;
    total_sqm: number;
    duration_min: number;
    bump_in_min: number;
    bump_out_min: number;
    /** Slice index 0..47 (30-min grid, anchored at 00:00). */
    slice_idx: number;
    /**
     * Headcount currently planned at each level [L0..L7] in this slice.
     * Populated by the executor's pass-2 (level-dependent rules) AFTER pass-1
     * has computed level-independent headcounts. In pass-1 this is all zeros.
     */
    staff_at_levels: number[];
    /**
     * `true` while the executor is running pass-2. Rules whose formula depends
     * on staff_at_levels are flagged via depends_on_levels and only evaluated
     * in pass-2.
     */
    is_pass_two: boolean;
}

/** A single demand_rules row, typed. */
export interface DemandRuleRow {
    id: string;
    rule_code: string;
    function_code: FunctionCode;
    level: number;
    /**
     * JSON predicate over L1 features. Keys are EventFeature fields; values
     * are either a literal (===) or a comparator string like ">300" / ">=100"
     * / "<50" / "between:100,300" / "in:buffet,plated".
     * Empty object means the rule always applies.
     */
    applies_when: Record<string, unknown>;
    /** DSL expression — see ruleEvaluator.ts. */
    formula: string;
    priority: number;
    version: number;
    is_active: boolean;
    notes: string | null;
}

/** Output of the executor for one (slice, function, level) cell. */
export interface RuleBaselineCell {
    slice_idx: number;
    function_code: FunctionCode;
    level: number;
    headcount: number;
    /** Rule codes that contributed (in priority order). */
    contributing_rule_codes: string[];
    /** Per-rule explanation lines for the L7 explanation JSON. */
    explanation: string[];
}

/** Event-level features the executor reads from. */
export interface EventFeatureForRules {
    event_id: string;
    event_type: string | null;
    pax: number;
    start_iso: string;
    end_iso: string;
    duration_min: number;
    service_type: 'buffet' | 'plated' | 'cocktail' | 'none' | null;
    alcohol: boolean | null;
    room_count: number;
    total_sqm: number;
    bump_in_min: number;
    bump_out_min: number;
    layout_complexity: 'simple' | 'standard' | 'complex' | null;
    /** First active slice index (inclusive). Anchors slice loop. */
    first_slice_idx: number;
    /** Last active slice index (inclusive). */
    last_slice_idx: number;
}
