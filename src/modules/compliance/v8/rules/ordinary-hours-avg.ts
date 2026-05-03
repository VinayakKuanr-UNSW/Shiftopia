import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';
import { differenceInMinutes, addDays, parseISO, format } from 'date-fns';

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
    
    const limitTotalHours = config.ord_avg_cycle_weeks * config.ord_avg_weekly_limit;
    const windowDays = config.ord_avg_cycle_weeks * 7;
    
    // 1. Build Daily Net Hours Map
    const dailyHours = new Map<string, number>();
    for (const s of shifts) {
        if (!s.is_ordinary_hours) continue;
        
        const start = parseISO(`${s.date}T${s.start_time}`);
        const end = parseISO(`${s.date}T${s.end_time}`);
        let mins = differenceInMinutes(end, start);
        if (mins < 0) mins += 1440; // Cross-midnight
        
        const netMins = Math.max(0, mins - (s.unpaid_break_minutes || 0));
        dailyHours.set(s.date, (dailyHours.get(s.date) || 0) + (netMins / 60));
    }
    
    const sortedDates = Array.from(dailyHours.keys()).sort();
    if (sortedDates.length === 0) return [];
    
    // 2. Prefix Sums for O(1) Window Lookups
    const prefix = new Array<number>(sortedDates.length + 1).fill(0);
    for (let i = 0; i < sortedDates.length; i++) {
        prefix[i + 1] = prefix[i] + dailyHours.get(sortedDates[i])!;
    }
    
    // 3. Scan 28-Day Rolling Windows
    let worstHours = 0;
    let worstStartDate = '';
    let worstEndDate = '';
    
    let startPtr = 0;
    for (let endIdx = 0; endIdx < sortedDates.length; endIdx++) {
        const endDateStr = sortedDates[endIdx];
        const endDate = parseISO(endDateStr);
        const winStartDate = format(addDays(endDate, -(windowDays - 1)), 'yyyy-MM-dd');
        
        while (startPtr <= endIdx && sortedDates[startPtr] < winStartDate) {
            startPtr++;
        }
        
        const windowHours = prefix[endIdx + 1] - prefix[startPtr];
        if (windowHours > worstHours) {
            worstHours = windowHours;
            worstStartDate = winStartDate;
            worstEndDate = endDateStr;
        }
    }
    
    if (worstHours <= limitTotalHours) return [];
    
    // Violation detected
    const avg = worstHours / config.ord_avg_cycle_weeks;
    return [{
        rule_id: 'V8_ORD_HOURS_AVG',
        rule_name: 'Ordinary Hours Averaging',
        status: 'BLOCKING',
        summary: `Exceeds ${limitTotalHours}h in 4-week window`,
        details: `Employee worked ${worstHours.toFixed(1)}h in the 28-day window from ${worstStartDate} to ${worstEndDate}. This averages to ${avg.toFixed(1)}h/week, exceeding the EBA limit of ${config.ord_avg_weekly_limit}h/week.`,
        affected_shifts: shifts.filter(s => s.date >= worstStartDate && s.date <= worstEndDate).map(s => s.id),
        blocking: true,
        calculation: {
            total_hours: worstHours,
            limit: limitTotalHours,
            average: avg,
            window_start: worstStartDate,
            window_end: worstEndDate
        }
    }];
};
