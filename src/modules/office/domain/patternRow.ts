/**
 * Office — the editable row.
 *
 * ONE UI ROW IS N DATABASE ROWS. The table shows "James Smith · Mon–Fri ·
 * 08:00–16:06", which is one line to read and five `baseline_ft_patterns` rows
 * to store. Keeping that expansion here, in a pure module, means the table
 * component never reasons about weekdays and the save path never reasons about
 * presentation.
 *
 * FIVE INPUTS, THREE DERIVATIONS. Of the nine columns the manager sees, only
 * role, days, start, end and the unpaid break are typed. Gross, paid break and
 * net are consequences:
 *
 *   gross = end − start   (carrying past midnight)
 *   net   = gross − unpaid break
 *   paid  = cl 37.1/37.2 applied to net — 15m past four hours, 30m past eight
 *
 * The paid rest pause is the one worth being firm about: it is a legal
 * consequence of how long someone works, not a field. Offering it as an input
 * would let a manager roster a nine-hour day with no rest pause and see no
 * complaint until the shape gate refused the shift days later.
 *
 * EVERYTHING HERE IS PURE. Same discipline as the rest of the domain layer,
 * and here it earns its keep directly: the table re-derives every row on every
 * keystroke, so this code runs hundreds of times per editing session and must
 * never touch a clock, a network, or a `Set`'s iteration order.
 */

import { cycleCeilingHours } from '@/modules/compliance/ordinary-hours-cycle';
import { lawfulDayCounts, requiredPaidBreakMinutes } from './patternDesigner';
import type {
    OfficePattern,
    EmployeeContractFacts,
    IsoWeekday,
    LeaveDay,
    PatternSlot,
    RawLeaveDay,
} from './types';

/** Weekdays in the order the table renders them, Monday first. */
export const ISO_WEEK: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

export const DAY_SHORT: Record<IsoWeekday, string> = {
    1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun',
};

export const DAY_LONG: Record<IsoWeekday, string> = {
    1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday',
    5: 'Friday', 6: 'Saturday', 7: 'Sunday',
};

/**
 * One line of the table.
 *
 * `slotIdByDay` carries the database id of each already-saved day so an edit
 * updates the existing row rather than deleting and re-inserting it — which
 * would churn `created_at` and lose the provenance an applied shift points at.
 */
export interface PatternRow {
    /** Stable identity for React and for dirty-tracking. Not a database id. */
    rowId: string;
    employeeId: string;
    userContractId: string;
    weekInCycle: number;
    days: readonly IsoWeekday[];
    /** `HH:mm`. */
    startTime: string;
    /** `HH:mm`. May be <= startTime for a shift crossing midnight. */
    endTime: string;
    unpaidBreakMinutes: number;
    roleId: string;
    /** `baseline_ft_patterns.id` per ISO weekday, for days already saved. */
    slotIdByDay: Readonly<Partial<Record<IsoWeekday, string>>>;
}

/**
 * Minutes between two `HH:mm` times, carrying past midnight.
 *
 * Identical in form to the `baseline_ft_patterns_net_derived` CHECK constraint:
 * `(d + 1439) % 1440 + 1`. A same-time start and end is a full 1440-minute day,
 * not a zero-length one, and a negative difference is a shift that finishes the
 * next morning. Keeping the two expressions the same shape is deliberate — if
 * they disagree, a row the client thinks is valid is rejected by the database
 * with a constraint name and no explanation.
 */
export function grossMinutesBetween(startTime: string, endTime: string): number {
    const toM = (hhmm: string): number => {
        const [h, m] = String(hhmm).split(':').map(Number);
        return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
    };
    const diff = toM(endTime) - toM(startTime);
    return ((diff + 1439) % 1440) + 1;
}

export interface RowDerivation {
    grossMinutes: number;
    netMinutes: number;
    /** cl 37.1/37.2 — derived from net, never typed. */
    paidBreakMinutes: number;
    /** `netMinutes × days.length` — this line's contribution to the week. */
    weeklyMinutes: number;
}

