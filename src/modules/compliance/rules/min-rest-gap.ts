/**
 * Minimum Rest Gap Rule
 * 
 * RULE_ID: MIN_REST_GAP
 * LIMIT: 8 hours minimum rest between shifts on consecutive days
 * APPLIES_TO: add, assign, swap, bid
 * BLOCKING: true
 * 
 * This rule ensures employees have at least 8 hours rest between
 * the end of their last shift on one day and the start of their
 * first shift on the next day.
 */

import {
    ComplianceRule,
    ComplianceCheckInput,
    ComplianceResult
} from '../types';
import {
    parseTimeToMinutes,
    minutesToHours,
    getNextDate,
    getPreviousDate,
    formatDateForDisplay
} from '../utils';

const MIN_REST_HOURS = 8;
const MIN_REST_MINUTES = MIN_REST_HOURS * 60;

/**
 * Get the end time in minutes for the latest ending shift on a given date
 */
function getLatestEndTimeForDate(
    shifts: { start_time: string; end_time: string; shift_date: string }[],
    date: string
): number | null {
    let latest = -1;

    for (const shift of shifts) {
        if (shift.shift_date !== date) continue;

        const start = parseTimeToMinutes(shift.start_time);
        let end = parseTimeToMinutes(shift.end_time);

        // Handle cross-midnight: if end <= start, this shift ends the next day
        // So for the given date, the shift ends at midnight (1440)
        if (end <= start) {
            end = 24 * 60; // midnight (end of day)
        }

        if (end > latest) {
            latest = end;
        }
    }

    return latest === -1 ? null : latest;
}

/**
 * Get the start time in minutes for the earliest starting shift on a given date
 */
function getEarliestStartTimeForDate(
    shifts: { start_time: string; end_time: string; shift_date: string }[],
    date: string
): number | null {
    let earliest = Infinity;

    for (const shift of shifts) {
        if (shift.shift_date !== date) continue;

        const start = parseTimeToMinutes(shift.start_time);

        if (start < earliest) {
            earliest = start;
        }
    }

    return earliest === Infinity ? null : earliest;
}

export const MinRestGapRule: ComplianceRule = {
    id: 'MIN_REST_GAP',
    name: 'Minimum rest between days',
    description: 'Employees must have at least 8 hours rest between end of shift one day and start of shift next day',
    appliesTo: ['add', 'assign', 'swap', 'bid'],
    blocking: true,

    evaluate(input: ComplianceCheckInput): ComplianceResult {
        const { candidate_shift, existing_shifts } = input;
        const candidateDate = candidate_shift.shift_date;
        const candidateStart = parseTimeToMinutes(candidate_shift.start_time);
        let candidateEnd = parseTimeToMinutes(candidate_shift.end_time);

        // Handle cross-midnight for candidate shift
        if (candidateEnd <= candidateStart) {
            candidateEnd += 24 * 60;
        }

        // Get previous day and next day
        const previousDate = getPreviousDate(candidateDate);
        const nextDate = getNextDate(candidateDate);

        // Check 1: Previous day's latest shift end → candidate start
        // We need shifts from the previous day (passed via existing_shifts_for_day or fetch separately)
        // For now, we'll check within the provided shifts
        const prevDayShifts = existing_shifts.filter(s => s.shift_date === previousDate);
        const prevDayLatestEnd = getLatestEndTimeForDate(prevDayShifts, previousDate);

        // Also check if any shifts crossed midnight into our candidate date
        // Those would have end times on candidate date already in existing_shifts_for_day

        let prevDayGap: number | null = null;
        if (prevDayLatestEnd !== null) {
            // Gap = hours from previous day end (relative to midnight) to candidate start
            // Previous day's end time + candidate start time = gap
            const minutesFromMidnight = (24 * 60) - prevDayLatestEnd;
            prevDayGap = minutesFromMidnight + candidateStart;
        }

        // Check 2: Candidate end → next day's earliest shift start
        // For this we need next day's shifts. Check existing_shifts_for_day for any
        const nextDayShifts = existing_shifts.filter(s => s.shift_date === nextDate);

        let nextDayGap: number | null = null;
        const nextDayEarliestStart = getEarliestStartTimeForDate(nextDayShifts, nextDate);

        if (nextDayEarliestStart !== null) {
            // If candidate crosses midnight, candidateEnd > 1440
            // Gap = candidate end time on next day to next day's first shift start
            if (candidateEnd > 24 * 60) {
                // Candidate ends on next day at (candidateEnd - 24*60) minutes
                const endOnNextDay = candidateEnd - (24 * 60);
                nextDayGap = nextDayEarliestStart - endOnNextDay;
            } else {
                // Candidate ends on candidateDate
                // Gap = minutes remaining in day + next day start
                const minutesToMidnight = (24 * 60) - candidateEnd;
                nextDayGap = minutesToMidnight + nextDayEarliestStart;
            }
        }

        // Determine if there's a violation
        let violatesRest = false;
        let shortestGap: number | null = null;
        let violationContext = '';

        if (prevDayGap !== null && prevDayGap < MIN_REST_MINUTES) {
            violatesRest = true;
            shortestGap = prevDayGap;
            violationContext = `Only ${minutesToHours(prevDayGap).toFixed(1)}h rest from previous day's shift`;
        }

        if (nextDayGap !== null && nextDayGap < MIN_REST_MINUTES && (shortestGap === null || nextDayGap < shortestGap)) {
            violatesRest = true;
            shortestGap = nextDayGap;
            violationContext = `Only ${minutesToHours(nextDayGap).toFixed(1)}h rest before next day's shift`;
        }

        // Build result
        const result: ComplianceResult = {
            rule_id: this.id,
            rule_name: this.name,
            status: violatesRest ? 'fail' : 'pass',
            summary: violatesRest
                ? `Rest gap less than ${MIN_REST_HOURS} hours`
                : `Adequate rest gap (${MIN_REST_HOURS}+ hours)`,
            details: violatesRest
                ? violationContext
                : `Employee has at least ${MIN_REST_HOURS} hours rest between consecutive days`,
            calculation: {
                existing_hours: 0, // Not applicable
                candidate_hours: minutesToHours(candidateEnd - candidateStart),
                total_hours: 0, // Not applicable
                limit: MIN_REST_HOURS,
                prev_day_gap_hours: prevDayGap !== null ? minutesToHours(prevDayGap) : null,
                next_day_gap_hours: nextDayGap !== null ? minutesToHours(nextDayGap) : null,
                shortest_gap_hours: shortestGap !== null ? minutesToHours(shortestGap) : null,
                target_date: candidateDate
            },
            blocking: this.blocking
        };

        return result;
    }
};

export default MinRestGapRule;
