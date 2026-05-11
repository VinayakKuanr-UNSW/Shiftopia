import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';
import { parseTimeToMinutes } from '../utils/time';

/**
 * V8 Rule: Student Visa 48h Fortnightly Limit
 * 
 * Enforces the Australian visa requirement that student visa holders
 * must not work more than 48 hours per rolling 14-day period.
 */
export const studentVisaRule: V8RuleEvaluator = (ctx) => {
    const { employee, shifts, config } = ctx;
    
    // Only applies to student visa holders
    if (employee.contract_type !== 'STUDENT_VISA') return [];
    
    const limitHours = config.student_visa_fortnightly_limit;
    const windowDays = 14;
    
    // 1. Build Daily Hours Map
    const dailyHours = new Map<string, number>();
    for (const s of shifts) {
        const date = s.date || s.shift_date || '';
        // CRITICAL: Skip shifts with missing scheduling info to prevent crashes
        if (!date || !s.start_time || !s.end_time) continue;

        const start = parseTimeToMinutes(s.start_time);
        let end = parseTimeToMinutes(s.end_time);
        if (end <= start) end += 1440;
        
        const netHours = Math.max(0, (end - start - (s.unpaid_break_minutes || 0)) / 60);
        dailyHours.set(date, (dailyHours.get(date) || 0) + netHours);
    }
    
    const sortedDates = Array.from(dailyHours.keys()).sort();
    if (sortedDates.length === 0) return [];
    
    // 2. Scan 14-Day Rolling Windows
    const prefix = new Array<number>(sortedDates.length + 1).fill(0);
    for (let i = 0; i < sortedDates.length; i++) {
        prefix[i + 1] = prefix[i] + dailyHours.get(sortedDates[i])!;
    }
    
    let worstHours = 0;
    let worstStartDate = '';
    let worstEndDate = '';
    
    let startPtr = 0;
    for (let endIdx = 0; endIdx < sortedDates.length; endIdx++) {
        const endDateStr = sortedDates[endIdx];
        
        const d = new Date(endDateStr);
        d.setUTCDate(d.getUTCDate() - (windowDays - 1));
        const winStartDate = d.toISOString().split('T')[0];
        
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
    
    if (worstHours <= limitHours) return [];
    
    return [{
        rule_id: 'V8_STUDENT_VISA_LIMIT',
        rule_name: 'Student Visa 48h Limit',
        status: 'BLOCKING',
        summary: `Exceeds 48h visa limit (${worstHours.toFixed(1)}h)`,
        details: `Employee has worked ${worstHours.toFixed(1)}h in the 14-day window from ${worstStartDate} to ${worstEndDate}, exceeding the 48-hour student visa limit.`,
        affected_shifts: shifts.filter(s => {
            const d = s.date || s.shift_date || '';
            return d >= worstStartDate && d <= worstEndDate;
        }).map(s => s.id),
        blocking: true,
        calculation: {
            total_hours: worstHours,
            limit: limitHours,
            window_start: worstStartDate,
            window_end: worstEndDate
        }
    }];
};
