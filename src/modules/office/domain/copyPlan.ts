/**
 * Which dates a "copy this shift to…" actually writes to, and why it skips the
 * rest — pure, with no React and no I/O.
 *
 * COPY WHAT IT CAN, REPORT THE REST. Four things can stop a date, and a bulk
 * copy over a fortnight will routinely hit at least one of them. Refusing the
 * whole range because 1 October is already rostered would make the feature
 * useless; writing 13 of 14 and saying nothing would be worse. So every skip
 * carries a reason, in the manager's words, and `Apply`'s pre-flight already set
 * this precedent.
 *
 * THE EXCLUDED WEEKDAYS ARE NOT "SKIPS". Ticking Sat and Sun means the manager
 * has already decided; listing 4 weekend dates as skipped would bury the one
 * date that genuinely could not be written. Nor is the source date itself — it
 * is where the shift already is.
 */
import type { CycleRequirement, IsoWeekday, RawLeaveDay } from './types';
import type { OfficeDay } from './plannedWeek';

export interface CopyPlanInput {
    /** The date being copied FROM. Never a target. */
    sourceDate: string;
    /** The source shift's net minutes, for the cycle-ceiling arithmetic. */
    netMinutes: number;
    /** `yyyy-MM-dd`, inclusive. */
    startDate: string;
    /** `yyyy-MM-dd`, inclusive. */
    endDate: string;
    /** ISO weekdays (1 = Mon … 7 = Sun) to EXCLUDE from the range. */
    excludeWeekdays: ReadonlySet<IsoWeekday>;
    /** The employee's existing cells, so cl 39.1 can be honoured. */
    existing: ReadonlyMap<string, OfficeDay>;
    /** Approved leave only. A pending request does not stop a copy. */
    approvedLeave: ReadonlyMap<string, RawLeaveDay>;
    /** Dates with a draft, unlocked roster — from `loadRosterCoverage`. */
    writableDates: ReadonlySet<string>;
    /** Dates whose only covering roster is published or locked (cl 38.2). */
    lockedOutDates: ReadonlySet<string>;
    /** The employee's cycles, for the cl 35.1(a) ceiling. */
    cycles: readonly CycleRequirement[];
    /**
     * Today in Sydney, `yyyy-MM-dd`. Anything before it is refused: this grid
     * behaves like the roster grid, which never creates a shift in the past.
     */
    today: string;
}

export interface CopySkip {
    date: string;
    reason: string;
}

export interface CopyPlan {
    /** Dates that will be written, in order. */
    targets: string[];
    /** Dates that will not, each with a reason. Excluded weekdays are absent. */
    skipped: CopySkip[];
}

/**
 * ISO weekday (1 = Mon … 7 = Sun) of a `yyyy-MM-dd` string.
 *
 * Built in UTC deliberately. `new Date('2026-04-05')` is parsed as UTC midnight,
 * but `getDay()` then reports the LOCAL weekday — so a viewer in Sydney reading
 * an autumn date can be a day out. Nothing here is a wall-clock time; these are
 * calendar dates, and they must not move.
 */
export function isoWeekdayOf(dateKey: string): IsoWeekday {
    const [y, m, d] = dateKey.split('-').map(Number);
    const dow = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay();
    return (dow === 0 ? 7 : dow) as IsoWeekday;
}

