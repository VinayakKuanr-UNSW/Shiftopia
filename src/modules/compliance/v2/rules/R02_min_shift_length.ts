/**
 * R02 — Minimum Shift Length
 *
 * Only evaluates candidate (incoming) shifts — no need to re-check published shifts.
 * Net hours (after break deduction) must meet config.min_shift_hours.
 */

import { RuleEvaluatorV2, RuleHitV2 } from '../types';
import { shiftDurationHours } from '../windows';

export const R02_min_shift_length: RuleEvaluatorV2 = (ctx) => {
    const hits: RuleHitV2[] = [];
    const min = ctx.config.min_shift_hours;

    for (const shift of ctx.candidate_shifts) {
        const hours = shiftDurationHours(shift);
        if (hours < min) {
            hits.push({
                rule_id:  'R02_MIN_SHIFT_LENGTH',
                severity: 'BLOCKING',
                message:
                    `Shift on ${shift.shift_date} (${shift.start_time}–${shift.end_time}) `
                    + `is ${hours.toFixed(2)}h — minimum is ${min}h.`,
                resolution_hint: `Extend the shift to at least ${min} hours.`,
                affected_shifts: [shift.shift_id],
            });
        }
    }

    return hits;
};
