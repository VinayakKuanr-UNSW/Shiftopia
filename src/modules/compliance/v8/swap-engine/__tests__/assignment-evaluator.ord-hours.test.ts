import { describe, it, expect } from 'vitest';
import { assignmentEvaluator } from '../assignment-evaluator';
import type { RosterShift } from '../types';

/**
 * Regression test for a latent hole: the V8SwapEngine used to HARDCODE every
 * party's contract_type to 'CASUAL' (comment "bridge will hydrate if needed" —
 * nothing ever did). Because V8_ORD_HOURS_AVG early-returns for CASUAL, the
 * ordinary-hours 4-week averaging cap was structurally unreachable in the
 * assignment / bulk-assignment / auto-scheduler / bid paths. An FT employee
 * rostered 280h in a 28-day window would falsely PASS.
 *
 * These tests prove the rule now fires for FT and stays exempt for CASUAL.
 */

// N consecutive 10h days (net) starting at startDate. 28 × 10h = 280h ≫ 152h cap.
function consecutive(nDays: number, startDate = '2026-06-01'): RosterShift[] {
    const out: RosterShift[] = [];
    const base = new Date(`${startDate}T00:00:00Z`);
    for (let i = 0; i < nDays; i++) {
        const d = new Date(base);
        d.setUTCDate(d.getUTCDate() + i);
        const date = d.toISOString().slice(0, 10);
        out.push({
            id: `s-${i}`,
            date,
            start_time: '08:00',
            end_time: '18:00',
            is_ordinary_hours: true,
            unpaid_break_minutes: 0,
        });
    }
    return out;
}

const all = consecutive(28);
const current_shifts = all.slice(0, 27);
const candidate_shift = all[27];

const hasOrdHours = (
    ctx?: { contract_type?: 'FT' | 'PT' | 'CASUAL' | null },
): boolean => {
    const res = assignmentEvaluator.evaluate({
        employee_id: 'e1',
        name: 'Test',
        current_shifts,
        candidate_shift,
        action_type: 'assign',
        employee_context: ctx,
    });
    return res.violations.some(v => v.constraint_id === 'V8_ORD_HOURS_AVG');
};

describe('assignmentEvaluator — V8_ORD_HOURS_AVG reachability', () => {
    it('FIRES for a FULL-TIME employee over the 152h/28-day cap', () => {
        expect(hasOrdHours({ contract_type: 'FT' })).toBe(true);
    });

    it('FIRES for a PART-TIME employee over the cap', () => {
        expect(hasOrdHours({ contract_type: 'PT' })).toBe(true);
    });

    it('stays EXEMPT for a CASUAL employee (same schedule)', () => {
        expect(hasOrdHours({ contract_type: 'CASUAL' })).toBe(false);
    });

    it('defaults to CASUAL (exempt) when no employee_context is supplied — unchanged legacy behaviour', () => {
        expect(hasOrdHours(undefined)).toBe(false);
    });
});
