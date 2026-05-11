import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';
import { parseTimeToMinutes } from '../utils/time';

/**
 * V8 Rule: Meal Breaks
 * 
 * EBA Requirement: A meal break must be taken after no more than 5 hours (300 mins) worked.
 */
export const mealBreakRule: V8RuleEvaluator = (ctx) => {
    const { shifts } = ctx;
    const violations: V8Hit[] = [];

    for (const s of shifts) {
        const start = parseTimeToMinutes(s.start_time);
        let end = parseTimeToMinutes(s.end_time);
        
        let totalMins = end - start;
        if (totalMins < 0) totalMins += 1440; // Cross-midnight

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
    }

    return violations;
};
