import { describe, it, expect } from 'vitest';
import { complianceEvaluator } from '../engine/compliance-evaluator';
import type { CandidateShift, EmployeeInfo, SimulatedRoster } from '../types';

/**
 * Regression: the employment target must SURVIVE the trip from a candidate
 * shift to the V8 engine, and a hit must survive the trip back.
 *
 * The bug this pins: every layer between the two was guarded on the target
 * being present, and every guard failed open. The shift projection dropped
 * `target_employment_type`, so HC-5c in the solver
 * (`if shift.target_employment_type:`) and V8_EMPLOYMENT_TARGET
 * (`if (!target) continue`) both went silent; `candidateToRosterShift` dropped
 * it again; `employment_statuses` never reached the party, which short-circuits
 * the rule on an empty list; and `CONSTRAINT_TO_VIOLATION` had no entry for the
 * rule, so a hit that did fire was discarded by `if (!violationType) continue`.
 *
 * That last link is gone — the lookup table was deleted and rule ids now travel
 * verbatim, which is why these assertions name `V8_EMPLOYMENT_TARGET` rather
 * than the local `EMPLOYMENT_TARGET` code it used to be translated into. See
 * `no-rule-is-dropped.test.ts`.
 *
 * The result was a roster scored 100% compliant whose every assignment was
 * rejected by `trg_shift_employment_target_2_enforce` on write — with all 90
 * shifts rolled back because one plpgsql exception unwinds the whole block.
 *
 * A unit test on the rule alone cannot catch this: the rule was always correct.
 * What was broken was the wiring, so these assertions go through the evaluator.
 */

function candidate(over: Partial<CandidateShift> = {}): CandidateShift {
    return {
        id: 's1',
        shift_date: '2026-08-17',
        start_time: '09:00',
        end_time: '17:00',
        assigned_employee_id: null,
        unpaid_break_minutes: 30,
        ...over,
    };
}

function employee(over: Partial<EmployeeInfo> = {}): EmployeeInfo {
    return {
        id: 'e1',
        name: 'Mary Smith',
        contracted_weekly_hours: 38,
        ...over,
    };
}

const emptyRoster: SimulatedRoster = { existingShifts: [], proposedAssignments: [] };

describe('employment target reaches the compliance engine', () => {
    it('blocks a Full-Time employee on a Casual-target shift', () => {
        // The exact prod shape: all 90 shifts targeted Casual, and the solver
        // placed an employee whose Active sub-department contract is Full-Time.
        const violations = complianceEvaluator.evaluate(
            candidate({ target_employment_type: 'Casual' }),
            employee({ contract_type: 'FT', employment_statuses: ['Full-Time'] }),
            emptyRoster,
        );

        const hit = violations.find(v => v.violation_type === 'V8_EMPLOYMENT_TARGET');
        expect(hit).toBeDefined();
        expect(hit!.blocking).toBe(true);
    });

    it('blocks a Part-Time employee on a Casual-target shift', () => {
        const violations = complianceEvaluator.evaluate(
            candidate({ target_employment_type: 'Casual' }),
            employee({ contract_type: 'PT', employment_statuses: ['Part-Time'] }),
            emptyRoster,
        );

        expect(violations.some(v => v.violation_type === 'V8_EMPLOYMENT_TARGET')).toBe(true);
    });

    it('allows a Casual on a Casual-target shift', () => {
        const violations = complianceEvaluator.evaluate(
            candidate({ target_employment_type: 'Casual' }),
            employee({ contract_type: 'CASUAL', employment_statuses: ['Casual'] }),
            emptyRoster,
        );

        expect(violations.some(v => v.violation_type === 'V8_EMPLOYMENT_TARGET')).toBe(false);
    });

    it('matches on the RAW contract status, not the collapsed contract_type', () => {
        // 'Flexible Part-Time' collapses onto 'PT', so contract_type alone cannot
        // answer a `target_requires_flexible` shift. Reading the raw status can.
        const flexible = complianceEvaluator.evaluate(
            candidate({ target_employment_type: 'PT', target_requires_flexible: true }),
            employee({ contract_type: 'PT', employment_statuses: ['Flexible Part-Time'] }),
            emptyRoster,
        );
        expect(flexible.some(v => v.violation_type === 'V8_EMPLOYMENT_TARGET')).toBe(false);

        const plainPartTimer = complianceEvaluator.evaluate(
            candidate({ target_employment_type: 'PT', target_requires_flexible: true }),
            employee({ contract_type: 'PT', employment_statuses: ['Part-Time'] }),
            emptyRoster,
        );
        expect(plainPartTimer.some(v => v.violation_type === 'V8_EMPLOYMENT_TARGET')).toBe(true);
    });

    it('stays silent when the target was never hydrated', () => {
        // Fail-open is deliberate — the DB trigger is still the guarantee — but it
        // is exactly why the wiring bug was invisible. Pinned so a future change
        // that makes un-hydrated input BLOCK is a visible decision, not a surprise.
        const violations = complianceEvaluator.evaluate(
            candidate(),
            employee({ contract_type: 'FT', employment_statuses: ['Full-Time'] }),
            emptyRoster,
        );

        expect(violations.some(v => v.violation_type === 'V8_EMPLOYMENT_TARGET')).toBe(false);
    });

    it('stays silent when the employee statuses were never hydrated', () => {
        const violations = complianceEvaluator.evaluate(
            candidate({ target_employment_type: 'Casual' }),
            employee({ contract_type: 'FT' }),
            emptyRoster,
        );

        expect(violations.some(v => v.violation_type === 'V8_EMPLOYMENT_TARGET')).toBe(false);
    });
});
