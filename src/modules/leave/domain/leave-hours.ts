/**
 * How many hours a leave request actually consumes.
 *
 * WHY THIS EXISTS. `requestedHours` was a free numeric input the employee
 * typed (`LeavePage` `formHours`, defaulting to 0), and `createLeaveRequest`
 * checks it against the balance and the DB trigger deducts exactly it. So the
 * number that draws down a statutory entitlement was whatever was in the box:
 * 0 consumed nothing, a typo consumed a year. Nothing derived it from the
 * contract, the roster, or the calendar.
 *
 * THE ORDER OF PREFERENCE, and why:
 *
 *   1. ROSTERED SHIFTS FIRST. Leave replaces work the employee was actually
 *      going to do, so when a roster exists for the range it is the truest
 *      answer — it already accounts for a short day, a double, or a day the
 *      person was never rostered on.
 *   2. THE CONTRACT OTHERWISE. Rosters are published a few weeks out and leave
 *      is requested months ahead, so most requests have no roster to read. Fall
 *      back to ordinary daily hours across the ordinary working days in range.
 *
 * PUBLIC HOLIDAYS ARE NEVER CONSUMED. An employee does not spend annual leave
 * on a day they were not going to work anyway (NES s89). This applies to the
 * contract estimate; the rostered path needs no special case, because a shift
 * rostered ON a public holiday is work, and leave covering it does consume the
 * entitlement.
 *
 * CASUALS CONSUME NOTHING unless the leave type is paid for them — in practice
 * only FDV (cl 46 / NES Div 11, `paidForCasual: true`), where the entitlement
 * is measured against what they were rostered to work.
 */

import { LEAVE_POLICIES } from './leave-policy';
import type { LeaveTypeCode } from '../model/leave.types';
import { isPublicHoliday } from '@/modules/core/lib/holidays';

/** 38h / 5 days — the EBA cl 36 ordinary day, and the divisor `leave-policy.ts` accrues on. */
export const DEFAULT_ORDINARY_DAYS_PER_WEEK = 5;
/** Mon-Fri, ISO weekdays. Used when the contract records no ordinary_days. */
const DEFAULT_ORDINARY_DAYS: readonly number[] = [1, 2, 3, 4, 5];

export interface LeaveHoursShift {
    shiftDate: string;      // yyyy-MM-dd
    startTime: string | null;
    endTime: string | null;
    /** Unpaid portion only — the paid rest pause stays in. */
    unpaidBreakMinutes?: number | null;
}

export interface LeaveHoursInput {
    leaveType: LeaveTypeCode;
    /** yyyy-MM-dd, inclusive. */
    startDate: string;
    endDate: string;
    /** From `resolveComplianceBasis`. Undefined weekly hours = no obligation. */
    contractedWeeklyHours: number | undefined;
    /** ISO weekdays the contract's ordinary hours fall on. Null/absent = Mon-Fri. */
    ordinaryDays?: number[] | null;
    /**
     * Shifts already rostered inside the range. An EMPTY array and UNDEFINED
     * mean different things: empty = we looked and there is no roster yet (use
     * the contract estimate); undefined = we did not look.
     */
    rosteredShifts?: LeaveHoursShift[];
}

export interface LeaveHoursResult {
    hours: number;
    /** Which rule produced the number — surfaced to the employee, not internal. */
    basis: 'rostered' | 'contract' | 'unpaid-for-casual' | 'no-working-days';
    /** Working days counted (contract basis) or shifts summed (rostered basis). */
    daysCounted: number;
    /** Public-holiday dates skipped by the contract estimate. */
    publicHolidaysSkipped: string[];
    /** Plain-language explanation for the form. */
    explanation: string;
}

/** Every yyyy-MM-dd from start to end inclusive. Parsed as LOCAL midnight. */
export function eachDateInclusive(startDate: string, endDate: string): string[] {
    const out: string[] = [];
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return out;

    const cursor = new Date(start);
    // Guard against a pathological range producing an unbounded loop; two years
    // is far past any single leave request.
    let guard = 0;
    while (cursor <= end && guard < 800) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, '0');
        const d = String(cursor.getDate()).padStart(2, '0');
        out.push(`${y}-${m}-${d}`);
        cursor.setDate(cursor.getDate() + 1);
        guard += 1;
    }
    return out;
}

/** ISO weekday (1=Mon .. 7=Sun) for a yyyy-MM-dd, read in LOCAL time. */
function isoWeekday(date: string): number {
    const day = new Date(`${date}T00:00:00`).getDay(); // 0=Sun
    return day === 0 ? 7 : day;
}

