/**
 * IncrementalValidator — Pre-flight validation rules 1–6.
 *
 * Runs fast, in-memory checks BEFORE the constraint solver (rules 7–9).
 * These checks catch entity-level problems that don't need the full solver:
 *
 *   Rule 1: DRAFT_STATE          — shift must be unassigned/draft
 *   Rule 2: ALREADY_ASSIGNED     — no existing assigned_employee_id
 *   Rule 3: OVERLAP              — no time overlap with existing/proposed shifts
 *   Rule 4: ROLE_MISMATCH        — employee role matches shift role (if required)
 *   Rule 5: QUALIFICATION_MISSING — employee has required skills/licenses
 *   Rule 6: QUALIFICATION_EXPIRED — qualifications are not expired for shift date
 *
 * Rules 7–10 (REST_GAP, WEEKLY_HOURS, CONSECUTIVE_DAYS, STUDENT_VISA)
 * are handled by ComplianceEvaluator via the constraint solver.
 *
 * Each rule short-circuits on the first blocking failure for performance.
 */

import type { CandidateShift, EmployeeInfo, ShiftViolation, SimulatedRoster } from '../types';
import { shiftEndMinutes, shiftStartMinutes } from './shift-sorter';

// =============================================================================
// OVERLAP DETECTION
// =============================================================================

function shiftsOverlap(a: CandidateShift, b: CandidateShift): boolean {
    const aStart = shiftStartMinutes(a);
    const aEnd   = shiftEndMinutes(a);
    const bStart = shiftStartMinutes(b);
    const bEnd   = shiftEndMinutes(b);
    // Strict overlap: one starts before the other ends
    return aStart < bEnd && bStart < aEnd;
}

// =============================================================================
// RULE IMPLEMENTATIONS
// =============================================================================

function checkDraftState(shift: CandidateShift): ShiftViolation | null {
    // Allow: null, 'Draft', 'draft', undefined (unset = draft)
    const status = (shift.lifecycle_status ?? '').toLowerCase();
    if (status === '' || status === 'draft') return null;

    return {
        violation_type: 'DRAFT_STATE',
        description: `Shift on ${shift.shift_date} is in "${shift.lifecycle_status}" state and cannot be reassigned. Only Draft shifts can be bulk-assigned.`,
        blocking: true,
    };
}

function checkAlreadyAssigned(shift: CandidateShift): ShiftViolation | null {
    if (!shift.assigned_employee_id) return null;

    return {
        violation_type: 'ALREADY_ASSIGNED',
        description: `Shift on ${shift.shift_date} is already assigned. Unassign it first before bulk-assigning.`,
        blocking: true,
    };
}

function checkOverlap(
    candidate: CandidateShift,
    roster: SimulatedRoster,
): ShiftViolation | null {
    const allShifts = [...roster.existingShifts, ...roster.proposedAssignments];

    for (const existing of allShifts) {
        if (existing.id === candidate.id) continue;
        if (shiftsOverlap(candidate, existing)) {
            return {
                violation_type: 'OVERLAP',
                conflicting_shift: {
                    id: existing.id,
                    shift_date: existing.shift_date,
                    start_time: existing.start_time,
                    end_time: existing.end_time,
                },
                description: `Time overlap with shift on ${existing.shift_date} (${existing.start_time}–${existing.end_time}).`,
                blocking: true,
            };
        }
    }
    return null;
}

/**
 * R10 — Role Contract Match (partial hierarchy).
 * Mirrors the v2 engine's R10_role_contract_match rule.
 * Only enforces dimensions the candidate shift provides.
 * BLOCKING: no assignment without a matching active contract.
 */
function checkRoleContractMatch(
    shift: CandidateShift,
    employee: EmployeeInfo,
    skipQualChecks: boolean,
): ShiftViolation | null {
    if (skipQualChecks) return null;
    if (!shift.role_id) return null;  // No role requirement on shift → skip

    const contracts = employee.contracts ?? [];
    if (contracts.length === 0) return null;  // No contract data → cannot enforce, skip

    const isValid = contracts.some(c => {
        if (c.role_id !== shift.role_id) return false;
        if (shift.organization_id && c.organization_id !== shift.organization_id) return false;
        if (shift.department_id && c.department_id !== shift.department_id) return false;
        if (shift.sub_department_id && c.sub_department_id && c.sub_department_id !== shift.sub_department_id) return false;
        return true;
    });

    if (!isValid) {
        return {
            violation_type: 'ROLE_MISMATCH',
            description: `Employee is not contracted for this position on ${shift.shift_date} — no active contract matches the shift's role and department.`,
            blocking: true,
        };
    }
    return null;
}

