/**
 * Max Shift Length Rule
 * 
 * RULE_ID: MAX_SHIFT_LENGTH
 * LIMIT: 12 hours per single shift
 * APPLIES_TO: add, assign, swap, bid
 * BLOCKING: true
 * 
 * A single continuous shift cannot exceed 12 hours.
 * Independent of other shifts.
 */

import {
    ComplianceRule,
    ComplianceCheckInput,
    ComplianceResult
} from '../types';
import {
    parseTimeToMinutes,
    minutesToHours
} from '../utils';

const MAX_SHIFT_HOURS = 12;

export const MaxShiftLengthRule: ComplianceRule = {
    id: 'MAX_SHIFT_LENGTH',
    name: 'Maximum single shift length',
    description: 'A single shift cannot exceed 12 hours',
    appliesTo: ['add', 'assign', 'swap', 'bid'],
    blocking: true,

    evaluate(input: ComplianceCheckInput): ComplianceResult {
        const { candidate_shift, existing_shifts } = input;

        // Calculate NET hours for candidate shift
        const start = parseTimeToMinutes(candidate_shift.start_time);
        let end = parseTimeToMinutes(candidate_shift.end_time);
        if (end <= start) end += 24 * 60;

        const grossMinutes = end - start;
        const unpaidBreak = candidate_shift.unpaid_break_minutes || 0;
        const netMinutes = grossMinutes - unpaidBreak;
        const netHours = minutesToHours(netMinutes);

        // Collect all shifts on the same day for display
        const shiftsOnDay = existing_shifts.filter(
            s => s.shift_date === candidate_shift.shift_date
        );

        const shiftsList: { time: string; net_hours: number }[] = [];

        // Add existing shifts
        shiftsOnDay.forEach(s => {
            const sStart = parseTimeToMinutes(s.start_time);
            let sEnd = parseTimeToMinutes(s.end_time);
            if (sEnd <= sStart) sEnd += 24 * 60;
            const sGross = sEnd - sStart;
            const sBreak = s.unpaid_break_minutes || 0;
            const sNet = minutesToHours(sGross - sBreak);
            shiftsList.push({
                time: `${s.start_time} - ${s.end_time}`,
                net_hours: sNet
            });
        });

        // Add candidate shift
        shiftsList.push({
            time: `${candidate_shift.start_time} - ${candidate_shift.end_time}`,
            net_hours: netHours
        });

        const totalNetHours = shiftsList.reduce((sum, s) => sum + s.net_hours, 0);
        const violates = netHours > MAX_SHIFT_HOURS;

        return {
            rule_id: this.id,
            rule_name: this.name,
            status: violates ? 'fail' : 'pass',
            summary: violates
                ? `Shift exceeds ${MAX_SHIFT_HOURS}h NET limit`
                : `Shift within ${MAX_SHIFT_HOURS}h NET limit`,
            details: violates
                ? `NET Duration: ${netHours.toFixed(1)}h (limit: ${MAX_SHIFT_HOURS}h)`
                : `NET shift duration is ${netHours.toFixed(1)}h`,
            calculation: {
                existing_hours: totalNetHours - netHours,
                candidate_hours: netHours,
                total_hours: netHours,
                limit: MAX_SHIFT_HOURS,
                gross_minutes: grossMinutes,
                unpaid_break: unpaidBreak,
                shifts_list: shiftsList
            },
            blocking: this.blocking
        };
    }
};

export default MaxShiftLengthRule;
