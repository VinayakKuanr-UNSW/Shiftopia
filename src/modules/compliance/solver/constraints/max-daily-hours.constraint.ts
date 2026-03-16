import type { SolverConstraint, SwapScenario, SolverConfig, ConstraintViolation, SwapParty } from '../types';
import type { ShiftTimeRange } from '../../types';
import { MaxDailyHoursRule } from '../../rules/max-daily-hours';

function evaluateParty(party: SwapParty): ConstraintViolation {
    const existingWithoutReceived: ShiftTimeRange[] = party.hypothetical_schedule.filter(
        s => !(
            s.shift_date === party.received_shift.shift_date &&
            s.start_time === party.received_shift.start_time &&
            s.end_time === party.received_shift.end_time
        )
    );

    const result = MaxDailyHoursRule.evaluate({
        employee_id: party.employee_id,
        action_type: 'swap',
        candidate_shift: party.received_shift,
        existing_shifts: existingWithoutReceived,
    });

    return {
        constraint_id: 'MAX_DAILY_HOURS',
        constraint_name: 'Maximum Daily Hours',
        employee_id: party.employee_id,
        employee_name: party.name,
        status: result.status,
        summary: result.summary,
        details: result.details,
        calculation: result.calculation as Record<string, unknown>,
        blocking: true,
    };
}

export const MaxDailyHoursConstraint: SolverConstraint = {
    id: 'MAX_DAILY_HOURS',
    name: 'Maximum Daily Hours',
    blocking: true,
    evaluate(scenario: SwapScenario, _config: SolverConfig): ConstraintViolation[] {
        return [evaluateParty(scenario.partyA), evaluateParty(scenario.partyB)];
    },
};
