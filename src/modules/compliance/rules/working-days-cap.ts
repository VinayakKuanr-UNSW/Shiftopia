
import {
    ComplianceRule,
    ComplianceCheckInput,
    ComplianceResult
} from '../types';
import { parseISO, subDays, isWithinInterval, format } from 'date-fns';

export const WorkingDaysCapRule: ComplianceRule = {
    id: 'WORKING_DAYS_CAP',
    name: 'Maximum Working Days (20/28)',
    description: 'Maximum of 20 working days in any 28-day cycle (EBA Cl 35.1e).',
    appliesTo: ['add', 'assign', 'swap'],
    blocking: true, // Blocking check

    evaluate(input: ComplianceCheckInput): ComplianceResult {
        if (!input.employee_id) {
            return {
                rule_id: this.id,
                rule_name: this.name,
                status: 'pass',
                summary: 'Shift is unassigned',
                details: 'Compliance checks skipped for unassigned shift',
                calculation: { existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 20 },
                blocking: false
            };
        }

        const { candidate_shift, existing_shifts } = input;
        const shiftDate = parseISO(candidate_shift.shift_date);

        // Check window: [D-27, D]
        const windowStart = subDays(shiftDate, 27);
        const windowEnd = shiftDate;

        // Collect all unique working days in this window
        const workingDays = new Set<string>();

        // 1. Add Candidate
        workingDays.add(candidate_shift.shift_date);

        // 2. Add Existing Shifts in Window
        existing_shifts.forEach(shift => {
            const sDate = parseISO(shift.shift_date);
            if (isWithinInterval(sDate, { start: windowStart, end: windowEnd })) {
                workingDays.add(shift.shift_date);
            }
        });

        const dayCount = workingDays.size;

        if (dayCount > 20) {
            return {
                rule_id: this.id,
                rule_name: this.name,
                status: 'fail',
                summary: `Exceeds 20 working days in 28-day period (${dayCount} days)`,
                details: `Employee works ${dayCount} days in the 28-day period ending ${format(shiftDate, 'dd/MM')}. Max allowed is 20.`,
                calculation: {
                    existing_hours: 0, // Not hour based
                    candidate_hours: 0,
                    total_hours: 0,
                    limit: 20,
                    day_count: dayCount
                },
                blocking: this.blocking
            };
        }

        return {
            rule_id: this.id,
            rule_name: this.name,
            status: 'pass',
            summary: `Within 20/28 day limit (${dayCount} days)`,
            details: `Employee works ${dayCount} days in the current 28-day cycle.`,
            calculation: {
                existing_hours: 0,
                candidate_hours: 0,
                total_hours: 0,
                limit: 20,
                day_count: dayCount
            },
            blocking: this.blocking
        };
    }
};
