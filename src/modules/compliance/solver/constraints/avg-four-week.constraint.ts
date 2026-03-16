import type { SolverConstraint, SwapScenario, SolverConfig, ConstraintViolation, SwapParty } from '../types';
import type { ShiftTimeRange } from '../../types';
import { AvgFourWeekCycleRule } from '../../rules/avg-four-week-cycle';

function evaluateParty(party: SwapParty, config: SolverConfig): ConstraintViolation {
    const existingWithoutReceived: ShiftTimeRange[] = party.hypothetical_schedule.filter(
        s => !(
            s.shift_date === party.received_shift.shift_date &&
            s.start_time === party.received_shift.start_time &&
            s.end_time === party.received_shift.end_time
        )
    );

    const result = AvgFourWeekCycleRule.evaluate({
        employee_id: party.employee_id,
        action_type: 'swap',
        candidate_shift: party.received_shift,
        existing_shifts: existingWithoutReceived,
        averaging_cycle_weeks: config.averaging_cycle_weeks,
    });

    return {
        constraint_id: 'AVG_FOUR_WEEK_CYCLE',
        constraint_name: 'Ordinary Hours Averaging',
        employee_id: party.employee_id,
        employee_name: party.name,
        status: result.status,
        summary: result.summary,
        details: result.details,
        calculation: result.calculation as Record<string, unknown>,
        blocking: true,
    };
}

export const AvgFourWeekConstraint: SolverConstraint = {
    id: 'AVG_FOUR_WEEK_CYCLE',
    name: 'Ordinary Hours Averaging',
    blocking: true,
    evaluate(scenario: SwapScenario, config: SolverConfig): ConstraintViolation[] {
        return [evaluateParty(scenario.partyA, config), evaluateParty(scenario.partyB, config)];
    },
};
