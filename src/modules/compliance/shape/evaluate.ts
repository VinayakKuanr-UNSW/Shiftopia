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

/**
 * Positive duration in minutes of a single break `breakStart`–`breakEnd`,
 * wrapping cleanly across midnight (e.g. `23:45`–`00:15` → `30`).
 * Returns `null` when either endpoint is missing or incomplete, or `0` when equal.
 */
export function breakSpanMinutes(
    breakStart: string | null | undefined,
    breakEnd: string | null | undefined,
): number | null {
    if (!isCompleteTime(breakStart) || !isCompleteTime(breakEnd)) return null;
    const s = parseTimeToMinutes(breakStart as string);
    const e = parseTimeToMinutes(breakEnd as string);
    if (s === e) return 0;
    return (((e - s) % 1440) + 1440) % 1440;
}

/**
 * The meal break as minutes after the shift's start, across midnight — the same
 * arithmetic as the database's `shift_minutes_after_start`, so the form, the pay
 * engines and the table agree on where a break sits. `null` until all three
 * times are fully typed. `to` can land at or before `from` when the times are
 * wrong; SHAPE_BREAK_WINDOW reports that rather than this hiding it.
 */
export function mealBreakWindow(
    startTime: string | null | undefined,
    breakStart: string | null | undefined,
    breakEnd: string | null | undefined,
): { from: number; to: number; minutes: number } | null {
    if (!isCompleteTime(startTime) || !isCompleteTime(breakStart) || !isCompleteTime(breakEnd)) return null;
    const start = parseTimeToMinutes(startTime as string);
    const after = (t: string) => (((parseTimeToMinutes(t) - start) % 1440) + 1440) % 1440;
    const from = after(breakStart as string);
    const to   = after(breakEnd as string);
    return { from, to, minutes: to - from };
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
    // deducted from working time — net equals gross. Sch 3 §1.1 makes this
    // prevail over cl 36.1 for these roles.
    const mealBreakIsPaid  = isSecurity;

    /**
     * The meal break is the window `break_start`–`break_end`, paid or unpaid by
     * role. It used to be a minute total — for security, a share of a paid-break
     * POOL it held alongside the rest pauses, which this function then had to
     * pull apart by reserving the required meal length. The window carries the
     * meal break on its own now, so `paid_break_minutes` is the pauses and
     * nothing has to be inferred.
     *
     * Schedule 3 still sets TWO security entitlements: §3.2(a) FULL-TIME is "a
     * paid meal break of 30 minutes", a fixed amount; §5.3(a) PART-TIME and
     * CASUAL EVENT security is the cl 36.1 range of 30–60, paid. Hence the cap.
     */
    const isFtSecurity     = isSecurity && input.target_employment_type === 'FT';
    const mealBreakCap     = isFtSecurity ? config.meal_break_min_minutes : config.meal_break_max_minutes;
    const paidBreakForPauses = paidBreak;

    const hasExplicitBreaks = Array.isArray(input.unpaid_breaks) && input.unpaid_breaks.length > 0;
    const rawBreaks = hasExplicitBreaks
        ? input.unpaid_breaks!
        : ((input.break_start && input.break_start.trim() !== '') || (input.break_end && input.break_end.trim() !== ''))
            ? [{ sno: 1, start: input.break_start ?? '', end: input.break_end ?? '' }]
            : [];

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
    } else if (paidBreak >= grossMinutes) {
        hits.push({
            rule_id:   'SHAPE_BREAK_EXCEEDS_SHIFT',
            rule_name: 'Break Longer Than Shift',
            status:    'BLOCKING',
            summary:   `Paid rest pause (${paidBreak}m) is longer than the shift (${grossMinutes}m)`,
            details:   `Paid rest pauses (${paidBreak}m) cannot equal or exceed the ${grossMinutes}-minute shift span.`,
            blocking:  true,
            field:     'paid_break_minutes',
            calculation: { paid_break_minutes: paidBreak, gross_minutes: grossMinutes, net_minutes: netMinutes },
        });
    }

    // ── SHAPE_BREAK_WINDOW ───────────────────────────────────────────────────
    // Every scheduled break window must sit strictly inside the shift (resolving
    // overnight shifts and overnight breaks cleanly across midnight), be ordered
    // chronologically with working time between multiple breaks, be in 15-minute
    // increments, and sum to `unpaid_break_minutes` (or 0 for Security).
    const afterStart = (t: string) => (((parseTimeToMinutes(t) - startMinutes) % 1440) + 1440) % 1440;
    const insideWindows: Array<{ idx: number; start: string; end: string; from: number; to: number; minutes: number }> = [];
    let windowProblem: { summary: string; details: string; field: 'break_start' | 'break_end' } | null = null;
    let totalWindowMinutes = 0;
    let prevTo: number | null = null;

    for (let idx = 0; idx < rawBreaks.length; idx++) {
        const b = rawBreaks[idx];
        const label = rawBreaks.length > 1 ? `Break #${idx + 1}` : 'Meal break';
        const sOk = isCompleteTime(b.start);
        const eOk = isCompleteTime(b.end);

        if (!sOk || !eOk) {
            if (!windowProblem) {
                windowProblem = {
                    summary: rawBreaks.length > 1
                        ? `Set both start and end for ${label}`
                        : 'Set both the meal break start and end',
                    details: 'A meal break needs both a start and an end time.',
                    field:   sOk ? 'break_end' : 'break_start',
                };
            }
            continue;
        }

        const dur  = breakSpanMinutes(b.start, b.end) ?? 0;
        const from = afterStart(b.start);
        const to   = afterStart(b.end);
        // Overnight-safe containment: both endpoints strictly inside (0, grossMinutes)
        // AND the positive break span equals `to - from` (prevents wrap-around false positives).
        const inside = dur > 0 && from > 0 && (from + dur) === to && to < grossMinutes;

        if (!inside) {
            if (!windowProblem) {
                windowProblem = {
                    summary: `${label} must sit inside the shift`,
                    details: `${label} (${b.start}–${b.end}) must start after the shift starts (${input.start_time}) and end before it finishes (${input.end_time}).`,
                    field:   'break_start',
                };
            }
            continue;
        }

        if (prevTo !== null && from <= prevTo) {
            if (!windowProblem) {
                windowProblem = {
                    summary: `${label} overlaps or touches Break #${idx}`,
                    details: 'Multiple unpaid breaks must be listed in chronological order within the shift with working time between them.',
                    field:   'break_start',
                };
            }
            continue;
        }

        prevTo = to;
        totalWindowMinutes += dur;
        insideWindows.push({ idx, start: b.start, end: b.end, from, to, minutes: dur });

        if ((dur % 15) !== 0 && !windowProblem) {
            windowProblem = {
                summary: `${label} (${dur}m) must be in 15-minute increments`,
                details: `${label} runs ${b.start}–${b.end} (${dur} minutes). Unpaid breaks must be rostered in 15-minute increments (e.g. 30m, 45m, 60m).`,
                field:   'break_end',
            };
        }
    }

    if (!windowProblem) {
        if (rawBreaks.length === 0 && unpaidBreak > 0) {
            windowProblem = {
                summary: 'Unpaid break needs a start and end time',
                details: `This shift deducts ${unpaidBreak} unpaid minutes without saying when they are taken. Pay follows the hours actually worked — the night rate (EBA cl 43) and weekend and public-holiday loadings (cl 41) — so where the break sits changes what is owed.`,
                field:   'break_start',
            };
        } else if (rawBreaks.length > 0 && !isSecurity && unpaidBreak !== totalWindowMinutes) {
            windowProblem = {
                summary: `Unpaid break (${unpaidBreak}m) does not match the meal break (${totalWindowMinutes}m)`,
                details: `Scheduled break windows total ${totalWindowMinutes} minutes, but the shift deducts ${unpaidBreak} minutes. The unpaid break must equal the meal break window total, or be 0 where the meal break is paid.`,
                field:   'break_start',
            };
        }
    }

    if (windowProblem) {
        const firstWin = insideWindows[0] ?? null;
        hits.push({
            rule_id:   'SHAPE_BREAK_WINDOW',
            rule_name: 'Meal Break Window',
            status:    'BLOCKING',
            summary:   windowProblem.summary,
            details:   windowProblem.details,
            blocking:  true,
            field:     windowProblem.field,
            calculation: {
                break_start: rawBreaks[0]?.start ?? input.break_start ?? null,
                break_end:   rawBreaks[0]?.end ?? input.break_end ?? null,
                window_from_minutes: firstWin?.from ?? null,
                window_to_minutes:   firstWin?.to ?? null,
                total_window_minutes: totalWindowMinutes,
                break_count: rawBreaks.length,
                gross_minutes: grossMinutes,
                unpaid_break_minutes: unpaidBreak,
            },
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

    const isSalaried = !!(input.is_salaried || input.pay_basis === 'salary');

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
        const hit: ShapeHit = {
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
                is_salaried: isSalaried,
            },
        };
        if (isSalaried) {
            hit.status = 'WARNING';
            hit.blocking = false;
            hit.summary = `Advisory: ${hit.summary}`;
            hit.details += ' Salaried staff are outside EBA cl 56.2; floor is advisory.';
        }
        hits.push(hit);
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
            const hit: ShapeHit = {
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
                    is_salaried: isSalaried,
                },
            };
            if (isSalaried) {
                hit.status = 'WARNING';
                hit.blocking = false;
                hit.summary = `Advisory: ${hit.summary}`;
                hit.details += ' Salaried staff are outside EBA cl 35.1(c); floor is advisory.';
            }
            hits.push(hit);
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
            const hit: ShapeHit = {
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
                    is_salaried: isSalaried,
                },
            };
            if (isSalaried) {
                hit.status = 'WARNING';
                hit.blocking = false;
                hit.summary = `Advisory: ${hit.summary}`;
                hit.details += ' Salaried staff are outside EBA min engagement; floor is advisory.';
            }
            hits.push(hit);
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
    // 30 is a FLOOR, not the answer: any meal break from 30 to 60 is lawful, and
    // a break shorter than 30 is not a meal break at all, whatever the shift's
    // length — which is also what the database refuses.
    //
    // BLOCKING: a shift rostered without its mandatory meal break cannot lawfully
    // be worked as written. No one-click fix: WHEN the break is taken is the
    // manager's call, and offering a time would be choosing it for them.
    const mealClause = isFtSecurity    ? 'EBA Sch 3 §3.2(a)'
                     : mealBreakIsPaid ? 'EBA Sch 3 §5.3(a)'
                     :                   'ICC EBA cl 36.1';
    // §3.2(a) states one number; cl 36.1 and §5.3(a) state a range.
    const mealEntitlement = isFtSecurity
        ? `${config.meal_break_min_minutes} minutes`
        : `not less than ${config.meal_break_min_minutes} and not more than ${config.meal_break_max_minutes} minutes`;
    const mealKind = mealBreakIsPaid ? 'paid' : 'unpaid';
    const mealDue  = netMinutes > config.meal_break_threshold_minutes;
    const mealMissing = mealDue && rawBreaks.length === 0;
    const shortWin    = insideWindows.find(w => w.minutes < config.meal_break_min_minutes);

    if (mealMissing || shortWin) {
        const shortMins = shortWin?.minutes ?? 0;
        const shortLabel = rawBreaks.length > 1 && shortWin ? `Break #${shortWin.idx + 1}` : 'Meal break';
        hits.push({
            rule_id:   'SHAPE_MEAL_BREAK',
            rule_name: 'Meal Break Requirement',
            status:    'BLOCKING',
            summary:   mealMissing
                ? `${mealBreakIsPaid ? 'Paid' : 'Unpaid'} meal break required — set when it starts and ends`
                : `${shortLabel} of ${shortMins}m is under the ${config.meal_break_min_minutes}m minimum`,
            details:   `A Team Member who works more than ${hours(config.meal_break_threshold_minutes)} hours on any one day is entitled to a ${mealKind} meal break of ${mealEntitlement} (${mealClause}). ${mealMissing ? 'This shift has none — set its start and end time.' : `This shift's break is ${shortMins} minutes.`}`,
            blocking:  true,
            field:     'break_start',
            calculation: {
                net_minutes: netMinutes,
                threshold_minutes: config.meal_break_threshold_minutes,
                meal_break_minutes: shortWin ? shortMins : totalWindowMinutes,
                meal_break_is_paid: mealBreakIsPaid,
                required_break_minutes: config.meal_break_min_minutes,
                max_break_minutes: config.meal_break_max_minutes,
                eba_clause: mealClause,
            },
        });
    }

    // ── SHAPE_MEAL_BREAK_CEILING (cl 36.1; Sch 3 §3.2(a)) ────────────────────
    // Each meal break window may not exceed 60 minutes; Full-Time Security's
    // §3.2(a) entitlement is a flat 30 minutes total.
    const longWin = insideWindows.find(w => w.minutes > mealBreakCap);
    const ftSecurityOverTotal = isFtSecurity && insideWindows.length > 1 && totalWindowMinutes > mealBreakCap;
    if (longWin || ftSecurityOverTotal) {
        const offendingMins = longWin ? longWin.minutes : totalWindowMinutes;
        const offendingSpan = longWin ? `${longWin.start}–${longWin.end}` : insideWindows.map(w => `${w.start}–${w.end}`).join(', ');
        hits.push({
            rule_id:   'SHAPE_MEAL_BREAK_CEILING',
            rule_name: 'Meal Break Ceiling',
            status:    'BLOCKING',
            summary:   `Meal break of ${offendingMins}m exceeds the ${mealBreakCap}m maximum`,
            details:   `A ${mealKind} meal break is ${mealEntitlement} (${mealClause}). This shift's break runs ${offendingSpan}, ${offendingMins} minutes.`,
            blocking:  true,
            field:     'break_end',
            calculation: { meal_break_minutes: offendingMins, meal_break_is_paid: mealBreakIsPaid, max_break_minutes: mealBreakCap },
        });
    }

    // ── SHAPE_MEAL_BREAK_TIMING (cl 36.2; Sch 3 §3.2(b), §5.3(b)) ────────────
    // Evaluates all continuous working stretches around the scheduled break(s):
    // [start..break1], [break1..break2], ..., [breakN..end]. Dispersing multiple
    // breaks across a long shift keeps each continuous work stretch ≤ 5h.
    if (mealDue && insideWindows.length > 0 && insideWindows.length === rawBreaks.length) {
        const limit = config.meal_break_latest_minutes;
        const firstBefore = insideWindows[0].from;
        const lastAfter   = grossMinutes - insideWindows[insideWindows.length - 1].to;
        const stretches: string[] = [];

        if (insideWindows.length === 1) {
            if (firstBefore > limit) stretches.push(`${hours(firstBefore)}h before the break`);
            if (lastAfter > limit) stretches.push(`${hours(lastAfter)}h after it`);
        } else {
            if (firstBefore > limit) stretches.push(`${hours(firstBefore)}h before Break #1`);
            for (let k = 1; k < insideWindows.length; k++) {
                const mid = insideWindows[k].from - insideWindows[k - 1].to;
                if (mid > limit) stretches.push(`${hours(mid)}h between Break #${k} and Break #${k + 1}`);
            }
            if (lastAfter > limit) stretches.push(`${hours(lastAfter)}h after Break #${insideWindows.length}`);
        }

        if (stretches.length > 0) {
            const clause = isFtSecurity ? 'EBA Sch 3 §3.2(b)' : isSecurity ? 'EBA Sch 3 §5.3(b)' : 'ICC EBA cl 36.2';
            hits.push({
                rule_id:   'SHAPE_MEAL_BREAK_TIMING',
                rule_name: 'Meal Break Timing',
                status:    'WARNING',
                summary:   `More than ${hours(limit)}h worked without a meal break — ${stretches.join(' and ')}`,
                details:   `The Employer will endeavour to ensure no Team Member works more than ${hours(limit)} hours without a meal break (${clause}). This shift works ${stretches.join(' and ')}. Operational requirements may justify a later break; this is advisory.`,
                blocking:  false,
                field:     'break_start',
                calculation: { minutes_before_break: firstBefore, minutes_after_break: lastAfter, limit_minutes: limit },
            });
        }
    }

    // ── SHAPE_REST_PAUSE_INCREMENT / _1 / _2 (cl 37.1, 37.2) ─────────────────
    // Paid rest pauses do not shorten the shift and do not require punches,
    // and must be entered in 15-minute increments (cl 37).
    const restPause2Applies = netMinutes >= config.rest_pause_2_threshold_minutes;
    if ((paidBreakForPauses % 15) !== 0) {
        const minPauseFloor = restPause2Applies
            ? config.rest_pause_minutes * 2
            : netMinutes >= config.rest_pause_1_threshold_minutes
                ? config.rest_pause_minutes
                : 15;
        const rounded = Math.max(Math.ceil(paidBreakForPauses / 15) * 15, minPauseFloor);
        hits.push({
            rule_id:   'SHAPE_REST_PAUSE_INCREMENT',
            rule_name: 'Rest Pause Increment',
            status:    'BLOCKING',
            summary:   `Paid rest pause (${paidBreakForPauses}m) must be in 15-minute increments`,
            details:   `Paid rest pauses are 15-minute entitlements under ICC EBA cl 37.1 / cl 37.2 and must be configured in multiples of 15 minutes (0m, 15m, 30m, 45m…).`,
            blocking:  true,
            field:     'paid_break_minutes',
            fix: { field: 'paid_break_minutes', value: rounded, label: `Set ${rounded}m` },
            calculation: { paid_break_minutes: paidBreakForPauses, suggested_minutes: rounded },
        });
    }

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
            fix: { field: 'paid_break_minutes', value: config.rest_pause_minutes, label: `Set ${config.rest_pause_minutes}m` },
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
            fix: { field: 'paid_break_minutes', value: config.rest_pause_minutes * 2, label: `Set ${config.rest_pause_minutes * 2}m` },
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
    // The form derives the unpaid total from the role and never sends one; this
    // catches every other caller.
    if (isSecurity && unpaidBreak > 0) {
        hits.push({
            rule_id:   'SHAPE_SECURITY_PAID_BREAK',
            rule_name: 'Security Meal Break Must Be Paid',
            status:    'BLOCKING',
            summary:   `Security shift deducts a ${unpaidBreak}m unpaid break — its meal break is paid`,
            details:   `A Security Team Member's meal break is PAID, on the basis that they remain available to return to work (EBA Sch 3 §3.2(a) for full-time security, §5.3(a) and (c) for part-time and casual event security). Keep the meal-break window, but deduct no unpaid minutes for it.`,
            blocking:  true,
            field:     'unpaid_break_minutes',
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