/** The three computed columns, from the five typed ones. */
export function deriveRow(row: Pick<PatternRow,
    'startTime' | 'endTime' | 'unpaidBreakMinutes' | 'days'>): RowDerivation {
    const grossMinutes = grossMinutesBetween(row.startTime, row.endTime);
    const netMinutes = grossMinutes - (row.unpaidBreakMinutes || 0);
    return {
        grossMinutes,
        netMinutes,
        paidBreakMinutes: requiredPaidBreakMinutes(netMinutes),
        weeklyMinutes: netMinutes * row.days.length,
    };
}

/**
 * Expand a row into one `PatternSlot` per selected day.
 *
 * `sortOrder` is the ISO weekday, which makes the emission order of
 * `candidateGenerator` a property of the calendar rather than of whatever order
 * the manager happened to click the day toggles in.
 */
export function rowToSlots(row: PatternRow): PatternSlot[] {
    const { netMinutes, paidBreakMinutes } = deriveRow(row);
    return [...row.days]
        .sort((a, b) => a - b)
        .map(dayOfWeek => ({
            sourceSlotId: row.slotIdByDay[dayOfWeek] ?? `${row.rowId}:${dayOfWeek}`,
            dayOfWeek,
            startTime: row.startTime,
            endTime: row.endTime,
            unpaidBreakMinutes: row.unpaidBreakMinutes,
            paidBreakMinutes,
            netMinutes,
            roleId: row.roleId,
            sortOrder: dayOfWeek,
        }));
}

/**
 * Every row belonging to one employee, as the pattern the engine consumes.
 *
 * Rows are flattened in `(day, rowId)` order so two identical row sets in
 * different orders produce byte-identical patterns — the determinism guarantee
 * has to survive the editing surface, not just the generator.
 */
export function rowsToPattern(
    employeeId: string,
    userContractId: string,
    subDepartmentId: string,
    rows: readonly PatternRow[],
): OfficePattern {
    const slots = rows
        .filter(r => r.employeeId === employeeId)
        .flatMap(rowToSlots)
        .sort((a, b) => (a.sortOrder !== b.sortOrder
            ? a.sortOrder - b.sortOrder
            : (a.sourceSlotId < b.sourceSlotId ? -1 : a.sourceSlotId > b.sourceSlotId ? 1 : 0)));

    return { employeeId, userContractId, subDepartmentId, slots };
}

/* ────────────────────────────────────────────────────────────────────────────
   Leave credit — a function of the PATTERN, not of the contract
   ──────────────────────────────────────────────────────────────────────────── */

/** Net ordinary hours a pattern rosters on each weekday. */
export function patternHoursByWeekday(
    pattern: Pick<OfficePattern, 'slots'>,
): Map<IsoWeekday, number> {
    const out = new Map<IsoWeekday, number>();
    for (const slot of pattern.slots) {
        out.set(slot.dayOfWeek, (out.get(slot.dayOfWeek) ?? 0) + slot.netMinutes / 60);
    }
    return out;
}

/**
 * Hours per weekday when there is NO pattern to read them from: the contract,
 * spread over Monday–Friday (weekly hours ÷ 5 — 7.6h for 38h full-time).
 *
 * WHY THIS EXISTS. The Office page no longer has a pattern table, so every
 * employee arrives here pattern-less, and `patternHoursByWeekday` of an empty
 * pattern is an empty map — which credited every approved leave day and every
 * public holiday at 0h. cl 44.7 pays annual leave for "ordinary hours of work in
 * the period" and cl 56.4 pays a public holiday someone "would ordinarily be
 * rostered to work"; zero is wrong for both, and it let the copy ceiling ignore
 * leave entirely. Monday–Friday is the full-time office week; a leave day that
 * falls on a weekend credits nothing, as it would have without the leave.
 */
export function contractHoursByWeekday(contractedWeeklyHours: number | null | undefined): Map<IsoWeekday, number> {
    const daily = (contractedWeeklyHours && contractedWeeklyHours > 0 ? contractedWeeklyHours : 38) / 5;
    return new Map<IsoWeekday, number>([[1, daily], [2, daily], [3, daily], [4, daily], [5, daily]]);
}

