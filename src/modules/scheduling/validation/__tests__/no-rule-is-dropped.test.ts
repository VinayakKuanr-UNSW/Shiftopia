import { describe, it, expect } from 'vitest';
import { complianceEvaluator } from '../engine/compliance-evaluator';
import type { CandidateShift, EmployeeInfo, SimulatedRoster } from '../types';

/**
 * Regression: every hit the compliance engine raises must REACH the caller.
 *
 * ComplianceEvaluator used to translate V8 rule ids onto a local `ViolationType`
 * enum through a lookup table, dropping anything unmapped with a bare
 * `continue`. Three BLOCKING rules were being discarded that way:
 *
 *   • V8_20_IN_28              — table key said `V8_WORKING_DAYS_CAP`
 *   • V8_STUDENT_VISA_LIMIT    — table key said `V8_STUDENT_VISA`
 *   • V8_MAX_DAILY_ENGAGEMENTS — never listed at all
 *
 * None of them raised an error; the hits were computed and thrown away, which
 * downstream is indistinguishable from a rule that passed. That matters because
 * this evaluator is the AutoScheduler's compliance gate — it runs once for the
 * preview and again as the pre-commit concurrency recheck, with no operator
 * reading each row.
 *
 * A unit test on any of those rules would have passed throughout: the rules were
 * always correct. What was broken was the wiring, so these assertions go through
 * the evaluator, exactly as `employment-target-reaches-engine.test.ts` does for
 * the same bug class.
 */

const DATE = '2026-08-17';

function candidate(over: Partial<CandidateShift> = {}): CandidateShift {
    return {
        id: 'cand',
        shift_date: DATE,
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
        contract_type: 'FT',
        contracted_weekly_hours: 38,
        ...over,
    };
}

