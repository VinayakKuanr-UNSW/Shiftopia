/**
 * Shift Shape Compliance — Evaluator
 *
 * The single owner of every EBA rule that can be decided from a shift alone.
 * See ./types.ts for why this layer exists and why net length is the measure.
 *
 * Rule IDs are stable and domain-named (`SHAPE_*`), deliberately NOT numbered
 * in EBA clause order — clause numbering changes between agreement versions,
 * and these IDs are referenced from test names, audit logs and UI cards.
 */

import { getShiftDayType } from '@/modules/core/lib/holidays';
import { shiftDurationMinutes, parseTimeToMinutes } from '../v8/utils/time';
import {
    DEFAULT_SHAPE_CONFIG,
    ShapeConfig,
    ShapeHit,
    ShapeInput,
    ShapeResult,
} from './types';

/**
 * The EBA minimum-engagement tier table (cl 12.3(e) / 12.4(c) / 12.5(c)).
 *
 * Applies to PT / flexible-PT / casual only. Full-time has no minimum
 * engagement — it has a daily ordinary-hours FLOOR instead (cl 35.1(c)), which
 * is more than twice as high and handled by SHAPE_FT_MIN_DAY below.
 *
 * Precedence: the training exemption wins over the Sunday/PH uplift — a
 * training shift is 2h regardless of the day it falls on.
 */
export function requiredMinEngagementMinutes(input: {
    isTraining?: boolean;
    isSunday?: boolean;
    isPublicHoliday?: boolean;
}): { requiredMins: number; reason: string } {
    if (input.isTraining) {
        return { requiredMins: 120, reason: 'training shifts' };
    }
    if (input.isSunday || input.isPublicHoliday) {
        return { requiredMins: 240, reason: 'Sundays/Public Holidays' };
    }
    return { requiredMins: 180, reason: 'standard days' };
}

const hours = (mins: number) => Math.round((mins / 60) * 100) / 100;

