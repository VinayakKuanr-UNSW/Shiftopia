import { describe, it, expect } from 'vitest';
import { complianceEvaluator } from '../engine/compliance-evaluator';
import type { CandidateShift, EmployeeInfo, SimulatedRoster } from '../types';

/**
 * Regression: paid rest breaks must SURVIVE the trip from a candidate/existing
 * shift to V8's `dailySpreadRule`.
 *
 * cl 39.2 caps a part-timer's split-shift spread at 12h "excluding meal AND
 * rest breaks". The solver (HC-9) and the DB trigger both net out
 * `paid_break_minutes`, but `candidateToRosterShift` rebuilt each shift field
 * by field and dropped it, so the AutoScheduler's preview measured a wider
 * spread and rejected lawful split-shift days as V8_SPLIT_SHIFT_SPREAD.
 *
 * The day below spans 06:00-18:30 = 750 gross minutes with 20 paid minutes on
 * each engagement: 710 net (lawful) when the pauses arrive, 750 (breach) when
 * they are dropped. The control proves the rule is reachable in this setup, so
 * the first assertion cannot pass vacuously.
 */

const pt: EmployeeInfo = {
    id: 'e1',
    name: 'Pat Part-Time',
    contract_type: 'PT',
    contracted_weekly_hours: 20,
    employment_statuses: ['Part-Time'],
};

function day(paid: number): { candidate: CandidateShift; roster: SimulatedRoster } {
    const base = { shift_date: '2026-08-17', unpaid_break_minutes: 0, paid_break_minutes: paid };
    return {
        candidate: {
            ...base, id: 'late', start_time: '15:30', end_time: '18:30', assigned_employee_id: null,
        },
        roster: {
            existingShifts: [{
                ...base, id: 'early', start_time: '06:00', end_time: '11:00', assigned_employee_id: 'e1',
            }],
            proposedAssignments: [],
        },
    };
}

const spreadHit = (paid: number) => {
    const { candidate, roster } = day(paid);
    return complianceEvaluator
        .evaluate(candidate, pt, roster)
        .find(v => v.violation_type === 'V8_SPLIT_SHIFT_SPREAD');
};

describe('paid breaks reach the compliance engine', () => {
    it('nets paid rest breaks out of the cl 39.2 spread (710 net — lawful)', () => {
        expect(spreadHit(20)).toBeUndefined();
    });

    it('control: the same day without paid breaks breaches (750 net)', () => {
        const hit = spreadHit(0);
        expect(hit).toBeDefined();
        expect(hit!.blocking).toBe(true);
    });
});
