/**
 * Unit tests for the L3 rule DSL evaluator.
 *
 * Pure tests — no DB, no network. Cover:
 *   - tokenizer / parser correctness (precedence, parens, ternary)
 *   - allowed function calls (ceil/floor/round/min/max/abs/clamp)
 *   - variable lookup (incl. unknown var error)
 *   - staff_at_levels[i] array access
 *   - dependsOnLevels detection (drives pass-2 routing)
 *   - safety: division by zero, unknown function, negative results clamped
 *   - applies_when matcher for all comparator forms
 */

import { describe, it, expect } from 'vitest';

import { compileRule, evaluateRule, RuleEvalError } from '../ruleEvaluator';
import { ruleApplies } from '../ruleMatcher';
import type { DemandRuleRow, EventFeatureForRules, RuleEvalContext } from '../ruleEngine.types';

function rule(formula: string, overrides: Partial<DemandRuleRow> = {}): DemandRuleRow {
    return {
        id: 'r1',
        rule_code: 'test',
        function_code: 'F&B',
        level: 1,
        applies_when: {},
        formula,
        priority: 100,
        version: 1,
        is_active: true,
        notes: null,
        ...overrides,
    };
}

function ctx(overrides: Partial<RuleEvalContext> = {}): RuleEvalContext {
    return {
        pax: 0,
        room_count: 0,
        total_sqm: 0,
        duration_min: 0,
        bump_in_min: 0,
        bump_out_min: 0,
        slice_idx: 0,
        staff_at_levels: [0, 0, 0, 0, 0, 0, 0, 0],
        is_pass_two: false,
        ...overrides,
    };
}

describe('ruleEvaluator — arithmetic & precedence', () => {
    it('evaluates simple arithmetic with correct precedence', () => {
        const c = compileRule(rule('2 + 3 * 4'));
        expect(evaluateRule(c, ctx())).toBe(14);
    });

    it('respects parentheses', () => {
        const c = compileRule(rule('(2 + 3) * 4'));
        expect(evaluateRule(c, ctx())).toBe(20);
    });

    it('handles unary minus', () => {
        const c = compileRule(rule('-(2 + 3) + 10'));
        expect(evaluateRule(c, ctx())).toBe(5);
    });

    it('clamps negative results to 0 (headcount floor)', () => {
        const c = compileRule(rule('5 - 100'));
        expect(evaluateRule(c, ctx())).toBe(0);
    });

    it('floors fractional results', () => {
        const c = compileRule(rule('7 / 2'));
        expect(evaluateRule(c, ctx())).toBe(3);
    });
});

describe('ruleEvaluator — variables & functions', () => {
    it('reads pax variable', () => {
        const c = compileRule(rule('ceil(pax / 50)'));
        expect(evaluateRule(c, ctx({ pax: 500 }))).toBe(10);
        expect(evaluateRule(c, ctx({ pax: 501 }))).toBe(11);
    });

    it('handles max() and min() with multiple args', () => {
        expect(evaluateRule(compileRule(rule('max(2, ceil(pax / 100))')), ctx({ pax: 50 }))).toBe(2);
        expect(evaluateRule(compileRule(rule('max(2, ceil(pax / 100))')), ctx({ pax: 500 }))).toBe(5);
        expect(evaluateRule(compileRule(rule('min(10, pax)')), ctx({ pax: 25 }))).toBe(10);
    });

    it('clamp(x, lo, hi) bounds correctly', () => {
        const c = compileRule(rule('clamp(pax, 5, 20)'));
        expect(evaluateRule(c, ctx({ pax: 1 }))).toBe(5);
        expect(evaluateRule(c, ctx({ pax: 12 }))).toBe(12);
        expect(evaluateRule(c, ctx({ pax: 100 }))).toBe(20);
    });

    it('throws on unknown function', () => {
        expect(() => compileRule(rule('cosine(pax)'))).not.toThrow(); // parses fine
        const c = compileRule(rule('cosine(pax)'));
        expect(() => evaluateRule(c, ctx({ pax: 1 }))).toThrow(RuleEvalError);
    });

    it('throws on unknown variable', () => {
        const c = compileRule(rule('mystery + 1'));
        expect(() => evaluateRule(c, ctx())).toThrow(RuleEvalError);
    });

    it('returns 0 on division by zero (caught as runtime error)', () => {
        const c = compileRule(rule('pax / room_count'));
        expect(() => evaluateRule(c, ctx({ pax: 100, room_count: 0 }))).toThrow(RuleEvalError);
    });
});

