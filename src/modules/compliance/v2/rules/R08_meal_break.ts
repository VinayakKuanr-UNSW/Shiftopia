/**
 * R08 — Mandatory Meal Break
 *
 * For shifts longer than config.meal_break_threshold_hours, a break of at least
 * config.meal_break_minimum_minutes must be recorded on the shift.
 *
 * Operation awareness:
 *   BID  → rule is skipped entirely (meal break scheduling is not confirmed at bid stage).
 *          The severity-resolver handles this with null — but we short-circuit here too
 *          for clarity and performance.
 *
 * Base severity: WARNING (escalated to BLOCKING at PUBLISH by severity-resolver).
 */

import { RuleEvaluatorV2, RuleHitV2 } from '../types';
import { shiftDurationHours } from '../windows';

export const R08_meal_break: RuleEvaluatorV2 = (ctx) => {
    // Meal break confirmation is not relevant for bid simulation
    if (ctx.operation_type === 'BID') return [];

    const hits: RuleHitV2[] = [];
    const thresholdH = ctx.config.meal_break_threshold_hours;
    const minBreak   = ctx.config.meal_break_minimum_minutes;

    for (const shift of ctx.candidate_shifts) {
        const duration = shiftDurationHours(shift);

        if (duration > thresholdH && shift.break_minutes < minBreak) {
            hits.push({
                rule_id:  'R08_MEAL_BREAK',
                severity: 'WARNING',    // severity-resolver escalates to BLOCKING at PUBLISH
                message:
                    `Shift on ${shift.shift_date} (${shift.start_time}–${shift.end_time}) `
                    + `is ${duration.toFixed(2)}h with only ${shift.break_minutes}min break `
                    + `— ${minBreak}min minimum required.`,
                resolution_hint: `Record a break of at least ${minBreak} minutes for this shift.`,
                affected_shifts: [shift.shift_id],
            });
        }
    }

    return hits;
};
