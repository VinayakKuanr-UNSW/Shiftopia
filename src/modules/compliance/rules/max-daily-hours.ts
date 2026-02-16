/**
 * Max Daily Hours Rule
 * 
 * RULE_ID: MAX_DAILY_HOURS
 * LIMIT: 12 hours net per calendar day
 * APPLIES_TO: add, assign, swap, bid
 * BLOCKING: true
 * 
 * This rule prevents employees from being scheduled for more than 12 hours
 * in a single calendar day.
 */

import {
    ComplianceRule,
    ComplianceCheckInput,
    ComplianceResult
} from '../types';
import {
    getShiftHoursForDate,
    getTotalHoursForDate,
    formatDateForDisplay,
    getNextDate
} from '../utils';

const MAX_DAILY_HOURS = 12;

export const MaxDailyHoursRule: ComplianceRule = {
    id: 'MAX_DAILY_HOURS',
    name: 'Maximum daily working hours',
    description: 'Employees cannot work more than 12 hours in a single calendar day',
    appliesTo: ['add', 'assign', 'swap', 'bid'],
    blocking: true,

    evaluate(input: ComplianceCheckInput): ComplianceResult {
        const { candidate_shift, existing_shifts } = input;
        const targetDate = candidate_shift.shift_date;

        // Calculate hours for the candidate shift on the target date
        const candidateHours = getShiftHoursForDate(candidate_shift, targetDate);

        // Calculate existing hours for the target date
        const existingHours = getTotalHoursForDate(existing_shifts, targetDate);

        // Calculate total
        const totalHours = Math.round((existingHours + candidateHours) * 100) / 100;

        // DEBUG: Trace why it might be blocking incorrectly
        if (totalHours > MAX_DAILY_HOURS || totalHours === 5) {
            console.log(`[MaxDailyHours] Date: ${targetDate} | Exist: ${existingHours} | Cand: ${candidateHours} | Total: ${totalHours} | Limit: ${MAX_DAILY_HOURS}`);
        }

        // Determine status
        const exceedsLimit = totalHours > MAX_DAILY_HOURS;

        // Build result
        const result: ComplianceResult = {
            rule_id: this.id,
            rule_name: this.name,
            status: exceedsLimit ? 'fail' : 'pass',
            summary: exceedsLimit
                ? `Exceeds ${MAX_DAILY_HOURS} hours daily limit`
                : `Within ${MAX_DAILY_HOURS} hours daily limit`,
            details: exceedsLimit
                ? `This shift would bring the employee to ${totalHours} hours on ${formatDateForDisplay(targetDate)}`
                : `Total of ${totalHours} hours on ${formatDateForDisplay(targetDate)}`,
            calculation: {
                existing_hours: existingHours,
                candidate_hours: candidateHours,
                total_hours: totalHours,
                limit: MAX_DAILY_HOURS,
                target_date: targetDate
            },
            blocking: this.blocking
        };

        // Also check next day if this is a cross-midnight shift
        const nextDayHours = getShiftHoursForDate(candidate_shift, getNextDate(targetDate));
        if (nextDayHours > 0) {
            // This shift crosses midnight - we should also check the next day
            // For now, add this info to the calculation
            result.calculation.next_day_hours = nextDayHours;
            result.calculation.crosses_midnight = true;
        }

        return result;
    }
};

export default MaxDailyHoursRule;
