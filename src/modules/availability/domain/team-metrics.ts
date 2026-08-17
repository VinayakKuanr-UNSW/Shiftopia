/**
 * Fatigue · Utilization · Fairness for the Availability Manager grid.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE POINT OF THIS FILE IS THE GRANULARITY. Read this before adding anything.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * These three were requested as three more per-cell modes alongside Hours and
 * Compliance. Only ONE of them is a per-day quantity, and the other two are not
 * a matter of effort — their canonical models are defined at coarser grains and
 * pushing them into a cell would mean inventing a second, rival definition.
 * This codebase has been there: the fairness/fatigue audit found FIVE rival
 * fairness definitions live at once, and the Annual Shift Grid shipped a
 * hand-rolled compliance model that contradicted the v8 engine and painted a
 * wall of false violations. So each metric is computed here at the grain its
 * own model supports, and rendered there.
 *
 *   FATIGUE      per (member, day).  REAL.
 *       `calculateFatigueWithRecovery(shifts, referenceDate)` is defined for
 *       any reference date and already carries circadian weighting and rest
 *       decay. `computePeakFatigue` samples it per day already. It reads a
 *       7-day trailing window, which the grid's 21-day lookback covers.
 *
 *   UTILIZATION  per (member, ISO week).  NOT per day.
 *       `workload.ts` floors the contracted denominator at ONE WEEK, and says
 *       why: at rangeDays=1 a 38h weekly contract becomes 5.4h, so a single
 *       legitimate 8h shift reads as ~147% over-utilized. There is no daily
 *       contracted target in `user_contracts` — only `contracted_weekly_hours`.
 *       A per-cell utilization would have to invent the denominator that file
 *       deliberately removed. The week column is the honest home for it.
 *
 *   FAIRNESS     per (member), over a 91-day window.  NOT per day OR per week.
 *       `fairness_ledger` is one row per (employee, metric, window) holding
 *       `rolling_value`, `team_average` and `debt` — fairness is a COMPARISON
 *       against the cohort, so a single person on a single day has no fairness
 *       value at all. What IS per (member, day) is their CONTRIBUTION: whether
 *       that day was a Saturday, Sunday, night or public holiday shift, which
 *       is exactly what the ledger counts. So the cells show contribution and
 *       the row shows standing. They are different things and are labelled as
 *       different things.
 *
 * @see docs/architecture/availability-manager-grid-merge-plan.md §9
 */

import {
    calculateFatigueWithRecovery,
    getFatigueBand,
    type FatigueBand,
} from '@/modules/rosters/domain/projections/utils/fatigue';
import { computeUtilizationPct } from '@/modules/rosters/domain/projections/utils/workload';
import { classifyShift, type FairnessMetric } from '@/modules/rosters/domain/fairness-ledger';
import type { RawTeamShift, TeamMember } from '../model/team-availability.types';

// ============================================================================
// FATIGUE — per (member, day)
// ============================================================================

export interface DayFatigue {
    /** Peak fatigue reached on this day. */
    score: number;
    band: FatigueBand;
}

export interface EmployeeFatigue {
    /** yyyy-MM-dd -> that day's peak. Only days the member actually worked. */
    byDate: Map<string, DayFatigue>;
    /** Worst band reached anywhere in the visible range. */
    worstBand: FatigueBand;
    peak: number;
}

/** `RawTeamShift` in the snake_case shape the fatigue model consumes. */
const toFatigueShift = (s: RawTeamShift) => ({
    shift_date: s.shiftDate,
    start_time: s.startTime,
    end_time: s.endTime,
    unpaid_break_minutes: s.unpaidBreakMinutes,
});

/**
 * Peak fatigue per member per day.
 *
 * `peak`, not `current`: the question a roster grid answers is "how bad does
 * this get for this person", which is the maximum reached on the day, not the
 * value left after resting to midnight. The two are deliberately different
 * numbers in the fatigue module and picking the wrong one here would quietly
 * report everyone as rested.
 *
 * Computed only for days the member actually worked — a fatigue score on a day
 * off is a decayed residue, and painting it across empty cells would make a
 * fortnight of leave look like a gradient of risk.
 *
 * `shifts` must be the WIDENED set: the model reads 7 trailing days, so a
 * Monday's score depends on the previous week.
 */
