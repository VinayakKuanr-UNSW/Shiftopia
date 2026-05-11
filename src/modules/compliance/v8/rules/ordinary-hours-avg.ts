import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';
import { parseTimeToMinutes } from '../utils/time';

/**
 * V8 Rule: Ordinary Hours Averaging
 * 
 * Enforces the EBA requirement that employees average <= 38h per week
 * over a rolling 4-week (28-day) cycle (Total 152h).
 */
export const ordinaryHoursAvgRule: V8RuleEvaluator = (ctx) => {
    const { employee, shifts, config } = ctx;
    
    // Not applicable for casuals (no contracted rate)
    if (employee.contract_type === 'CASUAL') return [];
    
    // 1. Build Daily Net Hours Map
    const dailyHours = new Map<string, number>();
    for (const s of shifts) {
        const dateStr = s.date || s.shift_date || '';
        // CRITICAL: Skip shifts with missing scheduling info to prevent crashes
        if (!dateStr || !s.start_time || !s.end_time) continue;
        if (!s.is_ordinary_hours) continue;
        
        const startMins = parseTimeToMinutes(s.start_time);
        let endMins = parseTimeToMinutes(s.end_time);
        
        if (endMins <= startMins) endMins += 1440; // Cross-midnight
        
        const totalMins = endMins - startMins;
        const breakMins = s.unpaid_break_minutes || 0;
        
        // Simple attribution to start date for V8 performance
        const netHours = Math.max(0, totalMins - breakMins) / 60;
        dailyHours.set(dateStr, (dailyHours.get(dateStr) || 0) + netHours);
    }
    
    const sortedDates = Array.from(dailyHours.keys()).sort();
    if (sortedDates.length === 0) return [];
    
    // 2. Prefix Sums for O(1) Window Lookups
    const prefix = new Array<number>(sortedDates.length + 1).fill(0);
    for (let i = 0; i < sortedDates.length; i++) {
        prefix[i + 1] = prefix[i] + dailyHours.get(sortedDates[i])!;
    }
    
    // 3. Scan Rolling Windows (7, 14, 21, and 28 days)
    const windowSizes = [7, 14, 21, 28];
    let worstViolation: { hours: number, limit: number, window: number, start: string, end: string } | null = null;
    
    for (let endIdx = 0; endIdx < sortedDates.length; endIdx++) {
        const endDateStr = sortedDates[endIdx];

        for (const winSize of windowSizes) {
            // Calculate start date string manually to avoid date-fns
            const d = new Date(endDateStr);
            d.setUTCDate(d.getUTCDate() - (winSize - 1));
            const winStartDate = d.toISOString().split('T')[0];
            
            // Find start pointer for this specific window size
            let ptr = 0;
            while (ptr <= endIdx && sortedDates[ptr] < winStartDate) {
                ptr++;
            }
            
            const windowHours = prefix[endIdx + 1] - prefix[ptr];
            
            const weeklyLimit = employee.contracted_weekly_hours || config.ord_avg_weekly_limit;
            const limit = (winSize / 7) * weeklyLimit;
            
            if (windowHours > limit) {
                const excess = windowHours - limit;
                if (!worstViolation || excess > (worstViolation.hours - worstViolation.limit)) {
                    worstViolation = { 
                        hours: windowHours, 
                        limit, 
                        window: winSize, 
                        start: winStartDate, 
                        end: endDateStr 
                    };
                }
            }
        }
    }
    
    if (!worstViolation) return [];
    
    // Violation detected
    const avg = worstViolation.hours / (worstViolation.window / 7);
    const windowName = worstViolation.window === 28 ? '4-week' : `${worstViolation.window / 7}-week`;
    
    return [{
        rule_id: 'V8_ORD_HOURS_AVG',
        rule_name: 'Ordinary Hours Averaging',
        status: 'BLOCKING',
        summary: `Exceeds ${worstViolation.limit.toFixed(1)}h in ${windowName} window`,
        details: `Employee worked ${worstViolation.hours.toFixed(1)}h in the ${worstViolation.window}-day window from ${worstViolation.start} to ${worstViolation.end}. This averages to ${avg.toFixed(1)}h/week, exceeding the limit of ${config.ord_avg_weekly_limit}h/week.`,
        affected_shifts: shifts.filter(s => {
            const d = s.date || s.shift_date || '';
            return d >= worstViolation!.start && d <= worstViolation!.end;
        }).map(s => s.id),
        blocking: true,
        calculation: {
            total_hours: worstViolation.hours,
            limit: worstViolation.limit,
            average: avg,
            window_days: worstViolation.window,
            window_start: worstViolation.start,
            window_end: worstViolation.end
        }
    }];
};
