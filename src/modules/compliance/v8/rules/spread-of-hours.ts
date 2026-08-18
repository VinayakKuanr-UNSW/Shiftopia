import { V8Hit, V8RuleEvaluator } from '../types';
import { parseTimeToMinutes, normalizedEndMinutes } from '../utils/time';

/**
 * V8 Rule: Split-Shift Spread (ICC EBA cl. 39.2)
 *
 * "Where SPLIT SHIFTS are worked, the total spread of hours over which work is
 * performed cannot exceed 12 hours EXCLUDING meal and rest breaks."
 *
 * Three things follow from that sentence, and this rule previously got all
 * three wrong. It read as a universal daily spread ceiling, applied to every
 * employment type, measured gross, and firing on a lone shift.
 *
 *   1. SCOPE — the clause governs split shifts. cl 39.1 confines split shifts
 *      to part-time and flexible part-time, and cl 7.14 defines one as ordinary
 *      hours worked in two parts on one day. Casuals are excluded outright
 *      (cl 28.4 gives them no split-shift allowance); their two-engagements
 *      case is already governed by cl 35.4(f) — at most two per day — and by
 *      the 12h daily WORKED cap, both of which have their own rules.
 *
 *   2. MEASURE — "excluding meal and rest breaks" means NET. This file's own
 *      docstring said so; the code subtracted nothing and measured first-start
 *      to last-end. So an 06:00–19:00 pairing carrying a 1h unpaid break —
 *      twelve hours worked, lawful under cl 35.1(d) — was reported as a 13h
 *      breach and blocked.
 *
 *   3. ARITY — a spread needs two engagements to spread ACROSS. On a single
 *      shift the applicable ceiling is the daily ordinary-hours cap
 *      (cl 35.1(d)/35.2(d)/35.3(d)/35.4(c)), which is `SHAPE_MAX_DURATION` at
 *      creation and `V8_MAX_DAILY_HOURS` at assignment. Raising a spread
 *      breach there told the user about a clause that does not reach them.
 *
 * The combination made this the single largest source of false blocks in the
 * grid: every long permanent day with a proper meal break failed a split-shift
 * rule for staff who cannot work split shifts.
 *
 * It stays BLOCKING. cl 39.2 is expressed as a ceiling with no "unless
 * otherwise agreed" limb, and cl 39.4's 3h maximum gap — the WARNING raised by
 * `splitShiftRule` — is the softer companion test, not a substitute.
 */

/** cl 39.2 — the split-shift spread ceiling, NET of meal and rest breaks. */
export const SPLIT_SHIFT_SPREAD_MINUTES = 720; // 12h

export const spreadOfHoursRule: V8RuleEvaluator = (ctx) => {
    const { shifts, employee } = ctx;
    const violations: V8Hit[] = [];

    // cl 39.1 / cl 7.14 — split shifts are a part-time and flexible part-time
    // structure. Mirrors `splitShiftRule`'s gate exactly; the two clauses are
    // limbs of one provision and must not diverge on who they reach.
    const eligible =
        employee.contract_type === 'PART_TIME' ||
        employee.contract_type === 'FLEXI_PART_TIME';
    if (!eligible) return [];

    const dailyGroups = new Map<string, typeof shifts>();
    for (const s of shifts) {
        const date = s.date || s.shift_date || '';
        if (!date) continue;
        const list = dailyGroups.get(date) || [];
        list.push(s);
        dailyGroups.set(date, list);
    }

    for (const [date, dayShifts] of dailyGroups.entries()) {
        // A spread needs two engagements to span. One shift is a duration.
        if (dayShifts.length < 2) continue;

        let earliestStart = Infinity;
        let latestEnd = -Infinity;
        // "Excluding meal and rest breaks": the unpaid break is time the Team
        // Member is released, so it comes out of the spread. Paid rest pauses
        // stay in — they are working time and the member is not free to leave.
        let unpaidBreakMinutes = 0;

        for (const s of dayShifts) {
            const start = parseTimeToMinutes(s.start_time);
            const end = normalizedEndMinutes(s.start_time, s.end_time);

            if (start < earliestStart) earliestStart = start;
            if (end > latestEnd) latestEnd = end;
            unpaidBreakMinutes += s.unpaid_break_minutes || 0;
        }

        const grossSpread = latestEnd - earliestStart;
        const netSpread = Math.max(0, grossSpread - unpaidBreakMinutes);

        if (netSpread > SPLIT_SHIFT_SPREAD_MINUTES) {
            violations.push({
                rule_id: 'V8_SPLIT_SHIFT_SPREAD',
                rule_name: 'Split-Shift Spread',
                status: 'BLOCKING',
                summary: `Split-shift spread exceeds 12h (${(netSpread / 60).toFixed(1)}h net)`,
                details:
                    `The two engagements on ${date} span ${(grossSpread / 60).toFixed(1)} hours ` +
                    `from first start to last end. Excluding ${unpaidBreakMinutes} minutes of unpaid ` +
                    `break that is ${(netSpread / 60).toFixed(1)} hours of spread, over the 12-hour ` +
                    `maximum for a split shift (ICC EBA cl. 39.2).`,
                affected_shifts: dayShifts.map(s => s.id),
                blocking: true,
                calculation: {
                    gross_spread_minutes: grossSpread,
                    unpaid_break_minutes: unpaidBreakMinutes,
                    net_spread_minutes: netSpread,
                    limit_minutes: SPLIT_SHIFT_SPREAD_MINUTES,
                    engagements: dayShifts.length,
                    date,
                },
            });
        }
    }

    return violations;
};
