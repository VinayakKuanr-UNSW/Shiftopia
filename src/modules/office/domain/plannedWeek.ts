/**
 * What each cell of the Office week grid contains — as a pure function, with no
 * React and no I/O.
 *
 * EVERY CELL IS A ROW IN `shifts`. It was not always: the grid used to render
 * `computeProposal` output, so a cell could be a shift that did not exist yet
 * and had no id, no actual clocking and nothing to edit. Reading the database
 * instead is what makes a cell editable, deletable, and able to show Actual /
 * Payroll / Variance at all.
 *
 * ONE FULL-TIME SHIFT PER PERSON PER DAY (cl 39.1, and the unique key
 * `(employee_id, week_in_cycle, iso_day_of_week)` on `baseline_ft_patterns`,
 * which makes a split shift unrepresentable in the pattern). `shifts` itself has
 * NO such constraint, so this is an app-level rule and the data can always drift
 * past it — another surface, a direct write, a repair script. When it does, the
 * extra shift is SURFACED rather than dropped: hiding a real rostered shift
 * because it is inconvenient is the worse failure.
 */
/*
 * `domain/shift.entity`, NOT `model/shift.types`. There are two `Shift`
 * interfaces in this codebase: the model one is camelCase and the entity one is
 * the snake_case database row. `shifts.queries.ts` returns the entity, and
 * `normalizeShiftRow` casts a raw PostgREST row straight into it — so the entity
 * is the shape that actually exists at runtime. Typing against the model one
 * compiles and then reads `undefined` from every field.
 */
import type { Shift } from '@/modules/rosters/domain/shift.entity';
import type { RawLeaveDay } from './types';

export interface OfficeDay {
    /** `yyyy-MM-dd`. */
    dateKey: string;
    /** The shift this cell edits — the earliest, when there is more than one. */
    shift: Shift;
    /**
     * Further shifts the same person holds that day.
     *
     * Non-empty is a cl 39.1 breach. Kept on the cell so the card can say so,
     * rather than being silently discarded by the indexer.
     */
    alsoOnThisDay: readonly Shift[];
}

/** Indexed employee → date → cell. */
export type OfficeWeekIndex = ReadonlyMap<string, ReadonlyMap<string, OfficeDay>>;

/**
 * Index the week's shifts by employee and date.
 *
 * Shifts outside `weekKeys` are dropped. The caller reads a wider window than
 * the visible week on purpose — consumption is counted over whole cycles, and
 * the one-per-day guard has to be able to see a shift the person holds on
 * another team — so the narrowing happens here rather than in the query.
 *
 * Ordering within a day is by `start_time`, so "the earliest" is deterministic
 * and `alsoOnThisDay` is stable across renders.
 */
export function indexOfficeWeek(
    shifts: readonly Shift[],
    weekKeys: ReadonlySet<string>,
): OfficeWeekIndex {
    const byEmployee = new Map<string, Map<string, Shift[]>>();

    for (const sh of shifts) {
        const employeeId = sh.assigned_employee_id;
        const dateKey = sh.shift_date;
        if (!employeeId || !dateKey || !weekKeys.has(dateKey)) continue;

        let days = byEmployee.get(employeeId);
        if (!days) byEmployee.set(employeeId, (days = new Map()));

        const bucket = days.get(dateKey);
        if (bucket) bucket.push(sh);
        else days.set(dateKey, [sh]);
    }

    const out = new Map<string, Map<string, OfficeDay>>();
    for (const [employeeId, days] of byEmployee) {
        const cells = new Map<string, OfficeDay>();
        for (const [dateKey, bucket] of days) {
            const sorted = [...bucket].sort(
                (a, b) => String(a.start_time ?? '').localeCompare(String(b.start_time ?? '')));
            cells.set(dateKey, {
                dateKey,
                shift: sorted[0],
                alsoOnThisDay: sorted.slice(1),
            });
        }
        out.set(employeeId, cells);
    }
    return out;
}

/**
 * Why a new full-time shift may NOT be created for this person on this date.
 *
 * The guard the database does not give us. Returns the reason rather than a
 * boolean, which is the difference between a disabled button and an explained
 * one.
 */
export function blockedFromCreating(
    cells: ReadonlyMap<string, OfficeDay> | undefined,
    dateKey: string,
): string | null {
    if (!cells?.has(dateKey)) return null;
    return 'This employee already has a shift that day, and a full-time split shift '
        + 'is not permitted (ICC EBA cl 39.1). Edit the existing shift instead.';
}

/**
 * Approved leave, by date.
 *
 * APPROVED ONLY. The loader reads pending leave too, because a pending request
 * still bears on whether the roster can be met — but a request nobody has
 * actioned must not take a day off the grid or stop a manager rostering it. A
 * pending day behaves exactly like any other.
 *
 * Keyed by date with the FIRST approved record winning. Two approved leave types
 * on one day is a data problem in `leave_requests` (which has no exclusion
 * constraint); picking deterministically beats rendering whichever arrived last.
 */
export function indexApprovedLeave(
    leaveDays: readonly RawLeaveDay[],
    weekKeys: ReadonlySet<string>,
): ReadonlyMap<string, RawLeaveDay> {
    const out = new Map<string, RawLeaveDay>();
    for (const d of leaveDays) {
        if (d.status !== 'approved') continue;
        if (!weekKeys.has(d.date)) continue;
        if (!out.has(d.date)) out.set(d.date, d);
    }
    return out;
}
