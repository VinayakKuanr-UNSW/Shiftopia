import { V8Hit, V8RuleEvaluator, V8Shift } from '../types';
import { parseTimeToMinutes, normalizedEndMinutes } from '../utils/time';

/**
 * V8 Rule: Daily Spread — two clauses, two populations, two measures.
 *
 * The agreement caps the spread of a day worked in more than one part, but it
 * does so TWICE, with different words each time, and the differences are load-
 * bearing:
 *
 *   cl 39.2 (restated verbatim at cl 28.4) — "Where split shifts are worked,
 *     the total spread of hours over which work is performed cannot exceed 12
 *     hours EXCLUDING MEAL AND REST BREAKS." Split shifts belong to part-time
 *     and flexible part-time (cl 39.1, cl 35.2(g), cl 35.3(i)); cl 7.14 defines
 *     one as ordinary hours worked in two parts by a Team Member "other than a
 *     casual", and cl 28.4 pays the allowance to everyone "other than a casual".
 *
 *   Sch 3 §5.3(g) — "A casual Event Security Team Member may work up to two (2)
 *     shifts in one day, provided that each engagement is not less than three
 *     (3) hours and that THE SPREAD OF HOURS DOES NOT EXCEED 12 HOURS." No
 *     "excluding breaks" limb, and Sch 3 §1.1 makes the schedule prevail.
 *
 * So a part-timer's twelve hours are measured NET and a casual security
 * member's are measured GROSS, and the second is the stricter of the two. That
 * is not sloppy drafting: security meal breaks are already paid (§5.3(a)), so
 * for them there is no unpaid time to exclude, and excluding paid time would
 * read the cap out of existence.
 *
 * WHO IS NOT HERE. A general casual working two shifts in a day is governed by
 * cl 35.4(f) — at most two engagements, each at its applicable minimum, and
 * "the total engagement does not exceed 12 hours". "Total engagement" is the
 * hours worked, not the span: where the drafters meant span they wrote "spread"
 * (Sch 3 §5.3(g)), four clauses apart, about the same fact pattern. Those three
 * limbs are already carried by V8_MAX_DAILY_ENGAGEMENTS, the shape layer's
 * minimum-engagement rule, and V8_MAX_DAILY_HOURS respectively, so a general
 * casual needs nothing here.
 *
 * WHAT THIS RULE USED TO DO. It read cl 39.2 as a universal daily ceiling:
 * every employment type, measured gross, firing on a lone shift. All three were
 * wrong, and together they made it the largest single source of false blocks in
 * the grid — every long permanent day with a proper meal break failed a
 * split-shift rule for staff who cannot work split shifts.
 *
 * ONE INTERPRETIVE CHOICE, STATED. cl 39.2 opens "where split shifts are
 * worked", and cl 39.4 defines a split shift as having no more than a 3-hour
 * gap. Read literally that would leave a PART-TIMER with a five-hour gap and a
 * fourteen-hour span governed by nothing at all — a wider gap attracting LESS
 * protection than a narrow one. The cap is read here as applying to any two
 * same-day engagements for the populations cl 39.1 reaches; cl 39.4 governs
 * when the Split Shift Allowance attaches, which is `splitShiftRule`'s job.
 */

/** cl 39.2 / cl 28.4 / Sch 3 §5.3(g) — twelve hours, however it is measured. */
export const DAILY_SPREAD_LIMIT_MINUTES = 720;

/** Sch 3 §5.3(g) — the flat floor for each engagement of a two-shift day. */
export const CASUAL_SECURITY_MIN_ENGAGEMENT_MINUTES = 180;

/** Back-compat alias: the cl 39.2 limb keeps its own name for the parity test. */
export const SPLIT_SHIFT_SPREAD_MINUTES = DAILY_SPREAD_LIMIT_MINUTES;

interface DayGroup {
    date:     string;
    shifts:   V8Shift[];
    /** First start to last end, in minutes. */
    gross:    number;
    /** Meal (unpaid) plus rest (paid) breaks across the day's engagements. */
    breaks:   number;
}

function groupByDay(shifts: V8Shift[]): DayGroup[] {
    const byDate = new Map<string, V8Shift[]>();
    for (const s of shifts) {
        const date = s.date || s.shift_date || '';
        if (!date || !s.start_time || !s.end_time) continue;
        const list = byDate.get(date) || [];
        list.push(s);
        byDate.set(date, list);
    }

    const groups: DayGroup[] = [];
    for (const [date, dayShifts] of byDate) {
        // A spread needs two engagements to span. On a single shift the ceiling
        // is the daily ordinary-hours cap (cl 35.1(d)/35.2(d)/35.3(d)/35.4(c)),
        // owned by SHAPE_MAX_DURATION at creation and V8_MAX_DAILY_HOURS here.
        if (dayShifts.length < 2) continue;

        let earliest = Infinity;
        let latest = -Infinity;
        let breaks = 0;
        for (const s of dayShifts) {
            earliest = Math.min(earliest, parseTimeToMinutes(s.start_time));
            latest = Math.max(latest, normalizedEndMinutes(s.start_time, s.end_time));
            breaks += (s.unpaid_break_minutes || 0) + (s.paid_break_minutes || 0);
        }
        groups.push({ date, shifts: dayShifts, gross: latest - earliest, breaks });
    }
    return groups;
}