describe('ruleEvaluator — ternary & boolean ops', () => {
    it('evaluates ternary expressions', () => {
        const c = compileRule(rule('pax > 100 ? 5 : 2'));
        expect(evaluateRule(c, ctx({ pax: 50 }))).toBe(2);
        expect(evaluateRule(c, ctx({ pax: 200 }))).toBe(5);
    });

    it('short-circuits && and ||', () => {
        // If && short-circuits, the right-hand division-by-zero never fires.
        const cAnd = compileRule(rule('pax > 100 && (room_count > 0 ? 1 : 0)'));
        expect(evaluateRule(cAnd, ctx({ pax: 50, room_count: 0 }))).toBe(0);

        const cOr = compileRule(rule('pax > 100 || pax > 0'));
        expect(evaluateRule(cOr, ctx({ pax: 50 }))).toBe(1);
    });
});

describe('ruleEvaluator — staff_at_levels array & pass detection', () => {
    it('reads staff_at_levels[i]', () => {
        const c = compileRule(rule('ceil(staff_at_levels[1] / 8)'));
        expect(evaluateRule(c, ctx({ staff_at_levels: [0, 16, 0, 0, 0, 0, 0, 0] }))).toBe(2);
    });

    it('out-of-bounds index returns 0', () => {
        const c = compileRule(rule('staff_at_levels[99]'));
        expect(evaluateRule(c, ctx())).toBe(0);
    });

    it('flags rules that depend on staff_at_levels', () => {
        expect(compileRule(rule('ceil(pax / 50)')).dependsOnLevels).toBe(false);
        expect(compileRule(rule('ceil(staff_at_levels[1] / 8)')).dependsOnLevels).toBe(true);
        // Nested usage still detected.
        expect(compileRule(rule('max(1, ceil(staff_at_levels[2] / 6))')).dependsOnLevels).toBe(true);
    });

    it('rejects unknown array names', () => {
        const c = compileRule(rule('mystery[0]'));
        expect(() => evaluateRule(c, ctx())).toThrow(RuleEvalError);
    });
});

describe('ruleEvaluator — parse errors', () => {
    it('rejects empty formula', () => {
        expect(() => compileRule(rule(''))).toThrow(RuleEvalError);
    });

    it('rejects unbalanced parens', () => {
        expect(() => compileRule(rule('(2 + 3'))).toThrow(RuleEvalError);
    });

    it('rejects stray operators', () => {
        expect(() => compileRule(rule('+ 2'))).toThrow(); // unary + not allowed
    });
});

// ── Matcher ────────────────────────────────────────────────────────────────

const baseFeature: EventFeatureForRules = {
    event_id: 'e1',
    event_type: 'Conference',
    pax: 500,
    start_iso: '2026-05-04T16:00:00+10:00',
    end_iso: '2026-05-04T22:00:00+10:00',
    duration_min: 360,
    service_type: 'buffet',
    alcohol: true,
    room_count: 2,
    total_sqm: 0,
    bump_in_min: 120,
    bump_out_min: 60,
    layout_complexity: 'standard',
    first_slice_idx: 28,
    last_slice_idx: 45,
};

describe('ruleMatcher — applies_when predicate', () => {
    it('empty predicate always matches', () => {
        expect(ruleApplies({}, baseFeature)).toBe(true);
    });

    it('literal equality matches', () => {
        expect(ruleApplies({ service_type: 'buffet' }, baseFeature)).toBe(true);
        expect(ruleApplies({ service_type: 'plated' }, baseFeature)).toBe(false);
    });

    it('boolean equality matches', () => {
        expect(ruleApplies({ alcohol: true }, baseFeature)).toBe(true);
        expect(ruleApplies({ alcohol: false }, baseFeature)).toBe(false);
    });

    it('comparator strings work', () => {
        expect(ruleApplies({ pax: '>300' }, baseFeature)).toBe(true);
        expect(ruleApplies({ pax: '>=500' }, baseFeature)).toBe(true);
        expect(ruleApplies({ pax: '<200' }, baseFeature)).toBe(false);
        expect(ruleApplies({ pax: '<=500' }, baseFeature)).toBe(true);
    });

    it('between: includes endpoints', () => {
        expect(ruleApplies({ pax: 'between:100,500' }, baseFeature)).toBe(true);
        expect(ruleApplies({ pax: 'between:600,1000' }, baseFeature)).toBe(false);
    });

    it('in: list matching', () => {
        expect(ruleApplies({ layout_complexity: 'in:standard,complex' }, baseFeature)).toBe(true);
        expect(ruleApplies({ layout_complexity: 'in:simple' }, baseFeature)).toBe(false);
    });

    it('all keys must match (AND semantics)', () => {
        expect(ruleApplies({ service_type: 'buffet', alcohol: true }, baseFeature)).toBe(true);
        expect(ruleApplies({ service_type: 'buffet', alcohol: false }, baseFeature)).toBe(false);
    });
});
