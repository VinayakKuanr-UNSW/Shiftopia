/**
 * Minimum Shift Length Rule
 *
 * RULE_ID: MIN_SHIFT_LENGTH
 * APPLIES_TO: add, assign, swap, bid
 * BLOCKING: true
 *
 * Context-aware minimums (User Story 5):
 *   Training shift  → 2 hours
 *   Weekday shift   → 3 hours
 *   Sunday / Public Holiday → 4 hours
 *
 * Sunday is auto-detected from the shift date.
 * Public holidays are passed via input.public_holiday_dates (YYYY-MM-DD[]).
 * Training context is passed via input.candidate_is_training.
 */

import {
    ComplianceRule,
    ComplianceCheckInput,
    ComplianceResult
} from '../types';
import { differenceInMinutes, parseISO, getDay } from 'date-fns';
import { parseZonedDateTime, SYDNEY_TZ } from '@/modules/core/lib/date.utils';

type ShiftContext = 'training' | 'sunday_or_holiday' | 'weekday';

function resolveShiftContext(input: ComplianceCheckInput): { context: ShiftContext; minHours: number } {
    if (input.candidate_is_training) {
        return { context: 'training', minHours: 2 };
    }

    const shiftDate = input.candidate_shift.shift_date;

    // Sunday: getDay returns 0
    const dayOfWeek = getDay(parseISO(shiftDate));
    if (dayOfWeek === 0) {
        return { context: 'sunday_or_holiday', minHours: 4 };
    }

    // Public holiday
    if (input.public_holiday_dates?.includes(shiftDate)) {
        return { context: 'sunday_or_holiday', minHours: 4 };
    }

    return { context: 'weekday', minHours: 3 };
}

const CONTEXT_LABELS: Record<ShiftContext, string> = {
    training: 'Training shift',
    sunday_or_holiday: 'Sunday / Public Holiday',
    weekday: 'Weekday shift'
};

export const MinShiftLengthRule: ComplianceRule = {
    id: 'MIN_SHIFT_LENGTH',
    name: 'Minimum Shift Length',
    description: 'Training ≥ 2h · Weekday ≥ 3h · Sunday / Public Holiday ≥ 4h',
    appliesTo: ['add', 'assign', 'swap', 'bid'],
    blocking: true,

    evaluate(input: ComplianceCheckInput): ComplianceResult {
        if (!input.employee_id) {
            return {
                rule_id: this.id,
                rule_name: this.name,
                status: 'pass',
                summary: 'Shift is unassigned',
                details: 'Compliance checks skipped for unassigned shift',
                calculation: { existing_hours: 0, candidate_hours: 0, total_hours: 0, limit: 3, shift_duration: 0 },
                blocking: false
            };
        }

        const { candidate_shift } = input;
        // F9: use org_timezone from input, fall back to Sydney for backward compatibility
        const tz = input.org_timezone ?? SYDNEY_TZ;
        const { context, minHours } = resolveShiftContext(input);
        const contextLabel = CONTEXT_LABELS[context];

        const start = parseZonedDateTime(candidate_shift.shift_date, candidate_shift.start_time, tz);
        const end = parseZonedDateTime(candidate_shift.shift_date, candidate_shift.end_time, tz);

        let durationMinutes = differenceInMinutes(end, start);
        if (durationMinutes < 0) durationMinutes += 1440; // cross-midnight

        const netDurationMinutes = durationMinutes - (candidate_shift.unpaid_break_minutes || 0);
        const netDurationHours = netDurationMinutes / 60;

        const pass = netDurationHours >= minHours;

        return {
            rule_id: this.id,
            rule_name: this.name,
            status: pass ? 'pass' : 'fail',
            summary: pass
                ? `${contextLabel}: ${netDurationHours.toFixed(1)}h meets ${minHours}h minimum`
                : `${contextLabel}: ${netDurationHours.toFixed(1)}h is below ${minHours}h minimum`,
            details: pass
                ? `Shift duration (${netDurationHours.toFixed(1)}h) meets the ${minHours}h minimum for a ${contextLabel.toLowerCase()}.`
                : `Minimum shift engagement for a ${contextLabel.toLowerCase()} is ${minHours} hours. Current shift is ${netDurationHours.toFixed(1)} hours.`,
            calculation: {
                existing_hours: 0,
                candidate_hours: netDurationHours,
                total_hours: netDurationHours,
                shift_duration: netDurationHours,
                limit: minHours,
                shift_context: context,
                context_label: contextLabel
            },
            blocking: this.blocking
        };
    }
};
