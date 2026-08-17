import { V8Hit, V8RuleEvaluator } from '../types';
import { parseTimeToMinutes } from '../utils/time';

/**
 * V8 Rule: Full-Time Paired Days Off (ICC EBA cl 35.1(e), p.28)
 *
 *   "The daily working hours for full-time Team Members shall be worked
 *    continuously, except for meal breaks, on not more than 20 days in a 28 day
 *    period. Each full-time Team Member shall have, on average, two (2)
 *    consecutive days off each week during each work cycle unless otherwise
 *    mutually agreed between the Employer and Team Member."
 *
 * cl 35.1(e) carries TWO obligations. `maxWorkdayLimitsRule` already owns the
 * first (20-in-28, BLOCKING). This rule owns the second, which had no
 * enforcement anywhere: the paired-days-off pattern.
 *
 * SEVERITY — WARNING, deliberately
 *   The clause is qualified twice: "on average" (so a single week without a
 *   pair is not itself a breach if the cycle averages out) and "unless
 *   otherwise mutually agreed" (so it is waivable). Both qualifications make an
 *   absolute block wrong. It is surfaced as a WARNING the manager can accept —
 *   the same posture `ordinaryHoursAvgRule` takes for its PEAK window.
 *
 * WHAT COUNTS AS A PAIR
 *   Two calendar days in a row on which the employee works no shift. A run of
 *   L consecutive days off yields floor(L / 2) pairs, so a 4-day break counts
 *   as two weeks' worth. Required pairs = whole weeks observed.
 *
 * WINDOW HANDLING
 *   The rule reads only the dates present in `shifts`, which is a window, not
 *   the employee's whole life. Two consequences, both handled below:
 *     • Fewer than 14 observed days ⇒ silent. An "average per week" cannot be
 *       established from a fragment, and firing here would spam every
 *       single-shift assignment check with a pattern warning.
 *     • Days off at the window edges are counted generously (a run that runs
 *       off the edge is assumed to continue), so a real pair straddling the
 *       boundary is never reported as missing.
 */

/** cl 35.1(e) — a "pair" is two consecutive days off. */
const PAIR_LENGTH_DAYS = 2;

/** Below this many observed days, an "on average per week" claim is not evaluable. */
const MIN_OBSERVABLE_WINDOW_DAYS = 14;

const DAY_MS = 86_400_000;

function toUtcDate(dateStr: string): Date {
    return new Date(`${dateStr}T00:00:00Z`);
}

function toDateStr(d: Date): string {
    return d.toISOString().slice(0, 10);
}

export const ftDaysOffRule: V8RuleEvaluator = (ctx) => {
    const { employee, shifts, config } = ctx;

    // Opt-in — see V8Config.enforce_ft_days_off.
    if (!config.enforce_ft_days_off) return [];

    if (employee.contract_type !== 'FULL_TIME') return [];

    // Sch 3 §3.1(b) — Full-Time Security work an "even time" 8-week roster with
    // its own days-on/days-off structure, and Sch 3 §1.1 makes the Schedule
    // prevail over the Agreement to the extent of any inconsistency.
    if (employee.is_security_role) return [];

    // 1. Working-day vector. Mirrors maxWorkdayLimitsRule so the two halves of
    //    cl 35.1(e) can never disagree about which days were worked, including
    //    the cross-midnight spill onto the following day.
    const workingDates = new Set<string>();
    for (const s of shifts) {
        const date = s.date || s.shift_date || '';
        if (!date || !s.start_time || !s.end_time) continue;

        workingDates.add(date);

        const start = parseTimeToMinutes(s.start_time);
        const end = parseTimeToMinutes(s.end_time);
        if (end <= start && s.end_time !== '00:00') {
            const next = toUtcDate(date);
            next.setUTCDate(next.getUTCDate() + 1);
            workingDates.add(toDateStr(next));
        }
    }

    if (workingDates.size === 0) return [];

    const sorted = Array.from(workingDates).sort();
    const windowStart = toUtcDate(sorted[0]);
    const windowEnd = toUtcDate(sorted[sorted.length - 1]);
    const spanDays = Math.round((windowEnd.getTime() - windowStart.getTime()) / DAY_MS) + 1;

    if (spanDays < MIN_OBSERVABLE_WINDOW_DAYS) return [];

    // 2. Walk the window day by day, counting maximal runs of days off.
    //    A run of length L contributes floor(L / 2) pairs.
    let pairsFound = 0;
    let currentRun = 0;
    let longestRun = 0;

    for (let i = 0; i < spanDays; i++) {
        const d = new Date(windowStart.getTime() + i * DAY_MS);
        const isWorking = workingDates.has(toDateStr(d));

        if (isWorking) {
            pairsFound += Math.floor(currentRun / PAIR_LENGTH_DAYS);
            longestRun = Math.max(longestRun, currentRun);
            currentRun = 0;
        } else {
            currentRun++;
        }
    }
    // Trailing run — the window ends on days off. Counted generously: the run
    // is assumed to continue past the observed edge, so a single trailing off
    // day still credits a pair rather than being reported as a near-miss.
    if (currentRun > 0) {
        longestRun = Math.max(longestRun, currentRun);
        pairsFound += Math.max(1, Math.floor(currentRun / PAIR_LENGTH_DAYS));
    }

    const wholeWeeks = Math.floor(spanDays / 7);
    if (pairsFound >= wholeWeeks) return [];

    return [{
        rule_id: 'V8_FT_DAYS_OFF',
        rule_name: 'Full-Time Paired Days Off',
        status: 'WARNING',
        summary: `${pairsFound} of ${wholeWeeks} required pairs of consecutive days off`,
        details:
            `Between ${sorted[0]} and ${sorted[sorted.length - 1]} (${spanDays} days, ` +
            `${wholeWeeks} whole weeks) this full-time employee has ${pairsFound} ` +
            `${pairsFound === 1 ? 'pair' : 'pairs'} of consecutive days off. ICC EBA ` +
            `cl 35.1(e) requires, on average, two consecutive days off each week during ` +
            `the work cycle. This is waivable by mutual agreement between the Employer ` +
            `and Team Member, so it is raised for review rather than blocked.`,
        affected_shifts: shifts.map(s => s.id),
        blocking: false,
        calculation: {
            pairs_found: pairsFound,
            pairs_required: wholeWeeks,
            window_start: sorted[0],
            window_end: sorted[sorted.length - 1],
            window_days: spanDays,
            whole_weeks: wholeWeeks,
            longest_run_days: longestRun,
            eba_clause: 'cl 35.1(e)',
        },
    }];
};
