/**
 * R02 — Minimum Shift Length
 *
 * Context-aware minimum durations:
 *   - Training shifts (is_training): 2h minimum
 *   - Sunday / Public Holiday shifts: 4h minimum
 *   - Standard weekday shifts:        3h minimum
 *
 * Net hours (after break deduction) must meet the calculated threshold.
 * The config.min_shift_hours is used as a fallback default (3h) but is
 * overridden when the shift carries enough context to determine its type.
 */

import { RuleEvaluatorV2, RuleHitV2 } from '../types';
import { shiftDurationHours } from '../windows';
import { isPublicHoliday } from '@/modules/core/lib/date.utils';

/**
 * Compute the context-aware minimum shift hours for a candidate shift.
 * Priority: Training (2h) → Sunday/PH (4h) → Weekday default (3h).
 */
function resolveMinHours(
    shift: { shift_date: string; is_training?: boolean },
    configDefault: number,
): number {
    // Training shifts have a reduced minimum
    if (shift.is_training) return 2.0;

    // Sunday (day 0) or Public Holiday → 4h
    const date = new Date(shift.shift_date + 'T00:00:00');
    const dayOfWeek = date.getDay(); // 0 = Sunday
    if (dayOfWeek === 0 || isPublicHoliday(date)) return 4.0;

    // Weekday default (config-driven, typically 3h)
    return configDefault;
}

export const R02_min_shift_length: RuleEvaluatorV2 = (ctx) => {
    const hits: RuleHitV2[] = [];

    for (const shift of ctx.candidate_shifts) {
        const min = resolveMinHours(shift, ctx.config.min_shift_hours);
        const hours = shiftDurationHours(shift);
        if (hours < min) {
            const label = shift.is_training ? 'Training' : min === 4.0 ? 'Sunday/PH' : 'Weekday';
            hits.push({
                rule_id:  'R02_MIN_SHIFT_LENGTH',
                severity: 'BLOCKING',
                message:
                    `Shift on ${shift.shift_date} (${shift.start_time}–${shift.end_time}) `
                    + `is ${hours.toFixed(2)}h — ${label} minimum is ${min}h.`,
                resolution_hint: `Extend the shift to at least ${min} hours.`,
                affected_shifts: [shift.shift_id],
            });
        }
    }

    return hits;
};
