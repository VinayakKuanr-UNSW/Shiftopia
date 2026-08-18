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
    ShapeEmploymentTarget,
    ShapeHit,
    ShapeInput,
    ShapeResult,
} from './types';

/**
 * The EBA minimum-engagement tier table.
 *
 * Applies to PT / flexible-PT / casual only. Full-time has no minimum
 * engagement — it has a daily ordinary-hours FLOOR instead (cl 35.1(c)), which
 * is more than twice as high and handled by SHAPE_FT_MIN_DAY below.
 *
 * THE CONCESSIONS ARE NOT UNIVERSAL (corrected 2026-08-18)
 * -------------------------------------------------------
 * cl 12.3(e) and cl 35.2(e) give PLAIN part-time a flat three consecutive
 * hours, with no exceptions of any kind. The two-hour training tier and the
 * four-hour Sunday tier appear only in cl 12.4(c) (flexible part-time) and
 * cl 12.5(c) (casual). This table previously applied all three tiers to
 * everyone, so a part-time training shift was accepted at two hours where the
 * agreement requires three.
 *
 * The public holiday is deliberately absent here. cl 56.2 grants a four-hour
 * minimum to EVERY Team Member working one, so it is not a tier of this table
 * but an independent floor — see SHAPE_MIN_ENGAGEMENT_PH. Keeping it separate
 * also settles the precedence question this table used to answer wrongly: a
 * training shift on a public holiday owes four hours under cl 56.2, not two.
 *
 * Precedence within the table: training beats the Sunday uplift, so a flexible
 * or casual training shift is two hours whichever day it falls on.
 */