function checkQualificationMatch(
    shift: CandidateShift,
    employee: EmployeeInfo,
    shiftRequiredQuals: string[],
    skipQualChecks: boolean,
): ShiftViolation | null {
    if (skipQualChecks || shiftRequiredQuals.length === 0) return null;

    const empQualIds = new Set(
        (employee.qualifications ?? []).map(q => q.qualification_id),
    );

    const missing = shiftRequiredQuals.filter(qId => !empQualIds.has(qId));
    if (missing.length === 0) return null;

    return {
        violation_type: 'QUALIFICATION_MISSING',
        description: `Employee is missing ${missing.length} required qualification(s) for this shift.`,
        blocking: true,
    };
}

function checkQualificationExpiry(
    shift: CandidateShift,
    employee: EmployeeInfo,
    shiftRequiredQuals: string[],
    skipQualChecks: boolean,
): ShiftViolation | null {
    if (skipQualChecks || shiftRequiredQuals.length === 0) return null;

    const today = shift.shift_date; // Compare expiry against shift date

    const expiredQuals = (employee.qualifications ?? []).filter(q => {
        if (!shiftRequiredQuals.includes(q.qualification_id)) return false;
        if (!q.expires_at) return false;
        return q.expires_at < today;
    });

    if (expiredQuals.length === 0) return null;

    return {
        violation_type: 'QUALIFICATION_EXPIRED',
        description: `Employee has ${expiredQuals.length} expired qualification(s) on ${shift.shift_date}.`,
        blocking: true,
    };
}

// =============================================================================
// VALIDATOR CLASS
// =============================================================================

export class IncrementalValidator {
    /**
     * Run rules 1–6 against a candidate shift.
     * Returns an array of violations (empty = all clear).
     *
     * @param shift           - The candidate shift to validate
     * @param employee        - The target employee profile
     * @param roster          - Current SimulatedRoster (existing + proposed)
     * @param shiftRequiredQuals - Required qualification IDs for this shift
     * @param skipQualChecks  - Skip rules 4–6 (role + qualification checks)
     */
    validate(
        shift: CandidateShift,
        employee: EmployeeInfo,
        roster: SimulatedRoster,
        shiftRequiredQuals: string[] = [],
        skipQualChecks = false,
    ): ShiftViolation[] {
        const violations: ShiftViolation[] = [];

        // Rule 1: Draft state
        const draftViolation = checkDraftState(shift);
        if (draftViolation) {
            violations.push(draftViolation);
            return violations; // Short-circuit — can't proceed if not draft
        }

        // Rule 2: Already assigned
        const assignedViolation = checkAlreadyAssigned(shift);
        if (assignedViolation) {
            violations.push(assignedViolation);
            return violations; // Short-circuit
        }

        // Rule 3: Overlap
        const overlapViolation = checkOverlap(shift, roster);
        if (overlapViolation) {
            violations.push(overlapViolation);
            // Continue — collect all violations even if overlap found
        }

        // Rule 4: Role contract match — R10 (blocking)
        const roleViolation = checkRoleContractMatch(shift, employee, skipQualChecks);
        if (roleViolation) violations.push(roleViolation);

        // Rule 5: Qualification match
        const qualMatchViolation = checkQualificationMatch(shift, employee, shiftRequiredQuals, skipQualChecks);
        if (qualMatchViolation) violations.push(qualMatchViolation);

        // Rule 6: Qualification expiry
        const qualExpiryViolation = checkQualificationExpiry(shift, employee, shiftRequiredQuals, skipQualChecks);
        if (qualExpiryViolation) violations.push(qualExpiryViolation);

        return violations;
    }
}

export const incrementalValidator = new IncrementalValidator();
