import { V8Hit, V8RuleEvaluator } from '../types';
import { parseTimeToMinutes } from '../utils/time';

/**
 * V8 Rule: Ordinary Hours Averaging (ICC EBA cl. 35)
 *
 * Policy (locked 2026-07-05, aligned with the CP-SAT scheduler):
 *   • HARD CAP (BLOCKING): the declared work cycle — default 4 weeks / 152h
 *     (38h/week averaged). This is the only blocking limit, matching the EBA's
 *     "average of 38 ordinary hours per week … over a work cycle of up to four
 *     (4) weeks" and the solver's single 28-day constraint.
 *   • PEAK (WARNING): a 7/14/21-day window whose average exceeds 38h/week. This
 *     is lawful when it averages out over the full cycle (cl. 35.1(a)), so it is
 *     surfaced as a warning, never a block.
 *   • CONTRACTED (WARNING): rostering a PT/flexi above their contracted weekly
 *     hours is permitted by written agreement at ordinary rates (cl. 12.3(d)),
 *     so it is a warning — NOT a block on the contracted figure.
 *
 * Casuals have no ordinary-hours contract and are excluded.
 */
export const ordinaryHoursAvgRule: V8RuleEvaluator = (ctx) => {
    const { employee, shifts, config } = ctx;

    if (employee.contract_type === 'CASUAL') return [];

    // 1. Daily net ordinary hours, attributed to the shift's start date.
    const dailyHours = new Map<string, number>();
    for (const s of shifts) {
        const dateStr = s.date || s.shift_date || '';
        if (!dateStr || !s.start_time || !s.end_time) continue; // skip malformed
        if (!s.is_ordinary_hours) continue;

        const startMins = parseTimeToMinutes(s.start_time);
        let endMins = parseTimeToMinutes(s.end_time);
        if (endMins <= startMins) endMins += 1440; // cross-midnight

        const breakMins = s.unpaid_break_minutes || 0;
        const netHours = Math.max(0, (endMins - startMins) - breakMins) / 60;
        dailyHours.set(dateStr, (dailyHours.get(dateStr) || 0) + netHours);
    }

    const sortedDates = Array.from(dailyHours.keys()).sort();
    if (sortedDates.length === 0) return [];

    // 2. Prefix sums for O(1) window totals.
    const prefix = new Array<number>(sortedDates.length + 1).fill(0);
    for (let i = 0; i < sortedDates.length; i++) {
        prefix[i + 1] = prefix[i] + dailyHours.get(sortedDates[i])!;
    }

    // Worst (max) total over any rolling window of `winSize` calendar days.
    const worstWindow = (winSize: number): { hours: number; start: string; end: string } => {
        let worst = { hours: 0, start: '', end: '' };
        for (let endIdx = 0; endIdx < sortedDates.length; endIdx++) {
            const endDateStr = sortedDates[endIdx];
            const d = new Date(endDateStr);
            d.setUTCDate(d.getUTCDate() - (winSize - 1));
            const winStart = d.toISOString().split('T')[0];

            let ptr = 0;
            while (ptr <= endIdx && sortedDates[ptr] < winStart) ptr++;

            const windowHours = prefix[endIdx + 1] - prefix[ptr];
            if (windowHours > worst.hours) worst = { hours: windowHours, start: winStart, end: endDateStr };
        }
        return worst;
    };

    const shiftsInRange = (start: string, end: string) =>
        shifts.filter(s => {
            const d = s.date || s.shift_date || '';
            return d >= start && d <= end;
        }).map(s => s.id);

    const weeklyLimit = config.ord_avg_weekly_limit;   // 38 — the statutory ceiling (NOT contracted)
    const cycleWeeks = config.ord_avg_cycle_weeks;     // 4
    const cycleDays = cycleWeeks * 7;                  // 28
    const cycleLimit = cycleWeeks * weeklyLimit;       // 152h

    // 3. HARD CAP — declared work cycle. BLOCKING dominates; return it alone.
    const cycle = worstWindow(cycleDays);
    if (cycle.hours > cycleLimit) {
        const avg = cycle.hours / cycleWeeks;
        return [{
            rule_id: 'V8_ORD_HOURS_AVG',
            rule_name: 'Ordinary Hours Averaging',
            status: 'BLOCKING',
            summary: `Exceeds ${cycleLimit.toFixed(0)}h over the ${cycleWeeks}-week cycle`,
            details:
                `Employee worked ${cycle.hours.toFixed(1)}h in the ${cycleDays}-day window from ` +
                `${cycle.start} to ${cycle.end} — an average of ${avg.toFixed(1)}h/week, over the ` +
                `${weeklyLimit}h/week ordinary-hours ceiling (ICC EBA cl. 35).`,
            affected_shifts: shiftsInRange(cycle.start, cycle.end),
            blocking: true,
            calculation: {
                total_hours: cycle.hours,
                limit: cycleLimit,
                average: avg,
                window_days: cycleDays,
                window_start: cycle.start,
                window_end: cycle.end,
            },
        }];
    }

    const hits: V8Hit[] = [];

    // 4. PEAK (WARNING) — the worst short-window rate above 38h/week.
    let worstPeak: { winSize: number; hours: number; rate: number; start: string; end: string } | null = null;
    for (const winSize of [7, 14, 21]) {
        const w = worstWindow(winSize);
        const limit = (winSize / 7) * weeklyLimit;
        if (w.hours > limit) {
            const rate = w.hours / (winSize / 7);
            if (!worstPeak || rate > worstPeak.rate) {
                worstPeak = { winSize, hours: w.hours, rate, start: w.start, end: w.end };
            }
        }
    }
    if (worstPeak) {
        hits.push({
            rule_id: 'V8_ORD_HOURS_PEAK',
            rule_name: 'Ordinary Hours Peak',
            status: 'WARNING',
            summary: `Sustained ${worstPeak.rate.toFixed(1)}h/week over ${worstPeak.winSize} days`,
            details:
                `Employee averaged ${worstPeak.rate.toFixed(1)}h/week over the ${worstPeak.winSize}-day window ` +
                `${worstPeak.start}–${worstPeak.end}, above the ${weeklyLimit}h/week ordinary-hours rate. ` +
                `Permitted if it averages out across the ${cycleWeeks}-week cycle (cl. 35.1(a)).`,
            affected_shifts: shiftsInRange(worstPeak.start, worstPeak.end),
            blocking: false,
            calculation: {
                total_hours: worstPeak.hours,
                average: worstPeak.rate,
                window_days: worstPeak.winSize,
                window_start: worstPeak.start,
                window_end: worstPeak.end,
                limit: (worstPeak.winSize / 7) * weeklyLimit,
            },
        });
    }

    // 5. CONTRACTED (WARNING) — above the employee's contracted weekly hours.
    const contracted = employee.contracted_weekly_hours;
    if (contracted && contracted > 0 && contracted < weeklyLimit) {
        const w7 = worstWindow(7);
        if (w7.hours > contracted) {
            hits.push({
                rule_id: 'V8_ORD_HOURS_CONTRACTED',
                rule_name: 'Above Contracted Hours',
                status: 'WARNING',
                summary: `Above contracted ${contracted}h/week (${w7.hours.toFixed(1)}h peak)`,
                details:
                    `Employee is rostered ${w7.hours.toFixed(1)}h in the 7-day window ${w7.start}–${w7.end}, ` +
                    `above their contracted ${contracted}h/week. Additional hours are permitted by written ` +
                    `agreement at ordinary rates (ICC EBA cl. 12.3(d)).`,
                affected_shifts: shiftsInRange(w7.start, w7.end),
                blocking: false,
                calculation: {
                    total_hours: w7.hours,
                    contracted_weekly_hours: contracted,
                    window_days: 7,
                    window_start: w7.start,
                    window_end: w7.end,
                },
            });
        }
    }

    return hits;
};