/** Minutes-from-midnight → `HH:mm`, wrapping past midnight. */
function minutesToTime(mins: number): string {
    const m = ((Math.round(mins) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * A fully-typed `HH:mm` (or `HH:mm:ss` from the database). Anchored at the start
 * only, so DB values with seconds pass.
 *
 * Checked rather than trusted because `parseTimeToMinutes` returns 0 for
 * anything it cannot read — including `''` and a half-typed `06:`. Zero is a
 * legitimate time (midnight), so a missing end time silently became midnight,
 * and against an 06:00 start that reads as a cross-midnight 18-hour shift. Every
 * rule then fired on a field the user had not filled in.
 */
const COMPLETE_TIME = /^([01]\d|2[0-3]):[0-5]\d/;

function isCompleteTime(t?: string | null): boolean {
    return typeof t === 'string' && COMPLETE_TIME.test(t);
}

/** Nothing to say about a shift that does not have a shape yet. */
const INCOMPLETE_RESULT: ShapeResult = {
    passed: false,
    blocking: false,
    status: 'INCOMPLETE',
    hits: [],
    net_minutes: 0,
};

/**
 * Evaluate a single shift's intrinsic shape.
 *
 * Pure and synchronous — safe to call on every keystroke in a form, inside the
 * solver's inner loop, or from a worker.
 */
export function evaluateShiftShape(
    input: ShapeInput,
    configOverride: Partial<ShapeConfig> = {},
): ShapeResult {
    const config: ShapeConfig = { ...DEFAULT_SHAPE_CONFIG, ...configOverride };
    const hits: ShapeHit[] = [];

    // A shift with a missing or half-typed time has no shape to evaluate. Report
    // that plainly instead of inventing one — the caller's own "set a start and
    // end time" prompt is the right message at this stage, not a wall of
    // breaches about fields that are still empty.
    if (!isCompleteTime(input.start_time) || !isCompleteTime(input.end_time)) {
        return INCOMPLETE_RESULT;
    }

    const unpaidBreak = Math.max(0, input.unpaid_break_minutes ?? 0);
    const paidBreak   = Math.max(0, input.paid_break_minutes ?? 0);

    const startMinutes = parseTimeToMinutes(input.start_time);
    const grossMinutes = shiftDurationMinutes(input.start_time, input.end_time);
    const netMinutes   = Math.max(0, grossMinutes - unpaidBreak);

    const isTraining = input.is_training === true;
    const dayType    = getShiftDayType(input.shift_date);
    const isSunday   = input.is_sunday ?? dayType.isSunday;
    const isPH       = input.is_public_holiday ?? dayType.isPublicHoliday;

    // ── SHAPE_VALID_RANGE ────────────────────────────────────────────────────
    // A zero-length shift is degenerate. `shiftDurationMinutes` deliberately
    // returns 0 (not 1440) when end === start, so this catches that case rather
    // than letting a placeholder shift sail through every other rule.
    if (grossMinutes <= 0) {
        hits.push({
            rule_id:   'SHAPE_VALID_RANGE',
            rule_name: 'Valid Time Range',
            status:    'BLOCKING',
            summary:   'Start and end time cannot be the same',
            details:   'A shift must have a positive duration. Set an end time later than the start time (overnight shifts are supported).',
            blocking:  true,
            field:     'end_time',
            calculation: { start_time: input.start_time, end_time: input.end_time, gross_minutes: grossMinutes },
        });

        // Every remaining rule is a statement about a real duration; running
        // them on a degenerate shift produces noise, not findings.
        return { passed: false, blocking: true, status: 'BLOCKING', hits, net_minutes: 0 };
    }

    // ── SHAPE_BREAK_EXCEEDS_SHIFT ────────────────────────────────────────────
    // Caught before the minimum rules so an over-long break reports as itself
    // rather than as a spurious minimum-engagement breach.
    if (unpaidBreak >= grossMinutes) {
        hits.push({
            rule_id:   'SHAPE_BREAK_EXCEEDS_SHIFT',
            rule_name: 'Break Longer Than Shift',
            status:    'BLOCKING',
            summary:   `Unpaid break (${unpaidBreak}m) is longer than the shift (${grossMinutes}m)`,
            details:   `The ${unpaidBreak}-minute unpaid break leaves no working time in a ${grossMinutes}-minute shift. Reduce the break or extend the shift.`,
            blocking:  true,
            field:     'unpaid_break_minutes',
            calculation: { unpaid_break_minutes: unpaidBreak, gross_minutes: grossMinutes, net_minutes: netMinutes },
        });
    }

    // ── SHAPE_MAX_SPREAD (cl 39.2) ───────────────────────────────────────────
    // Measured on GROSS span — deliberately the one place net is not the
    // measure, because spread is a statement about how long the person is tied
    // to the workplace, not how long they are paid. Without this, a 13-hour day
    // passes as "12h net" by declaring an hour of unpaid break.
    if (grossMinutes > config.max_spread_minutes) {
        hits.push({
            rule_id:   'SHAPE_MAX_SPREAD',
            rule_name: 'Maximum Spread of Hours',
            status:    'BLOCKING',
            summary:   `Spread is ${hours(grossMinutes)}h — over the ${hours(config.max_spread_minutes)}h maximum`,
            details:   `This shift spans ${hours(grossMinutes)}h from start to finish. ICC EBA cl 39.2 caps the spread of a single engagement at ${hours(config.max_spread_minutes)}h, breaks included.`,
            blocking:  true,
            field:     'end_time',
            fix: {
                field: 'end_time',
                value: minutesToTime(startMinutes + config.max_spread_minutes),
                label: `Trim to ${minutesToTime(startMinutes + config.max_spread_minutes)}`,
            },
            calculation: {
                gross_minutes: grossMinutes,
                limit_minutes: config.max_spread_minutes,
                excess_minutes: grossMinutes - config.max_spread_minutes,
            },
        });
    }

    // ── SHAPE_MAX_DURATION ───────────────────────────────────────────────────
    if (netMinutes > config.max_shift_minutes) {
        hits.push({
            rule_id:   'SHAPE_MAX_DURATION',
            rule_name: 'Maximum Shift Duration',
            status:    'BLOCKING',
            summary:   `Shift is ${hours(netMinutes)}h — over the ${hours(config.max_shift_minutes)}h maximum`,
            details:   `This shift is ${hours(netMinutes)}h of net working time, exceeding the ${hours(config.max_shift_minutes)}h maximum for a single engagement.`,
            blocking:  true,
            field:     'end_time',
            fix: {
                field: 'end_time',
                value: minutesToTime(startMinutes + config.max_shift_minutes + unpaidBreak),
                label: `Trim to ${minutesToTime(startMinutes + config.max_shift_minutes + unpaidBreak)}`,
            },
            calculation: {
                net_minutes: netMinutes,
                limit_minutes: config.max_shift_minutes,
                excess_minutes: netMinutes - config.max_shift_minutes,
            },
        });
    }

    // ── Minimum length — which rule applies depends on the employment target ──
    // FT and PT/Casual are mutually exclusive here by design: cl 12's engagement
    // tiers do not apply to full-timers at all, and cl 35.1(c)'s ordinary-hours
    // floor does not apply to anyone else. Running both would double-report.
    if (input.target_employment_type === 'FT') {
        // ── SHAPE_FT_MIN_DAY (cl 35.1(c)) ────────────────────────────────────
        // Enforced unconditionally. The clause's "may voluntarily agree to work
        // less" exception needs employee-level agreement data this system does
        // not record; a config escape hatch would silently re-open the gap that
        // let the entire FT roster sit 6 minutes under this floor.
        //
        // Measured per shift, not per day. cl 35.1(c) says "the ordinary hours
        // of any one day", but a full-time day may not lawfully be split
        // (cl 39.1 restricts split shifts to PT/flexi), so one FT shift IS the
        // FT day and the two readings coincide.
        if (netMinutes < config.ft_min_ordinary_day_minutes) {
            const shortfall = config.ft_min_ordinary_day_minutes - netMinutes;
            hits.push({
                rule_id:   'SHAPE_FT_MIN_DAY',
                rule_name: 'Full-Time Minimum Ordinary Day',
                status:    'BLOCKING',
                summary:   `Full-time shift is ${hours(netMinutes)}h — under the ${hours(config.ft_min_ordinary_day_minutes)}h minimum`,
                details:   `A shift targeted at full-time staff must provide at least ${hours(config.ft_min_ordinary_day_minutes)}h of net ordinary hours (ICC EBA cl 35.1(c)). This shift is ${hours(netMinutes)}h — ${shortfall} minutes short.`,
                blocking:  true,
                field:     'end_time',
                fix: {
                    field: 'end_time',
                    value: minutesToTime(startMinutes + config.ft_min_ordinary_day_minutes + unpaidBreak),
                    label: `Extend to ${minutesToTime(startMinutes + config.ft_min_ordinary_day_minutes + unpaidBreak)}`,
                },
                calculation: {
                    net_minutes: netMinutes,
                    required_minutes: config.ft_min_ordinary_day_minutes,
                    shortfall_minutes: shortfall,
                    eba_clause: 'cl 35.1(c)',
                },
            });
        }
    } else {
        // ── SHAPE_MIN_ENGAGEMENT (cl 12.3(e) / 12.4(c) / 12.5(c)) ────────────
        const { requiredMins, reason } = requiredMinEngagementMinutes({
            isTraining,
            isSunday,
            isPublicHoliday: isPH,
        });

        if (netMinutes < requiredMins) {
            hits.push({
                rule_id:   'SHAPE_MIN_ENGAGEMENT',
                rule_name: 'Minimum Engagement',
                status:    'BLOCKING',
                summary:   `Shift is ${hours(netMinutes)}h — under the ${hours(requiredMins)}h minimum`,
                details:   `This shift provides ${hours(netMinutes)}h of net working time. The ICC EBA requires a minimum engagement of ${hours(requiredMins)}h for ${reason}.`,
                blocking:  true,
                field:     'end_time',
                fix: {
                    field: 'end_time',
                    value: minutesToTime(startMinutes + requiredMins + unpaidBreak),
                    label: `Extend to ${minutesToTime(startMinutes + requiredMins + unpaidBreak)}`,
                },
                calculation: {
                    net_minutes: netMinutes,
                    required_minutes: requiredMins,
                    reason,
                    is_training: isTraining,
                    is_sunday: isSunday,
                    is_public_holiday: isPH,
                },
            });
        }
    }

    // ── SHAPE_MEAL_BREAK (cl 36.1) ───────────────────────────────────────────
    // "A Team Member who works for more than five (5) hours on any one day shall
    //  be entitled to an unpaid meal break of not less than thirty (30) minutes
    //  and not more than sixty (60) minutes."
    //
    // One flat rule with a RANGE, not a ladder. There is no second meal break and
    // no longer-shift tier anywhere in cl 36 — a 12h shift owes exactly the same
    // 30–60 minutes as a 5½h one. An earlier version of this rule required 60m
    // past 10h, inherited from a UI ladder rather than the agreement; the clause
    // does not say that.
    //
    // 30 is therefore a FLOOR, not the answer. The fix offers every lawful value
    // so the form does not present the minimum as though it were the requirement.
    //
    // BLOCKING: a shift rostered without its mandatory meal break cannot lawfully
    // be worked as written, and the remedy is one field in the same form.
    if (netMinutes > config.meal_break_threshold_minutes && unpaidBreak < config.meal_break_min_minutes) {
        hits.push({
            rule_id:   'SHAPE_MEAL_BREAK',
            rule_name: 'Meal Break Requirement',
            status:    'BLOCKING',
            summary:   `Unpaid meal break required — min ${config.meal_break_min_minutes}m (${unpaidBreak}m set)`,
            details:   `A Team Member who works more than ${hours(config.meal_break_threshold_minutes)} hours on any one day is entitled to an unpaid meal break of not less than ${config.meal_break_min_minutes} and not more than ${config.meal_break_max_minutes} minutes (ICC EBA cl 36.1). This shift has ${unpaidBreak} minutes scheduled.`,
            blocking:  true,
            field:     'unpaid_break_minutes',
            fix: {
                field: 'unpaid_break_minutes',
                value: config.meal_break_min_minutes,
                label: `Set ${config.meal_break_min_minutes}m`,
                options: config.meal_break_choices.map(v => ({ value: v, label: `${v}m` })),
            },
            calculation: {
                net_minutes: netMinutes,
                threshold_minutes: config.meal_break_threshold_minutes,
                unpaid_break_minutes: unpaidBreak,
                required_break_minutes: config.meal_break_min_minutes,
                max_break_minutes: config.meal_break_max_minutes,
                eba_clause: 'cl 36.1',
            },
        });
    }

    // ── SHAPE_MEAL_BREAK_CEILING (cl 36.1) ───────────────────────────────────
    // The other half of the same sentence: "not more than sixty (60) minutes".
    // Applies at every shift length, since there is only ever one meal break.
    if (unpaidBreak > config.meal_break_max_minutes) {
        hits.push({
            rule_id:   'SHAPE_MEAL_BREAK_CEILING',
            rule_name: 'Meal Break Ceiling',
            status:    'BLOCKING',
            summary:   `Meal break of ${unpaidBreak}m exceeds the ${config.meal_break_max_minutes}m maximum`,
            details:   `ICC EBA cl 36.1 caps an unpaid meal break at ${config.meal_break_max_minutes} minutes. This shift schedules ${unpaidBreak} minutes.`,
            blocking:  true,
            field:     'unpaid_break_minutes',
            fix: {
                field: 'unpaid_break_minutes',
                value: config.meal_break_max_minutes,
                label: `Set ${config.meal_break_max_minutes}m`,
                options: config.meal_break_choices.map(v => ({ value: v, label: `${v}m` })),
            },
            calculation: { unpaid_break_minutes: unpaidBreak, max_break_minutes: config.meal_break_max_minutes, eba_clause: 'cl 36.1' },
        });
    }

    // ── SHAPE_REST_PAUSE_1 / _2 (cl 37.1, 37.2) ──────────────────────────────
    // BLOCKING, per the principle that shift-shape breaches block.
    //
    // Caveat worth knowing: a rest pause is PAID time inside the shift, so
    // unlike the meal break it does not shorten the shift, and no field in this
    // system records whether one was actually TAKEN. `paid_break_minutes` is a
    // rostering declaration, not evidence. Blocking therefore enforces "the
    // roster allots the pause", not "the pause happened" — the strongest claim
    // this data model supports.
    // The two clauses are mutually exclusive by shift length, not cumulative.
    // Past 8h the requirement simply IS 30 minutes, so raising cl 37.1's "15m
    // required" alongside cl 37.2's "30m required" told the user two different
    // numbers for one obligation. Only the applicable tier is reported.
    const restPause2Applies = netMinutes >= config.rest_pause_2_threshold_minutes;

    if (!restPause2Applies
        && netMinutes >= config.rest_pause_1_threshold_minutes
        && paidBreak < config.rest_pause_minutes) {
        hits.push({
            rule_id:   'SHAPE_REST_PAUSE_1',
            rule_name: 'First Rest Pause',
            status:    'BLOCKING',
            summary:   `${config.rest_pause_minutes}m paid rest pause required (${paidBreak}m set)`,
            details:   `A paid ${config.rest_pause_minutes}-minute rest pause is due after ${hours(config.rest_pause_1_threshold_minutes)} consecutive ordinary hours worked (ICC EBA cl 37.1). Allot it in the paid-break field.`,
            blocking:  true,
            field:     'paid_break_minutes',
            fix: { field: 'paid_break_minutes', value: config.rest_pause_minutes, label: `Set ${config.rest_pause_minutes}m` },
            calculation: {
                net_minutes: netMinutes,
                threshold_minutes: config.rest_pause_1_threshold_minutes,
                paid_break_minutes: paidBreak,
                required_paid_minutes: config.rest_pause_minutes,
            },
        });
    }

    if (restPause2Applies && paidBreak < config.rest_pause_minutes * 2) {
        hits.push({
            rule_id:   'SHAPE_REST_PAUSE_2',
            rule_name: 'Second Rest Pause',
            status:    'BLOCKING',
            summary:   `${config.rest_pause_minutes * 2}m paid rest pauses required (${paidBreak}m set)`,
            details:   `A SECOND paid ${config.rest_pause_minutes}-minute rest pause is due after ${hours(config.rest_pause_2_threshold_minutes)} consecutive ordinary hours, excluding the meal break (ICC EBA cl 37.2). The two may be combined into one ${config.rest_pause_minutes * 2}-minute pause by agreement, but a combined pause must not adjoin the meal break (cl 37.3).`,
            blocking:  true,
            field:     'paid_break_minutes',
            fix: { field: 'paid_break_minutes', value: config.rest_pause_minutes * 2, label: `Set ${config.rest_pause_minutes * 2}m` },
            calculation: {
                net_minutes: netMinutes,
                threshold_minutes: config.rest_pause_2_threshold_minutes,
                paid_break_minutes: paidBreak,
                required_paid_minutes: config.rest_pause_minutes * 2,
            },
        });
    }

    const blocking = hits.some(h => h.blocking);
    const warning  = hits.some(h => h.status === 'WARNING');

    return {
        passed: !blocking,
        blocking,
        status: blocking ? 'BLOCKING' : warning ? 'WARNING' : 'PASS',
        hits,
        net_minutes: netMinutes,
    };
}
