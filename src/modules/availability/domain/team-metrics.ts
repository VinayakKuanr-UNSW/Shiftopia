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
 *   FAIRNESS     per (member), over the ledger window.  NOT per day OR per week.
 *       `casual_fairness_ledger` holds, per casual and metric, actual billed
 *       hours against their fair share of the casual shifts they were eligible
 *       and available for — a COMPARISON, so a single person on a single day
 *       has no fairness value at all. What IS per (member, day) is their
 *       CONTRIBUTION: the Saturday, Sunday, night and public-holiday hours of
 *       that day's casual shifts, which is exactly what the ledger measures. So
 *       the cells show contribution and the row shows standing. They are
 *       different things and are labelled as different things.
 *
 * @see docs/architecture/availability-manager-grid-merge-plan.md §9
 */

import {
    calculateFatigueWithRecovery,
    getFatigueBand,
    type FatigueBand,
} from '@/modules/rosters/domain/projections/utils/fatigue';
import { computeUtilizationPct } from '@/modules/rosters/domain/projections/utils/workload';
import {
    SC11_COEFF_PER_HOUR2,
    categoryMinutes,
    type FairnessMetric,
} from '@/modules/rosters/domain/fairness-ledger';
import type { RawTeamShift, TeamMember } from '../model/team-availability.types';

// ============================================================================
// FATIGUE — per (member, day)
// ============================================================================

interface DayFatigue {
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

interface WeekUtilization {
    pct: number;
    status: UtilizationStatus;
}

/**
 * Utilisation bands (80 / 105 / 120%), plus 'none' for "this person has no
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
 * Unsociability weight per hour, Saturday = 1: the solver's SC-11 coefficients
 * (EBA cl 41 Sat : Sun : PH = 1 : 2 : 6, night on its own scale) normalised,
 * so this page weighs an hour exactly as the autoscheduler prices it.
 */
const UNSOCIABLE_METRICS = ['saturday_hours', 'sunday_hours', 'public_holiday_hours', 'night_hours'] as const;
const WEIGHT: Record<(typeof UNSOCIABLE_METRICS)[number], number> = {
    saturday_hours: 1,
    sunday_hours: SC11_COEFF_PER_HOUR2.sunday_hours / SC11_COEFF_PER_HOUR2.saturday_hours,
    public_holiday_hours: SC11_COEFF_PER_HOUR2.public_holiday_hours / SC11_COEFF_PER_HOUR2.saturday_hours,
    night_hours: SC11_COEFF_PER_HOUR2.night_hours / SC11_COEFF_PER_HOUR2.saturday_hours,
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * What a single worked day contributes to the fairness ledger.
 *
 * This is NOT that person's fairness. It is the unsociable hours the ledger
 * measures, for one day, for one person — the raw material the standing is
 * built from. Only casual shifts count: fairness is casual-only.
 */
export interface DayFairnessContribution {
    /** Unsociable hours weighted Sat 1 / Sun 2 / PH 6 / night 1.5. Zero for an ordinary weekday day shift. */
    weight: number;
    labels: string[];
}

export function dayFairnessContribution(
    shifts: readonly RawTeamShift[],
): DayFairnessContribution | null {
    const casual = shifts.filter((s) => s.targetEmploymentType === 'Casual');
    if (casual.length === 0) return null;

    const hours = { saturday_hours: 0, sunday_hours: 0, public_holiday_hours: 0, night_hours: 0 };
    for (const s of casual) {
        // The ledger's own split, so the public-holiday source and the night
        // window are whichever ones the ledger uses.
        const m = categoryMinutes(s.shiftDate, s.startTime, s.endTime, s.netMinutes);
        hours.saturday_hours += m.saturday / 60;
        hours.sunday_hours += m.sunday / 60;
        hours.public_holiday_hours += m.public_holiday / 60;
        hours.night_hours += m.night / 60;
    }

    const labels: string[] = [];
    if (hours.public_holiday_hours > 0) labels.push('Public holiday');
    if (hours.sunday_hours > 0) labels.push('Sunday');
    if (hours.saturday_hours > 0) labels.push('Saturday');
    if (hours.night_hours > 0) labels.push('Night');
    const weight = UNSOCIABLE_METRICS.reduce((sum, metric) => sum + hours[metric] * WEIGHT[metric], 0);

    return { weight: round1(weight), labels };
}

/** One casual's standing, straight off the ledger. */
export interface MemberFairness {
    /** metric -> hours above (+) or below (−) their fair share, and how much to trust it. */
    byMetric: Partial<Record<FairnessMetric, { debtHours: number; confidence: number; opportunityCount: number }>>;
    /** yyyy-MM-dd bounds of the ledger window these came from. */
    windowStart: string | null;
    windowEnd: string | null;
}

/**
 * The single headline number: confidence-weighted unsociable hours above (+)
 * or below (−) their fair share.
 *
 * Total and overtime hours are deliberately excluded — they are fairness
 * metrics, but they are not *unsociability*, and folding them in would make a
 * person who simply works a lot indistinguishable from one who works every
 * Sunday.
 */
export function unsociableDebt(member: MemberFairness | undefined): number | null {
    if (!member) return null;
    let total = 0;
    let seen = 0;
    for (const metric of UNSOCIABLE_METRICS) {
        const entry = member.byMetric[metric];
        if (!entry || !Number.isFinite(entry.debtHours)) continue;
        total += entry.debtHours * entry.confidence * WEIGHT[metric];
        seen += 1;
    }
    return seen > 0 ? round1(total) : null;
}

type FairnessBand = 'over' | 'balanced' | 'under' | 'building' | 'na';

/** Below this confidence a standing is too thin to call either way. */
const BUILDING_BELOW_CONFIDENCE = 0.3;

/** Fairness is casual-only: does this member hold a Casual contract in scope? */
export function holdsCasualContract(member: Pick<TeamMember, 'contracts' | 'employmentStatus'>): boolean {
    return member.contracts
        ? member.contracts.some((c) => c.employmentStatus === 'Casual')
        : member.employmentStatus === 'Casual';
}

/**
 * A debt of zero is the ideal, so the band is a tolerance — half a shift
 * (4 weighted hours) — rather than a sign test. Too few opportunities is
 * neither balanced nor unbalanced: it is 'building'. Someone with no casual
 * contract is outside the model altogether: 'na'.
 */
export function fairnessBand(member: MemberFairness | undefined, isCasual: boolean, tolerance = 4): FairnessBand {
    if (!isCasual) return 'na';
    const entries = UNSOCIABLE_METRICS.map((m) => member?.byMetric[m]).filter((e) => e !== undefined);
    if (entries.every((e) => e.confidence < BUILDING_BELOW_CONFIDENCE)) return 'building';
    const debt = unsociableDebt(member) ?? 0;
    if (Math.abs(debt) <= tolerance) return 'balanced';
    return debt > 0 ? 'over' : 'under';
}

export const FAIRNESS_BAND_LABEL: Record<FairnessBand, string> = {
    over: 'Over share',
    balanced: 'Balanced',
    under: 'Under share',
    building: 'Building history',
    na: 'Casual only',
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
