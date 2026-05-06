import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';
import { differenceInMinutes, parseISO } from 'date-fns';

/**
 * V8 Rule: Meal Breaks
 * 
 * Enforces mandatory 30m break for shifts longer than 5 hours (300m).
 */
export const mealBreakRule: V8RuleEvaluator = (ctx) => {
    const { shifts, config } = ctx;
    const violations: V8Hit[] = [];

    for (const s of shifts) {
        const date = s.date || s.shift_date || '';
        const start = parseISO(`${date}T${s.start_time}`);
        const end = parseISO(`${date}T${s.end_time}`);
        let mins = differenceInMinutes(end, start);
        if (mins < 0) mins += 1440;

        if (mins >= config.meal_break_threshold_minutes && (s as any).break_minutes < 30) {
            violations.push({
                rule_id: 'V8_MEAL_BREAK',
                rule_name: 'Meal Break',
                status: 'BLOCKING',
                summary: 'Missing mandatory meal break',
                details: `Shift on ${s.date} (${(mins/60).toFixed(1)}h) requires a 30-minute break. Only ${(s as any).break_minutes || 0}m recorded.`,
                affected_shifts: [s.id],
                blocking: true
            });
        }
    }
    return violations;
};

/**
 * V8 Rule: Qualifications & Skills
 * 
 * Ensures the employee holds all skills and licenses required for the shift.
 */
export const qualificationRule: V8RuleEvaluator = (ctx) => {
    const { employee, shifts } = ctx;
    const violations: V8Hit[] = [];
    
    // In V8, we expect the caller to have already resolved the employee's skills/licenses
    const employeeQuals = new Set([
        ...(employee.skill_ids || []),
        ...(employee.license_ids || [])
    ]);

    for (const s of shifts) {
        const required = (s as any).required_qualifications || [];
        const missing = required.filter((q: string) => !employeeQuals.has(q));

        if (missing.length > 0) {
            violations.push({
                rule_id: 'V8_QUALIFICATIONS',
                rule_name: 'Qualifications',
                status: 'BLOCKING',
                summary: 'Missing required qualifications',
                details: `Employee is missing ${missing.length} required qualification(s) for this shift.`,
                affected_shifts: [s.id],
                blocking: true,
                calculation: { missing }
            });
        }
    }
    return violations;
};
