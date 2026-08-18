import { V8Hit, V8RuleEvaluator, V8Shift } from '../types';
import { parseTimeToMinutes, normalizedEndMinutes } from '../utils/time';
import { shiftStartDate } from '../utils/rest-gap';

/**
 * V8 Rule: Daily Meal Break — the limb of cl 36.1 a single shift cannot answer.
 *
 * cl 36.1 entitles a Team Member who works more than five hours "ON ANY ONE
 * DAY" to an unpaid meal break of not less than 30 and not more than 60
 * minutes. The shape layer enforces this per shift, which is where it usually
 * bites, but the clause is written per DAY: a casual rostered 08:00–11:00 and
 * again 11:00–14:00 has worked six hours on one day without a break, and both
 * engagements pass the shape gate on their own. Neither shift is defective;
 * the pairing is. That is the definition of a labour-layer rule.
 *
 * ONE INTERPRETIVE CHOICE, STATED. What satisfies the entitlement on a day
 * worked in more than one part? Read literally the clause asks only that the
 * Team Member get a meal break, and someone rostered 06:00–09:00 and again
 * 11:00–14:00 plainly has: two unpaid hours in the middle of the day. So the
 * gap between engagements counts, and this rule fires only when the day offers
 * no qualifying interval at ALL — abutting shifts, or a gap too short to be a
 * meal break. The alternative reading, that a break must fall inside a single
 * engagement, would make every split shift a breach of cl 36.1 while cl 39
 * expressly permits them.
 *
 * The 60-minute CEILING deliberately does not travel with that choice. It
 * caps a rostered in-shift meal break; applied to the interval between two
 * engagements it would outlaw the split shift cl 39.4 defines with a gap of up
 * to three hours. The ceiling therefore stays where the shape layer has it —
 * on the unpaid break declared within one shift.
 *
 * Security is paid through the break (Sch 3 §3.2(a) full-time, §5.3(a) event),
 * so for them the qualifying in-shift interval is the paid allotment, capped
 * the same way the shape layer caps it — `paid_break_minutes` pools the meal
 * break with the cl 37 rest pauses, and only the meal-break part of it answers
 * this clause.
 *
 * Applies to every employment type: cl 36.1 says "a Team Member", without
 * qualification, and the fact pattern reaches casuals most often.
 *
 * Days are keyed on START date, the convention the whole day-level family
 * uses. An engagement ending after midnight therefore belongs to the day it
 * began. A pair straddling midnight lands in two groups and is not seen here —
 * that pattern is cl 40.1's, which requires ten hours between finishing on one
 * day and starting the next, and reaches it first.
 */

/** cl 36.1 — "more than five (5) hours on any one day". */
export const DAILY_MEAL_BREAK_THRESHOLD_MINUTES = 300;

/** cl 36.1 — "not less than thirty (30) minutes". */
export const DAILY_MEAL_BREAK_MIN_MINUTES = 30;

/** cl 36.1 — "and not more than sixty (60) minutes". The in-shift ceiling. */
export const DAILY_MEAL_BREAK_MAX_MINUTES = 60;

interface Engagement {
    shift: V8Shift;
    start: number;
    end:   number;
    /** Non-working minutes declared inside this engagement. */
    inShiftBreak: number;
}

export const dailyMealBreakRule: V8RuleEvaluator = (ctx) => {
    const { shifts, employee } = ctx;
    const isSecurity = employee.is_security_role === true;
    const hits: V8Hit[] = [];

    const perDay = new Map<string, V8Shift[]>();
    for (const s of shifts) {
        if (!s.start_time || !s.end_time) continue;
        const day = shiftStartDate(s);
        if (!day) continue;
        const list = perDay.get(day) || [];
        list.push(s);
        perDay.set(day, list);
    }

    for (const [day, dayShifts] of perDay.entries()) {
        // A single engagement is decidable from the shift alone, so it belongs
        // to the shape layer and is enforced at creation. Evaluating it here
        // too would double-report the same defect against the same shift.
        if (dayShifts.length < 2) continue;

        // Never re-flag a day made up entirely of committed history.
        if (!dayShifts.some(s => s.is_candidate !== false)) continue;

        const engagements: Engagement[] = dayShifts
            .map(s => {
                const start = parseTimeToMinutes(s.start_time);
                const end = normalizedEndMinutes(s.start_time, s.end_time);
                const declared = isSecurity
                    ? Math.min(s.paid_break_minutes || 0, DAILY_MEAL_BREAK_MAX_MINUTES)
                    : (s.unpaid_break_minutes || 0);
                return { shift: s, start, end, inShiftBreak: declared };
            })
            .sort((a, b) => a.start - b.start);

        const workedMinutes = engagements.reduce(
            (sum, e) => sum + Math.max(0, e.end - e.start - e.inShiftBreak), 0,
        );
        if (workedMinutes <= DAILY_MEAL_BREAK_THRESHOLD_MINUTES) continue;

        // The longest single non-working interval the day offers, from either
        // source. A meal break is one continuous interval, so these are
        // compared, never summed: three ten-minute gaps are not a meal break.
        let longestBreak = 0;
        for (const e of engagements) longestBreak = Math.max(longestBreak, e.inShiftBreak);
        for (let i = 1; i < engagements.length; i++) {
            longestBreak = Math.max(longestBreak, engagements[i].start - engagements[i - 1].end);
        }

        if (longestBreak >= DAILY_MEAL_BREAK_MIN_MINUTES) continue;

        const kind = isSecurity ? 'paid' : 'unpaid';
        const clause = isSecurity
            ? (employee.contract_type === 'FULL_TIME' ? 'EBA Sch 3 §3.2(a)' : 'EBA Sch 3 §5.3(a)')
            : 'ICC EBA cl. 36.1';

        hits.push({
            rule_id: 'V8_DAILY_MEAL_BREAK',
            rule_name: 'Daily Meal Break',
            status: 'BLOCKING',
            summary: `${(workedMinutes / 60).toFixed(1)}h worked on ${day} with no meal break`,
            details:
                `A Team Member who works more than five (5) hours on any one day is entitled to a ` +
                `${kind} meal break of not less than ${DAILY_MEAL_BREAK_MIN_MINUTES} minutes (${clause}). ` +
                `The ${engagements.length} engagements on ${day} total ` +
                `${(workedMinutes / 60).toFixed(1)} hours worked, and the longest unbroken interval ` +
                `between or within them is ${longestBreak} minutes. Each engagement clears the ` +
                `five-hour threshold on its own, so the shift-level check cannot see this — the ` +
                `entitlement is created by the day, not by either shift.`,
            affected_shifts: engagements.map(e => e.shift.id),
            blocking: true,
            calculation: {
                worked_minutes: workedMinutes,
                threshold_minutes: DAILY_MEAL_BREAK_THRESHOLD_MINUTES,
                longest_break_minutes: longestBreak,
                required_break_minutes: DAILY_MEAL_BREAK_MIN_MINUTES,
                engagements: engagements.length,
                break_is_paid: isSecurity,
                date: day,
            },
        });
    }

    return hits;
};
