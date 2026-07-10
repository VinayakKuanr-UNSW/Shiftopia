import { V8RuleEvaluator, V8Hit } from '../types';

/**
 * V8 Rule: Approved Leave Conflict (audit F1)
 *
 * BLOCKING rule: a shift must not be assigned/added/bid/swapped onto a date
 * the employee has APPROVED leave. Approved leave is legal-hard
 * unavailability — it wins over coverage, mirroring the solver's
 * legal_hard » coverage tiering (the solver enforces the same dates through
 * `unavailable_dates`).
 *
 * Data: `employee.leave_days` — YYYY-MM-DD dates with approved leave,
 * populated by the caller's data layer. ABSENT data ⇒ the rule is silent
 * (tolerant of un-plumbed callers; the solver-side exclusion still holds).
 *
 * Candidate scoping follows the per-shift convention: shifts explicitly
 * marked `is_candidate === false` (history pulled in for cumulative context)
 * are skipped; unflagged shifts (swap-engine hypothetical schedules) are
 * treated as candidates.
 */
export const leaveConflictRule: V8RuleEvaluator = (ctx) => {
    const leaveDays = ctx.employee.leave_days;
    if (!leaveDays || leaveDays.length === 0) return [];
    const leaveSet = new Set(leaveDays);

    const hits: V8Hit[] = [];
    for (const s of ctx.shifts) {
        if (s.is_candidate === false) continue; // never re-validate history
        const date = s.date || s.shift_date || '';
        if (!date || !leaveSet.has(date)) continue;
        hits.push({
            rule_id: 'V8_LEAVE_CONFLICT',
            rule_name: 'Approved Leave',
            status: 'BLOCKING',
            summary: 'Employee is on approved leave',
            details: `This shift falls on ${date}, a day the employee has approved leave. Approved leave is a hard unavailability — unassign the leave or pick another employee.`,
            affected_shifts: [s.id],
            blocking: true,
        });
    }
    return hits;
};