/**
 * Resolve how many hours each leave day discharges, from this employee's own
 * pattern.
 *
 * cl 44.7 pays "the Team Member's ordinary hours of work in the period", not a
 * weekly average, so the measure is what the PATTERN rosters on that weekday.
 * Leave falling on a day the pattern does not work discharges nothing — which
 * is correct rather than harsh: there was no obligation there to discharge.
 *
 * Pure, and separated from the leave READ, so that editing a pattern re-runs
 * this over cached rows instead of going back to the database.
 */
export function attachLeaveCredit(
    raw: readonly RawLeaveDay[],
    hoursByWeekday: ReadonlyMap<IsoWeekday, number>,
    isoWeekdayOf: (date: string) => IsoWeekday,
): LeaveDay[] {
    return raw.map(day => ({
        ...day,
        creditHours: hoursByWeekday.get(isoWeekdayOf(day.date)) ?? 0,
    }));
}

/* ────────────────────────────────────────────────────────────────────────────
   The cycle verdict — the column that stops the 40-hour week
   ──────────────────────────────────────────────────────────────────────────── */

export type CycleVerdictStatus = 'empty' | 'balanced' | 'over' | 'short';

export interface CycleVerdict {
    /** Net hours the pattern rosters in one week. */
    patternWeeklyHours: number;
    /** `patternWeeklyHours × cycleWeeks`. */
    cycleHours: number;
    /** cl 35.x(a) — what the declared cycle allows. */
    ceilingHours: number;
    /** Positive = over the ceiling, negative = short of it. */
    deltaHours: number;
    status: CycleVerdictStatus;
}

/**
 * One minute of tolerance — enough to absorb the ÷60, nothing more.
 *
 * Being strict is the point. 08:00–16:30 with a 30-minute break is 8.0h a day
 * and 160h a cycle against a 152h ceiling; that is the breach every full-time
 * employee in this database was carrying, and it is only eight minutes a day
 * away from lawful.
 */
const TOLERANCE_HOURS = 1 / 60;

/**
 * Compare an employee's whole pattern against their contracted cycle ceiling.
 *
 * This is the arithmetic of `validatePattern`'s volume check, exposed as a
 * value so the table can render it live in a column while someone is still
 * typing — rather than as a finding they discover after pressing Generate.
 */
export function cycleVerdict(
    rows: readonly PatternRow[],
    facts: Pick<EmployeeContractFacts, 'contractedWeeklyHours' | 'cycleWeeks'>,
    defaultWeeklyHours = 38,
): CycleVerdict {
    const weeklyMinutes = rows.reduce((sum, r) => sum + deriveRow(r).weeklyMinutes, 0);
    const patternWeeklyHours = weeklyMinutes / 60;
    const cycleHours = patternWeeklyHours * facts.cycleWeeks;
    const ceilingHours = cycleCeilingHours(
        facts.cycleWeeks,
        facts.contractedWeeklyHours ?? defaultWeeklyHours,
    );
    const deltaHours = cycleHours - ceilingHours;

    const status: CycleVerdictStatus =
        rows.length === 0 || weeklyMinutes === 0 ? 'empty'
            : deltaHours > TOLERANCE_HOURS ? 'over'
                : deltaHours < -TOLERANCE_HOURS ? 'short'
                    : 'balanced';

    return { patternWeeklyHours, cycleHours, ceilingHours, deltaHours, status };
}

/* ────────────────────────────────────────────────────────────────────────────
   Copying a shape between employees
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Put one employee's weekly SHAPE onto another, and nothing else.
 *
 * ONLY DAYS, TIMES AND BREAKS TRAVEL. The target keeps their own
 * `userContractId` and `roleId`, because the contract is what authorises a role
 * and `BFT_PATTERN_ROLE_MISMATCH` is BLOCKING — carrying the source's role
 * across would hand somebody a pattern that can never be generated, and would
 * quietly change what their shifts are paid at.
 *
 * IT REPLACES, IT DOES NOT MERGE. Lines the target had beyond the source's
 * count are dropped, so the result is the source's pattern rather than a hybrid
 * of the two. Where the shapes line up, the target's existing database ids are
 * kept, so a later save updates those rows instead of deleting and re-inserting
 * them.
 *
 * Pure, and here rather than in the table component, because the invariant
 * worth protecting — that identity never travels with the shape — is a domain
 * rule and needs a test that does not require rendering anything.
 */
