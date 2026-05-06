/**
 * ComplianceEvaluator — Rules 7–12 via the constraint solver.
 *
 * Delegates to AssignmentEvaluator (the same engine used by the
 * EnhancedAddShiftModal) to evaluate scheduling constraints against
 * the SimulatedRoster:
 *
 *   Rule 7:  REST_GAP         — min 10h between shifts (blocking)
 *   Rule 8:  WEEKLY_HOURS     — max ordinary hours in 4-week rolling cycle
 *   Rule 9:  CONSECUTIVE_DAYS — max consecutive working days
 *   Rule 10: DAILY_HOURS      — max 12h in a single calendar day (blocking)
 *   Rule 11: WORKING_DAYS_CAP — max 20 days in rolling 28-day window (EBA Cl 35.1e, blocking)
 *   Rule 12: STUDENT_VISA     — 48h/fortnight limit (warning)
 *
 * The SimulatedRoster (existingShifts + proposedAssignments) is passed as
 * `current_shifts` so each new candidate is validated against the
 * incrementally-growing schedule — not just the DB state.
 */

import { assignmentEvaluator } from '@/modules/compliance';
import type { RosterShift } from '@/modules/compliance';
import type { CandidateShift, EmployeeInfo, ShiftViolation, SimulatedRoster, ViolationType } from '../types';

const CONSTRAINT_TO_VIOLATION: Record<string, ViolationType> = {
    V8_MIN_REST_GAP:     'REST_GAP',
    V8_ORD_HOURS_AVG:    'WEEKLY_HOURS',
    V8_MAX_DAILY_HOURS:  'DAILY_HOURS',
    V8_WORKING_DAYS_CAP: 'WORKING_DAYS_CAP',
    V8_STREAK_LIMIT:     'STREAK_LIMIT',
    V8_MIN_ENGAGEMENT:   'MIN_ENGAGEMENT',
    V8_SPREAD_OF_HOURS:  'SPREAD_OF_HOURS',
    V8_MEAL_BREAK:       'MEAL_BREAK',
    V8_STUDENT_VISA:     'STUDENT_VISA',
};

// =============================================================================
// ADAPTER
// =============================================================================

function candidateToRosterShift(s: CandidateShift): RosterShift {
    return {
        id: s.id,
        date: s.shift_date,
        shift_date: s.shift_date,
        start_time: s.start_time,
        end_time: s.end_time,
        unpaid_break_minutes: s.unpaid_break_minutes ?? 0,
        is_ordinary_hours: true, // Default for V8 rules
        role_id: s.role_id ?? undefined,
        is_training: s.lifecycle_status === 'TRAINING', // If applicable
    };
}

// =============================================================================
// EVALUATOR
// =============================================================================

export class ComplianceEvaluator {
    /**
     * Evaluate scheduling constraints (rules 7–10) for a single candidate shift.
     *
     * Uses AssignmentEvaluator with the SimulatedRoster as current_shifts,
     * so each shift is validated against the incremental state of all
     * previously-proposed assignments in this bulk run.
     *
     * @returns Array of ShiftViolation objects from solver failures/warnings.
     */
    evaluate(
        candidate: CandidateShift,
        employee: EmployeeInfo,
        roster: SimulatedRoster,
    ): ShiftViolation[] {
        // Combine existing + already-proposed assignments as the "current" schedule
        const currentShifts: RosterShift[] = [
            ...roster.existingShifts.map(candidateToRosterShift),
            ...roster.proposedAssignments
                .filter(p => p.id !== candidate.id)
                .map(candidateToRosterShift),
        ];

        const result = assignmentEvaluator.evaluate({
            employee_id: employee.id,
            name: employee.name,
            current_shifts: currentShifts,
            candidate_shift: candidateToRosterShift(candidate),
            action_type: 'assign',
        });

        // Convert ConstraintViolation[] → ShiftViolation[]
        const violations: ShiftViolation[] = [];

        for (const cv of result.violations) {
            const violationType = CONSTRAINT_TO_VIOLATION[cv.constraint_id];
            if (!violationType) continue;

            violations.push({
                violation_type: violationType,
                description: cv.summary,
                blocking: cv.blocking,
            });
        }

        // Include non-blocking warnings too
        for (const cv of result.warnings) {
            const violationType = CONSTRAINT_TO_VIOLATION[cv.constraint_id];
            if (!violationType) continue;
            // Avoid duplicates
            if (violations.some(v => v.violation_type === violationType)) continue;

            violations.push({
                violation_type: violationType,
                description: cv.summary,
                blocking: false,
            });
        }

        return violations;
    }
}

export const complianceEvaluator = new ComplianceEvaluator();
