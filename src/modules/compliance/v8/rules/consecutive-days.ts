import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';
import { parseTimeToMinutes } from '../utils/time';

/**
 * V8 Rule: Workday Limits (20-in-28 & Streaks)
 * 
 * EBA Requirements:
 * 1. 20 Days in 28: Employees (especially FT) cannot work more than 20 days in any 28-day window.
 * 2. Contract-Aware Streaks: 
 *    - Standard: Max 6 days.
 *    - Flexible Part-Time: Up to 10 days.
 */
export const maxWorkdayLimitsRule: V8RuleEvaluator = (ctx) => {
    const { shifts, employee } = ctx;
    if (shifts.length === 0) return [];
    
    // 1. Build Workday Vector
    const workingDates = new Set<string>();
    for (const s of shifts) {
        const date = s.date || s.shift_date || '';
        // CRITICAL: Skip shifts with missing scheduling info to prevent crashes
        if (!date || !s.start_time || !s.end_time) continue;

        workingDates.add(date);
        
        // Handle cross-midnight by adding the next day too
        const start = parseTimeToMinutes(s.start_time);
        const end = parseTimeToMinutes(s.end_time);
        if (end <= start && s.end_time !== '00:00') {
             const d = new Date(date);
             d.setUTCDate(d.getUTCDate() + 1);
             workingDates.add(d.toISOString().split('T')[0]);
        }
    }
    
    const sortedDates = Array.from(workingDates).sort();
    if (sortedDates.length === 0) return [];
    const violations: V8Hit[] = [];

    // --- RULE A: 20 IN 28 (Rolling Window) ---
    const maxWorkdays = 20;

    let worstWindow: any = null;

    for (let i = 0; i < sortedDates.length; i++) {
        const endDateStr = sortedDates[i];
        
        const d = new Date(endDateStr);
        d.setUTCDate(d.getUTCDate() - 27);
        const windowStart = d.toISOString().split('T')[0];

        const windowWorked = sortedDates.filter(d => d >= windowStart && d <= endDateStr).length;

        if (windowWorked > maxWorkdays) {
            if (!worstWindow || windowWorked > worstWindow.window_worked) {
                worstWindow = {
                    window_worked: windowWorked,
                    limit: maxWorkdays,
                    window_start: windowStart,
                    window_end: endDateStr
                };
            }
        }
    }

    if (worstWindow) {
        violations.push({
            rule_id: 'V8_20_IN_28',
            rule_name: '20 Days in 28 Limit',
            status: 'BLOCKING',
            summary: `Worked ${worstWindow.window_worked} days in 28-day window`,
            details: `Employee worked ${worstWindow.window_worked} days between ${worstWindow.window_start} and ${worstWindow.window_end}. Max allowed is 20 days.`,
            affected_shifts: shifts.filter(s => {
                const d = s.date || s.shift_date || '';
                return d >= worstWindow.window_start && d <= worstWindow.window_end;
            }).map(s => s.id),
            blocking: true,
            calculation: worstWindow
        });
    }

    // --- RULE B: CONTRACT-AWARE STREAK ---
    const streakLimit = employee.contract_type === 'FLEXI_PART_TIME' ? 10 : 6;
    
    let currentStreak = 1;
    let streakStart = sortedDates[0];

    for (let i = 1; i < sortedDates.length; i++) {
        const d1 = new Date(sortedDates[i - 1]).getTime();
        const d2 = new Date(sortedDates[i]).getTime();
        
        const diffDays = Math.round((d2 - d1) / 86400000);
        
        if (diffDays === 1) {
            currentStreak++;
        } else {
            if (currentStreak > streakLimit) {
                violations.push(generateStreakHit(currentStreak, streakLimit, streakStart, sortedDates[i-1], shifts));
            }
            currentStreak = 1;
            streakStart = sortedDates[i];
        }
    }

    if (currentStreak > streakLimit) {
        violations.push(generateStreakHit(currentStreak, streakLimit, streakStart, sortedDates[sortedDates.length - 1], shifts));
    }

    return violations;
};

function generateStreakHit(streak: number, limit: number, start: string, end: string, shifts: any[]): V8Hit {
    return {
        rule_id: 'V8_STREAK_LIMIT',
        rule_name: 'Maximum Consecutive Days',
        status: 'BLOCKING',
        summary: `${streak} consecutive working days`,
        details: `Employee worked ${streak} days in a row (from ${start} to ${end}). Limit for ${limit === 10 ? 'Flexi-PT' : 'Standard'} is ${limit} days.`,
        affected_shifts: shifts.filter(s => {
            const d = s.date || s.shift_date || '';
            return d >= start && d <= end;
        }).map(s => s.id),
        blocking: true,
        calculation: { streak_length: streak, limit, streak_start: start, streak_end: end }
    };
}
