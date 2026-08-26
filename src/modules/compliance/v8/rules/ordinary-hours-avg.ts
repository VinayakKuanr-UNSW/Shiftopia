import { V8Hit, V8RuleEvaluator } from '../types';
import { shiftDurationMinutes } from '../utils/time';
import {
    cycleBoundsFor,
    cycleIndexFor,
    normaliseCycleAnchor,
} from '../../ordinary-hours-cycle';

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
 *
 * Full-Time SECURITY (EBA Schedule 3 §3) is a discriminated exception: they
 * run a 42h/week average (38 ordinary + 4 "reasonable additional") over an
 * 8-week rotating cycle, not the general 38h/4-week structure — audit H-5.
 * Part-time/casual event security (Sch 3 §5) are unaffected; they use the
 * general structure like any other PT/casual employee.
 */
export const ordinaryHoursAvgRule: V8RuleEvaluator = (ctx) => {
    const { employee, shifts, config } = ctx;

    if (employee.contract_type === 'CASUAL') return [];

    const isFtSecurity = !!employee.is_security_role && employee.contract_type === 'FULL_TIME';

    // 1. Daily net ordinary hours, attributed to the shift's start date.
    const dailyHours = new Map<string, number>();
    for (const s of shifts) {
        const dateStr = s.date || s.shift_date || '';
        if (!dateStr || !s.start_time || !s.end_time) continue; // skip malformed
        if (!s.is_ordinary_hours) continue;

        const breakMins = s.unpaid_break_minutes || 0;
        const netHours = Math.max(0, shiftDurationMinutes(s.start_time, s.end_time) - breakMins) / 60;
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

    // Sch 3 §3 — Full-Time Security: 42h/week over an 8-week cycle instead
    // of the general 38h/week over a 4-week cycle.
    const weeklyLimit = isFtSecurity ? config.security_ord_avg_weekly_limit : config.ord_avg_weekly_limit;
    // The general population's cycle is DECLARED per engagement — cl 35.x(a) is a
    // disjunction over "a work cycle of up to four (4) weeks" (cl 12.2(b)), not
    // four caps at once. Full-time security instead run Schedule 3 §3.1's fixed
    // eight-week even-time cycle, which §1.1 makes prevail. The config value
    // survives only as the fallback for a context built without a contract read.
    const cycleWeeks = isFtSecurity
        ? config.security_ord_avg_cycle_weeks
        : (employee.ordinary_hours_cycle_weeks ?? config.ord_avg_cycle_weeks);
    const cycleAnchor = normaliseCycleAnchor(employee.ordinary_hours_cycle_anchor);
    const cycleDays = cycleWeeks * 7;                  // 28 general / 56 security
    const cycleLimit = cycleWeeks * weeklyLimit;       // 152h general / 336h security

    // 3. HARD CAP — the declared work cycle, ANCHORED rather than rolling.
    //
    // cl 35.x(a) caps the CYCLE. A rolling window instead caps every N
    // consecutive days, which is strictly stricter: it sums across a cycle
    // boundary and reports a breach on a roster that satisfies both cycles it
    // straddles. cl 42.6 ("during the work cycle") and cl 35.1(e) ("during each
    // work cycle") both presuppose a period with edges, so the hours are bucketed
    // by which cycle each date falls in and each bucket tested on its own.
    //
    // A bucket at the edge of the loaded window is PARTIAL, and therefore only
    // ever under-counts. That is the safe direction: a partial cycle can miss a
    // breach that the next evaluation catches, where a rolling window invents one
    // that never existed.
    const byCycle = new Map<number, { hours: number; anyDate: string }>();
    for (const [dateStr, hrs] of dailyHours) {
        const idx = cycleIndexFor(dateStr, cycleAnchor, cycleWeeks);
        const bucket = byCycle.get(idx);
        if (bucket) bucket.hours += hrs;
        else byCycle.set(idx, { hours: hrs, anyDate: dateStr });
    }

    let worstCycle: { hours: number; anyDate: string } | null = null;
    for (const bucket of byCycle.values()) {
        if (!worstCycle || bucket.hours > worstCycle.hours) worstCycle = bucket;
    }

    if (worstCycle && worstCycle.hours > cycleLimit) {
        const bounds = cycleBoundsFor(worstCycle.anyDate, cycleAnchor, cycleWeeks);
        const cycle = {
            hours: worstCycle.hours,
            start: bounds.start,
            end: bounds.endInclusive,
        };
        const avg = cycle.hours / cycleWeeks;
        return [{
            rule_id: 'V8_ORD_HOURS_AVG',
            rule_name: 'Ordinary Hours Averaging',
            status: 'BLOCKING',
            summary: `Exceeds ${cycleLimit.toFixed(0)}h over the ${cycleWeeks}-week cycle`,
            details:
                `Employee worked ${cycle.hours.toFixed(1)}h in the ${cycleDays}-day window from ` +
                `${cycle.start} to ${cycle.end} — an average of ${avg.toFixed(1)}h/week, over the ` +
                `${weeklyLimit}h/week ordinary-hours ceiling (${isFtSecurity ? 'ICC EBA Schedule 3 §3' : 'ICC EBA cl. 35'}).`,
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
