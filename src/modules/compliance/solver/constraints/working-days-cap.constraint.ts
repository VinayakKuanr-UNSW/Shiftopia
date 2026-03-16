import type { SolverConstraint, SwapScenario, SolverConfig, ConstraintViolation, SwapParty } from '../types';
import type { ShiftTimeRange } from '../../types';
import { WorkingDaysCapRule } from '../../rules/working-days-cap';

function evaluateParty(party: SwapParty): ConstraintViolation {
    const existingWithoutReceived: ShiftTimeRange[] = party.hypothetical_schedule.filter(
        s => !(
            s.shift_date === party.received_shift.shift_date &&
            s.start_time === party.received_shift.start_time &&
            s.end_time === party.received_shift.end_time
        )
    );

    const result = WorkingDaysCapRule.evaluate({
        employee_id: party.employee_id,
        action_type: 'swap',
        candidate_shift: party.received_shift,
        existing_shifts: existingWithoutReceived,
    });

    return {
        constraint_id: 'WORKING_DAYS_CAP',
        constraint_name: 'Max Working Days (20/28)',
        employee_id: party.employee_id,
        employee_name: party.name,
        status: result.status,
        summary: result.summary,
        details: result.details,
        calculation: result.calculation as Record<string, unknown>,
        blocking: true,
    };
}

export const WorkingDaysCapConstraint: SolverConstraint = {
    id: 'WORKING_DAYS_CAP',
    name: 'Max Working Days (20/28)',
    blocking: true,
    evaluate(scenario: SwapScenario, config: SolverConfig): ConstraintViolation[] {
        // Context-aware: bids are expressions of interest, not confirmed assignments.
        // The shift is not yet worked, so it cannot count toward the rolling 28-day cap.
        // This constraint self-excludes when action_type === 'bid'.
        if (config.action_type === 'bid') {
            return [
                passingViolation(scenario.partyA, 'Not applicable to bid actions'),
                passingViolation(scenario.partyB, 'Not applicable to bid actions'),
            ];
        }
        return [evaluateParty(scenario.partyA), evaluateParty(scenario.partyB)];
    },
};

function passingViolation(party: SwapParty, details: string): ConstraintViolation {
    return {
        constraint_id:   'WORKING_DAYS_CAP',
        constraint_name: 'Max Working Days (20/28)',
        employee_id:     party.employee_id,
        employee_name:   party.name,
        status:          'pass',
        summary:         'Not applicable',
        details,
        calculation:     {},
        blocking:        true,
    };
}
