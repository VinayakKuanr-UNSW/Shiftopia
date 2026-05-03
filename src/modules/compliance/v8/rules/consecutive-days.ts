import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';
import { parseISO, addDays, format, differenceInCalendarDays } from 'date-fns';

/**
 * V8 Rule: Maximum Consecutive Working Days
 * 
 * Prevents streaks of work without a rest day.
 * Standard EBA limit is 6 consecutive days (requiring a rest day on the 7th).
 */
export const maxConsecutiveDaysRule: V8RuleEvaluator = (ctx) => {
    const { shifts, config } = ctx;
    if (shifts.length === 0) return [];
    
    // 1. Map of working dates
    const workingDates = new Set<string>();
    for (const s of shifts) {
        workingDates.add(s.date);
        
        // Handle cross-midnight by adding the next day too
        const start = parseISO(`${s.date}T${s.start_time}`);
        const end = parseISO(`${s.date}T${s.end_time}`);
        if (end < start || (s.end_time === '00:00' && s.start_time !== '00:00')) {
             const nextDay = format(addDays(parseISO(s.date), 1), 'yyyy-MM-dd');
             workingDates.add(nextDay);
        }
    }
    
    const sortedDates = Array.from(workingDates).sort();
    
    let maxStreak = 0;
    let currentStreak = 1;
    let streakStart = sortedDates[0];
    let worstStreakStart = sortedDates[0];
    let worstStreakEnd = sortedDates[0];
    
    for (let i = 1; i < sortedDates.length; i++) {
        const prev = parseISO(sortedDates[i - 1]);
        const curr = parseISO(sortedDates[i]);
        
        if (differenceInCalendarDays(curr, prev) === 1) {
            currentStreak++;
        } else {
            if (currentStreak > maxStreak) {
                maxStreak = currentStreak;
                worstStreakStart = streakStart;
                worstStreakEnd = sortedDates[i - 1];
            }
            currentStreak = 1;
            streakStart = sortedDates[i];
        }
    }
    
    // Final check for the last streak
    if (currentStreak > maxStreak) {
        maxStreak = currentStreak;
        worstStreakStart = streakStart;
        worstStreakEnd = sortedDates[sortedDates.length - 1];
    }
    
    if (maxStreak <= config.max_consecutive_days) return [];
    
    return [{
        rule_id: 'V8_MAX_CONSECUTIVE_DAYS',
        rule_name: 'Maximum Consecutive Days',
        status: 'BLOCKING',
        summary: `${maxStreak} consecutive working days detected`,
        details: `Employee has worked a streak of ${maxStreak} days (from ${worstStreakStart} to ${worstStreakEnd}). The maximum allowed is ${config.max_consecutive_days} days.`,
        affected_shifts: shifts.filter(s => s.date >= worstStreakStart && s.date <= worstStreakEnd).map(s => s.id),
        blocking: true,
        calculation: {
            streak_length: maxStreak,
            limit: config.max_consecutive_days,
            streak_start: worstStreakStart,
            streak_end: worstStreakEnd
        }
    }];
};
