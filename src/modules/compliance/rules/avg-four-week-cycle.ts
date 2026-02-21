
import {
    ComplianceRule,
    ComplianceCheckInput,
    ComplianceResult
} from '../types';
import { parseISO, subDays, isWithinInterval, differenceInMinutes, format } from 'date-fns';
import { parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';

export const AvgFourWeekCycleRule: ComplianceRule = {
    id: 'AVG_FOUR_WEEK_CYCLE',
    name: 'Average Monthly Cycle (152h/4wk)',
    description: 'Maximum of 152 hours in any 4-week cycle (Avg 38h/wk) (EBA Cl 35.1a).',
    appliesTo: ['add', 'assign', 'swap', 'bid'],
    blocking: true, // Blocking check

    evaluate(input: ComplianceCheckInput): ComplianceResult {
        if (!input.employee_id) {
            return {
                rule_id: this.id,
                rule_name: this.name,
                status: 'pass',
                summary: 'Shift is unassigned',
                details: 'Compliance checks skipped for unassigned shift',
                calculation: { existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 152 },
                blocking: false
            };
        }

        const { candidate_shift, existing_shifts } = input;

        // Use Rolling 4-week window (28 days) ending on candidate shift date
        const shiftDate = parseISO(candidate_shift.shift_date);
        const windowStart = subDays(shiftDate, 27);
        const windowEnd = shiftDate;

        let totalMinutes = 0;

        // Helper to calculate minutes for a shift
        const getShiftMinutes = (s: any) => {
            const start = parseZonedDateTime(s.shift_date, s.start_time, SYDNEY_TZ);
            const end = parseZonedDateTime(s.shift_date, s.end_time, SYDNEY_TZ);
            let mins = differenceInMinutes(end, start);
            if (mins < 0) mins += 1440;
            return Math.max(0, mins - (s.unpaid_break_minutes || 0));
        };

        // 1. Add Candidate Shift
        totalMinutes += getShiftMinutes(candidate_shift);

        // 2. Add Existing Shifts in Window
        existing_shifts.forEach(shift => {
            const sDate = parseISO(shift.shift_date);
            if (isWithinInterval(sDate, { start: windowStart, end: windowEnd })) {
                totalMinutes += getShiftMinutes(shift);
            }
        });

        const totalHours = totalMinutes / 60;

        if (totalHours > 152) {
            return {
                rule_id: this.id,
                rule_name: this.name,
                status: 'fail',
                summary: `Exceeds 152h limit in 4-week period (${totalHours.toFixed(1)}h)`,
                details: `Total hours in rolling 4-week period: ${totalHours.toFixed(1)}h. Limit is 152h.`,
                calculation: {
                    existing_hours: (totalMinutes - getShiftMinutes(candidate_shift)) / 60,
                    candidate_hours: getShiftMinutes(candidate_shift) / 60,
                    total_hours: totalHours,
                    limit: 152
                },
                blocking: this.blocking
            };
        }

        return {
            rule_id: this.id,
            rule_name: this.name,
            status: 'pass',
            summary: `Within 152h/4wk limit (${totalHours.toFixed(1)}h)`,
            details: `Rolling 4-week total: ${totalHours.toFixed(1)}h / 152h`,
            calculation: {
                existing_hours: (totalMinutes - getShiftMinutes(candidate_shift)) / 60,
                candidate_hours: getShiftMinutes(candidate_shift) / 60,
                total_hours: totalHours,
                limit: 152
            },
            blocking: this.blocking
        };
    }
};
