import { V8RuleContext, V8Hit, V8RuleEvaluator } from '../types';
import { differenceInMinutes, parseISO } from 'date-fns';

/**
 * V8 Rule: Spread of Hours
 * 
 * EBA Requirement: Total spread (first start to last end) cannot exceed 12 hours 
 * (720 minutes) on any calendar day, excluding unpaid breaks.
 */
export const spreadOfHoursRule: V8RuleEvaluator = (ctx) => {
    const { shifts } = ctx;
    const violations: V8Hit[] = [];

    // Group shifts by date
    const dailyGroups = new Map<string, typeof shifts>();
    for (const s of shifts) {
        const date = s.date || s.shift_date || '';
        const list = dailyGroups.get(date) || [];
        list.push(s);
        dailyGroups.set(date, list);
    }

    for (const [date, dayShifts] of dailyGroups.entries()) {
        if (dayShifts.length < 1) continue;

        let earliestStart = Infinity;
        let latestEnd = -Infinity;

        for (const s of dayShifts) {
            const dateS = s.date || s.shift_date || '';
            const start = parseISO(`${dateS}T${s.start_time}`).getTime();
            let end = parseISO(`${dateS}T${s.end_time}`).getTime();
            if (end <= start) end += 86400000; // Cross-midnight adjustment

            if (start < earliestStart) earliestStart = start;
            if (end > latestEnd) latestEnd = end;
        }

        const spreadMins = (latestEnd - earliestStart) / 60000;

        if (spreadMins > 720) {
            violations.push({
                rule_id: 'V8_SPREAD_OF_HOURS',
                rule_name: 'Spread of Hours',
                status: 'BLOCKING',
                summary: `Daily spread exceeds 12h (${(spreadMins / 60).toFixed(1)}h)`,
                details: `Total spread on ${date} is ${(spreadMins / 60).toFixed(1)} hours (Earliest: ${new Date(earliestStart).toLocaleTimeString()} - Latest: ${new Date(latestEnd).toLocaleTimeString()}). Max allowed is 12h.`,
                affected_shifts: dayShifts.map(s => s.id),
                blocking: true,
                calculation: {
                    spread_minutes: spreadMins,
                    limit_minutes: 720,
                    date
                }
            });
        }
    }

    return violations;
};
