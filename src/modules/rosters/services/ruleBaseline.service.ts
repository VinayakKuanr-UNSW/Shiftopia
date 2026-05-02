/**
 * Demand Engine L3 — Baseline executor.
 *
 * Pure function from (event features, compiled rules) to baseline headcount
 * per (slice, function, level). Replaces the XGBoost runtime path of the
 * legacy demand engine with a deterministic, explainable rule evaluator.
 *
 * Two-pass evaluation:
 *   pass 1 — rules whose formula does NOT reference staff_at_levels[].
 *            Produces level-independent headcount per cell.
 *   pass 2 — rules that DO reference staff_at_levels[]. These are evaluated
 *            with the pass-1 totals already populated, so a supervisor-ratio
 *            rule like `ceil(staff_at_levels[1] / 8)` can read pass-1 output.
 *
 * Determinism: same inputs → byte-identical output. Rules are evaluated in
 * (priority asc, rule_code asc) order, so contributing_rule_codes is stable.
 */

import type {
    DemandRuleRow,
    EventFeatureForRules,
    RuleBaselineCell,
    RuleEvalContext,
} from '../domain/ruleEngine.types';
import { compileRule, evaluateRule, type CompiledRule } from '../domain/ruleEvaluator';
import { ruleApplies } from '../domain/ruleMatcher';
import type { FunctionCode } from '../api/supervisorFeedback.dto';

interface CellKey {
    slice_idx: number;
    function_code: FunctionCode;
    level: number;
}

const NUM_LEVELS = 8;

/** Compile a list of rules; bad formulae are surfaced in `errors`. */
export function compileRules(rules: readonly DemandRuleRow[]): {
    compiled: CompiledRule[];
    errors: Array<{ rule_code: string; message: string }>;
} {
    const compiled: CompiledRule[] = [];
    const errors: Array<{ rule_code: string; message: string }> = [];
    for (const r of rules) {
        try {
            compiled.push(compileRule(r));
        } catch (err) {
            errors.push({
                rule_code: r.rule_code,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return { compiled, errors };
}

export interface RuleBaselineResult {
    cells: RuleBaselineCell[];
    /** Rules that applied to this event but evaluated to 0 (kept for diagnostics). */
    zeroRules: string[];
    /** Rules that errored at runtime. */
    runtimeErrors: Array<{ rule_code: string; slice_idx: number; message: string }>;
}

/**
 * Run the full baseline pass for one event.
 *
 * @param feature  The event's L1 feature row.
 * @param rules    Active rules, already compiled.
 */
export function runBaseline(
    feature: EventFeatureForRules,
    rules: readonly CompiledRule[],
): RuleBaselineResult {
    const cellMap = new Map<string, RuleBaselineCell>();
    const zeroRules = new Set<string>();
    const runtimeErrors: RuleBaselineResult['runtimeErrors'] = [];

    // Group rules into pass-1 (level-independent) and pass-2 (level-dependent)
    const pass1: CompiledRule[] = [];
    const pass2: CompiledRule[] = [];
    for (const c of rules) {
        if (!c.rule.is_active) continue;
        if (!ruleApplies(c.rule.applies_when, feature)) continue;
        (c.dependsOnLevels ? pass2 : pass1).push(c);
    }

    const sliceStart = feature.first_slice_idx;
    const sliceEnd = feature.last_slice_idx;

    // ── Pass 1 — level-independent rules ────────────────────────────────
    for (let s = sliceStart; s <= sliceEnd; s++) {
        for (const c of pass1) {
            const ctx = makeCtx(feature, s, /*staff*/ new Array(NUM_LEVELS).fill(0), false);
            const value = safeEval(c, ctx, runtimeErrors, s);
            if (value > 0) {
                addToCell(cellMap, s, c, value);
            } else if (value === 0) {
                zeroRules.add(c.rule.rule_code);
            }
        }
    }

    // ── Pass 2 — level-dependent rules (e.g. supervisor ratios) ─────────
    if (pass2.length > 0) {
        for (let s = sliceStart; s <= sliceEnd; s++) {
            const staffAtLevels = readStaffAtLevels(cellMap, s);
            for (const c of pass2) {
                const ctx = makeCtx(feature, s, staffAtLevels, true);
                const value = safeEval(c, ctx, runtimeErrors, s);
                if (value > 0) {
                    addToCell(cellMap, s, c, value);
                } else if (value === 0) {
                    zeroRules.add(c.rule.rule_code);
                }
            }
        }
    }

    const cells = Array.from(cellMap.values()).sort((a, b) => {
        if (a.slice_idx !== b.slice_idx) return a.slice_idx - b.slice_idx;
        if (a.function_code !== b.function_code) return a.function_code.localeCompare(b.function_code);
        return a.level - b.level;
    });

    return { cells, zeroRules: Array.from(zeroRules), runtimeErrors };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCtx(
    feature: EventFeatureForRules,
    slice_idx: number,
    staff_at_levels: number[],
    is_pass_two: boolean,
): RuleEvalContext {
    return {
        pax: feature.pax,
        room_count: feature.room_count,
        total_sqm: feature.total_sqm,
        duration_min: feature.duration_min,
        bump_in_min: feature.bump_in_min,
        bump_out_min: feature.bump_out_min,
        slice_idx,
        staff_at_levels,
        is_pass_two,
    };
}

function safeEval(
    c: CompiledRule,
    ctx: RuleEvalContext,
    runtimeErrors: RuleBaselineResult['runtimeErrors'],
    slice_idx: number,
): number {
    try {
        return evaluateRule(c, ctx);
    } catch (err) {
        runtimeErrors.push({
            rule_code: c.rule.rule_code,
            slice_idx,
            message: err instanceof Error ? err.message : String(err),
        });
        return 0;
    }
}

function cellKey(slice_idx: number, function_code: FunctionCode, level: number): string {
    return `${slice_idx}|${function_code}|${level}`;
}

function addToCell(
    cellMap: Map<string, RuleBaselineCell>,
    slice_idx: number,
    c: CompiledRule,
    value: number,
): void {
    const key = cellKey(slice_idx, c.rule.function_code, c.rule.level);
    let cell = cellMap.get(key);
    if (!cell) {
        cell = {
            slice_idx,
            function_code: c.rule.function_code,
            level: c.rule.level,
            headcount: 0,
            contributing_rule_codes: [],
            explanation: [],
        };
        cellMap.set(key, cell);
    }
    cell.headcount += value;
    cell.contributing_rule_codes.push(c.rule.rule_code);
    cell.explanation.push(`rule:${c.rule.rule_code} +${value}`);
}

/** Sum headcount per level across all functions for a given slice. */
function readStaffAtLevels(
    cellMap: Map<string, RuleBaselineCell>,
    slice_idx: number,
): number[] {
    const out = new Array(NUM_LEVELS).fill(0);
    for (const cell of cellMap.values()) {
        if (cell.slice_idx !== slice_idx) continue;
        if (cell.level >= 0 && cell.level < NUM_LEVELS) {
            out[cell.level] += cell.headcount;
        }
    }
    return out;
}
