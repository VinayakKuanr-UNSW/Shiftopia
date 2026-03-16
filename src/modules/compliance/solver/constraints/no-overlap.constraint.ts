import type { SolverConstraint, SwapScenario, SolverConfig, ConstraintViolation, SwapParty } from '../types';
import type { ComplianceCheckInput } from '../../types';
import { NoOverlapRule } from '../../rules/no-overlap';

function evaluateParty(party: SwapParty): ConstraintViolation {
    const existingWithoutReceived: ComplianceCheckInput['existing_shifts'] =
        party.hypothetical_schedule.filter(
            s => !(
                s.shift_date === party.received_shift.shift_date &&
                s.start_time === party.received_shift.start_time &&
                s.end_time === party.received_shift.end_time
            )
        );

    const result = NoOverlapRule.evaluate({
        employee_id: party.employee_id,
        action_type: 'swap',
        candidate_shift: party.received_shift,
        existing_shifts: existingWithoutReceived,
    });

    return {
        constraint_id: 'NO_OVERLAP',
        constraint_name: 'No Overlapping Shifts',
        employee_id: party.employee_id,
        employee_name: party.name,
        status: result.status,
        summary: result.summary,
        details: result.details,
        calculation: result.calculation as Record<string, unknown>,
        blocking: true,
    };
}

export const NoOverlapConstraint: SolverConstraint = {
    id: 'NO_OVERLAP',
    name: 'No Overlapping Shifts',
    blocking: true,
    evaluate(scenario: SwapScenario, _config: SolverConfig): ConstraintViolation[] {
        return [evaluateParty(scenario.partyA), evaluateParty(scenario.partyB)];
    },
};
