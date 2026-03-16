import type { SolverConstraint, SwapScenario, SolverConfig, ConstraintViolation, SwapParty } from '../types';
import type { ShiftTimeRange } from '../../types';
import { MinRestGapRule } from '../../rules/min-rest-gap';

function evaluateParty(party: SwapParty, config: SolverConfig): ConstraintViolation {
    const existingWithoutReceived: ShiftTimeRange[] = party.hypothetical_schedule.filter(
        s => !(
            s.shift_date === party.received_shift.shift_date &&
            s.start_time === party.received_shift.start_time &&
            s.end_time === party.received_shift.end_time
        )
    );

    const result = MinRestGapRule.evaluate({
        employee_id: party.employee_id,
        action_type: 'swap',
        candidate_shift: party.received_shift,
        existing_shifts: existingWithoutReceived,
        rest_gap_hours: config.rest_gap_hours,
    });

    return {
        constraint_id: 'MIN_REST_GAP',
        constraint_name: 'Rest Gap Between Shifts',
        employee_id: party.employee_id,
        employee_name: party.name,
        status: result.status,
        summary: result.summary,
        details: result.details,
        calculation: result.calculation as Record<string, unknown>,
        blocking: true,
    };
}

export const MinRestGapConstraint: SolverConstraint = {
    id: 'MIN_REST_GAP',
    name: 'Rest Gap Between Shifts',
    blocking: true,
    evaluate(scenario: SwapScenario, config: SolverConfig): ConstraintViolation[] {
        return [evaluateParty(scenario.partyA, config), evaluateParty(scenario.partyB, config)];
    },
};
