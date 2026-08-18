/**
 * ConflictReporter — Aggregates violations into structured ShiftAssignmentResult.
 *
 * Takes the raw pre-flight violations (rules 1–6) and solver violations
 * (rules 7–10) and merges them into a single structured result per shift,
 * determining the final status (PASS / WARN / FAIL).
 */

import type { CandidateShift, ShiftAssignmentResult, ShiftAssignmentStatus, ShiftViolation } from '../types';

export class ConflictReporter {
    /**
     * Build a ShiftAssignmentResult for one candidate shift.
     *
     * @param shift          - The candidate shift
     * @param employeeId     - The target employee
     * @param preFlightViolations  - Violations from IncrementalValidator (rules 1–6)
     * @param solverViolations     - Violations from ComplianceEvaluator (rules 7–10)
     */
    build(
        shift: CandidateShift,
        employeeId: string,
        preFlightViolations: ShiftViolation[],
        solverViolations: ShiftViolation[],
    ): ShiftAssignmentResult {
        const allViolations = [...preFlightViolations, ...solverViolations];
        const hasBlocking = allViolations.some(v => v.blocking);
        const hasWarning  = allViolations.some(v => !v.blocking);

        let status: ShiftAssignmentStatus;
        if (hasBlocking) {
            status = 'FAIL';
        } else if (hasWarning) {
            status = 'WARN';
        } else {
            status = 'PASS';
        }

        return {
            shiftId:    shift.id,
            employeeId,
            shiftDate:  shift.shift_date,
            startTime:  shift.start_time,
            endTime:    shift.end_time,
            status,
            violations: allViolations,
            passing: !hasBlocking,
        };
    }
}

export const conflictReporter = new ConflictReporter();
