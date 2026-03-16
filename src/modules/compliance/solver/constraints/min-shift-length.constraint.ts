import type { SolverConstraint, SwapScenario, SolverConfig, ConstraintViolation, SwapParty } from '../types';
import { MinShiftLengthRule } from '../../rules/min-shift-length';

function evaluateParty(party: SwapParty, config: SolverConfig): ConstraintViolation {
    const result = MinShiftLengthRule.evaluate({
        employee_id: party.employee_id,
        action_type: 'swap',
        candidate_shift: party.received_shift,
        existing_shifts: party.hypothetical_schedule,
        candidate_is_training: config.candidate_is_training,
        public_holiday_dates: config.public_holiday_dates,
    });

    return {
        constraint_id: 'MIN_SHIFT_LENGTH',
        constraint_name: 'Minimum Shift Length',
        employee_id: party.employee_id,
        employee_name: party.name,
        status: result.status,
        summary: result.summary,
        details: result.details,
        calculation: result.calculation as Record<string, unknown>,
        blocking: true,
    };
}

export const MinShiftLengthConstraint: SolverConstraint = {
    id: 'MIN_SHIFT_LENGTH',
    name: 'Minimum Shift Length',
    blocking: true,
    evaluate(scenario: SwapScenario, config: SolverConfig): ConstraintViolation[] {
        return [evaluateParty(scenario.partyA, config), evaluateParty(scenario.partyB, config)];
    },
};