export function requiredMinEngagementMinutes(input: {
    /** Omit for the legacy universal reading. Pass it to get the correct tiers. */
    target?: ShapeEmploymentTarget;
    /** Narrows a `'PT'` target to flexible part-time. */
    isFlexible?: boolean;
    isTraining?: boolean;
    isSunday?: boolean;
    isPublicHoliday?: boolean;
}): { requiredMins: number; reason: string } {
    // Plain part-time: flat 3h, no concessions (cl 12.3(e), cl 35.2(e)).
    if (input.target === 'PT' && !input.isFlexible) {
        return { requiredMins: 180, reason: 'part-time engagements (no exceptions apply)' };
    }
    if (input.isTraining) {
        return { requiredMins: 120, reason: 'training on a non-event day' };
    }
    if (input.isSunday) {
        return { requiredMins: 240, reason: 'Sundays' };
    }
    // cl 56.2 handles public holidays for every type, via its own rule.
    if (input.isPublicHoliday) {
        return { requiredMins: 240, reason: 'public holidays' };
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
    // Net is gross minus the UNPAID break. For security there is none to
    // subtract, so net and gross coincide; subtracting a paid break there would
    // understate the shift and could fail an otherwise-lawful minimum.
    const netMinutes   = Math.max(0, grossMinutes - (input.is_security === true ? 0 : unpaidBreak));

    const isTraining  = input.is_training === true;
    const isFlexible  = input.target_requires_flexible === true;
    const isSecurity  = input.is_security === true;
    const dayType     = getShiftDayType(input.shift_date);
    const isSunday    = input.is_sunday ?? dayType.isSunday;
    const isPH        = input.is_public_holiday ?? dayType.isPublicHoliday;

    // Schedule 3 §3.2(a) / §5.3(a),(c): a security meal break is PAID, on the
    // basis that the member stays available to respond. It is therefore not
    // deducted from working time — net equals gross — and the requirement is
    // satisfied from the paid-break field. Sch 3 §1.1 makes this prevail over
    // cl 36.1 for these roles.
    const mealBreakIsPaid  = isSecurity;
    const mealBreakMinutes = mealBreakIsPaid ? paidBreak : unpaidBreak;
    /**
     * Security draws BOTH the meal break and the rest pauses from the single
     * `paid_break_minutes` field, so the two have to be told apart. Reserve the
     * meal break's REQUIRED length — not its permitted maximum — and leave the
     * remainder for the pauses.
     *
     * Reserving the 60m maximum instead would swallow a fully-compliant
     * allotment: a 9h security shift owing 30m meal (Sch 3) plus 30m of pauses
     * (cl 37.1 + 37.2) declares 60m, and reserving all of it left nothing for
     * the pauses, so a correct roster failed. Reserving nothing would be the
     * opposite error — the meal break would be counted twice.
     *
     * Gated on the meal actually being due: below the cl 36.1 threshold there is
     * no meal break to reserve for, and a 4h security shift's 15m is entirely a
     * rest pause.
     */
    const mealBreakDue = netMinutes > config.meal_break_threshold_minutes;
    const paidMealAllowance = mealBreakIsPaid && mealBreakDue
        ? Math.min(paidBreak, config.meal_break_min_minutes)
        : 0;
    const paidBreakForPauses = Math.max(0, paidBreak - paidMealAllowance);

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

    // ── SHAPE_SPREAD_GUARDRAIL (house policy) ────────────────────────────────
    // Measured on GROSS span, because the concern is how long the person is tied
    // to the workplace, not how long they are paid.
    //
    // This is NOT cl 39.2 and no longer claims to be. That clause reads "Where
    // SPLIT SHIFTS are worked, the total spread of hours over which work is
    // performed cannot exceed 12 hours EXCLUDING meal and rest breaks": scoped
    // to split shifts, which cl 39.1 and cl 7.14 confine to PT and FPT, and
    // measured net. Cited here against every shift and measured gross, it
    // refused an 06:00–19:00 shift with a 1h unpaid break — twelve hours worked,
    // lawful under cl 35.1(d).
    //
    // WARNING, not blocking: a house guardrail may flag a lawful roster, but it
    // must not veto one. The real cl 39.2 test needs both halves of a split
    // shift and lives in the labour layer.
    if (grossMinutes > config.max_spread_minutes) {
        hits.push({
            rule_id:   'SHAPE_SPREAD_GUARDRAIL',
            rule_name: 'Spread of Hours Guardrail',
            status:    'WARNING',
            summary:   `Spread is ${hours(grossMinutes)}h — over the ${hours(config.max_spread_minutes)}h guideline`,
            details:   `This shift spans ${hours(grossMinutes)}h from start to finish, breaks included, above the ${hours(config.max_spread_minutes)}h house guideline. This is an ICC Sydney scheduling policy, not an EBA requirement — cl 39.2's 12-hour spread cap applies to split shifts and is measured excluding breaks.`,
            blocking:  false,
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

    // ── SHAPE_MIN_ENGAGEMENT_PH (cl 56.2) ────────────────────────────────────
    // "A Team Member working on a public holiday will be rostered to work for a
    // minimum period of four (4) consecutive hours or receive a minimum payment
    // of four (4) hours per engagement."
    //
    // Its own rule rather than a tier of the table below, for two reasons. It
    // binds EVERY Team Member — cl 56.2 draws no distinction by employment type,
    // where cl 12's tiers do. And as an independent floor it settles the
    // precedence the tier table used to get wrong: a training shift on a public
    // holiday owes four hours, not the two the training concession would give.
    // Full-time is exempt only because SHAPE_FT_MIN_DAY already demands 7.6h.
    if (isPH && input.target_employment_type !== 'FT'
        && netMinutes < config.public_holiday_min_engagement_minutes) {
        const req = config.public_holiday_min_engagement_minutes;
        const end = minutesToTime(startMinutes + req + (isSecurity ? 0 : unpaidBreak));
        hits.push({
            rule_id:   'SHAPE_MIN_ENGAGEMENT_PH',
            rule_name: 'Public Holiday Minimum Engagement',
            status:    'BLOCKING',
            summary:   `Public holiday shift is ${hours(netMinutes)}h — under the ${hours(req)}h minimum`,
            details:   `A Team Member working on a public holiday must be rostered for at least ${hours(req)} consecutive hours (ICC EBA cl 56.2). This shift provides ${hours(netMinutes)}h of net working time.`,
            blocking:  true,
            field:     'end_time',
            fix: { field: 'end_time', value: end, label: `Extend to ${end}` },
            calculation: {
                net_minutes: netMinutes,
                required_minutes: req,
                is_public_holiday: true,
                eba_clause: 'cl 56.2',
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
            target: input.target_employment_type,
            isFlexible,
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
    if (netMinutes > config.meal_break_threshold_minutes && mealBreakMinutes < config.meal_break_min_minutes) {
        const kind   = mealBreakIsPaid ? 'paid' : 'unpaid';
        const field  = mealBreakIsPaid ? ('paid_break_minutes' as const) : ('unpaid_break_minutes' as const);
        const clause = mealBreakIsPaid ? 'EBA Sch 3 §3.2 / §5.3' : 'ICC EBA cl 36.1';
        hits.push({
            rule_id:   'SHAPE_MEAL_BREAK',
            rule_name: 'Meal Break Requirement',
            status:    'BLOCKING',
            summary:   `${mealBreakIsPaid ? 'Paid' : 'Unpaid'} meal break required — min ${config.meal_break_min_minutes}m (${mealBreakMinutes}m set)`,
            details:   `A Team Member who works more than ${hours(config.meal_break_threshold_minutes)} hours on any one day is entitled to a ${kind} meal break of not less than ${config.meal_break_min_minutes} and not more than ${config.meal_break_max_minutes} minutes (${clause}). This shift has ${mealBreakMinutes} minutes scheduled.`,
            blocking:  true,
            field,
            fix: {
                field,
                value: config.meal_break_min_minutes,
                label: `Set ${config.meal_break_min_minutes}m`,
                options: config.meal_break_choices.map(v => ({ value: v, label: `${v}m` })),
            },
            calculation: {
                net_minutes: netMinutes,
                threshold_minutes: config.meal_break_threshold_minutes,
                meal_break_minutes: mealBreakMinutes,
                meal_break_is_paid: mealBreakIsPaid,
                required_break_minutes: config.meal_break_min_minutes,
                max_break_minutes: config.meal_break_max_minutes,
                eba_clause: mealBreakIsPaid ? 'Sch 3 §3.2 / §5.3' : 'cl 36.1',
            },
        });
    }

    // ── SHAPE_MEAL_BREAK_CEILING (cl 36.1) ───────────────────────────────────
    // The other half of the same sentence: "not more than sixty (60) minutes".
    // Applies at every shift length, since there is only ever one meal break.
    if (mealBreakMinutes > config.meal_break_max_minutes) {
        hits.push({
            rule_id:   'SHAPE_MEAL_BREAK_CEILING',
            rule_name: 'Meal Break Ceiling',
            status:    'BLOCKING',
            summary:   `Meal break of ${mealBreakMinutes}m exceeds the ${config.meal_break_max_minutes}m maximum`,
            details:   `A meal break is capped at ${config.meal_break_max_minutes} minutes (${mealBreakIsPaid ? 'EBA Sch 3 §5.3' : 'ICC EBA cl 36.1'}). This shift schedules ${mealBreakMinutes} minutes.`,
            blocking:  true,
            field:     mealBreakIsPaid ? 'paid_break_minutes' : 'unpaid_break_minutes',
            fix: {
                field: mealBreakIsPaid ? 'paid_break_minutes' : 'unpaid_break_minutes',
                value: config.meal_break_max_minutes,
                label: `Set ${config.meal_break_max_minutes}m`,
                options: config.meal_break_choices.map(v => ({ value: v, label: `${v}m` })),
            },
            calculation: { meal_break_minutes: mealBreakMinutes, meal_break_is_paid: mealBreakIsPaid, max_break_minutes: config.meal_break_max_minutes },
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
        && paidBreakForPauses < config.rest_pause_minutes) {
        hits.push({
            rule_id:   'SHAPE_REST_PAUSE_1',
            rule_name: 'First Rest Pause',
            status:    'BLOCKING',
            summary:   `${config.rest_pause_minutes}m paid rest pause required (${paidBreakForPauses}m set)`,
            details:   `A paid ${config.rest_pause_minutes}-minute rest pause is due after ${hours(config.rest_pause_1_threshold_minutes)} consecutive ordinary hours worked (ICC EBA cl 37.1). Allot it in the paid-break field.`,
            blocking:  true,
            field:     'paid_break_minutes',
            fix: { field: 'paid_break_minutes', value: paidMealAllowance + config.rest_pause_minutes, label: `Set ${paidMealAllowance + config.rest_pause_minutes}m` },
            calculation: {
                net_minutes: netMinutes,
                threshold_minutes: config.rest_pause_1_threshold_minutes,
                paid_break_minutes: paidBreakForPauses,
                required_paid_minutes: config.rest_pause_minutes,
            },
        });
    }

    if (restPause2Applies && paidBreakForPauses < config.rest_pause_minutes * 2) {
        hits.push({
            rule_id:   'SHAPE_REST_PAUSE_2',
            rule_name: 'Second Rest Pause',
            status:    'BLOCKING',
            summary:   `${config.rest_pause_minutes * 2}m paid rest pauses required (${paidBreakForPauses}m set)`,
            details:   `A SECOND paid ${config.rest_pause_minutes}-minute rest pause is due after ${hours(config.rest_pause_2_threshold_minutes)} consecutive ordinary hours, excluding the meal break (ICC EBA cl 37.2). The two may be combined into one ${config.rest_pause_minutes * 2}-minute pause by agreement, but a combined pause must not adjoin the meal break (cl 37.3).`,
            blocking:  true,
            field:     'paid_break_minutes',
            fix: { field: 'paid_break_minutes', value: paidMealAllowance + config.rest_pause_minutes * 2, label: `Set ${paidMealAllowance + config.rest_pause_minutes * 2}m` },
            calculation: {
                net_minutes: netMinutes,
                threshold_minutes: config.rest_pause_2_threshold_minutes,
                paid_break_minutes: paidBreakForPauses,
                required_paid_minutes: config.rest_pause_minutes * 2,
            },
        });
    }

    // ── SHAPE_SECURITY_PAID_BREAK (Sch 3 §3.2, §5.3) ─────────────────────────
    // A security meal break is paid, so an unpaid one on a security shift is
    // both a Schedule 3 breach and a silent mis-measurement: `netMinutes`
    // ignores it, so the roster shows more working time than the form recorded.
    // Flagged rather than absorbed, with the remedy being to move the minutes.
    if (isSecurity && unpaidBreak > 0) {
        hits.push({
            rule_id:   'SHAPE_SECURITY_PAID_BREAK',
            rule_name: 'Security Meal Break Must Be Paid',
            status:    'BLOCKING',
            summary:   `Security shift has a ${unpaidBreak}m unpaid break — it must be paid`,
            details:   `A Security Team Member's meal break is PAID, on the basis that they remain available to return to work (EBA Sch 3 §3.2(a) for full-time security, §5.3(a) and (c) for part-time and casual event security). Move these ${unpaidBreak} minutes to the paid-break field.`,
            blocking:  true,
            field:     'unpaid_break_minutes',
            fix: { field: 'unpaid_break_minutes', value: 0, label: 'Clear unpaid break' },
            calculation: { unpaid_break_minutes: unpaidBreak, paid_break_minutes: paidBreak, schedule: 'Sch 3 §3.2 / §5.3' },
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