/** N consecutive worked days ending the day before `DATE`. */
function priorDays(n: number): CandidateShift[] {
    const out: CandidateShift[] = [];
    for (let i = 1; i <= n; i++) {
        const d = new Date(`${DATE}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - i);
        out.push(candidate({
            id: `prior-${i}`,
            shift_date: d.toISOString().slice(0, 10),
            assigned_employee_id: 'e1',
        }));
    }
    return out;
}

const emptyRoster: SimulatedRoster = { existingShifts: [], proposedAssignments: [] };

describe('no rule is dropped between the engine and the caller', () => {
    it('reports V8_20_IN_28 — the cap the old table misnamed', () => {
        // 20 prior worked days + the candidate = 21 inside a 28-day window.
        const violations = complianceEvaluator.evaluate(
            candidate(),
            employee(),
            { existingShifts: priorDays(20), proposedAssignments: [] },
        );

        const hit = violations.find(v => v.violation_type === 'V8_20_IN_28');
        expect(hit).toBeDefined();
        expect(hit!.blocking).toBe(true);
    });

    it('reports V8_MAX_DAILY_ENGAGEMENTS — the cap the old table never listed', () => {
        // cl 35.4(f): a casual may work at most 2 engagements in one day.
        // Deliberately non-overlapping, so this is the engagement count firing
        // and not V8_NO_OVERLAP standing in for it.
        const sameDay: CandidateShift[] = [
            candidate({ id: 'a', start_time: '06:00', end_time: '09:00', assigned_employee_id: 'e1' }),
            candidate({ id: 'b', start_time: '10:00', end_time: '13:00', assigned_employee_id: 'e1' }),
        ];

        const violations = complianceEvaluator.evaluate(
            candidate({ id: 'c', start_time: '14:00', end_time: '17:00' }),
            employee({ contract_type: 'CASUAL' }),
            { existingShifts: sameDay, proposedAssignments: [] },
        );

        expect(violations.some(v => v.violation_type === 'V8_NO_OVERLAP')).toBe(false);

        const hit = violations.find(v => v.violation_type === 'V8_MAX_DAILY_ENGAGEMENTS');
        expect(hit).toBeDefined();
        expect(hit!.blocking).toBe(true);
    });

    it('carries the rule id verbatim, not a translated local code', () => {
        // The whole defect was a second naming system. Pin that there is now
        // only one: whatever V8 called the rule is what arrives here.
        const violations = complianceEvaluator.evaluate(
            candidate(),
            employee(),
            { existingShifts: priorDays(20), proposedAssignments: [] },
        );

        expect(violations.length).toBeGreaterThan(0);
        for (const v of violations) {
            expect(v.violation_type).toMatch(/^V8_/);
        }
    });

    it('carries a human-readable rule_name for display', () => {
        // AutoSchedulerPanel renders `ruleName ?? type`. The old enum discarded
        // V8's own label and rendered the identifier, so the panel read
        // "WORKING_DAYS_CAP" where V8 had already written "20 Days in 28 Limit".
        const violations = complianceEvaluator.evaluate(
            candidate(),
            employee(),
            { existingShifts: priorDays(20), proposedAssignments: [] },
        );

        const hit = violations.find(v => v.violation_type === 'V8_20_IN_28')!;
        expect(hit.rule_name).toBeTruthy();
        expect(hit.rule_name).not.toBe(hit.violation_type);
        expect(hit.rule_name).toMatch(/[a-z]/); // prose, not an UPPER_SNAKE identifier
    });

    it('reports each rule once, keeping BLOCKING over WARNING', () => {
        const violations = complianceEvaluator.evaluate(
            candidate(),
            employee(),
            { existingShifts: priorDays(20), proposedAssignments: [] },
        );

        const ids = violations.map(v => v.violation_type);
        expect(new Set(ids).size).toBe(ids.length);
        expect(violations.find(v => v.violation_type === 'V8_20_IN_28')!.blocking).toBe(true);
    });

    it('raises nothing on a clean assignment', () => {
        expect(complianceEvaluator.evaluate(candidate(), employee(), emptyRoster)).toEqual([]);
    });

    /**
     * The third dropped rule, V8_STUDENT_VISA_LIMIT.
     *
     * Fixing the lookup table exposed a hydration gap underneath it: the flag
     * the rule guards on existed nowhere on this path — not on `EmployeeInfo`,
     * not in ScenarioLoader's select, not in ComplianceEvaluator's
     * `employee_context` — so the rule short-circuited on its own guard before
     * any of the mapping code ran. This test asserted that unreachability, to
     * keep the gap visible rather than assumed closed, and said in as many
     * words that it should be rewritten as a positive assertion once hydration
     * landed. It has, so it is.
     */
    it('reports V8_STUDENT_VISA_LIMIT once the flag is hydrated', () => {
        const heavyFortnight = priorDays(13).map(s => ({ ...s, start_time: '06:00', end_time: '18:00' }));

        const violations = complianceEvaluator.evaluate(
            candidate({ start_time: '06:00', end_time: '18:00' }),
            employee({ contract_type: 'CASUAL', is_student_visa: true }),
            { existingShifts: heavyFortnight, proposedAssignments: [] },
        );

        const hit = violations.find(v => v.violation_type === 'V8_STUDENT_VISA_LIMIT');
        expect(hit).toBeDefined();
        expect(hit!.blocking).toBe(true);
    });

    it('stays silent for the same roster without the visa condition', () => {
        // The counterpart the old pinned test could not distinguish itself
        // from: before hydration, EVERY employee looked like this.
        const heavyFortnight = priorDays(13).map(s => ({ ...s, start_time: '06:00', end_time: '18:00' }));

        const violations = complianceEvaluator.evaluate(
            candidate({ start_time: '06:00', end_time: '18:00' }),
            employee({ contract_type: 'CASUAL' }),
            { existingShifts: heavyFortnight, proposedAssignments: [] },
        );

        expect(violations.some(v => v.violation_type === 'V8_STUDENT_VISA_LIMIT')).toBe(false);
    });
});

/**
 * `is_student_visa` was not the only fact this path dropped.
 *
 * `fetchV8EmployeeContext` has derived `is_security_role` since audit H-5, and
 * it fell off at the same two hops — `EmployeeInfo` had no field for it and
 * `ComplianceEvaluator` did not forward it. Everything keyed on EBA Schedule 3
 * was therefore unreachable from the AutoScheduler however correct the rules
 * were, including Sch 3 §5.3(g), which was only added to the labour layer once
 * the agreement text was read.
 *
 * Same bug class as the lookup table above, one layer further out: the rule
 * runs, finds no discriminator, and returns nothing — indistinguishable
 * downstream from a rule that passed.
 */
describe('Schedule 3 reaches the engine', () => {
    const SECURITY_DAY = '2026-08-17';

    /** Two engagements spanning 13h gross — over Sch 3 §5.3(g)'s 12h ceiling. */
    function longSecurityDay(): CandidateShift[] {
        return [
            candidate({
                id: 'sec-am', shift_date: SECURITY_DAY,
                start_time: '06:00', end_time: '11:00',
                assigned_employee_id: 'e1', unpaid_break_minutes: 0,
            }),
        ];
    }

    it('applies the casual-security spread cap when the role flag is hydrated', () => {
        const violations = complianceEvaluator.evaluate(
            candidate({ start_time: '15:00', end_time: '19:00', unpaid_break_minutes: 0 }),
            employee({ contract_type: 'CASUAL', is_security_role: true }),
            { existingShifts: longSecurityDay(), proposedAssignments: [] },
        );

        expect(violations.some(v => v.violation_type === 'V8_CASUAL_SECURITY_SPREAD')).toBe(true);
    });

    it('leaves a non-security casual alone on the identical roster', () => {
        // cl 39.1 confines the split-shift spread to PT and FPT, so a general
        // casual has no spread cap at all. The flag is the only difference.
        const violations = complianceEvaluator.evaluate(
            candidate({ start_time: '15:00', end_time: '19:00', unpaid_break_minutes: 0 }),
            employee({ contract_type: 'CASUAL' }),
            { existingShifts: longSecurityDay(), proposedAssignments: [] },
        );

        expect(violations.some(v => v.violation_type === 'V8_CASUAL_SECURITY_SPREAD')).toBe(false);
    });
});