export function copyPatternShape(
    allRows: readonly PatternRow[],
    sourceEmployeeId: string,
    targetEmployeeId: string,
    newRowId: (index: number) => string,
): PatternRow[] {
    const source = allRows.filter(r => r.employeeId === sourceEmployeeId);
    const target = allRows.filter(r => r.employeeId === targetEmployeeId);

    // Nothing to copy from, or nobody to copy onto: leave the draft untouched
    // rather than inventing rows for someone with no contract line.
    if (source.length === 0 || target.length === 0) return [...allRows];

    const head = target[0];
    const replacements: PatternRow[] = source.map((src, i) => ({
        ...(target[i] ?? head),
        rowId: target[i]?.rowId ?? newRowId(i),
        employeeId: targetEmployeeId,
        userContractId: head.userContractId,
        roleId: head.roleId,
        slotIdByDay: target[i]?.slotIdByDay ?? {},
        weekInCycle: src.weekInCycle,
        days: [...src.days],
        startTime: src.startTime,
        endTime: src.endTime,
        unpaidBreakMinutes: src.unpaidBreakMinutes,
    }));

    return [...allRows.filter(r => r.employeeId !== targetEmployeeId), ...replacements];
}

/* ────────────────────────────────────────────────────────────────────────────
   Seeding
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The row an employee starts with when they have no saved pattern.
 *
 * Built from `designPattern`'s arithmetic rather than from a hardcoded
 * Monday-to-Friday-nine-to-five, so the seed is lawful for THIS contract: a 38h
 * week seeds five 7.6h days, and a contract that cannot be spread over five
 * lawful days seeds whatever it can be.
 *
 * This is what removes the empty state. Before, a team with no template saw a
 * picker with nothing in it and a button that could fail; now every employee
 * arrives with a compliant row already in place, and the manager's job is to
 * correct it rather than to construct it.
 */
export function seedRow(args: {
    rowId: string;
    employeeId: string;
    userContractId: string;
    roleId: string;
    weeklyHours: number;
    /** Preferred working days; trimmed to what the contract can lawfully hold. */
    days?: readonly IsoWeekday[];
    startTime?: string;
    unpaidBreakMinutes?: number;
}): PatternRow {
    const unpaid = args.unpaidBreakMinutes ?? 30;
    const startTime = args.startTime ?? '08:00';
    const preferred = args.days ?? [1, 2, 3, 4, 5];

    // `lawfulDayCounts` is the authority on how many days a quota can be spread
    // across; the preferred set is trimmed toward it rather than overridden, so
    // a Monday-start week stays a Monday-start week.
    const counts = lawfulDayCounts(args.weeklyHours);
    const dayCount = counts.includes(preferred.length)
        ? preferred.length
        : (counts[counts.length - 1] ?? preferred.length);

    const days = [...preferred].sort((a, b) => a - b).slice(0, dayCount);
    const perDayNet = days.length > 0 ? Math.round((args.weeklyHours * 60) / days.length) : 0;
    const endMinutes = toMinutes(startTime) + perDayNet + unpaid;

    return {
        rowId: args.rowId,
        employeeId: args.employeeId,
        userContractId: args.userContractId,
        weekInCycle: 1,
        days,
        startTime,
        endTime: toHhmm(endMinutes),
        unpaidBreakMinutes: unpaid,
        roleId: args.roleId,
        slotIdByDay: {},
    };
}

/* Time formatting, private to this module. `patternDesigner` has its own copies
   and does not export them; two four-line functions are a smaller cost than
   widening that module's surface to share them. */

function toMinutes(hhmm: string): number {
    const [h, m] = String(hhmm).split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function toHhmm(minutes: number): string {
    const wrapped = ((minutes % 1440) + 1440) % 1440;
    return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}