/** Paid minutes of one rostered shift. Only the UNPAID break comes off. */
function shiftPaidMinutes(shift: LeaveHoursShift): number {
    if (!shift.startTime || !shift.endTime) return 0;
    const toMinutes = (t: string): number => {
        const [h, m] = t.split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
        return h * 60 + m;
    };
    const start = toMinutes(shift.startTime);
    let end = toMinutes(shift.endTime);
    if (Number.isNaN(start) || Number.isNaN(end)) return 0;
    if (end <= start) end += 1440; // overnight
    const unpaidBreak = Math.max(0, shift.unpaidBreakMinutes ?? 0);
    return Math.max(0, end - start - unpaidBreak);
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The hours this request should consume. Never negative; 0 is a legitimate
 * answer (a casual on unpaid leave, or a range containing no working day).
 */
export function resolveRequestedLeaveHours(input: LeaveHoursInput): LeaveHoursResult {
    const { leaveType, startDate, endDate, contractedWeeklyHours, ordinaryDays, rosteredShifts } = input;

    const dates = eachDateInclusive(startDate, endDate);
    if (dates.length === 0) {
        return {
            hours: 0, basis: 'no-working-days', daysCounted: 0, publicHolidaysSkipped: [],
            explanation: 'Choose a start and end date to see how much leave this uses.',
        };
    }

    const policy = LEAVE_POLICIES[leaveType];
    const hasObligation = typeof contractedWeeklyHours === 'number' && contractedWeeklyHours > 0;

    // Casuals draw down nothing except where the type is paid for them.
    if (!hasObligation && !policy?.paidForCasual) {
        return {
            hours: 0, basis: 'unpaid-for-casual', daysCounted: 0, publicHolidaysSkipped: [],
            explanation: 'Casual employment does not accrue this leave type, so no balance is used. '
                + 'Submitting still records the absence so you are not rostered.',
        };
    }

    // ── 1. Rostered shifts, when we have looked and found some ───────────────
    if (rosteredShifts && rosteredShifts.length > 0) {
        const minutes = rosteredShifts.reduce((sum, s) => sum + shiftPaidMinutes(s), 0);
        const hours = round2(minutes / 60);
        return {
            hours,
            basis: 'rostered',
            daysCounted: rosteredShifts.length,
            publicHolidaysSkipped: [],
            explanation: `${hours}h — the paid hours of the ${rosteredShifts.length} shift`
                + `${rosteredShifts.length === 1 ? '' : 's'} you are already rostered for in this range.`,
        };
    }

    // ── 2. Contract estimate ─────────────────────────────────────────────────
    // A casual reaching here is on a paid-for-casual type (FDV) with no roster
    // to measure, so there is nothing to draw against and no contract to
    // estimate from. Say so rather than inventing a permanent's day.
    if (!hasObligation) {
        return {
            hours: 0, basis: 'no-working-days', daysCounted: 0, publicHolidaysSkipped: [],
            explanation: 'No shifts are rostered in this range yet, so there are no hours to pay. '
                + 'Your manager can confirm the amount once the roster is published.',
        };
    }

    const workingDays = ordinaryDays && ordinaryDays.length > 0 ? ordinaryDays : DEFAULT_ORDINARY_DAYS;
    // The daily rate follows the contract's OWN week: a part-timer on 20h across
    // three days has a 6.67h day, not a 4h one, so dividing by a flat 5 would
    // under-consume their balance by a third.
    const hoursPerDay = contractedWeeklyHours / workingDays.length;

    const publicHolidaysSkipped: string[] = [];
    let daysCounted = 0;
    for (const date of dates) {
        if (!workingDays.includes(isoWeekday(date))) continue;
        if (isPublicHoliday(new Date(`${date}T00:00:00`))) {
            publicHolidaysSkipped.push(date);
            continue;
        }
        daysCounted += 1;
    }

    if (daysCounted === 0) {
        return {
            hours: 0,
            basis: 'no-working-days',
            daysCounted: 0,
            publicHolidaysSkipped,
            explanation: publicHolidaysSkipped.length > 0
                ? 'This range covers no working days — every day in it is a public holiday or a '
                  + 'day you are not contracted to work, so no leave is used.'
                : 'This range covers no days you are contracted to work, so no leave is used.',
        };
    }

    const hours = round2(daysCounted * hoursPerDay);
    const holidayNote = publicHolidaysSkipped.length > 0
        ? `, excluding ${publicHolidaysSkipped.length} public holiday`
          + `${publicHolidaysSkipped.length === 1 ? '' : 's'}`
        : '';
    return {
        hours,
        basis: 'contract',
        daysCounted,
        publicHolidaysSkipped,
        explanation: `${hours}h — ${daysCounted} working day${daysCounted === 1 ? '' : 's'} `
            + `at ${round2(hoursPerDay)}h/day from your contract${holidayNote}. `
            + 'No roster is published for this range yet.',
    };
}
