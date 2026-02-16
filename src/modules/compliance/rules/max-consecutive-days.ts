/**
 * Max Consecutive Working Days Rule
 * 
 * RULE_ID: MAX_CONSECUTIVE_DAYS
 * LIMIT: 12 consecutive working days (block on 13th)
 * APPLIES_TO: add, assign, swap, bid
 * BLOCKING: true
 * 
 * Implementation follows the 15-step specification:
 * - Multiple shifts on same calendar day = 1 working day
 * - A single gap day resets the streak completely
 * - Only past days + candidate day are evaluated
 * - Rule based on calendar days, not hours or shifts
 */


import {
    ComplianceRule,
    ComplianceCheckInput,
    ComplianceResult,
    ShiftTimeRange
} from '../types';
import { parseISO, subDays, addDays, format, differenceInCalendarDays } from 'date-fns';
import { splitShiftByDay } from '../utils';

const MAX_CONSECUTIVE_DAYS = 20;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract unique calendar dates from shifts, handling cross-midnight
 */
function extractUniqueDates(shifts: ShiftTimeRange[]): Set<string> {
    const dates = new Set<string>();

    for (const shift of shifts) {
        // Handle cross-midnight shifts
        const dayRanges = splitShiftByDay(shift);
        for (const range of dayRanges) {
            dates.add(range.shift_date);
        }
    }

    return dates;
}

/**
 * Count consecutive days surrounding the candidate date (backwards AND forwards).
 * This is crucial for bulk assignments where the candidate might be the start of a sequence.
 */
function countConsecutiveDaysSurrounding(
    candidateDate: string,
    workingDates: Set<string>
): { consecutiveDays: number; streakStart: string; streakEnd: string } {
    let consecutiveDays = 1; // Start with candidate day
    let streakStart = candidateDate;
    let streakEnd = candidateDate;

    const candidateDateParsed = parseISO(candidateDate);

    // Look Backwards
    let backDate = subDays(candidateDateParsed, 1);
    while (true) {
        const dateStr = format(backDate, 'yyyy-MM-dd');
        if (workingDates.has(dateStr)) {
            consecutiveDays++;
            streakStart = dateStr;
            backDate = subDays(backDate, 1);
        } else {
            break;
        }
    }

    // Look Forwards
    let forwardDate = addDays(candidateDateParsed, 1);
    while (true) {
        const dateStr = format(forwardDate, 'yyyy-MM-dd');
        if (workingDates.has(dateStr)) {
            consecutiveDays++;
            streakEnd = dateStr; // Update end of streak
            forwardDate = addDays(forwardDate, 1);
        } else {
            break;
        }
    }

    return { consecutiveDays, streakStart, streakEnd };
}

// =============================================================================
// MAIN RULE
// =============================================================================

export const MaxConsecutiveDaysRule: ComplianceRule = {
    id: 'MAX_CONSECUTIVE_DAYS',
    name: 'Max consecutive working days',
    description: `Employees cannot work more than ${MAX_CONSECUTIVE_DAYS} consecutive days.`,
    appliesTo: ['add', 'assign', 'swap', 'bid'],
    blocking: true,

    evaluate(input: ComplianceCheckInput): ComplianceResult {
        const { candidate_shift, existing_shifts } = input;

        // Step 3: Extract candidate shift date
        const candidateDate = candidate_shift.shift_date;
        const candidateDateParsed = parseISO(candidateDate);

        // Step 4: Filter existing shifts to a safe wider window (30 days both sides)
        // We look forward too because in bulk assignments, "existing_shifts" includes other candidates!
        const windowStart = subDays(candidateDateParsed, 30);
        const windowEnd = addDays(candidateDateParsed, 30);

        const relevantShifts = existing_shifts.filter(shift => {
            const shiftDate = parseISO(shift.shift_date);
            return shiftDate >= windowStart && shiftDate <= windowEnd;
        });

        // Step 5: Derive unique working dates from existing shifts
        const workingDates = extractUniqueDates(relevantShifts);

        // Step 6: Add candidate shift date to the set
        workingDates.add(candidateDate);

        // Step 7-11: Count consecutive days surrounding the candidate
        const { consecutiveDays, streakStart, streakEnd } = countConsecutiveDaysSurrounding(
            candidateDate,
            workingDates
        );

        // Step 12: Evaluate result
        const violates = consecutiveDays > MAX_CONSECUTIVE_DAYS;

        // Format dates for display
        const streakStartFormatted = format(parseISO(streakStart), 'EEE d MMM');
        const streakEndFormatted = format(parseISO(streakEnd), 'EEE d MMM');

        // Step 14-15: Return structured result
        return {
            rule_id: this.id,
            rule_name: this.name,
            status: violates ? 'fail' : 'pass',
            summary: violates
                ? `Streak of ${consecutiveDays} days exceeds limit`
                : `Within ${MAX_CONSECUTIVE_DAYS} consecutive days limit`,
            details: violates
                ? `Adding this shift contributes to a ${consecutiveDays}-day streak from ${streakStartFormatted} to ${streakEndFormatted}. Maximum allowed is ${MAX_CONSECUTIVE_DAYS} days.`
                : `Current streak: ${consecutiveDays} day${consecutiveDays !== 1 ? 's' : ''} (${streakStartFormatted} — ${streakEndFormatted})`,
            calculation: {
                existing_hours: 0,
                candidate_hours: 0,
                total_hours: 0,
                limit: MAX_CONSECUTIVE_DAYS,
                streak_days: consecutiveDays,
                streak_start: streakStart,
                streak_end: streakEnd,
                all_working_dates: Array.from(workingDates).sort()
            },
            blocking: this.blocking
        };
    }
};

export default MaxConsecutiveDaysRule;
