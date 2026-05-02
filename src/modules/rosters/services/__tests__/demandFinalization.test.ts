/**
 * Unit tests for demandFinalization.service.ts (L7 combiner).
 *
 * Pure function — no DB, no network.
 *
 * Covers:
 *   - Feedback multiplier applied correctly to baseline
 *   - Timecard multiplier applied (default 1.0 in Phase 1)
 *   - L6 constraint floors raise headcount when binding
 *   - Cold-start rows pinned at 1.0 (< minRowsForSignal)
 *   - Multiple cells produce sorted output (slice → function → level)
 *   - Explanation array carries expected strings
 *   - Binding constraint flag and field
 */

import { describe, it, expect } from 'vitest';
import { finalizeDemand } from '../../services/demandFinalization.service';
import type { RuleBaselineCell } from '../../domain/ruleEngine.types';
import type { SupervisorFeedbackRow } from '../../api/supervisorFeedback.dto';

function baseline(
    slice_idx: number,
    function_code: string,
    level: number,
    headcount: number,
): RuleBaselineCell {
    return {
        slice_idx,
        function_code: function_code as RuleBaselineCell['function_code'],
        level,
        headcount,
        contributing_rule_codes: ['fb_test'],
        explanation: [`rule:fb_test +${headcount}`],
    };
}

function feedback(
    verdict: 'UNDER' | 'OVER' | 'OK',
    severity: number,
    functionCode: string,
    level: number,
): SupervisorFeedbackRow {
    return {
        id: `fb-${Math.random()}`,
        event_id: 'e1',
        function_code: functionCode as any,
        level,
        slice_start: 0,
        slice_end: 47,
        verdict,
        severity,
        reason_code: 'peak_underestimated',
        reason_note: null,
        supervisor_id: null,
        rule_version_at_event: null,
        created_at: new Date().toISOString(),
    };
}

describe('finalizeDemand — basic combination', () => {
    it('no feedback → multiplier 1.0 (cold start), headcount = baseline', () => {
        const result = finalizeDemand({
            synthesis_run_id: null,
            event_id: 'e1',
            baselineCells: [baseline(32, 'F&B', 1, 10)],
            feedbackByBucket: new Map(),
        });

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].headcount).toBe(10);
        expect(result.rows[0].feedback_multiplier_used).toBe(1.0);
        expect(result.rows[0].timecard_ratio_used).toBe(1.0);
        expect(result.rows[0].binding_constraint).toBeNull();
    });

    it('UNDER sev=5 × 3 rows → multiplier > 1.0, headcount increases', () => {
        const rows = [
            feedback('UNDER', 5, 'F&B', 1),
            feedback('UNDER', 5, 'F&B', 1),
            feedback('UNDER', 5, 'F&B', 1),
        ];
        const feedbackByBucket = new Map([['F&B|1', rows]]);

        const result = finalizeDemand({
            synthesis_run_id: null,
            event_id: 'e1',
            baselineCells: [baseline(32, 'F&B', 1, 10)],
            feedbackByBucket,
        });

        expect(result.rows[0].feedback_multiplier_used).toBeGreaterThan(1.0);
        expect(result.rows[0].headcount).toBeGreaterThan(10);
    });

    it('OVER sev=5 × 3 rows → multiplier < 1.0, headcount decreases', () => {
        const rows = [
            feedback('OVER', 5, 'F&B', 1),
            feedback('OVER', 5, 'F&B', 1),
            feedback('OVER', 5, 'F&B', 1),
        ];
        const feedbackByBucket = new Map([['F&B|1', rows]]);

        const result = finalizeDemand({
            synthesis_run_id: null,
            event_id: 'e1',
            baselineCells: [baseline(32, 'F&B', 1, 20)],
            feedbackByBucket,
        });

        expect(result.rows[0].feedback_multiplier_used).toBeLessThan(1.0);
        expect(result.rows[0].headcount).toBeLessThan(20);
    });

    it('headcount is never negative', () => {
        const rows = Array.from({ length: 10 }, () => feedback('OVER', 5, 'F&B', 1));
        const feedbackByBucket = new Map([['F&B|1', rows]]);

        const result = finalizeDemand({
            synthesis_run_id: null,
            event_id: 'e1',
            baselineCells: [baseline(32, 'F&B', 1, 1)],
            feedbackByBucket,
        });

        expect(result.rows[0].headcount).toBeGreaterThanOrEqual(0);
    });
});