/** Every `yyyy-MM-dd` from `start` to `end` inclusive. UTC, for the same reason. */
export function datesBetween(start: string, end: string): string[] {
    if (!start || !end || end < start) return [];
    const [sy, sm, sd] = start.split('-').map(Number);
    const out: string[] = [];
    const cursor = new Date(Date.UTC(sy, (sm ?? 1) - 1, sd ?? 1));
    // A guard, not a limit anyone should reach: a mistyped year would otherwise
    // spin here forever.
    for (let i = 0; i < 2000; i++) {
        const key = cursor.toISOString().slice(0, 10);
        if (key > end) break;
        out.push(key);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
}

function cycleFor(
    cycles: readonly CycleRequirement[],
    dateKey: string,
): CycleRequirement | undefined {
    return cycles.find(c => dateKey >= c.start && dateKey <= c.endInclusive);
}

export function planCopy(input: CopyPlanInput): CopyPlan {
    const {
        sourceDate, netMinutes, startDate, endDate, excludeWeekdays,
        existing, approvedLeave, writableDates, lockedOutDates, cycles, today,
    } = input;

    const targets: string[] = [];
    const skipped: CopySkip[] = [];

    /*
     * Hours committed so far per cycle, so the ceiling is checked against the
     * running total rather than each date in isolation. Ten copies that each fit
     * individually can still overrun cl 35.1(a) together, which is exactly the
     * failure a bulk action introduces.
     */
    const addedHoursByCycle = new Map<number, number>();
    const hours = netMinutes / 60;

    for (const date of datesBetween(startDate, endDate)) {
        // Not skips — the manager already decided these.
        if (date === sourceDate) continue;
        if (excludeWeekdays.has(isoWeekdayOf(date))) continue;

        if (date < today) {
            skipped.push({ date, reason: 'In the past' });
            continue;
        }
        if (approvedLeave.has(date)) {
            skipped.push({ date, reason: 'On approved leave' });
            continue;
        }
        if (existing.has(date)) {
            // cl 39.1 — a full-time split shift is not permitted, and the pattern
            // table cannot represent one.
            skipped.push({ date, reason: 'Already rostered that day' });
            continue;
        }
        if (lockedOutDates.has(date)) {
            skipped.push({ date, reason: 'Roster is published or locked (cl 38.2)' });
            continue;
        }
        if (!writableDates.has(date)) {
            skipped.push({ date, reason: 'No draft roster covers this date' });
            continue;
        }

        const cycle = cycleFor(cycles, date);
        if (cycle) {
            const already = addedHoursByCycle.get(cycle.cycleIndex) ?? 0;
            /*
             * Ordinary hours in the cycle = rostered work + approved paid leave
             * + public-holiday credit. Leave and PH hours ARE ordinary hours
             * (cl 44.7, cl 56.4); leaving them out let a copy roster a full
             * 152h of work on top of a week of annual leave — 190h, the excess
             * being overtime (cl 42.1) priced as ordinary time.
             */
            const credited = cycle.paidLeaveHours + cycle.publicHolidayCreditHours;
            const after = cycle.existingHours + credited + already + hours;
            if (after > cycle.ceilingHours + 1e-9) {
                skipped.push({
                    date,
                    reason: `Would exceed the ${cycle.ceilingHours.toFixed(1)}h cycle ceiling (cl 35.1(a))`
                        + (credited > 0 ? ` once ${credited.toFixed(1)}h of leave and public holidays is counted` : ''),
                });
                continue;
            }
            addedHoursByCycle.set(cycle.cycleIndex, already + hours);
        }

        targets.push(date);
    }

    return { targets, skipped };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** yyyy-MM-dd → "5 Oct". Pure string work: these are calendar dates, never instants. */
const shortDate = (ymd: string) => `${Number(ymd.slice(8, 10))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]}`;

/**
 * The one toast a copy ends with: "Copied to X dates (5 Oct – 29 Oct), Y dates
 * skipped." The span says WHERE the copies went — usually into weeks the grid is
 * not showing, which otherwise reads as "nothing happened". The reasons for the
 * first few skips go in the description, so a skip is never just a number.
 */
export function copyOutcomeToast(
    created: readonly string[],
    skipped: ReadonlyArray<{ date: string; reason: string }>,
): { title: string; description?: string } {
    const sorted = [...created].sort();
    const span = sorted.length === 0 ? ''
        : sorted.length === 1 ? ` (${shortDate(sorted[0])})`
            : ` (${shortDate(sorted[0])} – ${shortDate(sorted[sorted.length - 1])})`;
    const title = `Copied to ${plural(created.length, 'date')}${span}, ${plural(skipped.length, 'date')} skipped`;
    if (skipped.length === 0) return { title };
    const shown = skipped.slice(0, 3).map(s => `${s.date}: ${s.reason}`).join(' · ');
    return {
        title,
        description: skipped.length > 3 ? `${shown} · …and ${skipped.length - 3} more` : shown,
    };
}