export const dailySpreadRule: V8RuleEvaluator = (ctx) => {
    const { shifts, employee } = ctx;
    const hits: V8Hit[] = [];

    const isSplitShiftPopulation =
        employee.contract_type === 'PART_TIME' ||
        employee.contract_type === 'FLEXI_PART_TIME';
    const isCasualSecurity =
        employee.contract_type === 'CASUAL' && employee.is_security_role === true;

    if (!isSplitShiftPopulation && !isCasualSecurity) return [];

    for (const day of groupByDay(shifts)) {
        if (isSplitShiftPopulation) {
            // cl 39.2 — NET of meal and rest breaks.
            const net = Math.max(0, day.gross - day.breaks);
            if (net > DAILY_SPREAD_LIMIT_MINUTES) {
                hits.push({
                    rule_id: 'V8_SPLIT_SHIFT_SPREAD',
                    rule_name: 'Split-Shift Spread',
                    status: 'BLOCKING',
                    summary: `Split-shift spread exceeds 12h (${(net / 60).toFixed(1)}h net)`,
                    details:
                        `The engagements on ${day.date} span ${(day.gross / 60).toFixed(1)} hours from first ` +
                        `start to last end. Excluding ${day.breaks} minutes of meal and rest breaks that is ` +
                        `${(net / 60).toFixed(1)} hours of spread, over the 12-hour maximum for a split ` +
                        `shift (ICC EBA cl. 39.2).`,
                    affected_shifts: day.shifts.map(s => s.id),
                    blocking: true,
                    calculation: {
                        gross_spread_minutes: day.gross,
                        break_minutes: day.breaks,
                        net_spread_minutes: net,
                        limit_minutes: DAILY_SPREAD_LIMIT_MINUTES,
                        engagements: day.shifts.length,
                        measure: 'net',
                        date: day.date,
                    },
                });
            }
            continue;
        }

        // Sch 3 §5.3(g) — GROSS. No "excluding breaks" limb, and the meal break
        // is paid anyway, so there is no unpaid time to take out.
        if (day.gross > DAILY_SPREAD_LIMIT_MINUTES) {
            hits.push({
                rule_id: 'V8_CASUAL_SECURITY_SPREAD',
                rule_name: 'Casual Security Daily Spread',
                status: 'BLOCKING',
                summary: `Security spread exceeds 12h (${(day.gross / 60).toFixed(1)}h)`,
                details:
                    `A casual Event Security Team Member working two shifts in one day may span no more ` +
                    `than 12 hours (EBA Schedule 3 §5.3(g)). The engagements on ${day.date} span ` +
                    `${(day.gross / 60).toFixed(1)} hours. Unlike cl 39.2 this limit is measured on the ` +
                    `full span — the schedule states no exclusion for breaks, and Schedule 3 §5.3(a) ` +
                    `already makes the meal break paid.`,
                affected_shifts: day.shifts.map(s => s.id),
                blocking: true,
                calculation: {
                    gross_spread_minutes: day.gross,
                    limit_minutes: DAILY_SPREAD_LIMIT_MINUTES,
                    engagements: day.shifts.length,
                    measure: 'gross',
                    date: day.date,
                },
            });
        }

        // The other limb of the same sentence: "each engagement is not less than
        // three (3) hours". A FLAT three, where §5.3(e) would otherwise allow a
        // two-hour non-event-day training block. Reachable exactly when a casual
        // security member works a short training shift alongside another shift —
        // the shape layer cannot see it, because it needs both.
        const short = day.shifts.filter(s => {
            const worked = normalizedEndMinutes(s.start_time, s.end_time)
                - parseTimeToMinutes(s.start_time)
                - (s.unpaid_break_minutes || 0);
            return worked < CASUAL_SECURITY_MIN_ENGAGEMENT_MINUTES;
        });
        if (short.length > 0) {
            hits.push({
                rule_id: 'V8_CASUAL_SECURITY_ENGAGEMENT',
                rule_name: 'Casual Security Two-Shift Engagement',
                status: 'BLOCKING',
                summary: `Each engagement must be at least 3h when working two shifts`,
                details:
                    `Where a casual Event Security Team Member works two shifts in one day, each ` +
                    `engagement must be no less than three (3) hours (EBA Schedule 3 §5.3(g)). This is a ` +
                    `flat floor: the two-hour non-event-day training concession in §5.3(e) does not ` +
                    `survive alongside a second shift. ${short.length} engagement(s) on ${day.date} fall short.`,
                affected_shifts: short.map(s => s.id),
                blocking: true,
                calculation: {
                    required_minutes: CASUAL_SECURITY_MIN_ENGAGEMENT_MINUTES,
                    short_shift_ids: short.map(s => s.id),
                    engagements: day.shifts.length,
                    date: day.date,
                },
            });
        }
    }

    return hits;
};

/** Previous name. Kept so the engine's rule list needs no churn. */
export const spreadOfHoursRule = dailySpreadRule;
