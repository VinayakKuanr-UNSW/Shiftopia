import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';
import { parseTimeToMinutes } from '../utils/time';

/**
 * V8 Rule: Maximum Daily Hours
 * 
 * Prevents employees from working more than 12 hours in a single calendar day.
 */
export const maxDailyHoursRule: V8RuleEvaluator = (ctx) => {
    const { shifts, config } = ctx;
    
    const dailyMinutes = new Map<string, number>();
    
    for (const s of shifts) {
        const date = s.date || s.shift_date || '';
        const start = parseTimeToMinutes(s.start_time);
        let end = parseTimeToMinutes(s.end_time);
        
        let totalMins = end - start;
        if (totalMins < 0) totalMins += 1440; // Cross-midnight
        
        dailyMinutes.set(date, (dailyMinutes.get(date) || 0) + totalMins);
    }
    
    const violations: V8Hit[] = [];
    const limitMins = config.max_daily_hours * 60;
    
    for (const [date, mins] of dailyMinutes.entries()) {
        if (mins > limitMins) {
            violations.push({
                rule_id: 'V8_MAX_DAILY_HOURS',
                rule_name: 'Maximum Daily Hours',
                status: 'BLOCKING',
                summary: `Exceeds ${config.max_daily_hours}h daily limit`,
                details: `Employee worked ${(mins / 60).toFixed(1)}h on ${date}, exceeding the ${config.max_daily_hours}h cap.`,
                affected_shifts: shifts.filter(s => (s.date || s.shift_date) === date).map(s => s.id),
                blocking: true,
                calculation: {
                    total_minutes: mins,
                    limit_minutes: limitMins,
                    date
                }
            });
        }
    }
    
    return violations;
};