export function buildFatigueByEmployee(
    shifts: readonly RawTeamShift[],
    members: readonly Pick<TeamMember, 'profileId'>[],
    visibleDates: readonly string[],
): Map<string, EmployeeFatigue> {
    const byProfile = new Map<string, RawTeamShift[]>();
    for (const member of members) byProfile.set(member.profileId, []);
    for (const shift of shifts) {
        if (!shift.assignedEmployeeId) continue;
        byProfile.get(shift.assignedEmployeeId)?.push(shift);
    }

    const visible = new Set(visibleDates);
    const out = new Map<string, EmployeeFatigue>();

    for (const member of members) {
        const theirs = byProfile.get(member.profileId) ?? [];
        const entry: EmployeeFatigue = { byDate: new Map(), worstBand: 'ok', peak: 0 };

        if (theirs.length > 0) {
            const mapped = theirs.map(toFatigueShift);
            // Only days they worked, and only days on screen.
            const workedDates = [...new Set(theirs.map((s) => s.shiftDate))].filter((d) =>
                visible.has(d),
            );

            for (const date of workedDates) {
                const { peak } = calculateFatigueWithRecovery(mapped, date);
                const band = getFatigueBand(peak);
                entry.byDate.set(date, { score: peak, band });
                if (peak > entry.peak) {
                    entry.peak = peak;
                    entry.worstBand = band;
                }
            }
        }

        out.set(member.profileId, entry);
    }

    return out;
}

// ============================================================================
// UTILIZATION — per (member, ISO week)
// ============================================================================

export type UtilizationStatus = 'none' | 'under' | 'ideal' | 'over' | 'critical';

export interface WeekUtilization {
    pct: number;
    status: UtilizationStatus;
}

/**
 * Bands from `fairness.ts:getUtilizationStatus`, restated rather than imported
 * only because that module's version cannot express "this person has no
 * contract to measure against", which is a real state here (casuals with
 * `contracted_weekly_hours = 0`) and must not read as 0% under-utilized.
 */
export function utilizationStatus(pct: number, hasContract: boolean): UtilizationStatus {
    if (!hasContract) return 'none';
    if (pct < 80) return 'under';
    if (pct <= 105) return 'ideal';
    if (pct <= 120) return 'over';
    return 'critical';
}

/**
 * Utilization for ONE ISO week — 7 days, which is exactly the grain
 * `contracted_weekly_hours` is expressed in, so no scaling and no invented
 * denominator.
 */
export function weekUtilization(
    weekHours: number,
    contractedWeeklyHours: number | undefined,
): WeekUtilization {
    const hasContract = !!contractedWeeklyHours && contractedWeeklyHours > 0;
    if (!hasContract) return { pct: 0, status: 'none' };
    const pct = computeUtilizationPct(weekHours, contractedWeeklyHours, 7);
    return { pct, status: utilizationStatus(pct, true) };
}

// ============================================================================
// FAIRNESS — contribution per (member, day) · standing per (member)
// ============================================================================

/**
 * What a single worked day contributes to the fairness ledger.
 *
 * This is NOT that person's fairness. It is the classification the ledger
 * counts, for one day, for one person — the raw material the 91-day standing is
 * built from. Naming matters here: calling this "their fairness on Tuesday"
 * would be the sixth rival definition of a word this codebase has already had
 * to reconcile once.
 */
export interface DayFairnessContribution {
    isSaturday: boolean;
    isSunday: boolean;
    isNight: boolean;
    isPublicHoliday: boolean;
    /**
     * EBA cl 41 unsociability weight — Sat 1, Sun 2, public holiday 6, and a
     * night shift counts 1 on its own. Zero for an ordinary weekday day shift.
     */
    weight: number;
    labels: string[];
}

