import type { SolverConstraint, SwapScenario, SolverConfig, ConstraintViolation, SwapParty } from '../types';
import type { ShiftTimeRange } from '../../types';
import { StudentVisa48hRule } from '../../rules/student-visa-48h';

function evaluateParty(party: SwapParty, config: SolverConfig): ConstraintViolation {
    const existingWithoutReceived: ShiftTimeRange[] = party.hypothetical_schedule.filter(
        s => !(
            s.shift_date === party.received_shift.shift_date &&
            s.start_time === party.received_shift.start_time &&
            s.end_time === party.received_shift.end_time
        )
    );

    const result = StudentVisa48hRule.evaluate({
        employee_id: party.employee_id,
        action_type: 'swap',
        candidate_shift: party.received_shift,
        existing_shifts: existingWithoutReceived,
        student_visa_enforcement: config.student_visa_enforcement,
    });

    const blocking = config.student_visa_enforcement === true;

    return {
        constraint_id: 'STUDENT_VISA_48H',
        constraint_name: 'Student Visa 48h/Fortnight',
        employee_id: party.employee_id,
        employee_name: party.name,
        status: result.status,
        summary: result.summary,
        details: result.details,
        calculation: result.calculation as Record<string, unknown>,
        blocking,
    };
}

export const StudentVisa48hConstraint: SolverConstraint = {
    id: 'STUDENT_VISA_48H',
    name: 'Student Visa 48h/Fortnight',
    blocking: false, // Configurable — see evaluateParty
    evaluate(scenario: SwapScenario, config: SolverConfig): ConstraintViolation[] {
        return [evaluateParty(scenario.partyA, config), evaluateParty(scenario.partyB, config)];
    },
};