describe('finalizeDemand — L6 constraint floors', () => {
    it('floor raises headcount when formula result is below the floor', () => {
        const result = finalizeDemand({
            synthesis_run_id: null,
            event_id: 'e1',
            baselineCells: [baseline(32, 'Security', 3, 1)],
            feedbackByBucket: new Map(),
            constraintFloors: [
                { function_code: 'Security', level: 3, floor: 5, rule_code: 'min_security_alcohol' },
            ],
        });

        expect(result.rows[0].headcount).toBe(5);
        expect(result.rows[0].binding_constraint).toBe('min_security_alcohol');
        expect(result.bindingConstraints).toHaveLength(1);
    });

    it('floor does not reduce headcount when formula result is above the floor', () => {
        const result = finalizeDemand({
            synthesis_run_id: null,
            event_id: 'e1',
            baselineCells: [baseline(32, 'Security', 3, 10)],
            feedbackByBucket: new Map(),
            constraintFloors: [
                { function_code: 'Security', level: 3, floor: 5, rule_code: 'min_security_alcohol' },
            ],
        });

        expect(result.rows[0].headcount).toBe(10);
        expect(result.rows[0].binding_constraint).toBeNull();
        expect(result.bindingConstraints).toHaveLength(0);
    });
});

describe('finalizeDemand — provenance', () => {
    it('explanation contains baseline rule, timecard_ratio_used, and feedback_multiplier_used strings', () => {
        const result = finalizeDemand({
            synthesis_run_id: null,
            event_id: 'e1',
            baselineCells: [baseline(32, 'F&B', 1, 10)],
            feedbackByBucket: new Map(),
        });

        const exp = result.rows[0].explanation as string[];
        expect(exp.some((e) => e.includes('rule:fb_test'))).toBe(true);
        expect(exp.some((e) => e.includes('timecard_mult'))).toBe(true);
        expect(exp.some((e) => e.includes('feedback_mult'))).toBe(true);
    });

    it('explanation marks cold_start when feedback rows < minRowsForSignal', () => {
        const rows = [feedback('UNDER', 5, 'F&B', 1)]; // 1 row < 3 (default threshold)
        const feedbackByBucket = new Map([['F&B|1', rows]]);

        const result = finalizeDemand({
            synthesis_run_id: null,
            event_id: 'e1',
            baselineCells: [baseline(32, 'F&B', 1, 10)],
            feedbackByBucket,
        });

        const exp = result.rows[0].explanation as string[];
        expect(exp.some((e) => e.includes('cold_start'))).toBe(true);
    });
});

describe('finalizeDemand — ordering', () => {
    it('output rows are sorted by slice → function → level', () => {
        const result = finalizeDemand({
            synthesis_run_id: null,
            event_id: 'e1',
            baselineCells: [
                baseline(33, 'Security', 3, 5),
                baseline(32, 'F&B', 1, 10),
                baseline(32, 'F&B', 2, 3),
                baseline(32, 'AV', 3, 2),
            ],
            feedbackByBucket: new Map(),
        });

        const keys = result.rows.map((r) => `${r.slice_idx}|${r.function_code}|${r.level}`);
        const sorted = [...keys].sort((a, b) => {
            const [as, af, al] = a.split('|');
            const [bs, bf, bl] = b.split('|');
            if (as !== bs) return Number(as) - Number(bs);
            if (af !== bf) return af.localeCompare(bf);
            return Number(al) - Number(bl);
        });
        expect(keys).toEqual(sorted);
    });
});
