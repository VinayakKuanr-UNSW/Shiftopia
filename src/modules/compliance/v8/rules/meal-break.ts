import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';
import { shiftDurationMinutes } from '../utils/time';

/** cl 36 — a meal break must not exceed 60 minutes (audit L-6). */
const MEAL_BREAK_MAX_MINUTES = 60;

/**
 * V8 Rule: Meal Breaks
 *
 * EBA Requirement: A meal break must be taken after no more than 5 hours (300 mins) worked,
 * and (cl 36) must not exceed 60 minutes.
 */
export const mealBreakRule: V8RuleEvaluator = (ctx) => {
    const { shifts } = ctx;
    const violations: V8Hit[] = [];

    for (const s of shifts) {
        // Per-shift check — only the shift(s) being added/changed, not the
        // employee's committed history (see V8Shift.is_candidate).
        if (s.is_candidate === false) continue;

        const totalMins = shiftDurationMinutes(s.start_time, s.end_time);

        // If shift is longer than 5 hours, we check if a break is recorded.
        // In the rostering UI, this is usually reflected by s.unpaid_break_minutes.
        if (totalMins > 300) {
            const hasBreak = (s.unpaid_break_minutes || 0) >= 30; // Standard 30min meal break

            if (!hasBreak) {
                violations.push({
                    rule_id: 'V8_MEAL_BREAK',
                    rule_name: 'Meal Break Requirement',
                    status: 'WARNING',
                    summary: `Missing meal break (>5h shift)`,
                    details: `Shift on ${s.date} is ${(totalMins / 60).toFixed(1)}h but has no scheduled meal break. EBA requires a break to be taken after 5 hours worked — confirm at timesheet.`,
                    affected_shifts: [s.id],
                    blocking: false,
                    calculation: {
                        duration_minutes: totalMins,
                        break_minutes: s.unpaid_break_minutes || 0
                    }
                });
            }
        }

        // AUDIT FIX L-6: only the 30-minute floor was ever checked — cl 36
        // also caps a meal break at 60 minutes. Independent of shift length,
        // since an over-length break is a data/scheduling issue either way.
        if ((s.unpaid_break_minutes || 0) > MEAL_BREAK_MAX_MINUTES) {
            violations.push({
                rule_id: 'V8_MEAL_BREAK_CEILING',
                rule_name: 'Meal Break Ceiling',
                status: 'WARNING',
                summary: `Meal break exceeds 60 minutes`,
                details: `Shift on ${s.date} has a ${s.unpaid_break_minutes}-minute unpaid break — cl 36 caps a meal break at ${MEAL_BREAK_MAX_MINUTES} minutes.`,
                affected_shifts: [s.id],
                blocking: false,
                calculation: {
                    break_minutes: s.unpaid_break_minutes || 0,
                    max_break_minutes: MEAL_BREAK_MAX_MINUTES,
                },
            });
        }
    }

    return violations;
};
