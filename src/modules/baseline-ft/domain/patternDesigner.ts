/**
 * Designing a baseline pattern that is compliant BY CONSTRUCTION.
 *
 * The alternative — let someone hand-build a template and validate it
 * afterwards — is how production ended up with a template named "Baseline FT"
 * whose days were 8.0h, which is 40h a week against a 38h contract. The
 * arithmetic is unforgiving and invisible: 38 ÷ 5 is 7.6h EXACTLY, which is
 * also cl 35.1(c)'s daily floor, so a five-day week has no slack in either
 * direction and a nine-minute error a day is a breach.
 *
 * So this module derives the day length from the CONTRACT rather than asking
 * for it. The author chooses which days they work; the hours follow.
 *
 * WHY THIS IS NOT A NEW TABLE. It writes a normal `roster_templates` row with
 * normal `template_shifts` beneath it. The pattern storage stays exactly what
 * the rest of the product already understands — this is a shortcut into that,
 * not a parallel model.
 */

import type { Finding, IsoWeekday } from './types';

/** cl 35.1(c) — a full-time ordinary day is at least 7.6h. */
export const FT_MIN_DAY_MINUTES = 456;
/** cl 35.1(d) — and at most 12h. */
export const FT_MAX_DAY_MINUTES = 720;
/** cl 36.1 — over five hours worked needs an unpaid meal break of 30–60m. */
export const MEAL_BREAK_THRESHOLD_MINUTES = 300;
/** cl 37.1 — 15m paid rest pause after four consecutive hours. */
export const REST_PAUSE_1_AFTER_MINUTES = 240;
/** cl 37.2 — a second 15m after eight. */
export const REST_PAUSE_2_AFTER_MINUTES = 480;

export interface PatternDesignInput {
    /** Contracted hours per week. Defaults to 38 upstream when unknown. */
    weeklyHours: number;
    /** Which weekdays the employee works. Order is irrelevant; duplicates ignored. */
    days: readonly IsoWeekday[];
    /** `HH:mm`, the same start every working day. */
    startTime: string;
    /** Unpaid meal break in minutes. Must satisfy cl 36.1 when the day is long. */
    unpaidBreakMinutes: number;
    roleId: string;
}

export interface DesignedSlot {
    dayOfWeek: IsoWeekday;
    startTime: string;
    endTime: string;
    netMinutes: number;
    unpaidBreakMinutes: number;
    /** Derived from cl 37, not asked for — it is a legal consequence of length. */
    paidBreakMinutes: number;
    roleId: string;
    sortOrder: number;
}

export interface PatternDesign {
    slots: DesignedSlot[];
    findings: Finding[];
    /** Net hours each working day, derived from the contract. */
    hoursPerDay: number;
    /** `slots.length × hoursPerDay`. Equals `weeklyHours` when the design is valid. */
    weeklyHours: number;
}

function toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function toHhmm(minutes: number): string {
    const wrapped = ((minutes % 1440) + 1440) % 1440;
    const h = Math.floor(wrapped / 60);
    const m = wrapped % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** cl 37 — rest pauses are a consequence of the day's length, never a choice. */
export function requiredPaidBreakMinutes(netMinutes: number): number {
    if (netMinutes >= REST_PAUSE_2_AFTER_MINUTES) return 30;
    if (netMinutes >= REST_PAUSE_1_AFTER_MINUTES) return 15;
    return 0;
}

/**
 * How many working days a weekly quota can lawfully be spread across.
 *
 * Both ends bind: too few days makes each one longer than cl 35.1(d)'s twelve
 * hours, too many makes each shorter than cl 35.1(c)'s 7.6. For the standard
 * 38h week that leaves four or five, and nothing else.
 */
export function lawfulDayCounts(weeklyHours: number): number[] {
    const weeklyMinutes = Math.round(weeklyHours * 60);
    const out: number[] = [];
    for (let days = 1; days <= 7; days++) {
        const per = weeklyMinutes / days;
        if (per >= FT_MIN_DAY_MINUTES && per <= FT_MAX_DAY_MINUTES) out.push(days);
    }
    return out;
}

/**
 * Turn a contract plus a choice of days into a full week of shifts.
 *
 * Returns findings rather than throwing: the caller renders them next to the
 * controls that caused them, which is how the author learns that five days is
 * possible and six is not.
 */
export function designPattern(input: PatternDesignInput): PatternDesign {
    const findings: Finding[] = [];
    const days = [...new Set(input.days)].sort((a, b) => a - b);

    const empty: PatternDesign = { slots: [], findings, hoursPerDay: 0, weeklyHours: 0 };

    if (days.length === 0) {
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_DESIGN_NO_DAYS',
            plain: 'Choose at least one day this employee works.',
            overridable: false,
        });
        return empty;
    }

    if (!input.roleId) {
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_DESIGN_NO_ROLE',
            plain: 'Choose the role these shifts are for.',
            overridable: false,
        });
        return empty;
    }

    const weeklyMinutes = Math.round(input.weeklyHours * 60);
    const perDay = weeklyMinutes / days.length;

    // Non-integer minutes would be unreproducible: the stored times are
    // minute-resolution, so a day of 7.6333…h cannot be written down.
    if (!Number.isInteger(perDay)) {
        const options = lawfulDayCounts(input.weeklyHours);
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_DESIGN_UNEVEN_DAYS',
            plain:
                `${input.weeklyHours}h does not divide evenly across ${days.length} days. ` +
                (options.length > 0
                    ? `Try ${options.join(' or ')} day${options.length === 1 ? '' : 's'} instead.`
                    : `No number of equal days fits between the 7.6-hour minimum and the 12-hour maximum.`),
            clause: 'ICC EBA cl 35.1(a)',
            overridable: false,
            calculation: { weekly_hours: input.weeklyHours, days: days.length, minutes_per_day: perDay },
        });
        return empty;
    }

    if (perDay < FT_MIN_DAY_MINUTES) {
        const options = lawfulDayCounts(input.weeklyHours);
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_DESIGN_DAY_TOO_SHORT',
            plain:
                `Spreading ${input.weeklyHours}h across ${days.length} days gives ` +
                `${(perDay / 60).toFixed(2)}h a day, below the 7.6-hour minimum for a full-time day. ` +
                (options.length > 0 ? `Use ${options.join(' or ')} days instead.` : ''),
            clause: 'ICC EBA cl 35.1(c)',
            overridable: false,
            calculation: { minutes_per_day: perDay, minimum: FT_MIN_DAY_MINUTES },
        });
        return empty;
    }

    if (perDay > FT_MAX_DAY_MINUTES) {
        const options = lawfulDayCounts(input.weeklyHours);
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_DESIGN_DAY_TOO_LONG',
            plain:
                `Spreading ${input.weeklyHours}h across ${days.length} days gives ` +
                `${(perDay / 60).toFixed(2)}h a day, above the 12-hour maximum. ` +
                (options.length > 0 ? `Use ${options.join(' or ')} days instead.` : ''),
            clause: 'ICC EBA cl 35.1(d)',
            overridable: false,
            calculation: { minutes_per_day: perDay, maximum: FT_MAX_DAY_MINUTES },
        });
        return empty;
    }

    // cl 36.1 — a day over five hours needs 30–60 minutes of UNPAID meal break.
    const unpaid = input.unpaidBreakMinutes;
    if (perDay > MEAL_BREAK_THRESHOLD_MINUTES && (unpaid < 30 || unpaid > 60)) {
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_DESIGN_MEAL_BREAK',
            plain:
                `A ${(perDay / 60).toFixed(2)}-hour day needs an unpaid meal break of between 30 and ` +
                `60 minutes. ${unpaid} minutes was given.`,
            clause: 'ICC EBA cl 36.1',
            overridable: false,
            calculation: { net_minutes: perDay, unpaid_break_minutes: unpaid },
        });
        return empty;
    }

    const startMinutes = toMinutes(input.startTime);
    if (!input.startTime || Number.isNaN(startMinutes)) {
        findings.push({
            severity: 'BLOCKING',
            code: 'BFT_DESIGN_NO_START',
            plain: 'Choose the time these shifts start.',
            overridable: false,
        });
        return empty;
    }

    const paid = requiredPaidBreakMinutes(perDay);
    // The unpaid break sits INSIDE the span, so the finish time carries it; the
    // paid rest pause does not, because it is paid time already inside `net`.
    const endTime = toHhmm(startMinutes + perDay + unpaid);

    const slots: DesignedSlot[] = days.map((dayOfWeek, i) => ({
        dayOfWeek,
        startTime: input.startTime,
        endTime,
        netMinutes: perDay,
        unpaidBreakMinutes: unpaid,
        paidBreakMinutes: paid,
        roleId: input.roleId,
        sortOrder: i,
    }));

    // Worth saying out loud: a five-day 38h week lands exactly on the floor, so
    // there is no room to absorb a later change.
    if (perDay === FT_MIN_DAY_MINUTES) {
        findings.push({
            severity: 'INFO',
            code: 'BFT_DESIGN_AT_FLOOR',
            plain:
                `Each day is exactly 7.6 hours, which is both ${input.weeklyHours}h ÷ ${days.length} ` +
                `and the minimum length of a full-time day. Any shortening breaches the minimum; ` +
                `any lengthening breaches the weekly average.`,
            clause: 'ICC EBA cl 35.1(a), cl 35.1(c)',
            overridable: false,
        });
    }

    // Crossing midnight is legal but rarely intended from a simple designer.
    if (startMinutes + perDay + unpaid >= 1440) {
        findings.push({
            severity: 'WARNING',
            code: 'BFT_DESIGN_CROSSES_MIDNIGHT',
            plain:
                `These shifts finish at ${endTime} the following day. Check that is intended — ` +
                `a shift crossing midnight also has to clear the 10-hour break before the next one.`,
            clause: 'ICC EBA cl 40.1',
            overridable: true,
        });
    }

    return {
        slots,
        findings,
        hoursPerDay: perDay / 60,
        weeklyHours: (perDay * days.length) / 60,
    };
}
