/**
 * ComplianceEvaluator — labour compliance via the V8 constraint engine.
 *
 * Delegates to AssignmentEvaluator (the same engine used by the
 * EnhancedAddShiftModal, the bid modal and the swap modals) and reports
 * WHATEVER IT RAISES, verbatim. This evaluator deliberately keeps no list of
 * the rules it expects: V8 owns that set, and any list kept here is a second
 * copy that silently goes stale.
 *
 * It used to keep one. `CONSTRAINT_TO_VIOLATION` mapped V8 rule ids onto a local
 * `ViolationType` enum and dropped anything unmapped with a bare `continue`, so
 * a rule missing from the table was indistinguishable from a rule that passed.
 * Three BLOCKING rules were being discarded that way — the 20-in-28 cap, the
 * student-visa limit, and the casual two-shifts-a-day cap. See `ViolationCode`
 * in ../types for the detail.
 *
 * Since this evaluator is the AutoScheduler's compliance gate — called once to
 * build the preview and again as the pre-commit concurrency recheck — a dropped
 * rule there is a rule that never reaches an operator at all.
 *
 * The SimulatedRoster (existingShifts + proposedAssignments) is passed as
 * `current_shifts` so each new candidate is validated against the
 * incrementally-growing schedule — not just the DB state.
 */

import { assignmentEvaluator } from '@/modules/compliance';
import type { ConstraintViolation, RosterShift } from '@/modules/compliance';
import type { CandidateShift, EmployeeInfo, ShiftViolation, SimulatedRoster } from '../types';

/**
 * Shape rules are absent here by design, not by omission. Assignment places
 * EXISTING shifts, whose shape was validated at creation by
 * `@/modules/compliance/shape` — minimum engagement, meal break and the rest
 * cannot change because a different person was chosen for an unchanged shift.
 * V8 does not emit them either; the two modules agree on the boundary.
 */

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
        // Explicit field mappers like this one are where per-shift rule inputs
        // go missing: V8_EMPLOYMENT_TARGET is guarded on the target being
        // present, so dropping it here reads as "rule passed" rather than as a
        // type error.
        target_employment_type: s.target_employment_type ?? null,
        target_requires_flexible: s.target_requires_flexible ?? false,
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
     * previously-proposed assignments in this validation run.
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
            employee_context: {
                contract_type: employee.contract_type,
                contracted_weekly_hours: employee.contracted_weekly_hours,
                // audit F1 — approved-leave dates drive V8_LEAVE_CONFLICT.
                leave_days: employee.leave_days,
                // Raw contract statuses drive V8_EMPLOYMENT_TARGET. The rule
                // returns [] on an empty list, so the shift-side target above is
                // inert without this.
                employment_statuses: employee.employment_statuses,
            },
        });

        // ConstraintViolation[] → ShiftViolation[]. A rename, not a filter:
        // every hit V8 raises is reported, keyed by its own rule id.
        const violations: ShiftViolation[] = [];
        const seen = new Set<string>();

        const push = (cv: ConstraintViolation, blocking: boolean) => {
            if (seen.has(cv.constraint_id)) return;
            seen.add(cv.constraint_id);
            violations.push({
                violation_type: cv.constraint_id,
                // V8 already carries the display label; the old enum threw it
                // away and rendered the identifier instead.
                rule_name:   cv.constraint_name || cv.name || cv.constraint_id,
                description: cv.summary,
                blocking,
            });
        };

        // Blocking first, so a rule appearing in both lists keeps its severity.
        for (const cv of result.violations) push(cv, cv.blocking);
        for (const cv of result.warnings)   push(cv, false);

        return violations;
    }
}

export const complianceEvaluator = new ComplianceEvaluator();