/** cl 41 weights. Sat : Sun : PH = 1 : 2 : 6. */
const WEIGHT = { saturday: 1, sunday: 2, publicHoliday: 6, night: 1 } as const;

export function dayFairnessContribution(
    shifts: readonly RawTeamShift[],
): DayFairnessContribution | null {
    if (shifts.length === 0) return null;

    let isSaturday = false;
    let isSunday = false;
    let isNight = false;
    let isPublicHoliday = false;

    for (const s of shifts) {
        // Uses the ledger's own classifier, so the public-holiday source is
        // whichever one the ledger uses — this app has had three rival holiday
        // lists and picking one here by hand is how they diverge again.
        const flags = classifyShift(s.shiftDate, s.startTime, s.endTime);
        isSaturday ||= flags.isSaturday;
        isSunday ||= flags.isSunday;
        isNight ||= flags.isNight;
        isPublicHoliday ||= flags.isPublicHoliday;
    }

    const labels: string[] = [];
    let weight = 0;
    if (isPublicHoliday) { labels.push('Public holiday'); weight += WEIGHT.publicHoliday; }
    if (isSunday) { labels.push('Sunday'); weight += WEIGHT.sunday; }
    if (isSaturday) { labels.push('Saturday'); weight += WEIGHT.saturday; }
    if (isNight) { labels.push('Night'); weight += WEIGHT.night; }

    return { isSaturday, isSunday, isNight, isPublicHoliday, weight, labels };
}

/** One employee's standing, straight off the ledger. */
export interface FairnessStanding {
    /** metric -> how far they sit from the team average over the window. */
    debtByMetric: Partial<Record<FairnessMetric, number>>;
    /** yyyy-MM-dd bounds of the ledger window these came from. */
    windowStart: string | null;
    windowEnd: string | null;
}

/**
 * The single headline number: unsociable-shift debt against the cohort.
 *
 * Combines the cl 41-weighted metrics only. `total_hours` and `denial_rate`
 * are deliberately excluded — they are fairness metrics, but they are not
 * *unsociability*, and averaging them into one figure would make a person who
 * simply works a lot indistinguishable from one who works every Sunday.
 *
 * Positive = carrying MORE than their share.
 */
export function unsociableDebt(standing: FairnessStanding | undefined): number | null {
    if (!standing) return null;
    const { debtByMetric } = standing;
    const parts: Array<[FairnessMetric, number]> = [
        ['saturday_shifts', WEIGHT.saturday],
        ['sunday_shifts', WEIGHT.sunday],
        ['public_holiday_shifts', WEIGHT.publicHoliday],
        ['night_shifts', WEIGHT.night],
    ];
    let total = 0;
    let seen = 0;
    for (const [metric, weight] of parts) {
        const v = debtByMetric[metric];
        if (typeof v === 'number' && Number.isFinite(v)) {
            total += v * weight;
            seen += 1;
        }
    }
    return seen > 0 ? Math.round(total * 10) / 10 : null;
}

export type FairnessBand = 'over' | 'balanced' | 'under';

/**
 * A debt of exactly zero is the ideal, so the band has to be a tolerance rather
 * than a sign test — otherwise a rounding-level 0.1 reads as unfair.
 */
export function fairnessBand(debt: number | null, tolerance = 1): FairnessBand {
    if (debt === null || Math.abs(debt) <= tolerance) return 'balanced';
    return debt > 0 ? 'over' : 'under';
}

export const FAIRNESS_BAND_LABEL: Record<FairnessBand, string> = {
    over: 'Over share',
    balanced: 'Balanced',
    under: 'Under share',
};

export const UTILIZATION_STATUS_LABEL: Record<UtilizationStatus, string> = {
    none: 'No contract',
    under: 'Under',
    ideal: 'On target',
    over: 'Over',
    critical: 'Well over',
};

export const FATIGUE_BAND_LABEL: Record<FatigueBand, string> = {
    ok: 'OK',
    risk: 'Elevated',
    critical: 'Critical',
};

export type { FatigueBand };
