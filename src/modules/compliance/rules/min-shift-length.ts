
import {
    ComplianceRule,
    ComplianceCheckInput,
    ComplianceResult
} from '../types';
import { differenceInMinutes, parseISO } from 'date-fns';
import { parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';

export const MinShiftLengthRule: ComplianceRule = {
    id: 'MIN_SHIFT_LENGTH',
    name: 'Minimum Shift Length',
    description: 'Shifts must be at least 3 hours long (EBA Cl 12.3e).',
    appliesTo: ['add', 'assign', 'swap', 'bid'],
    blocking: true,

    evaluate(input: ComplianceCheckInput): ComplianceResult {
        // If unassigned, skip check with info message
        if (!input.employee_id) {
            return {
                rule_id: this.id,
                rule_name: this.name,
                status: 'pass',
                summary: 'Shift is unassigned',
                details: 'Compliance checks skipped for unassigned shift',
                calculation: { existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 3 },
                blocking: false
            };
        }

        const { candidate_shift } = input;

        // Parse times using correct timezone to avoid DST calculation errors
        const start = parseZonedDateTime(candidate_shift.shift_date, candidate_shift.start_time, SYDNEY_TZ);
        const end = parseZonedDateTime(candidate_shift.shift_date, candidate_shift.end_time, SYDNEY_TZ);

        // Handle cross-midnight
        let durationMinutes = differenceInMinutes(end, start);
        if (durationMinutes < 0) {
            durationMinutes += 1440;
        }

        // Subtract unpaid break
        const netDurationMinutes = durationMinutes - (candidate_shift.unpaid_break_minutes || 0);
        const netDurationHours = netDurationMinutes / 60;

        if (netDurationHours < 3) {
            return {
                rule_id: this.id,
                rule_name: this.name,
                status: 'fail',
                summary: `Shift length ${netDurationHours.toFixed(1)}h is shorter than minimum 3.0h`,
                details: `Minimum shift engagement is 3 hours. Current shift is ${netDurationHours.toFixed(1)} hours.`,
                calculation: {
                    existing_hours: 0,
                    candidate_hours: netDurationHours,
                    total_hours: netDurationHours,
                    limit: 3
                },
                blocking: this.blocking
            };
        }

        return {
            rule_id: this.id,
            rule_name: this.name,
            status: 'pass',
            summary: 'Shift meets minimum duration',
            details: `Shift is ${netDurationHours.toFixed(1)} hours (Min: 3h)`,
            calculation: {
                existing_hours: 0,
                candidate_hours: netDurationHours,
                total_hours: netDurationHours,
                limit: 3
            },
            blocking: this.blocking
        };
    }
};
