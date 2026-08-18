/**
 * Shift Shape Compliance for TEMPLATE shifts.
 *
 * WHY TEMPLATES NEED THEIR OWN ENTRY POINT. `apply_template_to_date_range_v2`
 * stamps shifts server-side, straight from `template_shifts` into `shifts`. The
 * client never holds those rows, so the Layer-1 gate in
 * `shiftsCommands.createShift` cannot see them — a template carrying a 90-minute
 * casual engagement would mint one unlawful shift per matching day, silently,
 * with nothing in the app ever having looked at it.
 *
 * Validating at AUTHORING time closes that without a second enforcement point at
 * application time: a template shift has exactly the same intrinsic fields as a
 * real one, so if the template is lawful every shift stamped from it is lawful
 * too. Fix the mould, not each casting.
 *
 * WHAT IT DELIBERATELY CANNOT CHECK — the two day-typed rules.
 * `SHAPE_MIN_ENGAGEMENT_PH` (cl 56.2, four hours on a public holiday) and the
 * Sunday tier of `SHAPE_MIN_ENGAGEMENT` (cl 12.4(c)/12.5(c)) both need a DATE,
 * and a template shift has at most a day-of-week. A `dayOfWeek` of 0 is a
 * genuine Sunday and is checked as one; `null` means "any day", and asserting
 * the Sunday minimum against it would refuse a lawful three-hour weekday
 * template on the grounds that someone might one day apply it to a Sunday.
 *
 * Public holidays cannot be reached from a day-of-week at all. So a template
 * applied across Christmas can still produce a three-hour casual shift that
 * cl 56.2 says must be four. That residual is real and is called out here rather
 * than papered over; closing it needs a check at APPLICATION time, when the
 * dates are known.
 */

import { evaluateShiftShape, type ShapeHit } from '@/modules/compliance/shape';
import { isSecurityRoleName } from '@/modules/compliance/security-role';
import type { Group, TemplateShift } from './templates.types';

/**
 * Placeholder date. Never consulted: `is_sunday` and `is_public_holiday` are
 * always passed explicitly below, and `evaluateShiftShape` only reads
 * `shift_date` to derive those two when they are absent.
 */
const NO_DATE = '1970-01-01';

export interface TemplateShapeFailure {
    groupName:    string;
    subGroupName: string;
    /** The shift's own name, or a positional fallback so it can still be found. */
    shiftName:    string;
    startTime:    string;
    endTime:      string;
    hits:         ShapeHit[];
}

/** Evaluate one template shift. Day-typed rules are scoped as described above. */
export function evaluateTemplateShiftShape(shift: TemplateShift) {
    return evaluateShiftShape({
        shift_date:               NO_DATE,
        start_time:               shift.startTime,
        end_time:                 shift.endTime,
        unpaid_break_minutes:     shift.unpaidBreakDuration ?? 0,
        paid_break_minutes:       shift.paidBreakDuration ?? 0,
        target_employment_type:   shift.targetEmploymentType ?? 'Casual',
        target_requires_flexible: shift.targetRequiresFlexible ?? false,
        // The role name rides along on the template shift, so Schedule 3 is
        // resolvable here with no lookup.
        is_security:              isSecurityRoleName(shift.roleName),
        // A stated Sunday is checked as one. "Any day" is not treated as Sunday
        // — see the header. Public holidays are unreachable from a weekday.
        is_sunday:                shift.dayOfWeek === 0,
        is_public_holiday:        false,
    });
}

/**
 * Every shift in the template whose shape breaches the agreement.
 *
 * Returns ALL failures rather than the first, because a manager fixing a
 * template wants the whole list — being sent back into a fifty-shift editor once
 * per breach is how people learn to route around a gate.
 */
export function validateTemplateShapes(groups: Group[]): TemplateShapeFailure[] {
    const failures: TemplateShapeFailure[] = [];

    for (const group of groups) {
        for (const subGroup of group.subGroups ?? []) {
            (subGroup.shifts ?? []).forEach((shift, i) => {
                const result = evaluateTemplateShiftShape(shift);
                // INCOMPLETE is not a failure: a half-typed time is the editor's
                // problem to prompt for, not a breach to report.
                if (!result.blocking) return;

                failures.push({
                    groupName:    group.name,
                    subGroupName: subGroup.name,
                    shiftName:    shift.name?.trim() || `${shift.roleName ?? 'Shift'} #${i + 1}`,
                    startTime:    shift.startTime,
                    endTime:      shift.endTime,
                    hits:         result.hits.filter(h => h.blocking),
                });
            });
        }
    }

    return failures;
}

/** One line per failure, naming where it is and which clause it breaches. */
export function describeTemplateShapeFailures(failures: TemplateShapeFailure[]): string[] {
    return failures.map(f =>
        `${f.groupName} › ${f.subGroupName} › ${f.shiftName} (${f.startTime}–${f.endTime}): ` +
        f.hits.map(h => h.summary).join('; '),
    );
}
