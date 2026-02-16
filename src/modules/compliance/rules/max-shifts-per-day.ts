/**
 * Max Shifts Per Day Rule
 * 
 * RULE_ID: MAX_SHIFTS_PER_DAY
 * LIMIT: 3 shifts per day
 * APPLIES_TO: add, assign, swap, bid
 * BLOCKING: true
 * 
 * Ensure an employee does not work more than 3 distinct shifts in a single day.
 */

import {
    ComplianceRule,
    ComplianceCheckInput,
    ComplianceResult
} from '../types';

const MAX_SHIFTS = 3;

export const MaxShiftsPerDayRule: ComplianceRule = {
    id: 'MAX_SHIFTS_PER_DAY',
    name: 'Maximum shifts per day',
    description: `Employees cannot work more than ${MAX_SHIFTS} shifts in a single day`,
    appliesTo: ['add', 'assign', 'swap', 'bid'],
    blocking: true,

    evaluate(input: ComplianceCheckInput): ComplianceResult {
        const { candidate_shift, existing_shifts } = input;
        const targetDate = candidate_shift.shift_date;

        // Count shifts on this day
        // Filter existing shifts for same day
        const shiftsToday = existing_shifts.filter(s => s.shift_date === targetDate);

        // Total count = existing + 1 (candidate)
        const totalShifts = shiftsToday.length + 1;

        const violates = totalShifts > MAX_SHIFTS;

        return {
            rule_id: this.id,
            rule_name: this.name,
            status: violates ? 'fail' : 'pass',
            summary: violates
                ? `Exceeds ${MAX_SHIFTS} shifts per day limit`
                : `Within ${MAX_SHIFTS} shifts limit`,
            details: violates
                ? `Employee has ${totalShifts} shifts on ${targetDate}`
                : `Total shifts today: ${totalShifts} (limit: ${MAX_SHIFTS})`,
            calculation: {
                existing_hours: 0,
                candidate_hours: 0,
                total_hours: 0,
                limit: MAX_SHIFTS,
                shift_count: totalShifts,
                shifts_list: [...shiftsToday, candidate_shift].map(s => `${s.start_time}-${s.end_time}`)
            },
            blocking: this.blocking
        };
    }
};

export default MaxShiftsPerDayRule;
