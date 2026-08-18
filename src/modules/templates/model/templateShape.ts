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
 * cl 56.2 says must be four. Closing that needs a check at APPLICATION time,
 * when the dates are known — `validateTemplateApplication` below, which the
 * apply mutation runs before it calls the RPC.
 */

import { evaluateShiftShape, type ShapeHit } from '@/modules/compliance/shape';
import { isSecurityRoleName } from '@/modules/compliance/security-role';
import { getShiftDayType } from '@/modules/core/lib/holidays';
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

// =============================================================================
// APPLICATION TIME — the two day-typed rules, against the real dates
// =============================================================================

/**
 * A template shift paired with where it lives, so a failure can be named.
 * The apply path reads these from `template_shifts` rather than from the
 * editor's in-memory `Group[]`.
 */
export interface PlacedTemplateShift {
    groupName:    string;
    subGroupName: string;
    shift:        TemplateShift;
}

export interface TemplateApplicationFailure extends TemplateShapeFailure {
    /** The date this instance would be stamped onto. */
    date:    string;
    /** Why that date is special — what the authoring gate could not know. */
    dayType: 'public holiday' | 'Sunday';
}

/** Inclusive YYYY-MM-DD range, walked in local dates to match the RPC. */
function eachDate(startDate: string, endDate: string): string[] {
    const out: string[] = [];
    const [sy, sm, sd] = startDate.split('-').map(Number);
    const [ey, em, ed] = endDate.split('-').map(Number);
    if (!sy || !ey) return out;
    const cursor = new Date(sy, sm - 1, sd);
    const end = new Date(ey, em - 1, ed);
    // A range inverted by the caller yields nothing rather than looping forever.
    while (cursor <= end && out.length <= 366) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, '0');
        const d = String(cursor.getDate()).padStart(2, '0');
        out.push(`${y}-${m}-${d}`);
        cursor.setDate(cursor.getDate() + 1);
    }
    return out;
}

/**
 * Which template shifts land on which dates.
 *
 * Mirrors `apply_template_to_date_range_v2` exactly: it stamps a shift when
 * `day_of_week IS NULL OR day_of_week = <the day>`. A null day-of-week is
 * therefore EVERY day, not no day — which is precisely how a template shift
 * reaches a public holiday nobody chose to roster.
 */
export function planTemplateApplication(
    placed: ReadonlyArray<PlacedTemplateShift>,
    startDate: string,
    endDate: string,
): Array<PlacedTemplateShift & { date: string }> {
    const plan: Array<PlacedTemplateShift & { date: string }> = [];
    for (const date of eachDate(startDate, endDate)) {
        const [y, m, d] = date.split('-').map(Number);
        const dow = new Date(y, m - 1, d).getDay();
        for (const p of placed) {
            const target = p.shift.dayOfWeek;
            if (target === null || target === undefined || target === dow) {
                plan.push({ ...p, date });
            }
        }
    }
    return plan;
}

/**
 * Shape failures that only exist once a template meets a calendar.
 *
 * The authoring gate has already cleared everything intrinsic to the shift, so
 * anything raised here is a rule that needed a DATE: cl 56.2's four-hour public
 * holiday minimum, and the Sunday tier of cl 12.4(c)/12.5(c) reached by a shift
 * whose day-of-week is "any". Ordinary weekdays are skipped outright — they
 * cannot produce a verdict the authoring gate did not already reach, and
 * walking them would re-report a template the manager has already been told
 * about, once per matching day in the range.
 */
export function validateTemplateApplication(
    placed: ReadonlyArray<PlacedTemplateShift>,
    startDate: string,
    endDate: string,
): TemplateApplicationFailure[] {
    const failures: TemplateApplicationFailure[] = [];

    for (const item of planTemplateApplication(placed, startDate, endDate)) {
        const { isSunday, isPublicHoliday } = getShiftDayType(item.date);
        if (!isSunday && !isPublicHoliday) continue;

        const shift = item.shift;
        const result = evaluateShiftShape({
            shift_date:               item.date,
            start_time:               shift.startTime,
            end_time:                 shift.endTime,
            unpaid_break_minutes:     shift.unpaidBreakDuration ?? 0,
            paid_break_minutes:       shift.paidBreakDuration ?? 0,
            target_employment_type:   shift.targetEmploymentType ?? 'Casual',
            target_requires_flexible: shift.targetRequiresFlexible ?? false,
            is_security:              isSecurityRoleName(shift.roleName),
            is_sunday:                isSunday,
            is_public_holiday:        isPublicHoliday,
        });
        if (!result.blocking) continue;

        failures.push({
            date:         item.date,
            dayType:      isPublicHoliday ? 'public holiday' : 'Sunday',
            groupName:    item.groupName,
            subGroupName: item.subGroupName,
            shiftName:    shift.name?.trim() || `${shift.roleName ?? 'Shift'}`,
            startTime:    shift.startTime,
            endTime:      shift.endTime,
            hits:         result.hits.filter(h => h.blocking),
        });
    }

    return failures;
}

/** One line per failure, naming the DATE — the fact the authoring gate lacked. */
export function describeTemplateApplicationFailures(
    failures: ReadonlyArray<TemplateApplicationFailure>,
): string[] {
    return failures.map(f =>
        `${f.date} (${f.dayType}) — ${f.groupName} › ${f.subGroupName} › ${f.shiftName} ` +
        `(${f.startTime}–${f.endTime}): ${f.hits.map(h => h.summary).join('; ')}`,
    );
}

// =============================================================================
// LOADING A STORED TEMPLATE
// =============================================================================

/** The `template_shifts` columns the shape layer reads. */
export interface TemplateShiftRow {
    id:                       string;
    name:                     string | null;
    role_name:                string | null;
    start_time:               string | null;
    end_time:                 string | null;
    unpaid_break_minutes:     number | null;
    paid_break_minutes:       number | null;
    day_of_week:              number | null;
    target_employment_type:   string | null;
    target_requires_flexible: boolean | null;
}

/** Normalise a stored row into the shape the evaluator already understands. */
export function templateShiftFromRow(row: TemplateShiftRow): TemplateShift {
    return {
        id:                       row.id,
        name:                     row.name ?? undefined,
        roleName:                 row.role_name ?? undefined,
        startTime:                (row.start_time ?? '').slice(0, 5),
        endTime:                  (row.end_time ?? '').slice(0, 5),
        paidBreakDuration:        row.paid_break_minutes ?? 0,
        unpaidBreakDuration:      row.unpaid_break_minutes ?? 0,
        dayOfWeek:                row.day_of_week,
        targetEmploymentType:     (row.target_employment_type ?? 'Casual') as TemplateShift['targetEmploymentType'],
        targetRequiresFlexible:   row.target_requires_flexible ?? false,
        skills:                   [],
        licenses:                 [],
        siteTags:                 [],
        eventTags:                [],
        sortOrder:                0,
    };
}
